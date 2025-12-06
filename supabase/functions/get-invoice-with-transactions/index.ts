import { createClient } from "npm:@supabase/supabase-js@2.29.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? ""
        }
      }
    });
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    const user = userData?.user ?? null;
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const url = new URL(req.url);
    const invoice_id = url.searchParams.get("invoice_id");
    if (!invoice_id) {
      return new Response(JSON.stringify({
        error: "invoice_id is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: invoice, error: invoiceError } = await supabaseClient.from("invoices").select(`
        *,
        invoice_items (*),
        blueprint_usage (
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price
          )
        ),
        transaction_job_allocations (
          id,
          allocation_amount,
          allocation_percentage,
          notes,
          created_at,
          updated_at,
          transactions (
            id,
            transaction_id,
            date,
            name,
            merchant_name,
            amount,
            category,
            pending,
            payment_channel,
            bank_accounts (
              id,
              name,
              mask,
              type
            )
          )
        )
      `).eq("id", invoice_id).eq("user_id", user.id).single();
    if (invoiceError) {
      throw invoiceError;
    }
    if (!invoice) {
      return new Response(JSON.stringify({
        error: "Invoice not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const linkedTransactionsCount = invoice.transaction_job_allocations?.length ?? 0;
    const linkedBlueprintsCount = invoice.blueprint_usage?.length ?? 0;
    const totalLinkedTransactionsCost = (invoice.transaction_job_allocations ?? []).reduce((sum, alloc)=>{
      const amt = Number(alloc.allocation_amount) || 0;
      return sum + amt;
    }, 0);
    const estimatedCost = (invoice.blueprint_usage ?? []).reduce((sum, usage)=>{
      const cost = Number(usage.cost_blueprints?.total_estimated_cost) || 0;
      return sum + cost;
    }, 0);
    const invoiceAmount = Number(invoice.amount) || 0;
    const estimatedProfit = invoiceAmount - estimatedCost;
    const actualProfit = invoiceAmount - totalLinkedTransactionsCost;
    const profitVariance = estimatedProfit !== 0 && totalLinkedTransactionsCost > 0 ? (actualProfit - estimatedProfit) / estimatedProfit * 100 : 0;
    return new Response(JSON.stringify({
      success: true,
      invoice,
      summary: {
        linked_transactions: linkedTransactionsCount,
        linked_blueprints: linkedBlueprintsCount,
        total_linked_costs: parseFloat(totalLinkedTransactionsCost.toFixed(2)),
        estimated_cost: parseFloat(estimatedCost.toFixed(2)),
        estimated_profit: parseFloat(estimatedProfit.toFixed(2)),
        actual_cost: parseFloat(totalLinkedTransactionsCost.toFixed(2)),
        actual_profit: parseFloat(actualProfit.toFixed(2)),
        profit_variance_percent: parseFloat(profitVariance.toFixed(2))
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error?.message ?? String(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
