import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const client = url.searchParams.get("client");
    const service_type = url.searchParams.get("service_type");
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    const has_actual_costs = url.searchParams.get("has_actual_costs");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    let query = supabaseClient
      .from("invoices")
      .select(`
        *,
        invoice_items (*),
        blueprint_usage (
          id,
          blueprint_id,
          actual_sale_price,
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
          notes,
          created_at,
          transactions (
            id,
            transaction_id,
            date,
            name,
            merchant_name,
            amount,
            category
          )
        )
      `, { count: "exact" })
      .eq("user_id", user.id);

    if (status) {
      query = query.eq("status", status);
    }

    if (client) {
      query = query.ilike("client", `%${client}%`);
    }

    if (service_type) {
      query = query.eq("service_type", service_type);
    }

    if (start_date) {
      query = query.gte("invoice_date", start_date);
    }

    if (end_date) {
      query = query.lte("invoice_date", end_date);
    }

    if (has_actual_costs === "true") {
      query = query.not("total_actual_cost", "is", null);
    } else if (has_actual_costs === "false") {
      query = query.is("total_actual_cost", null);
    }

    query = query
      .order("invoice_date", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: invoices, error: invoicesError, count } = await query;

    if (invoicesError) {
      throw invoicesError;
    }

    // Calculate summary
    const totalRevenue = invoices?.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0) || 0;
    const totalActualCost = invoices?.reduce((sum, inv) => sum + parseFloat(inv.total_actual_cost || 0), 0) || 0;
    const totalActualProfit = invoices?.reduce((sum, inv) => sum + parseFloat(inv.actual_profit || 0), 0) || 0;

    const invoicesWithProfit = invoices?.filter(inv => inv.total_actual_cost !== null) || [];
    const averageProfitMargin = invoicesWithProfit.length > 0
      ? (totalActualProfit / totalRevenue) * 100
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        invoices: invoices || [],
        pagination: {
          total: count || 0,
          limit,
          offset,
          has_more: count ? offset + limit < count : false,
        },
        summary: {
          total_invoices: count || 0,
          total_revenue: totalRevenue,
          total_actual_cost: totalActualCost,
          total_actual_profit: totalActualProfit,
          average_profit_margin: parseFloat(averageProfitMargin.toFixed(2)),
          invoices_with_costs: invoicesWithProfit.length,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});