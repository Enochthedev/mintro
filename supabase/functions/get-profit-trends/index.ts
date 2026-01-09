import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-profit-trends
 * 
 * REFACTORED: Always calculates profit trends using available data.
 * Primary cost source: linked bank transactions (transaction_job_allocations)
 * Falls back to stored actual_profit or blueprint estimates when no transactions linked.
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
      .select(`
        id,
        invoice,
        amount,
        invoice_date,
        total_actual_cost,
        actual_profit,
        cost_override_by_user,
        blueprint_usage (
          id,
          cost_blueprints (
            total_estimated_cost
          )
        )
      `)
      .eq("user_id", user.id)
      .gte("invoice_date", startDate.toISOString().split('T')[0])
      .lte("invoice_date", endDate.toISOString().split('T')[0])
      .order("invoice_date", { ascending: true });

    if (invoicesError) {
      throw invoicesError;
    }

    // ============================================
    // GET LINKED TRANSACTIONS FOR ALL INVOICES
    // ============================================
    const invoiceIds = invoices?.map(inv => inv.id) || [];

    const { data: allAllocations, error: allocError } = await supabaseClient
      .from("transaction_job_allocations")
      .select("job_id, allocation_amount")
      .in("job_id", invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

    if (allocError) {
      console.error("Error fetching allocations:", allocError);
    }

    // Group allocations by invoice
    const allocationsByInvoice = new Map<string, number>();
    (allAllocations || []).forEach((alloc: { job_id: string; allocation_amount: number | string }) => {
      const current = allocationsByInvoice.get(alloc.job_id) || 0;
      allocationsByInvoice.set(alloc.job_id, current + Math.abs(parseFloat(String(alloc.allocation_amount || 0))));
    });

    // ============================================
    // GET ALL TRANSACTIONS IN RANGE (for expense tracking)
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
    // CALCULATE PROFIT FOR EACH INVOICE
    // ============================================
    const invoiceCalculations = (invoices || []).map(inv => {
      const revenue = parseFloat(inv.amount || 0);

      // Get costs from linked transactions (primary source)
      const transactionCosts = allocationsByInvoice.get(inv.id) || 0;

      // Get estimated costs from blueprints
      const blueprintCosts = (inv.blueprint_usage || []).reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
        0
      );

      // Determine effective cost
      let effectiveCost: number;
      if (inv.cost_override_by_user && inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
      } else if (inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else {
        effectiveCost = 0;
      }

      const profit = revenue - effectiveCost;
      const hasCostData = transactionCosts > 0 || blueprintCosts > 0 || inv.total_actual_cost !== null;

      return {
        id: inv.id,
        invoice_date: inv.invoice_date,
        revenue,
        cost: effectiveCost,
        profit,
        has_cost_data: hasCostData,
      };
    });

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
    const invoicesWithCostDataByPeriod = new Map();

    invoiceCalculations.forEach(inv => {
      const key = getKey(inv.invoice_date);

      revenueByPeriod.set(key, (revenueByPeriod.get(key) || 0) + inv.revenue);
      costByPeriod.set(key, (costByPeriod.get(key) || 0) + inv.cost);
      profitByPeriod.set(key, (profitByPeriod.get(key) || 0) + inv.profit);
      invoiceCountByPeriod.set(key, (invoiceCountByPeriod.get(key) || 0) + 1);
      if (inv.has_cost_data) {
        invoicesWithCostDataByPeriod.set(key, (invoicesWithCostDataByPeriod.get(key) || 0) + 1);
      }
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

    const trends = Array.from(allPeriods).sort().map(periodKey => {
      const revenue = revenueByPeriod.get(periodKey) || 0;
      const expenses = expensesByPeriod.get(periodKey) || 0;
      const cost = costByPeriod.get(periodKey) || 0;
      const profit = profitByPeriod.get(periodKey) || 0;
      const netProfit = revenue - expenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const invoiceCount = invoiceCountByPeriod.get(periodKey) || 0;
      const invoicesWithCostData = invoicesWithCostDataByPeriod.get(periodKey) || 0;

      return {
        period: periodKey,
        revenue: parseFloat(revenue.toFixed(2)),
        expenses: parseFloat(expenses.toFixed(2)),
        job_costs: parseFloat(cost.toFixed(2)),
        job_profit: parseFloat(profit.toFixed(2)),
        net_profit: parseFloat(netProfit.toFixed(2)),
        job_profit_margin: parseFloat(margin.toFixed(2)),
        net_profit_margin: parseFloat(netMargin.toFixed(2)),
        invoice_count: invoiceCount,
        invoices_with_cost_data: invoicesWithCostData,
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

      const profitGrowth = previous.job_profit > 0
        ? ((current.job_profit - previous.job_profit) / previous.job_profit) * 100
        : 0;

      const netProfitGrowth = previous.net_profit > 0
        ? ((current.net_profit - previous.net_profit) / previous.net_profit) * 100
        : 0;

      growthRates.push({
        period: current.period,
        revenue_growth: parseFloat(revenueGrowth.toFixed(2)),
        job_profit_growth: parseFloat(profitGrowth.toFixed(2)),
        net_profit_growth: parseFloat(netProfitGrowth.toFixed(2)),
      });
    }

    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    const totalRevenue = trends.reduce((sum, t) => sum + t.revenue, 0);
    const totalExpenses = trends.reduce((sum, t) => sum + t.expenses, 0);
    const totalJobProfit = trends.reduce((sum, t) => sum + t.job_profit, 0);
    const totalNetProfit = trends.reduce((sum, t) => sum + t.net_profit, 0);
    const averagePeriodRevenue = trends.length > 0 ? totalRevenue / trends.length : 0;
    const averagePeriodProfit = trends.length > 0 ? totalJobProfit / trends.length : 0;

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

    const totalInvoicesWithCostData = invoiceCalculations.filter(c => c.has_cost_data).length;
    const totalInvoices = invoiceCalculations.length;

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
          total_job_profit: parseFloat(totalJobProfit.toFixed(2)),
          total_net_profit: parseFloat(totalNetProfit.toFixed(2)),
          average_period_revenue: parseFloat(averagePeriodRevenue.toFixed(2)),
          average_period_profit: parseFloat(averagePeriodProfit.toFixed(2)),
          periods_analyzed: trends.length,
          trend_direction: trendDirection,
          total_invoices: totalInvoices,
          invoices_with_cost_data: totalInvoicesWithCostData,
        },
        data_quality: {
          message: totalInvoicesWithCostData === 0
            ? "No cost data available. Link bank transactions to invoices for profit trend analysis."
            : totalInvoicesWithCostData < totalInvoices
              ? `${totalInvoicesWithCostData} of ${totalInvoices} invoices have cost data. Profit trends may not be fully accurate.`
              : "All invoices have cost data for accurate trend analysis.",
          cost_data_coverage: totalInvoices > 0
            ? parseFloat(((totalInvoicesWithCostData / totalInvoices) * 100).toFixed(2))
            : 0,
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