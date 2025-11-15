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
    const invoice_id = url.searchParams.get("invoice_id");

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id query parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get invoice with all related data
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        invoice_items (*),
        blueprint_usage (
          id,
          blueprint_id,
          actual_materials_cost,
          actual_labor_cost,
          actual_overhead_cost,
          total_actual_cost,
          actual_profit,
          cost_variance,
          profit_variance,
          completed_date,
          notes,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price,
            target_profit_amount
          )
        ),
        transaction_job_allocations (
          id,
          allocation_amount,
          allocation_percentage,
          notes,
          created_at,
          transactions (
            id,
            transaction_id,
            date,
            amount,
            name,
            merchant_name,
            category
          )
        ),
        invoice_cost_overrides (
          id,
          previous_materials_cost,
          previous_labor_cost,
          previous_overhead_cost,
          previous_total_cost,
          previous_profit,
          new_materials_cost,
          new_labor_cost,
          new_overhead_cost,
          new_total_cost,
          new_profit,
          override_reason,
          override_method,
          created_at
        )
      `)
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate linked expenses total
    const linkedExpensesTotal = invoice.transaction_job_allocations?.reduce(
      (sum: number, alloc: any) => sum + parseFloat(alloc.allocation_amount || 0),
      0
    ) || 0;

    // Calculate profit summary
    const profitSummary = {
      revenue: parseFloat(invoice.amount || 0),
      actual_cost: parseFloat(invoice.total_actual_cost || 0),
      actual_profit: parseFloat(invoice.actual_profit || 0),
      profit_margin: invoice.amount > 0 && invoice.actual_profit
        ? (parseFloat(invoice.actual_profit) / parseFloat(invoice.amount)) * 100
        : null,
      has_cost_override: invoice.cost_override_by_user || false,
      linked_expenses_total: linkedExpensesTotal,
    };

    // Get blueprint variance if any
    let blueprintComparison = null;
    if (invoice.blueprint_usage && invoice.blueprint_usage.length > 0) {
      const totalEstimatedCost = invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
        0
      );
      const totalActualCost = invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.total_actual_cost || 0),
        0
      );

      blueprintComparison = {
        total_estimated_cost: totalEstimatedCost,
        total_actual_cost: totalActualCost,
        variance: totalActualCost - totalEstimatedCost,
        variance_percentage: totalEstimatedCost > 0
          ? ((totalActualCost - totalEstimatedCost) / totalEstimatedCost) * 100
          : 0,
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoice: {
          ...invoice,
          profit_summary: profitSummary,
          blueprint_comparison: blueprintComparison,
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