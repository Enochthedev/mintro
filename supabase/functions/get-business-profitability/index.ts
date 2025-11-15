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
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");

    // Default to current year if no dates provided
    const startDate = start_date || `${new Date().getFullYear()}-01-01`;
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // ============================================
    // REVENUE: Get all invoices
    // ============================================
    const { data: invoices, error: invoicesError } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    if (invoicesError) {
      throw invoicesError;
    }

    const totalRevenue = invoices?.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0) || 0;
    const invoicesWithCosts = invoices?.filter(inv => inv.total_actual_cost !== null) || [];
    
    const totalActualCost = invoicesWithCosts.reduce(
      (sum, inv) => sum + parseFloat(inv.total_actual_cost || 0), 0
    );

    const totalActualProfit = invoicesWithCosts.reduce(
      (sum, inv) => sum + parseFloat(inv.actual_profit || 0), 0
    );

    // ============================================
    // EXPENSES: Get all transactions (negative = income, positive = expense)
    // ============================================
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("amount, date, category")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate);

    if (txError) {
      throw txError;
    }

    const totalExpenses = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      return amount > 0 ? sum + amount : sum;
    }, 0) || 0;

    const totalIncome = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      return amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0) || 0;

    // ============================================
    // PROFITABILITY METRICS
    // ============================================
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    
    const averageJobProfit = invoicesWithCosts.length > 0 
      ? totalActualProfit / invoicesWithCosts.length 
      : 0;

    const averageJobMargin = invoicesWithCosts.length > 0
      ? (totalActualProfit / invoicesWithCosts.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0)) * 100
      : 0;

    // ============================================
    // BREAKDOWN BY SERVICE TYPE
    // ============================================
    const serviceTypeBreakdown = new Map();

    invoices?.forEach(inv => {
      const serviceType = inv.service_type || "Uncategorized";
      const current = serviceTypeBreakdown.get(serviceType) || {
        revenue: 0,
        cost: 0,
        profit: 0,
        count: 0,
      };

      current.revenue += parseFloat(inv.amount || 0);
      current.cost += parseFloat(inv.total_actual_cost || 0);
      current.profit += parseFloat(inv.actual_profit || 0);
      current.count += 1;

      serviceTypeBreakdown.set(serviceType, current);
    });

    const serviceTypes = Array.from(serviceTypeBreakdown.entries()).map(([type, data]) => ({
      service_type: type,
      revenue: data.revenue,
      cost: data.cost,
      profit: data.profit,
      profit_margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
      invoice_count: data.count,
    })).sort((a, b) => b.revenue - a.revenue);

    // ============================================
    // MONTH-OVER-MONTH COMPARISON
    // ============================================
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const currentMonthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const lastMonthStart = currentMonth === 0 
      ? `${currentYear - 1}-12-01`
      : `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const lastMonthEnd = currentMonth === 0
      ? `${currentYear - 1}-12-31`
      : `${currentYear}-${String(currentMonth).padStart(2, '0')}-${new Date(currentYear, currentMonth, 0).getDate()}`;

    const currentMonthInvoices = invoices?.filter(inv => inv.invoice_date >= currentMonthStart) || [];
    const lastMonthInvoices = invoices?.filter(
      inv => inv.invoice_date >= lastMonthStart && inv.invoice_date <= lastMonthEnd
    ) || [];

    const currentMonthRevenue = currentMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
    
    const revenueChange = lastMonthRevenue > 0 
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        period: {
          start_date: startDate,
          end_date: endDate,
        },
        overview: {
          total_revenue: parseFloat(totalRevenue.toFixed(2)),
          total_expenses: parseFloat(totalExpenses.toFixed(2)),
          total_income_from_transactions: parseFloat(totalIncome.toFixed(2)),
          net_profit: parseFloat(netProfit.toFixed(2)),
          profit_margin: parseFloat(profitMargin.toFixed(2)),
        },
        job_metrics: {
          total_invoices: invoices?.length || 0,
          invoices_with_cost_tracking: invoicesWithCosts.length,
          total_actual_cost: parseFloat(totalActualCost.toFixed(2)),
          total_actual_profit: parseFloat(totalActualProfit.toFixed(2)),
          average_job_profit: parseFloat(averageJobProfit.toFixed(2)),
          average_job_margin: parseFloat(averageJobMargin.toFixed(2)),
        },
        service_type_breakdown: serviceTypes,
        month_over_month: {
          current_month_revenue: parseFloat(currentMonthRevenue.toFixed(2)),
          last_month_revenue: parseFloat(lastMonthRevenue.toFixed(2)),
          revenue_change_percent: parseFloat(revenueChange.toFixed(2)),
          trend: revenueChange > 0 ? "up" : revenueChange < 0 ? "down" : "flat",
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