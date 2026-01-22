import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-accurate-profitability
 * 
 * Returns ACCURATE profit calculations using:
 * 
 * 1. REVENUE: Invoice amounts (from QuickBooks or Mintro)
 * 2. COSTS: Calculated from Item.PurchaseCost × Quantity (REAL data)
 * 3. EXPENSES: Bank transactions (Plaid) categorized as expenses
 * 
 * Priority for cost data:
 * 1. qb_item_cost - Real costs from QuickBooks Item.PurchaseCost
 * 2. qb_expense_linked - Expenses linked to invoices via CustomerRef
 * 3. transaction_linked - Bank transactions linked to jobs
 * 4. user_verified - Manual user overrides
 * 5. estimated - Fallback estimation (least accurate)
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

    const url = new URL(req.url);
    const startDate = url.searchParams.get("start_date") || `${new Date().getFullYear()}-01-01`;
    const endDate = url.searchParams.get("end_date") || new Date().toISOString().split('T')[0];

    // ============================================
    // 1. GET ALL INVOICES WITH COST DATA
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
        source,
        total_actual_cost,
        actual_materials_cost,
        actual_labor_cost,
        actual_overhead_cost,
        actual_profit,
        cost_data_source,
        cost_override_by_user,
        line_items
      `)
      .eq("user_id", user.id)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate)
      .order("invoice_date", { ascending: false });

    if (invoicesError) throw invoicesError;

    // ============================================
    // 2. GET BANK TRANSACTIONS (EXPENSES)
    // ============================================
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, amount, date, category, name, merchant_name")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate);

    if (txError) throw txError;

    // Calculate expenses from bank transactions
    // Negative amounts = money out (expenses)
    // Positive amounts = money in (income/deposits)
    const bankExpenses = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      const category = (tx.category || '').toLowerCase();
      
      // Skip revenue/income categories
      if (category === 'revenue' || category === 'income') return sum;
      
      // Negative amounts are expenses
      return amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0) || 0;

    const bankIncome = transactions?.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      const category = (tx.category || '').toLowerCase();
      
      if (category === 'revenue' || category === 'income') {
        return sum + Math.abs(amount);
      }
      return amount > 0 ? sum + amount : sum;
    }, 0) || 0;

    // ============================================
    // 3. CALCULATE PROFITABILITY PER INVOICE
    // ============================================
    const invoiceDetails = (invoices || []).map(inv => {
      const revenue = parseFloat(inv.amount || 0);
      const cost = parseFloat(inv.total_actual_cost || 0);
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      // Determine data quality
      const costSource = inv.cost_data_source || 'none';
      const dataQuality = getDataQuality(costSource);

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type,
        invoice_date: inv.invoice_date,
        status: inv.status,
        source: inv.source,
        
        financials: {
          revenue,
          cost,
          profit,
          margin: parseFloat(margin.toFixed(2)),
        },
        
        cost_breakdown: {
          materials: parseFloat(inv.actual_materials_cost || 0),
          labor: parseFloat(inv.actual_labor_cost || 0),
          overhead: parseFloat(inv.actual_overhead_cost || 0),
        },
        
        data_quality: {
          cost_source: costSource,
          quality_level: dataQuality.level,
          quality_description: dataQuality.description,
          is_real_cost: ['qb_item_cost', 'qb_expense_linked', 'user_verified'].includes(costSource),
          has_user_override: inv.cost_override_by_user || false,
        },
        
        line_item_count: Array.isArray(inv.line_items) ? inv.line_items.length : 0,
      };
    });

    // ============================================
    // 4. AGGREGATE METRICS
    // ============================================
    const totalRevenue = invoiceDetails.reduce((sum, inv) => sum + inv.financials.revenue, 0);
    const totalCost = invoiceDetails.reduce((sum, inv) => sum + inv.financials.cost, 0);
    const totalProfit = totalRevenue - totalCost;
    const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    // Count by data quality
    const byQuality = {
      real_cost: invoiceDetails.filter(inv => inv.data_quality.is_real_cost).length,
      estimated: invoiceDetails.filter(inv => !inv.data_quality.is_real_cost && inv.financials.cost > 0).length,
      no_cost: invoiceDetails.filter(inv => inv.financials.cost === 0).length,
    };

    // By cost source
    const byCostSource: Record<string, number> = {};
    invoiceDetails.forEach(inv => {
      const source = inv.data_quality.cost_source;
      byCostSource[source] = (byCostSource[source] || 0) + 1;
    });

    // ============================================
    // 5. SERVICE TYPE BREAKDOWN
    // ============================================
    const serviceTypeMap = new Map<string, { revenue: number; cost: number; count: number; realCostCount: number }>();
    
    invoiceDetails.forEach(inv => {
      const type = inv.service_type || "Uncategorized";
      const current = serviceTypeMap.get(type) || { revenue: 0, cost: 0, count: 0, realCostCount: 0 };
      
      current.revenue += inv.financials.revenue;
      current.cost += inv.financials.cost;
      current.count += 1;
      if (inv.data_quality.is_real_cost) current.realCostCount += 1;
      
      serviceTypeMap.set(type, current);
    });

    const serviceTypeBreakdown = Array.from(serviceTypeMap.entries()).map(([type, data]) => ({
      service_type: type,
      revenue: parseFloat(data.revenue.toFixed(2)),
      cost: parseFloat(data.cost.toFixed(2)),
      profit: parseFloat((data.revenue - data.cost).toFixed(2)),
      margin: data.revenue > 0 ? parseFloat(((data.revenue - data.cost) / data.revenue * 100).toFixed(2)) : 0,
      invoice_count: data.count,
      real_cost_count: data.realCostCount,
    })).sort((a, b) => b.revenue - a.revenue);

    // ============================================
    // 6. EXPENSE BREAKDOWN BY CATEGORY
    // ============================================
    const expensesByCategory = new Map<string, number>();
    transactions?.forEach(tx => {
      const amount = parseFloat(tx.amount || 0);
      if (amount >= 0) return; // Skip income
      
      const category = tx.category || 'Uncategorized';
      const current = expensesByCategory.get(category) || 0;
      expensesByCategory.set(category, current + Math.abs(amount));
    });

    const expenseBreakdown = Array.from(expensesByCategory.entries())
      .map(([category, amount]) => ({
        category,
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    // ============================================
    // 7. DATA QUALITY ASSESSMENT
    // ============================================
    const totalInvoices = invoiceDetails.length;
    const realCostPercentage = totalInvoices > 0 ? (byQuality.real_cost / totalInvoices) * 100 : 0;

    let dataQualityMessage = "";
    let dataQualityLevel = "poor";

    if (realCostPercentage >= 80) {
      dataQualityLevel = "excellent";
      dataQualityMessage = "Excellent! Most invoices have real cost data from QuickBooks.";
    } else if (realCostPercentage >= 50) {
      dataQualityLevel = "good";
      dataQualityMessage = "Good coverage. Consider adding PurchaseCost to more QuickBooks Items.";
    } else if (realCostPercentage >= 20) {
      dataQualityLevel = "fair";
      dataQualityMessage = "Fair coverage. Add PurchaseCost to QuickBooks Items for better accuracy.";
    } else {
      dataQualityLevel = "poor";
      dataQualityMessage = "Limited real cost data. Run quickbooks-full-sync and ensure Items have PurchaseCost set.";
    }

    return new Response(
      JSON.stringify({
        success: true,
        period: { start_date: startDate, end_date: endDate },
        
        summary: {
          total_revenue: parseFloat(totalRevenue.toFixed(2)),
          total_cost: parseFloat(totalCost.toFixed(2)),
          total_profit: parseFloat(totalProfit.toFixed(2)),
          profit_margin: parseFloat(overallMargin.toFixed(2)),
          invoice_count: totalInvoices,
        },
        
        bank_transactions: {
          total_expenses: parseFloat(bankExpenses.toFixed(2)),
          total_income: parseFloat(bankIncome.toFixed(2)),
          transaction_count: transactions?.length || 0,
        },
        
        data_quality: {
          level: dataQualityLevel,
          message: dataQualityMessage,
          real_cost_percentage: parseFloat(realCostPercentage.toFixed(1)),
          by_quality: byQuality,
          by_cost_source: byCostSource,
        },
        
        service_type_breakdown: serviceTypeBreakdown,
        expense_breakdown: expenseBreakdown,
        
        invoices: invoiceDetails,
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

/**
 * Get data quality level and description for a cost source
 */
function getDataQuality(costSource: string): { level: string; description: string } {
  switch (costSource) {
    case "qb_item_cost":
      return { level: "excellent", description: "Real cost from QuickBooks Item.PurchaseCost" };
    case "qb_expense_linked":
      return { level: "excellent", description: "Real cost from linked QuickBooks expenses" };
    case "user_verified":
      return { level: "good", description: "Manually verified by user" };
    case "transaction_linked":
      return { level: "good", description: "Cost from linked bank transactions" };
    case "blueprint_linked":
      return { level: "fair", description: "Estimated from cost blueprint" };
    case "chart_of_accounts":
      return { level: "fair", description: "Estimated from account type classification" };
    case "estimated":
      return { level: "poor", description: "Rough estimate based on industry averages" };
    case "keyword_fallback":
      return { level: "poor", description: "Estimated from item name keywords" };
    default:
      return { level: "none", description: "No cost data available" };
  }
}
