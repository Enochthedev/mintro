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

    const {
      invoice_id,
      actual_materials_cost,
      actual_labor_cost,
      actual_overhead_cost,
      cost_override_reason,
    } = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get current invoice
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate new totals
    const newMaterialsCost = actual_materials_cost ?? invoice.actual_materials_cost ?? 0;
    const newLaborCost = actual_labor_cost ?? invoice.actual_labor_cost ?? 0;
    const newOverheadCost = actual_overhead_cost ?? invoice.actual_overhead_cost ?? 0;
    const newTotalCost = newMaterialsCost + newLaborCost + newOverheadCost;
    const newProfit = (invoice.amount || 0) - newTotalCost;

    // Store previous values for history
    const hasChanges = 
      invoice.actual_materials_cost !== newMaterialsCost ||
      invoice.actual_labor_cost !== newLaborCost ||
      invoice.actual_overhead_cost !== newOverheadCost;

    if (hasChanges) {
      // Create override history record
      await supabaseClient
        .from("invoice_cost_overrides")
        .insert({
          invoice_id,
          user_id: user.id,
          previous_materials_cost: invoice.actual_materials_cost,
          previous_labor_cost: invoice.actual_labor_cost,
          previous_overhead_cost: invoice.actual_overhead_cost,
          previous_total_cost: invoice.total_actual_cost,
          previous_profit: invoice.actual_profit,
          new_materials_cost: newMaterialsCost,
          new_labor_cost: newLaborCost,
          new_overhead_cost: newOverheadCost,
          new_total_cost: newTotalCost,
          new_profit: newProfit,
          override_reason: cost_override_reason || "Manual cost update",
          override_method: "manual",
        });
    }

    // Update invoice
    const { data: updated, error: updateError } = await supabaseClient
      .from("invoices")
      .update({
        actual_materials_cost: newMaterialsCost,
        actual_labor_cost: newLaborCost,
        actual_overhead_cost: newOverheadCost,
        total_actual_cost: newTotalCost,
        actual_profit: newProfit,
        cost_override_reason: cost_override_reason,
        cost_override_at: new Date().toISOString(),
        cost_override_by_user: true,
      })
      .eq("id", invoice_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invoice costs updated successfully",
        invoice: updated,
        profit_breakdown: {
          revenue: invoice.amount,
          costs: {
            materials: newMaterialsCost,
            labor: newLaborCost,
            overhead: newOverheadCost,
            total: newTotalCost,
          },
          profit: newProfit,
          profit_margin: invoice.amount > 0 ? ((newProfit / invoice.amount) * 100).toFixed(2) : 0,
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