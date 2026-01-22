import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * get-combined-profitability
 * 
 * RECOMMENDED APPROACH:
 * QuickBooks P&L (official) + Mintro-only invoices = Complete Picture
 * 
 * This gives you:
 * - Official QB accounting numbers (for tax/reporting)
 * - PLUS any invoices created only in Mintro (not synced to QB)
 * 
 * Use this as your main profitability endpoint.
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

    // Parse params
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

    const now = new Date();
    if (!startDate) startDate = `${now.getFullYear()}-01-01`;
    if (!endDate) endDate = now.toISOString().split('T')[0];

    // ========== 1. GET QUICKBOOKS P&L (BASE) ==========
    const { data: qbReport } = await supabaseClient
      .from("quickbooks_pnl_reports")
      .select("*")
      .eq("user_id", user.id)
      .lte("start_date", endDate)
      .gte("end_date", startDate)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    const qbIncome = Number(qbReport?.total_income || 0);
    const qbCogs = Number(qbReport?.total_cost_of_goods_sold || 0);
    const qbGrossProfit = Number(qbReport?.gross_profit || 0);
    const qbExpenses = Number(qbReport?.total_expenses || 0);
    const qbNetIncome = Number(qbReport?.net_income || 0);

    // ========== 2. GET MINTRO-ONLY INVOICES ==========
    // These are invoices created in Mintro that are NOT in QuickBooks
    const { data: mintroInvoices } = await supabaseClient
      .from("invoices")
      .select("id, amount, total_actual_cost, client, invoice_date")
      .eq("user_id", user.id)
      .is("quickbooks_id", null)  // Not synced to QB
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    const mintroRevenue = mintroInvoices?.reduce((sum, inv) => sum + Number(inv.amount || 0), 0) || 0;
    const mintroCost = mintroInvoices?.reduce((sum, inv) => sum + Number(inv.total_actual_cost || 0), 0) || 0;
    const mintroProfit = mintroRevenue - mintroCost;

    // ========== 3. COMBINE TOTALS ==========
    const totalIncome = qbIncome + mintroRevenue;
    const totalCogs = qbCogs + mintroCost;  // Mintro costs are like COGS
    const totalGrossProfit = totalIncome - totalCogs;
    const totalExpenses = qbExpenses;  // Operating expenses only from QB
    const totalNetIncome = totalGrossProfit - totalExpenses;
    const profitMargin = totalIncome > 0 ? (totalNetIncome / totalIncome) * 100 : 0;

    // ========== 4. CHECK QB CONNECTION STATUS ==========
    const { data: qbConnection } = await supabaseClient
      .from("quickbooks_connections")
      .select("id, company_name, last_sync, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    const hasQuickBooks = !!qbConnection;
    const hasQbPnlData = !!qbReport;

    return new Response(
      JSON.stringify({
        success: true,
        period: { start_date: startDate, end_date: endDate },

        // ===== COMBINED TOTALS (USE THESE) =====
        profitability: {
          total_income: round(totalIncome),
          cost_of_goods_sold: round(totalCogs),
          gross_profit: round(totalGrossProfit),
          operating_expenses: round(totalExpenses),
          net_income: round(totalNetIncome),
          profit_margin: round(profitMargin)
        },

        // ===== BREAKDOWN BY SOURCE =====
        sources: {
          quickbooks: {
            connected: hasQuickBooks,
            has_pnl_data: hasQbPnlData,
            company_name: qbConnection?.company_name || null,
            last_synced: qbReport?.synced_at || null,
            income: round(qbIncome),
            cogs: round(qbCogs),
            gross_profit: round(qbGrossProfit),
            expenses: round(qbExpenses),
            net_income: round(qbNetIncome),
            income_breakdown: qbReport?.income_breakdown || [],
            expense_breakdown: qbReport?.expense_breakdown || []
          },
          mintro_only: {
            invoice_count: mintroInvoices?.length || 0,
            revenue: round(mintroRevenue),
            cost: round(mintroCost),
            profit: round(mintroProfit),
            invoices: mintroInvoices?.map(inv => ({
              id: inv.id,
              client: inv.client,
              amount: Number(inv.amount),
              cost: Number(inv.total_actual_cost || 0),
              date: inv.invoice_date
            })) || []
          }
        },

        // ===== STATUS & RECOMMENDATIONS =====
        status: {
          data_complete: hasQbPnlData || (mintroInvoices?.length || 0) > 0,
          quickbooks_connected: hasQuickBooks,
          quickbooks_pnl_synced: hasQbPnlData,
          mintro_invoices_count: mintroInvoices?.length || 0,
          recommendation: !hasQuickBooks 
            ? "Connect QuickBooks for complete financial data"
            : !hasQbPnlData 
              ? "Sync your QuickBooks P&L report for accurate numbers"
              : "Data is up to date"
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

function round(num: number): number {
  return Math.round(num * 100) / 100;
}
