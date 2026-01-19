import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * quickbooks-sync-all
 * 
 * ONE ENDPOINT TO SYNC EVERYTHING from QuickBooks:
 * 
 * 1. Chart of Accounts - For expense classification
 * 2. Items - Products with PurchaseCost (actual costs!)
 * 3. Invoices - Revenue data
 * 4. Purchases - Actual expenses (checks, CC, cash)
 * 5. Bills - Vendor bills (accounts payable)
 * 6. Auto-link expenses to invoices via CustomerRef
 * 
 * After this sync, analytics use REAL costs from QuickBooks!
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

        // Get QuickBooks tokens
        const { data: qbAuth, error: qbAuthError } = await supabaseClient
            .from("quickbooks_auth")
            .select("access_token, refresh_token, realm_id, token_expires_at")
            .eq("user_id", user.id)
            .single();

        if (qbAuthError || !qbAuth) {
            return new Response(
                JSON.stringify({ error: "QuickBooks not connected. Please connect your QuickBooks account first." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check token expiration and refresh if needed
        let accessToken = qbAuth.access_token;
        const expiresAt = new Date(qbAuth.token_expires_at);

        if (expiresAt <= new Date()) {
            console.log("Token expired, refreshing...");
            const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
            if (!refreshResult.success) {
                return new Response(
                    JSON.stringify({ error: "Failed to refresh QuickBooks token. Please reconnect." }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            accessToken = refreshResult.access_token;

            await supabaseClient
                .from("quickbooks_auth")
                .update({
                    access_token: refreshResult.access_token,
                    refresh_token: refreshResult.refresh_token,
                    token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
                })
                .eq("user_id", user.id);
        }

        const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox"
            ? "https://sandbox-quickbooks.api.intuit.com"
            : "https://quickbooks.api.intuit.com";

        const results = {
            chart_of_accounts: { synced: 0, errors: [] as string[] },
            items: { synced: 0, with_purchase_cost: 0, errors: [] as string[] },
            invoices: { synced: 0, updated: 0, errors: [] as string[] },
            expenses: { purchases: 0, bills: 0, errors: [] as string[] },
            linking: { matched: 0, total_cost_linked: 0 },
        };

        // ========== 1. SYNC CHART OF ACCOUNTS ==========
        console.log("Step 1: Syncing Chart of Accounts...");
        try {
            const accountQuery = encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000");
            const accountResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${accountQuery}`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
            );

            if (accountResponse.ok) {
                const accountData = await accountResponse.json();
                const accounts = accountData.QueryResponse?.Account || [];

                for (const account of accounts) {
                    const mintroCategory = classifyAccountType(account.AccountType);

                    await supabaseClient.from("quickbooks_chart_of_accounts").upsert({
                        user_id: user.id,
                        quickbooks_account_id: account.Id,
                        name: account.Name,
                        account_type: account.AccountType,
                        account_sub_type: account.AccountSubType || null,
                        classification: account.Classification,
                        mintro_category: mintroCategory,
                        is_active: account.Active,
                        synced_at: new Date().toISOString(),
                    }, { onConflict: "user_id,quickbooks_account_id" });

                    results.chart_of_accounts.synced++;
                }
            }
        } catch (err: any) {
            results.chart_of_accounts.errors.push(err.message);
        }

        // ========== 2. SYNC ITEMS (WITH PURCHASE COST) ==========
        console.log("Step 2: Syncing Items with PurchaseCost...");
        try {
            const itemQuery = encodeURIComponent("SELECT * FROM Item MAXRESULTS 1000");
            const itemResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${itemQuery}`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
            );

            if (itemResponse.ok) {
                const itemData = await itemResponse.json();
                const items = itemData.QueryResponse?.Item || [];

                for (const item of items) {
                    await supabaseClient.from("quickbooks_items").upsert({
                        user_id: user.id,
                        quickbooks_item_id: item.Id,
                        name: item.Name,
                        sku: item.Sku || null,
                        description: item.Description || null,
                        item_type: item.Type,
                        unit_price: item.UnitPrice || null,
                        purchase_cost: item.PurchaseCost || null,
                        qty_on_hand: item.QtyOnHand || 0,
                        income_account_ref: item.IncomeAccountRef?.name || null,
                        expense_account_ref: item.ExpenseAccountRef?.name || null,
                        asset_account_ref: item.AssetAccountRef?.name || null,
                        is_active: item.Active,
                        synced_at: new Date().toISOString(),
                    }, { onConflict: "user_id,quickbooks_item_id" });

                    results.items.synced++;
                    if (item.PurchaseCost) results.items.with_purchase_cost++;
                }
            }
        } catch (err: any) {
            results.items.errors.push(err.message);
        }

        // ========== 3. SYNC INVOICES (REVENUE) + CALCULATE COSTS FROM ITEMS ==========
        console.log("Step 3: Syncing Invoices with Item costs...");

        // First, load all items with PurchaseCost into a lookup map
        const { data: itemsWithCost } = await supabaseClient
            .from("quickbooks_items")
            .select("quickbooks_item_id, name, purchase_cost, unit_price")
            .eq("user_id", user.id)
            .not("purchase_cost", "is", null);

        const itemCostMap = new Map<string, { purchaseCost: number; unitPrice: number; name: string }>();
        (itemsWithCost || []).forEach(item => {
            itemCostMap.set(item.quickbooks_item_id, {
                purchaseCost: item.purchase_cost,
                unitPrice: item.unit_price || 0,
                name: item.name,
            });
        });
        console.log(`Loaded ${itemCostMap.size} items with PurchaseCost for invoice cost calculation`);

        // Also load Chart of Accounts for fallback
        const { data: chartOfAccounts } = await supabaseClient
            .from("quickbooks_chart_of_accounts")
            .select("quickbooks_account_id, mintro_category, account_type")
            .eq("user_id", user.id);

        const accountMap = new Map<string, { category: string; accountType: string }>();
        (chartOfAccounts || []).forEach(acc => {
            accountMap.set(acc.quickbooks_account_id, {
                category: acc.mintro_category,
                accountType: acc.account_type,
            });
        });

        try {
            const invoiceQuery = encodeURIComponent("SELECT * FROM Invoice MAXRESULTS 1000");
            const invoiceResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${invoiceQuery}`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
            );

            if (invoiceResponse.ok) {
                const invoiceData = await invoiceResponse.json();
                const qbInvoices = invoiceData.QueryResponse?.Invoice || [];

                for (const qbInvoice of qbInvoices) {
                    // Check if exists
                    const { data: existing } = await supabaseClient
                        .from("invoices")
                        .select("id, cost_data_source")
                        .eq("user_id", user.id)
                        .eq("quickbooks_invoice_id", qbInvoice.Id)
                        .single();

                    // Calculate costs from line items using Item.PurchaseCost
                    const costCalc = calculateCostsFromLineItems(qbInvoice.Line, itemCostMap, accountMap);

                    const invoiceRecord: any = {
                        user_id: user.id,
                        quickbooks_invoice_id: qbInvoice.Id,
                        quickbooks_doc_number: qbInvoice.DocNumber || null,
                        quickbooks_customer_ref: qbInvoice.CustomerRef?.value || null,
                        client: qbInvoice.CustomerRef?.name || "Unknown",
                        amount: qbInvoice.TotalAmt || 0,
                        status: mapQBStatus(qbInvoice.Balance, qbInvoice.TotalAmt),
                        invoice_date: qbInvoice.TxnDate || null,
                        due_date: qbInvoice.DueDate || null,
                        service_type: deriveServiceType(qbInvoice.Line),
                        synced_at: new Date().toISOString(),
                    };

                    // Only set costs if we don't already have better data (expense-linked)
                    const existingSource = existing?.cost_data_source;
                    if (!existingSource || existingSource !== "qb_expense_linked") {
                        invoiceRecord.actual_materials_cost = costCalc.materials;
                        invoiceRecord.actual_labor_cost = costCalc.labor;
                        invoiceRecord.actual_overhead_cost = costCalc.overhead;
                        invoiceRecord.total_actual_cost = costCalc.totalCost;
                        invoiceRecord.actual_profit = (qbInvoice.TotalAmt || 0) - costCalc.totalCost;
                        invoiceRecord.cost_data_source = costCalc.source;
                    }

                    if (existing) {
                        await supabaseClient.from("invoices").update(invoiceRecord).eq("id", existing.id);
                        results.invoices.updated++;
                    } else {
                        await supabaseClient.from("invoices").insert(invoiceRecord);
                        results.invoices.synced++;
                    }
                }
            }
        } catch (err: any) {
            results.invoices.errors.push(err.message);
        }

        // ========== 4. SYNC PURCHASES (ACTUAL EXPENSES) ==========
        console.log("Step 4: Syncing Purchases (actual expenses)...");
        try {
            const purchaseQuery = encodeURIComponent("SELECT * FROM Purchase MAXRESULTS 1000");
            const purchaseResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${purchaseQuery}`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
            );

            if (purchaseResponse.ok) {
                const purchaseData = await purchaseResponse.json();
                const purchases = purchaseData.QueryResponse?.Purchase || [];

                for (const purchase of purchases) {
                    const refs = extractLineRefs(purchase.Line);

                    await supabaseClient.from("quickbooks_expenses").upsert({
                        user_id: user.id,
                        quickbooks_expense_id: purchase.Id,
                        expense_type: "purchase",
                        vendor_name: purchase.EntityRef?.name || null,
                        vendor_id: purchase.EntityRef?.value || null,
                        total_amount: purchase.TotalAmt,
                        payment_type: purchase.PaymentType || null,
                        customer_ref_id: refs.customerRefId,
                        customer_ref_name: refs.customerRefName,
                        account_ref_id: refs.accountRefId,
                        account_ref_name: refs.accountRefName,
                        transaction_date: purchase.TxnDate,
                        line_items: purchase.Line,
                        memo: purchase.PrivateNote || null,
                        synced_at: new Date().toISOString(),
                    }, { onConflict: "user_id,quickbooks_expense_id" });

                    results.expenses.purchases++;
                }
            }
        } catch (err: any) {
            results.expenses.errors.push(`Purchases: ${err.message}`);
        }

        // ========== 5. SYNC BILLS (VENDOR BILLS) ==========
        console.log("Step 5: Syncing Bills (vendor invoices)...");
        try {
            const billQuery = encodeURIComponent("SELECT * FROM Bill MAXRESULTS 1000");
            const billResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${billQuery}`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
            );

            if (billResponse.ok) {
                const billData = await billResponse.json();
                const bills = billData.QueryResponse?.Bill || [];

                for (const bill of bills) {
                    const refs = extractLineRefs(bill.Line);

                    await supabaseClient.from("quickbooks_expenses").upsert({
                        user_id: user.id,
                        quickbooks_expense_id: `bill-${bill.Id}`,
                        expense_type: "bill",
                        vendor_name: bill.VendorRef?.name || null,
                        vendor_id: bill.VendorRef?.value || null,
                        total_amount: bill.TotalAmt,
                        customer_ref_id: refs.customerRefId,
                        customer_ref_name: refs.customerRefName,
                        account_ref_id: refs.accountRefId,
                        account_ref_name: refs.accountRefName,
                        transaction_date: bill.TxnDate,
                        due_date: bill.DueDate || null,
                        line_items: bill.Line,
                        memo: bill.PrivateNote || null,
                        synced_at: new Date().toISOString(),
                    }, { onConflict: "user_id,quickbooks_expense_id" });

                    results.expenses.bills++;
                }
            }
        } catch (err: any) {
            results.expenses.errors.push(`Bills: ${err.message}`);
        }

        // ========== 6. AUTO-LINK EXPENSES TO INVOICES ==========
        console.log("Step 6: Auto-linking expenses to invoices via CustomerRef...");
        try {
            // Get all expenses with customer refs
            const { data: expenses } = await supabaseClient
                .from("quickbooks_expenses")
                .select("id, customer_ref_id, total_amount, account_ref_name, vendor_name")
                .eq("user_id", user.id)
                .not("customer_ref_id", "is", null)
                .eq("is_linked_to_invoice", false);

            // Get all invoices with QB customer refs
            const { data: invoices } = await supabaseClient
                .from("invoices")
                .select("id, quickbooks_customer_ref, amount")
                .eq("user_id", user.id)
                .not("quickbooks_customer_ref", "is", null);

            // Group expenses by customer ref
            const expensesByCustomer = new Map<string, any[]>();
            (expenses || []).forEach(exp => {
                const key = exp.customer_ref_id;
                if (!expensesByCustomer.has(key)) expensesByCustomer.set(key, []);
                expensesByCustomer.get(key)!.push(exp);
            });

            // Match and link
            for (const invoice of invoices || []) {
                const matchedExpenses = expensesByCustomer.get(invoice.quickbooks_customer_ref) || [];

                if (matchedExpenses.length > 0) {
                    const totalCost = matchedExpenses.reduce((sum, e) => sum + (e.total_amount || 0), 0);

                    // Categorize costs
                    let materials = 0, labor = 0, overhead = 0;
                    for (const exp of matchedExpenses) {
                        const account = (exp.account_ref_name || "").toLowerCase();
                        const vendor = (exp.vendor_name || "").toLowerCase();
                        const amount = exp.total_amount || 0;

                        if (account.includes("cogs") || account.includes("material") || vendor.includes("depot") || vendor.includes("supply")) {
                            materials += amount;
                        } else if (account.includes("labor") || account.includes("subcontract")) {
                            labor += amount;
                        } else {
                            overhead += amount;
                        }

                        // Mark expense as linked
                        await supabaseClient
                            .from("quickbooks_expenses")
                            .update({ is_linked_to_invoice: true, linked_invoice_id: invoice.id })
                            .eq("id", exp.id);
                    }

                    // Update invoice with real costs
                    await supabaseClient.from("invoices").update({
                        total_actual_cost: totalCost,
                        actual_materials_cost: materials,
                        actual_labor_cost: labor,
                        actual_overhead_cost: overhead,
                        actual_profit: (invoice.amount || 0) - totalCost,
                        cost_data_source: "qb_expense_linked",
                    }).eq("id", invoice.id);

                    results.linking.matched++;
                    results.linking.total_cost_linked += totalCost;
                }
            }
        } catch (err: any) {
            console.error("Linking error:", err);
        }

        // ========== FINAL SUMMARY ==========
        const totalExpenses = results.expenses.purchases + results.expenses.bills;

        return new Response(
            JSON.stringify({
                success: true,
                message: `Synced ${results.chart_of_accounts.synced} accounts, ${results.items.synced} items, ${results.invoices.synced + results.invoices.updated} invoices, ${totalExpenses} expenses. Linked ${results.linking.matched} expense sets to invoices.`,
                sync_results: results,
                data_sources: {
                    revenue: "QuickBooks Invoices",
                    costs: "QuickBooks Purchases + Bills",
                    item_costs: `${results.items.with_purchase_cost} items have PurchaseCost`,
                    linked: `${results.linking.matched} invoices have real QB costs ($${results.linking.total_cost_linked.toFixed(2)})`,
                },
                next_steps: [
                    "Run get-business-profitability to see accurate analytics",
                    "Invoices with cost_data_source='qb_expense_linked' have REAL costs",
                    "Unlinked invoices fall back to Chart of Accounts estimation",
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

// Helper: Classify QB AccountType to Mintro category
function classifyAccountType(accountType: string): string {
    const type = accountType?.toLowerCase() || "";
    if (type.includes("cost of goods")) return "cogs";
    if (type.includes("expense") || type.includes("other expense")) return "expense";
    if (type.includes("income") || type.includes("other income")) return "revenue";
    if (type.includes("bank") || type.includes("credit card") || type.includes("loan") || type.includes("equity")) return "exclude";
    return "other";
}

// Helper: Extract refs from line items
function extractLineRefs(lines: any[]): any {
    let customerRefId = null, customerRefName = null, accountRefId = null, accountRefName = null;

    for (const line of lines || []) {
        const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
        if (detail) {
            if (detail.CustomerRef && !customerRefId) {
                customerRefId = detail.CustomerRef.value;
                customerRefName = detail.CustomerRef.name;
            }
            if (detail.AccountRef && !accountRefId) {
                accountRefId = detail.AccountRef.value;
                accountRefName = detail.AccountRef.name;
            }
        }
    }
    return { customerRefId, customerRefName, accountRefId, accountRefName };
}

// Helper: Map QB status
function mapQBStatus(balance: number, total: number): string {
    if (balance === 0) return "paid";
    if (balance < total) return "partial";
    return "sent";
}

// Helper: Derive service type from line items
function deriveServiceType(lines: any[]): string {
    const keywords: Record<string, string[]> = {
        "Landscaping": ["landscape", "lawn", "garden", "plant", "tree", "shrub"],
        "Design": ["design", "consult", "plan", "architect"],
        "Installation": ["install", "setup", "build", "construct"],
        "Maintenance": ["maint", "repair", "service", "clean"],
    };

    for (const line of lines || []) {
        const desc = (line.Description || line.SalesItemLineDetail?.ItemRef?.name || "").toLowerCase();
        for (const [type, words] of Object.entries(keywords)) {
            if (words.some(w => desc.includes(w))) return type;
        }
    }
    return "General";
}

// Helper: Calculate costs from invoice line items using Item.PurchaseCost + Chart of Accounts
function calculateCostsFromLineItems(
    lines: any[],
    itemCostMap: Map<string, { purchaseCost: number; unitPrice: number; name: string }>,
    accountMap: Map<string, { category: string; accountType: string }>
): { materials: number; labor: number; overhead: number; totalCost: number; source: string } {
    let materials = 0;
    let labor = 0;
    let overhead = 0;
    let hasItemCost = false;
    let hasAccountCost = false;

    for (const line of lines || []) {
        if (line.DetailType !== "SalesItemLineDetail" || !line.SalesItemLineDetail) continue;

        const itemRef = line.SalesItemLineDetail.ItemRef;
        const qty = line.SalesItemLineDetail.Qty || 1;
        const lineAmount = line.Amount || 0;

        if (!itemRef) continue;

        // Priority 1: Use Item.PurchaseCost if available (ACTUAL COST!)
        const itemData = itemCostMap.get(itemRef.value);
        if (itemData && itemData.purchaseCost > 0) {
            const actualCost = itemData.purchaseCost * qty;
            materials += actualCost;  // Items with PurchaseCost are typically materials
            hasItemCost = true;
            continue;
        }

        // Priority 2: Use Chart of Accounts classification for estimation
        const accountRef = line.SalesItemLineDetail.ItemAccountRef?.value;
        if (accountRef && accountMap.has(accountRef)) {
            const { category, accountType } = accountMap.get(accountRef)!;
            hasAccountCost = true;

            if (category === "cogs" || accountType.toLowerCase().includes("cost of goods")) {
                materials += lineAmount * 0.6;  // 60% of sale = estimated cost
            } else if (category === "expense") {
                labor += lineAmount * 0.4;
            } else if (category === "revenue" || category === "other") {
                overhead += lineAmount * 0.15;
            }
            continue;
        }

        // Priority 3: Keyword-based fallback
        const desc = (line.Description || itemRef.name || "").toLowerCase();
        if (desc.includes("material") || desc.includes("supply") || desc.includes("product")) {
            materials += lineAmount * 0.6;
        } else if (desc.includes("labor") || desc.includes("install") || desc.includes("service")) {
            labor += lineAmount * 0.4;
        } else {
            overhead += lineAmount * 0.15;
        }
    }

    const totalCost = materials + labor + overhead;

    // Determine the source of cost data
    let source = "keyword_fallback";
    if (hasItemCost) {
        source = "qb_item_cost";  // Best - actual Item.PurchaseCost
    } else if (hasAccountCost) {
        source = "chart_of_accounts";  // Good - estimated from account type
    }

    return { materials, labor, overhead, totalCost, source };
}

// Helper: Refresh token
async function refreshAccessToken(refreshToken: string): Promise<any> {
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");

    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });

    if (!response.ok) return { success: false };
    const data = await response.json();
    return { success: true, ...data };
}

