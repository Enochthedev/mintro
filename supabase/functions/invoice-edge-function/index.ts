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
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: authHeader
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
    const status = url.searchParams.get("status") ?? undefined;
    const client = url.searchParams.get("client") ?? undefined;
    const service_type = url.searchParams.get("service_type") ?? undefined;
    const start_date = url.searchParams.get("start_date") ?? undefined;
    const end_date = url.searchParams.get("end_date") ?? undefined;
    const has_actual_costs = url.searchParams.get("has_actual_costs") ?? undefined;
    const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    let query = supabaseClient.from("invoices").select(`
        *,
        invoice_items (*),
        blueprint_usage (
          id,
          blueprint_id,
          total_actual_cost,
          actual_profit,
          cost_blueprints (
            name,
            blueprint_type
          )
        ),
        transaction_job_allocations (
          id,
          allocation_amount,
          allocation_percentage,
          transactions (
            id,
            transaction_id,
            name,
            merchant_name,
            amount,
            date,
            category
          )
        )
      `, {
      count: "exact"
    }).eq("user_id", user.id);
    if (status) query = query.eq("status", status);
    if (client) query = query.ilike("client", `%${client}%`);
    if (service_type) query = query.eq("service_type", service_type);
    if (start_date) query = query.gte("invoice_date", start_date);
    if (end_date) query = query.lte("invoice_date", end_date);
    if (has_actual_costs === "true") {
      query = query.not("total_actual_cost", "is", null);
    } else if (has_actual_costs === "false") {
      query = query.is("total_actual_cost", null);
    }
    query = query.order("invoice_date", {
      ascending: false
    }).range(offset, offset + limit - 1);
    const { data: invoicesRaw, error: invoicesError, count } = await query;
    if (invoicesError) throw invoicesError;
    const invoices = invoicesRaw ?? [];
    // Helper to safely parse numbers
    const parseNum = (v)=>{
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    // Calculate summary
    const totalRevenue = invoices.reduce((sum, inv)=>sum + parseNum(inv.amount), 0);
    const totalActualCost = invoices.reduce((sum, inv)=>sum + parseNum(inv.total_actual_cost), 0);
    const totalActualProfit = invoices.reduce((sum, inv)=>sum + parseNum(inv.actual_profit), 0);
    const invoicesWithProfit = invoices.filter((inv)=>inv.total_actual_cost !== null);
    const averageProfitMargin = invoicesWithProfit.length > 0 ? totalActualProfit / (totalRevenue || 1) * 100 : 0;
    // Enrich each invoice
    const enrichedInvoices = invoices.map((invoice)=>{
      const linkedTransactionsCount = invoice.transaction_job_allocations?.length || 0;
      const linkedBlueprintsCount = invoice.blueprint_usage?.length || 0;
      const totalLinkedCost = (invoice.transaction_job_allocations || []).reduce((sum, alloc)=>sum + parseNum(alloc.allocation_amount), 0);
      return {
        ...invoice,
        computed: {
          linked_transactions_count: linkedTransactionsCount,
          linked_blueprints_count: linkedBlueprintsCount,
          total_linked_cost: Number(totalLinkedCost.toFixed(2)),
          has_linked_transactions: linkedTransactionsCount > 0,
          has_cost_tracking: linkedTransactionsCount > 0 || invoice.total_actual_cost !== null
        }
      };
    });
    return new Response(JSON.stringify({
      success: true,
      invoices: enrichedInvoices,
      pagination: {
        total: count ?? 0,
        limit,
        offset,
        has_more: count ? offset + limit < count : false
      },
      summary: {
        total_invoices: count ?? 0,
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_actual_cost: Number(totalActualCost.toFixed(2)),
        total_actual_profit: Number(totalActualProfit.toFixed(2)),
        average_profit_margin: Number(averageProfitMargin.toFixed(2)),
        invoices_with_costs: invoicesWithProfit.length
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
