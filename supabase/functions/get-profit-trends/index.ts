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
    const period = url.searchParams.get("period") || "monthly"; // monthly, quarterly, yearly
    const months = parseInt(url.searchParams.get("months") || "12");

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // ============================================
    // GET ALL INVOICES IN RANGE
    // ============================================
    const { data: invoices, error: invoicesError } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .gte("invoice_date", startDate.toISOString().split('T')[0])
      .lte("invoice_date", endDate.toISOString().split('T')[0])
      .order("invoice_date", { ascending: true });

    if (invoicesError) {
      throw invoicesError;
    }

    // ============================================
    // GET ALL TRANSACTIONS IN RANGE
    // ============================================
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("amount, date")
      .eq("user_id", user.id)
      .gte("date", startDate.toISOString().split('T')[0])
      .lte("date", endDate.toISOString().split('T')[0])
      .order("date", { ascending: true });

    if (txError) {
      throw txError;
    }

    // ============================================
    // AGGREGATE BY PERIOD
    // ============================================
    const getMonthKey = (date: string) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const getQuarterKey = (date: string) => {
      const d = new Date(date);
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}-Q${quarter}`;
    };

    const getYearKey = (date: string) => {
      return new Date(date).getFullYear().toString();
    };

    const getKey = period === "quarterly" 
      ? getQuarterKey 
      : period === "yearly" 
        ? getYearKey 
        : getMonthKey;

    // Aggregate invoices
    const revenueByPeriod = new Map();
    const costByPeriod = new Map();
    const profitByPeriod = new Map();
    const invoiceCountByPeriod = new Map();

    invoices?.forEach(inv => {
      const key = getKey(inv.invoice_date);
      
      revenueByPeriod.set(key, (revenueByPeriod.get(key) || 0) + parseFloat(inv.amount || 0));
      costByPeriod.set(key, (costByPeriod.get(key) || 0) + parseFloat(inv.total_actual_cost || 0));
      profitByPeriod.set(key, (profitByPeriod.get(key) || 0) + parseFloat(inv.actual_profit || 0));
      invoiceCountByPeriod.set(key, (invoiceCountByPeriod.get(key) || 0) + 1);
    });

    // Aggregate transactions (expenses)
    const expensesByPeriod = new Map();

    transactions?.forEach(tx => {
      const amount = parseFloat(tx.amount || 0);
      if (amount > 0) { // Positive = expense
        const key = getKey(tx.date);
        expensesByPeriod.set(key, (expensesByPeriod.get(key) || 0) + amount);
      }
    });

    // ============================================
    // BUILD TREND DATA
    // ============================================
    const allPeriods = new Set([
      ...revenueByPeriod.keys(),
      ...expensesByPeriod.keys(),
    ]);

    const trends = Array.from(allPeriods).sort().map(period => {
      const revenue = revenueByPeriod.get(period) || 0;
      const expenses = expensesByPeriod.get(period) || 0;
      const cost = costByPeriod.get(period) || 0;
      const profit = profitByPeriod.get(period) || 0;
      const netProfit = revenue - expenses;
      const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const jobMargin = revenue > 0 && profit > 0 ? (profit / revenue) * 100 : 0;

      return {
        period,
        revenue: parseFloat(revenue.toFixed(2)),
        expenses: parseFloat(expenses.toFixed(2)),
        tracked_cost: parseFloat(cost.toFixed(2)),
        tracked_profit: parseFloat(profit.toFixed(2)),
        net_profit: parseFloat(netProfit.toFixed(2)),
        profit_margin: parseFloat(margin.toFixed(2)),
        job_profit_margin: parseFloat(jobMargin.toFixed(2)),
        invoice_count: invoiceCountByPeriod.get(period) || 0,
      };
    });

    // ============================================
    // CALCULATE GROWTH RATES
    // ============================================
    const growthRates = [];
    for (let i = 1; i < trends.length; i++) {
      const current = trends[i];
      const previous = trends[i - 1];

      const revenueGrowth = previous.revenue > 0 
        ? ((current.revenue - previous.revenue) / previous.revenue) * 100 
        : 0;

      const profitGrowth = previous.net_profit > 0 
        ? ((current.net_profit - previous.net_profit) / previous.net_profit) * 100 
        : 0;

      growthRates.push({
        period: current.period,
        revenue_growth: parseFloat(revenueGrowth.toFixed(2)),
        profit_growth: parseFloat(profitGrowth.toFixed(2)),
      });
    }

    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    const totalRevenue = trends.reduce((sum, t) => sum + t.revenue, 0);
    const totalExpenses = trends.reduce((sum, t) => sum + t.expenses, 0);
    const averageMonthlyRevenue = trends.length > 0 ? totalRevenue / trends.length : 0;
    const averageMonthlyProfit = trends.length > 0 
      ? trends.reduce((sum, t) => sum + t.net_profit, 0) / trends.length 
      : 0;

    // Calculate trend direction
    const recentPeriods = trends.slice(-3);
    const olderPeriods = trends.slice(-6, -3);
    
    const recentAvgRevenue = recentPeriods.length > 0 
      ? recentPeriods.reduce((sum, t) => sum + t.revenue, 0) / recentPeriods.length 
      : 0;
    const olderAvgRevenue = olderPeriods.length > 0 
      ? olderPeriods.reduce((sum, t) => sum + t.revenue, 0) / olderPeriods.length 
      : 0;

    const trendDirection = recentAvgRevenue > olderAvgRevenue 
      ? "growing" 
      : recentAvgRevenue < olderAvgRevenue 
        ? "declining" 
        : "stable";

    return new Response(
      JSON.stringify({
        success: true,
        period_type: period,
        months_analyzed: months,
        trends,
        growth_rates: growthRates,
        summary: {
          total_revenue: parseFloat(totalRevenue.toFixed(2)),
          total_expenses: parseFloat(totalExpenses.toFixed(2)),
          average_period_revenue: parseFloat(averageMonthlyRevenue.toFixed(2)),
          average_period_profit: parseFloat(averageMonthlyProfit.toFixed(2)),
          periods_analyzed: trends.length,
          trend_direction: trendDirection,
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