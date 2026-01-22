import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const { start_date, end_date } = await req.json();

    if (!start_date || !end_date) {
      return new Response(
        JSON.stringify({ error: "start_date and end_date are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Get QuickBooks P&L Base
    // We try to find the most recently synced report for this exact period
    const { data: qbReport } = await supabaseClient
      .from("quickbooks_pnl_reports")
      .select("*")
      .eq("user_id", user.id)
      .eq("start_date", start_date)
      .eq("end_date", end_date)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    const basePnl = {
      revenue: Number(qbReport?.total_income || 0),
      expenses: Number(qbReport?.total_expenses || 0),
      profit: Number(qbReport?.net_income || 0),
      last_synced: qbReport?.synced_at || null,
    };

    // 2. Get Mintro-only Invoices (created in Mintro or manually added)
    // These are fully additive to the QB P&L
    const { data: mintroInvoices, error: mintroError } = await supabaseClient
      .from("invoices")
      .select("amount, total_actual_cost")
      .eq("user_id", user.id)
      .neq("source", "quickbooks")
      .gte("invoice_date", start_date)
      .lte("invoice_date", end_date);

    if (mintroError) throw mintroError;

    const mintroRevenue = mintroInvoices?.reduce((sum: number, inv: any) => sum + (Number(inv.amount) || 0), 0) || 0;
    const mintroExpenses = mintroInvoices?.reduce((sum: number, inv: any) => sum + (Number(inv.total_actual_cost) || 0), 0) || 0;
    const mintroProfit = mintroRevenue - mintroExpenses;

    // 3. Get Edited QB Invoices
    // These are invoices that were synced from QB but then edited in Mintro.
    // We need to calculate the difference (Delta) to adjust the QB P&L.
    const { data: editedQbInvoices, error: editedError } = await supabaseClient
      .from("invoices")
      .select("amount, total_actual_cost, original_qb_amount, original_qb_cost, quickbooks_invoice_id")
      .eq("user_id", user.id)
      .eq("source", "quickbooks")
      .eq("edited_after_sync", true)
      .gte("invoice_date", start_date)
      .lte("invoice_date", end_date);

    if (editedError) throw editedError;

    let adjustmentRevenue = 0;
    let adjustmentExpenses = 0;
    const adjustments: any[] = [];

    editedQbInvoices?.forEach((inv: any) => {
      const currentRev = Number(inv.amount) || 0;
      const originalRev = Number(inv.original_qb_amount) || 0;
      
      const currentCost = Number(inv.total_actual_cost) || 0;
      const originalCost = Number(inv.original_qb_cost) || 0;

      const revDelta = currentRev - originalRev;
      const costDelta = currentCost - originalCost;

      if (revDelta !== 0 || costDelta !== 0) {
        adjustmentRevenue += revDelta;
        adjustmentExpenses += costDelta;
        
        adjustments.push({
          invoice_id: inv.quickbooks_invoice_id,
          revenue_delta: revDelta,
          cost_delta: costDelta
        });
      }
    });

    const adjustmentProfit = adjustmentRevenue - adjustmentExpenses;

    // 4. Final Aggregation
    const totalRevenue = basePnl.revenue + mintroRevenue + adjustmentRevenue;
    const totalExpenses = basePnl.expenses + mintroExpenses + adjustmentExpenses;
    const totalProfit = totalRevenue - totalExpenses;

    return new Response(
      JSON.stringify({
        success: true,
        period: { start_date, end_date },
        
        // Final Merged Results
        merged_pnl: {
          revenue: totalRevenue,
          expenses: totalExpenses,
          profit: totalProfit,
          profit_margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
        },

        // Detailed Breakdown for Debugging/UI
        breakdown: {
          quickbooks_base: {
            ...basePnl,
            note: "Data directly from QuickBooks P&L Report"
          },
          mintro_only: {
            revenue: mintroRevenue,
            expenses: mintroExpenses,
            profit: mintroProfit,
            count: mintroInvoices?.length || 0,
            note: "Invoices created exclusively in Mintro"
          },
          adjustments: {
            revenue: adjustmentRevenue,
            expenses: adjustmentExpenses,
            profit: adjustmentProfit,
            affected_invoices: adjustments.length,
            note: "Adjustments from QB invoices edited in Mintro"
          }
        }
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
