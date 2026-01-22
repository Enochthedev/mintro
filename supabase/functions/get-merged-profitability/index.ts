import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * get-merged-profitability
 * 
 * Returns BOTH QuickBooks official P&L AND Mintro's calculated profitability
 * so users can see both numbers and understand any discrepancies.
 * 
 * This is important for a multi-user platform because:
 * - Some users have perfect QB data (numbers will match)
 * - Some users have incomplete QB data (Mintro's calculation is more accurate)
 * - Transparency builds trust
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

    // Parse params from body or query string
    let startDate: string, endDate: string;
    
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      startDate = body.start_date;
      endDate = body.end_date;
    } else {
      const url = new URL(req.url);
      startDate = url.searchParams.get("start_date") || "";
      endDate = url.searchParams.get("end_date") || "";
    }

    // Default to current year if not provided
    const now = new Date();
    if (!startDate) startDate = `${now.getFullYear()}-01-01`;
    if (!endDate) endDate = now.toISOString().split('T')[0];

    // ========== 1. GET QUICKBOOKS OFFICIAL P&L ==========
    const { data: qbReport } = await supabaseClient
      .from("quickbooks_pnl_reports")
      .select("*")
      .eq("user_id", user.id)
      .lte("start_date", endDate)
      .gte("end_date", startDate)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    const quickbooksPnl = {
      total_income: Number(qbReport?.total_income || 0),
      cogs: Number(qbReport?.total_cost_of_goods_sold || 0),
      gross_profit: Number(qbReport?.gross_profit || 0),
      total_expenses: Number(qbReport?.total_expenses || 0),
      net_income: Number(qbReport?.net_income || 0),
      last_synced: qbReport?.synced_at || null,
      period_covered: qbReport ? {
        start: qbReport.start_date,
        end: qbReport.end_date
      } : null
    };

    // ========== 2. GET MINTRO CALCULATED PROFITABILITY ==========
    // This uses Item.PurchaseCost for accurate per-job costing
    
    const { data: allInvoices } = await supabaseClient
      .from("invoices")
      .select(`
        id, amount, total_actual_cost, cost_data_source,
        quickbooks_id, source, invoice_date
      `)
      .eq("user_id", user.id)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    // Separate QB invoices from Mintro-only invoices
    const qbInvoices = allInvoices?.filter(inv => inv.quickbooks_id) || [];
    const mintroOnlyInvoices = allInvoices?.filter(inv => !inv.quickbooks_id) || [];

    // Calculate Mintro's view of QB invoices (using Item.PurchaseCost)
    const mintroQbRevenue = qbInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const mintroQbCost = qbInvoices.reduce((sum, inv) => sum + Number(inv.total_actual_cost || 0), 0);
    const mintroQbProfit = mintroQbRevenue - mintroQbCost;

    // Mintro-only invoices (not in QuickBooks)
    const mintroOnlyRevenue = mintroOnlyInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const mintroOnlyCost = mintroOnlyInvoices.reduce((sum, inv) => sum + Number(inv.total_actual_cost || 0), 0);
    const mintroOnlyProfit = mintroOnlyRevenue - mintroOnlyCost;

    // Data quality metrics
    const invoicesWithRealCost = qbInvoices.filter(inv => inv.cost_data_source === 'qb_item_cost').length;
    const dataQualityPercent = qbInvoices.length > 0 
      ? Math.round((invoicesWithRealCost / qbInvoices.length) * 100) 
      : 0;

    // ========== 3. GET EXPENSES FROM QUICKBOOKS ==========
    const { data: qbExpenses } = await supabaseClient
      .from("quickbooks_expenses")
      .select("total_amount, expense_type")
      .eq("user_id", user.id)
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate);

    const totalQbExpenses = qbExpenses?.reduce((sum, exp) => sum + Number(exp.total_amount || 0), 0) || 0;

    // ========== 4. BUILD COMPARISON ==========
    const mintroPnl = {
      total_income: mintroQbRevenue + mintroOnlyRevenue,
      cogs: mintroQbCost + mintroOnlyCost, // From Item.PurchaseCost
      gross_profit: (mintroQbRevenue + mintroOnlyRevenue) - (mintroQbCost + mintroOnlyCost),
      total_expenses: totalQbExpenses, // Operating expenses from QB
      net_income: (mintroQbRevenue + mintroOnlyRevenue) - (mintroQbCost + mintroOnlyCost) - totalQbExpenses,
    };

    // Calculate discrepancy
    const revenueDiscrepancy = quickbooksPnl.total_income - mintroPnl.total_income;
    const cogsDiscrepancy = quickbooksPnl.cogs - mintroPnl.cogs;
    
    // Determine which number to trust
    let recommendation: string;
    let recommendedSource: 'quickbooks' | 'mintro';
    
    if (Math.abs(cogsDiscrepancy) < 100 && dataQualityPercent > 80) {
      recommendation = "Your QuickBooks data is well-maintained. Both numbers are reliable.";
      recommendedSource = 'quickbooks';
    } else if (dataQualityPercent > 50) {
      recommendation = "Mintro's calculation uses actual item costs and may be more accurate for job-level profitability.";
      recommendedSource = 'mintro';
    } else {
      recommendation = "Consider adding PurchaseCost to your QuickBooks Items for more accurate profit tracking.";
      recommendedSource = 'mintro';
    }

    return new Response(
      JSON.stringify({
        success: true,
        period: { start_date: startDate, end_date: endDate },

        // Side-by-side comparison
        comparison: {
          quickbooks_official: {
            ...quickbooksPnl,
            source: "QuickBooks P&L Report",
            description: "Official accounting numbers from QuickBooks"
          },
          mintro_calculated: {
            ...mintroPnl,
            source: "Mintro (Item.PurchaseCost)",
            description: "Calculated from actual item costs per invoice"
          },
          discrepancy: {
            revenue: revenueDiscrepancy,
            cogs: cogsDiscrepancy,
            note: cogsDiscrepancy !== 0 
              ? `COGS differs by $${Math.abs(cogsDiscrepancy).toFixed(2)} - this is normal if QB COGS account isn't fully maintained`
              : "Numbers match!"
          }
        },

        // Recommendation for the user
        recommendation: {
          use: recommendedSource,
          reason: recommendation,
          data_quality: {
            invoices_with_real_cost: invoicesWithRealCost,
            total_qb_invoices: qbInvoices.length,
            percentage: dataQualityPercent,
            rating: dataQualityPercent >= 80 ? 'excellent' : dataQualityPercent >= 50 ? 'good' : dataQualityPercent >= 25 ? 'fair' : 'needs_improvement'
          }
        },

        // Detailed breakdown
        breakdown: {
          qb_invoices: {
            count: qbInvoices.length,
            revenue: mintroQbRevenue,
            cost: mintroQbCost,
            profit: mintroQbProfit
          },
          mintro_only_invoices: {
            count: mintroOnlyInvoices.length,
            revenue: mintroOnlyRevenue,
            cost: mintroOnlyCost,
            profit: mintroOnlyProfit
          },
          operating_expenses: {
            from_qb_purchases: qbExpenses?.filter(e => e.expense_type === 'purchase').reduce((s, e) => s + Number(e.total_amount), 0) || 0,
            from_qb_bills: qbExpenses?.filter(e => e.expense_type === 'bill').reduce((s, e) => s + Number(e.total_amount), 0) || 0,
            total: totalQbExpenses
          }
        }
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
