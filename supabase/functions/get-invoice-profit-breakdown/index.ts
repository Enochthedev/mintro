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

    // Get invoice with blueprint usage
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        blueprint_usage (
          *,
          cost_blueprints (*)
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

    // Get linked expenses
    const { data: linkedExpenses } = await supabaseClient
      .from("transaction_job_allocations")
      .select(`
        *,
        transactions (
          id,
          transaction_id,
          date,
          amount,
          name,
          merchant_name
        )
      `)
      .eq("job_id", invoice_id);

    const totalLinkedExpenses = linkedExpenses?.reduce(
      (sum, exp) => sum + parseFloat(exp.allocation_amount || 0),
      0
    ) || 0;

    // Calculate costs from blueprints
    const estimatedCosts = invoice.blueprint_usage && invoice.blueprint_usage.length > 0 ? {
      materials: invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.estimated_materials_cost || 0),
        0
      ),
      labor: invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.estimated_labor_cost || 0),
        0
      ),
      overhead: invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.estimated_overhead_cost || 0),
        0
      ),
      total: invoice.blueprint_usage.reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
        0
      ),
    } : null;

    const actualCosts = {
      materials: parseFloat(invoice.actual_materials_cost || 0),
      labor: parseFloat(invoice.actual_labor_cost || 0),
      overhead: parseFloat(invoice.actual_overhead_cost || 0),
      total: parseFloat(invoice.total_actual_cost || 0),
    };

    const variance = estimatedCosts ? {
      materials: actualCosts.materials - estimatedCosts.materials,
      labor: actualCosts.labor - estimatedCosts.labor,
      overhead: actualCosts.overhead - estimatedCosts.overhead,
      total: actualCosts.total - estimatedCosts.total,
    } : null;

    const actualProfit = (invoice.amount || 0) - actualCosts.total;
    const estimatedProfit = estimatedCosts 
      ? (invoice.amount || 0) - estimatedCosts.total
      : null;

    // Get override history
    const { data: overrideHistory } = await supabaseClient
      .from("invoice_cost_overrides")
      .select("*")
      .eq("invoice_id", invoice_id)
      .order("created_at", { ascending: false });

    return new Response(
      JSON.stringify({
        success: true,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice,
          client: invoice.client,
          amount: invoice.amount,
          invoice_date: invoice.invoice_date,
          status: invoice.status,
        },
        blueprints: invoice.blueprint_usage?.map((usage: any) => ({
          id: usage.cost_blueprints?.id,
          name: usage.cost_blueprints?.name,
          type: usage.cost_blueprints?.blueprint_type,
        })) || [],
        costs: {
          estimated: estimatedCosts,
          actual: actualCosts,
          variance: variance,
          linked_transactions: totalLinkedExpenses,
        },
        profit: {
          estimated: estimatedProfit,
          actual: actualProfit,
          variance: estimatedProfit ? actualProfit - estimatedProfit : null,
          margin: invoice.amount > 0 ? ((actualProfit / invoice.amount) * 100).toFixed(2) : 0,
        },
        linked_expenses: linkedExpenses?.map(exp => ({
          id: exp.id,
          amount: exp.allocation_amount,
          date: exp.transactions?.date,
          vendor: exp.transactions?.name,
          merchant: exp.transactions?.merchant_name,
        })) || [],
        override_history: overrideHistory || [],
        has_manual_override: invoice.cost_override_by_user || false,
        last_override_at: invoice.cost_override_at,
        override_reason: invoice.cost_override_reason,
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