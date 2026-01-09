import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-invoice-profit-breakdown
 * 
 * REFACTORED: Always shows profit breakdown using whatever data exists.
 * Primary cost source: linked bank transactions (transaction_job_allocations)
 * Optional enhancement: blueprint estimates for comparison
 * Optional override: manual cost entries
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

    // Get linked transactions (primary cost source)
    const { data: linkedExpenses, error: linkError } = await supabaseClient
      .from("transaction_job_allocations")
      .select(`
        *,
        transactions (
          id,
          transaction_id,
          date,
          amount,
          name,
          merchant_name,
          category
        )
      `)
      .eq("job_id", invoice_id);

    if (linkError) {
      console.error("Error fetching linked expenses:", linkError);
    }

    // Calculate costs from linked transactions
    const transactionCosts = (linkedExpenses || []).reduce(
      (sum, exp) => sum + Math.abs(parseFloat(exp.allocation_amount || 0)),
      0
    );

    // Calculate costs from blueprints (estimated)
    const hasBlueprints = invoice.blueprint_usage && invoice.blueprint_usage.length > 0;
    const estimatedCosts = hasBlueprints ? {
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

    // Check for manual override
    const hasOverride = invoice.cost_override_by_user || false;

    // Actual costs (from stored values or calculated from transactions)
    const storedActualCosts = {
      materials: parseFloat(invoice.actual_materials_cost || 0),
      labor: parseFloat(invoice.actual_labor_cost || 0),
      overhead: parseFloat(invoice.actual_overhead_cost || 0),
      total: parseFloat(invoice.total_actual_cost || 0),
    };

    // Determine effective cost for profit calculation
    let effectiveCost: number;
    let costSource: string;

    if (hasOverride && invoice.total_actual_cost !== null) {
      effectiveCost = storedActualCosts.total;
      costSource = "manual_override";
    } else if (transactionCosts > 0) {
      effectiveCost = transactionCosts;
      costSource = "linked_transactions";
    } else if (storedActualCosts.total > 0) {
      effectiveCost = storedActualCosts.total;
      costSource = "stored_actual";
    } else if (estimatedCosts && estimatedCosts.total > 0) {
      effectiveCost = estimatedCosts.total;
      costSource = "blueprint_estimate";
    } else {
      effectiveCost = 0;
      costSource = "none";
    }

    const revenue = parseFloat(invoice.amount || 0);
    const calculatedProfit = revenue - effectiveCost;
    const estimatedProfit = estimatedCosts ? revenue - estimatedCosts.total : null;
    const profitMargin = revenue > 0 ? (calculatedProfit / revenue) * 100 : 0;

    // Variance calculations (only if we have both estimate and actual)
    const variance = estimatedCosts && effectiveCost > 0 ? {
      materials: storedActualCosts.materials - estimatedCosts.materials,
      labor: storedActualCosts.labor - estimatedCosts.labor,
      overhead: storedActualCosts.overhead - estimatedCosts.overhead,
      total: effectiveCost - estimatedCosts.total,
    } : null;

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
          amount: revenue,
          invoice_date: invoice.invoice_date,
          status: invoice.status,
        },
        blueprints: invoice.blueprint_usage?.map((usage: any) => ({
          id: usage.cost_blueprints?.id,
          name: usage.cost_blueprints?.name,
          type: usage.cost_blueprints?.blueprint_type,
        })) || [],
        costs: {
          // Costs from linked transactions (primary source)
          from_transactions: {
            total: parseFloat(transactionCosts.toFixed(2)),
            transaction_count: linkedExpenses?.length || 0,
          },
          // Estimated costs from blueprints (optional)
          estimated: estimatedCosts ? {
            materials: parseFloat(estimatedCosts.materials.toFixed(2)),
            labor: parseFloat(estimatedCosts.labor.toFixed(2)),
            overhead: parseFloat(estimatedCosts.overhead.toFixed(2)),
            total: parseFloat(estimatedCosts.total.toFixed(2)),
          } : null,
          // Stored actual costs (may be from override or previous calculation)
          actual: {
            materials: parseFloat(storedActualCosts.materials.toFixed(2)),
            labor: parseFloat(storedActualCosts.labor.toFixed(2)),
            overhead: parseFloat(storedActualCosts.overhead.toFixed(2)),
            total: parseFloat(storedActualCosts.total.toFixed(2)),
          },
          // The cost used for profit calculation
          effective: {
            amount: parseFloat(effectiveCost.toFixed(2)),
            source: costSource,
          },
          // Variance between estimated and effective (if applicable)
          variance: variance ? {
            materials: parseFloat(variance.materials.toFixed(2)),
            labor: parseFloat(variance.labor.toFixed(2)),
            overhead: parseFloat(variance.overhead.toFixed(2)),
            total: parseFloat(variance.total.toFixed(2)),
          } : null,
        },
        profit: {
          calculated: parseFloat(calculatedProfit.toFixed(2)),
          estimated: estimatedProfit !== null ? parseFloat(estimatedProfit.toFixed(2)) : null,
          variance: estimatedProfit !== null ? parseFloat((calculatedProfit - estimatedProfit).toFixed(2)) : null,
          margin: parseFloat(profitMargin.toFixed(2)),
        },
        linked_expenses: (linkedExpenses || []).map(exp => ({
          id: exp.id,
          amount: parseFloat(Math.abs(parseFloat(exp.allocation_amount || 0)).toFixed(2)),
          date: exp.transactions?.date,
          vendor: exp.transactions?.name,
          merchant: exp.transactions?.merchant_name,
          category: exp.transactions?.category,
          transaction_id: exp.transactions?.id,
        })),
        override_history: overrideHistory || [],
        has_manual_override: hasOverride,
        last_override_at: invoice.cost_override_at,
        override_reason: invoice.cost_override_reason,
        data_sources: {
          has_linked_transactions: transactionCosts > 0,
          has_blueprints: hasBlueprints,
          has_manual_override: hasOverride,
          cost_source: costSource,
        },
        data_quality: {
          message: transactionCosts === 0 && !hasBlueprints && !hasOverride
            ? "No cost data. Link bank transactions to this invoice to track expenses."
            : transactionCosts === 0 && hasBlueprints
              ? "Using estimated costs from blueprints. Link actual transactions for accurate profit."
              : "Costs calculated from linked transactions.",
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