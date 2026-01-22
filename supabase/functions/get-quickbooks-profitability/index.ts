import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * get-quickbooks-profitability
 * 
 * OPTION 1: Returns ONLY the official QuickBooks P&L numbers.
 * Use this when you want to display exactly what QuickBooks shows.
 * 
 * This is the "accounting truth" - what would appear on tax returns.
 * Numbers come directly from the synced QuickBooks P&L report.
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

    // Get the most recent QB P&L report that covers this period
    const { data: qbReport, error: reportError } = await supabaseClient
      .from("quickbooks_pnl_reports")
      .select("*")
      .eq("user_id", user.id)
      .lte("start_date", endDate)
      .gte("end_date", startDate)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    if (reportError || !qbReport) {
      return new Response(
        JSON.stringify({ 
          error: "No QuickBooks P&L data found",
          hint: "Call quickbooks-sync-pnl first to sync your P&L report from QuickBooks",
          requested_period: { start_date: startDate, end_date: endDate }
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate profit margin
    const totalIncome = Number(qbReport.total_income || 0);
    const netIncome = Number(qbReport.net_income || 0);
    const profitMargin = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;

    return new Response(
      JSON.stringify({
        success: true,
        source: "quickbooks",
        period: { 
          start_date: qbReport.start_date, 
          end_date: qbReport.end_date,
          report_basis: qbReport.report_basis
        },
        
        // Main P&L numbers
        profitability: {
          total_income: totalIncome,
          cost_of_goods_sold: Number(qbReport.total_cost_of_goods_sold || 0),
          gross_profit: Number(qbReport.gross_profit || 0),
          total_expenses: Number(qbReport.total_expenses || 0),
          net_operating_income: Number(qbReport.net_operating_income || 0),
          net_income: netIncome,
          profit_margin: Math.round(profitMargin * 100) / 100
        },

        // Detailed breakdowns
        breakdown: {
          income: qbReport.income_breakdown || [],
          cogs: qbReport.cogs_breakdown || [],
          expenses: qbReport.expense_breakdown || []
        },

        // Metadata
        metadata: {
          last_synced: qbReport.synced_at,
          data_source: "QuickBooks P&L Report",
          note: "These are the official accounting numbers from QuickBooks"
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
