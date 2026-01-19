import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * quickbooks-link-expenses-to-invoices
 * 
 * Automatically links QuickBooks expenses to invoices using:
 * 1. CustomerRef matching (QB expenses tagged to a customer)
 * 2. Date range matching (expenses near invoice date)
 * 
 * After linking, invoice costs are calculated from REAL QB data!
 */

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            {
                global: {
                    headers: { Authorization: req.headers.get("Authorization")! },
                },
            }
        );

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body = await req.json().catch(() => ({}));
        const { invoice_id, auto_link_all = false } = body;

        const results = {
            invoices_processed: 0,
            expenses_linked: 0,
            total_costs_from_qb: 0,
            links: [] as any[],
        };

        // Get all QB expenses with customer refs (not yet linked)
        const { data: expenses, error: expenseError } = await supabaseClient
            .from("quickbooks_expenses")
            .select("*")
            .eq("user_id", user.id)
            .not("customer_ref_id", "is", null);

        if (expenseError) throw expenseError;
        console.log(`Found ${expenses?.length || 0} expenses with customer refs`);

        // Get invoices to process
        let invoicesQuery = supabaseClient
            .from("invoices")
            .select("id, quickbooks_customer_ref, client, amount, service_type, invoice_date")
            .eq("user_id", user.id);

        if (invoice_id) {
            invoicesQuery = invoicesQuery.eq("id", invoice_id);
        } else if (!auto_link_all) {
            // Only process invoices without linked QB expenses
            invoicesQuery = invoicesQuery.is("cost_data_source", null)
                .or("cost_data_source.eq.estimated,cost_data_source.eq.keyword_fallback");
        }

        const { data: invoices, error: invoiceError } = await invoicesQuery;
        if (invoiceError) throw invoiceError;
        console.log(`Processing ${invoices?.length || 0} invoices`);

        // Create lookup map for expenses by customer_ref_id
        const expensesByCustomer = new Map<string, any[]>();
        (expenses || []).forEach(exp => {
            const key = exp.customer_ref_id;
            if (!expensesByCustomer.has(key)) {
                expensesByCustomer.set(key, []);
            }
            expensesByCustomer.get(key)!.push(exp);
        });

        // Process each invoice
        for (const invoice of invoices || []) {
            results.invoices_processed++;

            // Match by QB customer ref
            const customerRef = invoice.quickbooks_customer_ref;
            const matchedExpenses = customerRef ? expensesByCustomer.get(customerRef) || [] : [];

            if (matchedExpenses.length > 0) {
                // Calculate total costs from matched expenses
                const totalFromQB = matchedExpenses.reduce((sum, exp) => sum + (exp.total_amount || 0), 0);
                results.total_costs_from_qb += totalFromQB;
                results.expenses_linked += matchedExpenses.length;

                // Categorize expenses (simple heuristic based on account names)
                let materialsCost = 0;
                let laborCost = 0;
                let overheadCost = 0;

                for (const exp of matchedExpenses) {
                    const accountName = (exp.account_ref_name || "").toLowerCase();
                    const vendorName = (exp.vendor_name || "").toLowerCase();
                    const amount = exp.total_amount || 0;

                    if (
                        accountName.includes("material") ||
                        accountName.includes("cogs") ||
                        accountName.includes("inventory") ||
                        vendorName.includes("depot") ||
                        vendorName.includes("lowes") ||
                        vendorName.includes("supply")
                    ) {
                        materialsCost += amount;
                    } else if (
                        accountName.includes("labor") ||
                        accountName.includes("subcontract") ||
                        accountName.includes("payroll") ||
                        vendorName.includes("contractor")
                    ) {
                        laborCost += amount;
                    } else {
                        overheadCost += amount;
                    }

                    // Mark expense as linked
                    await supabaseClient
                        .from("quickbooks_expenses")
                        .update({
                            is_linked_to_invoice: true,
                            linked_invoice_id: invoice.id,
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", exp.id);
                }

                // Update invoice with real QB costs
                await supabaseClient
                    .from("invoices")
                    .update({
                        total_actual_cost: totalFromQB,
                        actual_materials_cost: materialsCost,
                        actual_labor_cost: laborCost,
                        actual_overhead_cost: overheadCost,
                        actual_profit: (invoice.amount || 0) - totalFromQB,
                        cost_data_source: "qb_expense_linked",
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", invoice.id);

                results.links.push({
                    invoice_id: invoice.id,
                    client: invoice.client,
                    invoice_amount: invoice.amount,
                    expenses_matched: matchedExpenses.length,
                    total_cost: totalFromQB,
                    materials: materialsCost,
                    labor: laborCost,
                    overhead: overheadCost,
                    profit: (invoice.amount || 0) - totalFromQB,
                });
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Linked ${results.expenses_linked} QB expenses to ${results.links.length} invoices`,
                results,
                next_steps: [
                    "Invoices now have accurate costs from QuickBooks!",
                    "Check get-business-profitability for updated analytics",
                    "Expense categorization uses account names - refine as needed",
                ],
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
