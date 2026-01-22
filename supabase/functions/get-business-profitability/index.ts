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
 * REFACTORED v2: Now uses REAL cost data from QuickBooks Items when available:
 * 
 * Cost Priority (highest to lowest accuracy):
 * 1. qb_item_cost - Real costs from QuickBooks Item.PurchaseCost (BEST)
 * 2. user_verified - Manual user overrides
 * 3. transaction_linked - Costs from linked bank transactions
 * 4. blueprint_linked - Estimated from cost blueprints
 * 5. estimated - Fallback estimation (least accurate)
 * 
 * Run quickbooks-full-sync to populate Items with PurchaseCost for accurate profits.
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
    // REVENUE: Get ALL invoices with cost data source info
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
        actual_materials_cost,
        actual_labor_cost,
        actual_overhead_cost,
        actual_profit,
        cost_override_by_user,
        cost_data_source,
        source,
        line_items,
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
    // QUICKBOOKS MERGED P&L (if connected)
    // This section overlays the QB P&L data with Mintro adjustments
    // ============================================
    let qbMergedPnl: any = null;

    // Check if user has QB P&L data for this period
    const { data: qbReport } = await supabaseClient
      .from("quickbooks_pnl_reports")
      .select("*")
      .eq("user_id", user.id)
      .lte("start_date", startDate)
      .gte("end_date", endDate)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    if (qbReport) {
      // Get Mintro-only invoices (not from QB)
      const { data: mintroOnlyInvoices } = await supabaseClient
        .from("invoices")
        .select("amount, total_actual_cost")
        .eq("user_id", user.id)
        .neq("source", "quickbooks")
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate);

      const mintroRevenue = mintroOnlyInvoices?.reduce((sum: number, inv: any) => sum + (Number(inv.amount) || 0), 0) || 0;
      const mintroExpenses = mintroOnlyInvoices?.reduce((sum: number, inv: any) => sum + (Number(inv.total_actual_cost) || 0), 0) || 0;

      // Get edited QB invoices (need to apply delta adjustment)
      const { data: editedQbInvoices } = await supabaseClient
        .from("invoices")
        .select("amount, total_actual_cost, original_qb_amount, original_qb_cost")
        .eq("user_id", user.id)
        .eq("source", "quickbooks")
        .eq("edited_after_sync", true)
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate);

      let adjustmentRevenue = 0;
      let adjustmentExpenses = 0;

      editedQbInvoices?.forEach((inv: any) => {
        const revDelta = (Number(inv.amount) || 0) - (Number(inv.original_qb_amount) || 0);
        const costDelta = (Number(inv.total_actual_cost) || 0) - (Number(inv.original_qb_cost) || 0);
        adjustmentRevenue += revDelta;
        adjustmentExpenses += costDelta;
      });

      // Merge: QB Base + Mintro Only + Adjustments
      const mergedRevenue = Number(qbReport.total_income || 0) + mintroRevenue + adjustmentRevenue;
      const mergedExpenses = Number(qbReport.total_expenses || 0) + mintroExpenses + adjustmentExpenses;
      const mergedProfit = mergedRevenue - mergedExpenses;

      qbMergedPnl = {
        enabled: true,
        last_synced: qbReport.synced_at,
        merged: {
          revenue: parseFloat(mergedRevenue.toFixed(2)),
          expenses: parseFloat(mergedExpenses.toFixed(2)),
          profit: parseFloat(mergedProfit.toFixed(2)),
          profit_margin: mergedRevenue > 0 ? parseFloat(((mergedProfit / mergedRevenue) * 100).toFixed(2)) : 0,
        },
        breakdown: {
          quickbooks_base: {
            revenue: Number(qbReport.total_income || 0),
            expenses: Number(qbReport.total_expenses || 0),
            profit: Number(qbReport.net_income || 0),
          },
          mintro_only: {
            revenue: mintroRevenue,
            expenses: mintroExpenses,
            profit: mintroRevenue - mintroExpenses,
            count: mintroOnlyInvoices?.length || 0,
          },
          adjustments: {
            revenue: adjustmentRevenue,
            expenses: adjustmentExpenses,
            profit: adjustmentRevenue - adjustmentExpenses,
            edited_invoices: editedQbInvoices?.length || 0,
          },
        },
      };
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
    // Uses cost_data_source to determine data quality
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
      
      // Get stored cost and its source
      const storedCost = inv.total_actual_cost !== null ? parseFloat(inv.total_actual_cost || 0) : null;
      const costSource = inv.cost_data_source || 'none';
      
      // Determine if this is "real" cost data (from QB Items or user verified)
      const isRealCost = ['qb_item_cost', 'qb_expense_linked', 'user_verified'].includes(costSource);

      // Determine effective cost (priority: override > stored > transactions > 0)
      let effectiveCost: number;
      let effectiveSource: string;
      
      if (hasOverride && storedCost !== null) {
        effectiveCost = storedCost;
        effectiveSource = 'user_verified';
      } else if (storedCost !== null && costSource && costSource !== 'none') {
        effectiveCost = storedCost;
        effectiveSource = costSource;
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
        effectiveSource = 'transaction_linked';
      } else {
        effectiveCost = 0;
        effectiveSource = 'none';
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
          from_override: hasOverride ? storedCost : null,
          stored: storedCost,
          effective: effectiveCost,
        },
        cost_breakdown: {
          materials: parseFloat(inv.actual_materials_cost || 0),
          labor: parseFloat(inv.actual_labor_cost || 0),
          overhead: parseFloat(inv.actual_overhead_cost || 0),
        },
        profit: {
          calculated: calculatedProfit,
          estimated: estimatedProfit,
          variance: estimatedProfit !== null ? calculatedProfit - estimatedProfit : null,
        },
        margin,
        has_cost_data: effectiveCost > 0 || storedCost !== null,
        data_quality: {
          cost_source: effectiveSource,
          is_real_cost: isRealCost,
          quality_level: getQualityLevel(effectiveSource),
        },
        data_sources: {
          has_linked_transactions: transactionCosts > 0,
          has_blueprints: blueprintCosts > 0,
          has_manual_override: hasOverride,
          has_qb_item_cost: costSource === 'qb_item_cost',
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
    const invoicesWithRealCosts = invoiceCalculations.filter(c => c.data_quality.is_real_cost).length;
    const invoicesWithQbItemCost = invoiceCalculations.filter(c => c.data_sources.has_qb_item_cost).length;

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
          message: invoicesWithRealCosts > 0
            ? `${invoicesWithRealCosts} of ${invoices?.length} invoices have real cost data from QuickBooks.`
            : invoicesWithAnyCostData === 0
              ? "No cost data available. Run quickbooks-full-sync to get real costs from QuickBooks Items."
              : `${invoicesWithAnyCostData} of ${invoices?.length} invoices have estimated costs. Run quickbooks-full-sync for accurate data.`,
          invoices_missing_cost_data: (invoices?.length || 0) - invoicesWithAnyCostData,
          invoices_with_real_costs: invoicesWithRealCosts,
          invoices_with_qb_item_cost: invoicesWithQbItemCost,
          real_cost_percentage: invoices?.length ? parseFloat(((invoicesWithRealCosts / invoices.length) * 100).toFixed(1)) : 0,
          recommendation: invoicesWithQbItemCost === 0
            ? "Run quickbooks-full-sync to sync Items with PurchaseCost for accurate profit tracking."
            : invoicesWithRealCosts < (invoices?.length || 0) * 0.5
              ? "Add PurchaseCost to more QuickBooks Items for better accuracy."
              : "Good coverage of real cost data!",
        },
        // QuickBooks Merged P&L - only present if user has synced QB P&L data
        // Frontend should prefer this for headline numbers when available
        quickbooks_merged_pnl: qbMergedPnl,
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

/**
 * Get quality level for a cost source
 */
function getQualityLevel(costSource: string): string {
  switch (costSource) {
    case "qb_item_cost":
    case "qb_expense_linked":
      return "excellent";
    case "user_verified":
    case "transaction_linked":
      return "good";
    case "blueprint_linked":
    case "chart_of_accounts":
      return "fair";
    case "estimated":
    case "keyword_fallback":
      return "poor";
    default:
      return "none";
  }
}