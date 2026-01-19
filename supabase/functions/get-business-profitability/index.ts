import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-business-profitability
 * 
 * REFACTORED: Now calculates profit for ALL invoices using whatever data exists:
 * - Revenue from invoice totals
 * - Costs from linked bank transactions (transaction_job_allocations)
 * - Optional: Estimated costs from blueprints for comparison
 * - Optional: Manual overrides when present
 * 
 * The engine NO LONGER requires blueprints or manual overrides to function.
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
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");

    // Default to current year if no dates provided
    const startDate = start_date || `${new Date().getFullYear()}-01-01`;
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // ============================================
    // REVENUE: Get ALL invoices (no filtering by cost data)
    // ============================================
    const { data: invoices, error: invoicesError } = await supabaseClient
      .from("invoices")
      .select(`
        id,
        invoice,
        client,
        amount,
        invoice_date,
        service_type,
        status,
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
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    if (invoicesError) {
      throw invoicesError;
    }

    // ============================================
    // COSTS: Get all linked transactions for these invoices
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
    // EXPENSES: Get all transactions (for overall expense tracking)
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

    // EXPENSE LOGIC:
    // - Revenue category = income (not expense)
    // - Everything else (including Miscellaneous) = expense
    //
    // Plaid convention:
    // - Negative amounts = money OUT (expenses, payments, purchases)
    // - Positive amounts = money IN (income, deposits, refunds)
    
    // Calculate total expenses: All transactions that are NOT categorized as 'Revenue'
    // This includes: explicit expenses, miscellaneous, uncategorized, etc.
    const totalExpenses = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      const category = (tx.category || '').toLowerCase().trim();
      
      // If category is 'revenue', it's income not expense
      if (category === 'revenue') {
        return sum;
      }
      
      // Everything else is an expense (negative in Plaid = money out)
      // For miscellaneous and other categories, we take the absolute value of negative amounts
      return amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0) || 0;

    // Calculate revenue from transactions (only items categorized as 'Revenue' or positive inflows)
    const totalIncome = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      const category = (tx.category || '').toLowerCase().trim();
      
      // Revenue category items (regardless of sign)
      if (category === 'revenue') {
        return sum + Math.abs(amount);
      }
      
      // Income is POSITIVE in Plaid (money entering account) and NOT an expense category
      return amount > 0 ? sum + amount : sum;
    }, 0) || 0;

    // Get expense breakdown by category for detailed analytics
    const expensesByCategory = new Map<string, number>();
    transactions?.forEach(tx => {
      const amount = parseFloat(tx.amount || 0);
      const category = (tx.category || 'Uncategorized').toLowerCase().trim();
      
      // Skip revenue items
      if (category === 'revenue') return;
      
      // Only count negative amounts (money out) as expenses
      if (amount < 0) {
        const expenseAmount = Math.abs(amount);
        const displayCategory = category || 'Uncategorized';
        const current = expensesByCategory.get(displayCategory) || 0;
        expensesByCategory.set(displayCategory, current + expenseAmount);
      }
    });

    // Convert expense breakdown map to array
    const expenseBreakdown = Array.from(expensesByCategory.entries())
      .map(([category, amount]) => ({
        category: category.charAt(0).toUpperCase() + category.slice(1),
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    // ============================================
    // CALCULATE PROFIT FOR EACH INVOICE
    // ============================================
    const invoiceCalculations = (invoices || []).map(inv => {
      const revenue = parseFloat(inv.amount || 0);

      // Get costs from linked transactions
      const transactionCosts = allocationsByInvoice.get(inv.id) || 0;

      // Get estimated costs from blueprints (if any)
      const blueprintCosts = (inv.blueprint_usage || []).reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
        0
      );

      // Check for manual override
      const hasOverride = inv.cost_override_by_user || false;
      const overrideCost = hasOverride && inv.total_actual_cost !== null
        ? parseFloat(inv.total_actual_cost || 0)
        : null;

      // Determine effective cost (priority: override > transactions > stored value > 0)
      let effectiveCost: number;
      if (overrideCost !== null) {
        effectiveCost = overrideCost;
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
      } else if (inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else {
        effectiveCost = 0;
      }

      const calculatedProfit = revenue - effectiveCost;
      const estimatedProfit = blueprintCosts > 0 ? revenue - blueprintCosts : null;
      const margin = revenue > 0 ? (calculatedProfit / revenue) * 100 : 0;

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type,
        invoice_date: inv.invoice_date,
        revenue,
        costs: {
          from_transactions: transactionCosts,
          from_blueprints: blueprintCosts > 0 ? blueprintCosts : null,
          from_override: overrideCost,
          effective: effectiveCost,
        },
        profit: {
          calculated: calculatedProfit,
          estimated: estimatedProfit,
          variance: estimatedProfit !== null ? calculatedProfit - estimatedProfit : null,
        },
        margin,
        has_cost_data: transactionCosts > 0 || blueprintCosts > 0 || hasOverride || inv.total_actual_cost !== null,
        data_sources: {
          has_linked_transactions: transactionCosts > 0,
          has_blueprints: blueprintCosts > 0,
          has_manual_override: hasOverride,
        },
      };
    });

    // ============================================
    // AGGREGATE METRICS
    // ============================================
    const totalRevenue = invoiceCalculations.reduce((sum, c) => sum + c.revenue, 0);
    const totalCalculatedCosts = invoiceCalculations.reduce((sum, c) => sum + c.costs.effective, 0);
    const totalCalculatedProfit = invoiceCalculations.reduce((sum, c) => sum + c.profit.calculated, 0);

    const invoicesWithTransactionCosts = invoiceCalculations.filter(c => c.data_sources.has_linked_transactions).length;
    const invoicesWithBlueprintEstimates = invoiceCalculations.filter(c => c.data_sources.has_blueprints).length;
    const invoicesWithAnyCostData = invoiceCalculations.filter(c => c.has_cost_data).length;

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const averageJobProfit = invoices?.length && invoices.length > 0
      ? totalCalculatedProfit / invoices.length
      : 0;

    const averageJobMargin = invoices?.length && invoices.length > 0
      ? (totalCalculatedProfit / totalRevenue) * 100
      : 0;

    // ============================================
    // BREAKDOWN BY SERVICE TYPE
    // ============================================
    const serviceTypeBreakdown = new Map();

    invoiceCalculations.forEach(inv => {
      const serviceType = inv.service_type || "Uncategorized";
      const current = serviceTypeBreakdown.get(serviceType) || {
        revenue: 0,
        cost: 0,
        profit: 0,
        count: 0,
        with_cost_data: 0,
      };

      current.revenue += inv.revenue;
      current.cost += inv.costs.effective;
      current.profit += inv.profit.calculated;
      current.count += 1;
      if (inv.has_cost_data) current.with_cost_data += 1;

      serviceTypeBreakdown.set(serviceType, current);
    });

    const serviceTypes = Array.from(serviceTypeBreakdown.entries()).map(([type, data]) => ({
      service_type: type,
      revenue: parseFloat(data.revenue.toFixed(2)),
      cost: parseFloat(data.cost.toFixed(2)),
      profit: parseFloat(data.profit.toFixed(2)),
      profit_margin: data.revenue > 0 ? parseFloat(((data.profit / data.revenue) * 100).toFixed(2)) : 0,
      invoice_count: data.count,
      invoices_with_cost_data: data.with_cost_data,
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

    const currentMonthCalcs = invoiceCalculations.filter(inv => inv.invoice_date >= currentMonthStart);
    const lastMonthCalcs = invoiceCalculations.filter(
      inv => inv.invoice_date >= lastMonthStart && inv.invoice_date <= lastMonthEnd
    );

    const currentMonthRevenue = currentMonthCalcs.reduce((sum, inv) => sum + inv.revenue, 0);
    const currentMonthProfit = currentMonthCalcs.reduce((sum, inv) => sum + inv.profit.calculated, 0);
    const lastMonthRevenue = lastMonthCalcs.reduce((sum, inv) => sum + inv.revenue, 0);
    const lastMonthProfit = lastMonthCalcs.reduce((sum, inv) => sum + inv.profit.calculated, 0);

    const revenueChange = lastMonthRevenue > 0
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0;

    const profitChange = lastMonthProfit > 0
      ? ((currentMonthProfit - lastMonthProfit) / lastMonthProfit) * 100
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
          invoices_with_cost_data: invoicesWithAnyCostData,
          invoices_with_transaction_costs: invoicesWithTransactionCosts,
          invoices_with_blueprint_estimates: invoicesWithBlueprintEstimates,
          total_job_costs: parseFloat(totalCalculatedCosts.toFixed(2)),
          total_job_profit: parseFloat(totalCalculatedProfit.toFixed(2)),
          average_job_profit: parseFloat(averageJobProfit.toFixed(2)),
          average_job_margin: parseFloat(averageJobMargin.toFixed(2)),
        },
        service_type_breakdown: serviceTypes,
        expense_breakdown: expenseBreakdown,
        month_over_month: {
          current_month_revenue: parseFloat(currentMonthRevenue.toFixed(2)),
          current_month_profit: parseFloat(currentMonthProfit.toFixed(2)),
          last_month_revenue: parseFloat(lastMonthRevenue.toFixed(2)),
          last_month_profit: parseFloat(lastMonthProfit.toFixed(2)),
          revenue_change_percent: parseFloat(revenueChange.toFixed(2)),
          profit_change_percent: parseFloat(profitChange.toFixed(2)),
          trend: revenueChange > 0 ? "up" : revenueChange < 0 ? "down" : "flat",
        },
        data_quality: {
          message: invoicesWithAnyCostData === 0
            ? "No cost data available. Link bank transactions to invoices to see profit calculations."
            : invoicesWithAnyCostData < (invoices?.length || 0)
              ? `${invoicesWithAnyCostData} of ${invoices?.length} invoices have cost data. Link more transactions for better accuracy.`
              : "All invoices have cost data.",
          invoices_missing_cost_data: (invoices?.length || 0) - invoicesWithAnyCostData,
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