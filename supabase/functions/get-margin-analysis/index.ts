import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-margin-analysis
 * 
 * REFACTORED: Now analyzes margins for ALL invoices, not just those with pre-set costs.
 * Calculates costs from linked transactions (transaction_job_allocations) as primary source.
 * Blueprints and overrides enhance but don't enable the analysis.
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
    const min_margin = parseFloat(url.searchParams.get("min_margin") || "0");

    const startDate = start_date || `${new Date().getFullYear()}-01-01`;
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // ============================================
    // GET ALL INVOICES (no cost filter)
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
        total_actual_cost,
        actual_profit,
        cost_override_by_user,
        blueprint_usage (
          id,
          cost_blueprints (
            id,
            name,
            blueprint_type,
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

    if (!invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No invoices found in the specified period",
          by_service_type: [],
          by_blueprint_type: [],
          by_blueprint: [],
          low_margin_jobs: [],
          high_margin_jobs: [],
          summary: {
            total_jobs_analyzed: 0,
            average_margin: 0,
            median_margin: 0,
            jobs_below_threshold: 0,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================
    // GET LINKED TRANSACTIONS FOR ALL INVOICES
    // ============================================
    const invoiceIds = invoices.map(inv => inv.id);

    const { data: allAllocations, error: allocError } = await supabaseClient
      .from("transaction_job_allocations")
      .select("job_id, allocation_amount")
      .in("job_id", invoiceIds);

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
    // CALCULATE PROFIT FOR EACH INVOICE
    // ============================================
    const invoiceCalculations = invoices.map(inv => {
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
      const overrideCost = hasOverride && inv.total_actual_cost !== null
        ? parseFloat(inv.total_actual_cost || 0)
        : null;

      // Determine effective cost
      let effectiveCost: number;
      if (overrideCost !== null) {
        effectiveCost = overrideCost;
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
      } else if (inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else {
        effectiveCost = 0;
      }

      const profit = revenue - effectiveCost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const hasCostData = transactionCosts > 0 || blueprintCosts > 0 || hasOverride || inv.total_actual_cost !== null;

      // Get blueprint info for categorization
      const blueprints = (inv.blueprint_usage || []).map((usage: any) => ({
        id: usage.cost_blueprints?.id,
        name: usage.cost_blueprints?.name,
        type: usage.cost_blueprints?.blueprint_type,
      })).filter((bp: any) => bp.id);

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type || "Uncategorized",
        invoice_date: inv.invoice_date,
        revenue,
        cost: effectiveCost,
        profit,
        margin: parseFloat(margin.toFixed(2)),
        has_cost_data: hasCostData,
        blueprints,
        data_sources: {
          has_linked_transactions: transactionCosts > 0,
          has_blueprints: blueprintCosts > 0,
          has_manual_override: hasOverride,
        },
      };
    });

    // ============================================
    // ANALYZE BY SERVICE TYPE
    // ============================================
    const byServiceType = new Map();

    invoiceCalculations.forEach(inv => {
      const serviceType = inv.service_type;
      const current = byServiceType.get(serviceType) || {
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        job_count: 0,
        jobs_with_cost_data: 0,
        margins: [],
      };

      current.total_revenue += inv.revenue;
      current.total_cost += inv.cost;
      current.total_profit += inv.profit;
      current.job_count += 1;
      if (inv.has_cost_data) current.jobs_with_cost_data += 1;
      current.margins.push(inv.margin);

      byServiceType.set(serviceType, current);
    });

    const serviceTypeAnalysis = Array.from(byServiceType.entries()).map(([type, data]) => ({
      service_type: type,
      job_count: data.job_count,
      jobs_with_cost_data: data.jobs_with_cost_data,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: data.total_revenue > 0
        ? parseFloat(((data.total_profit / data.total_revenue) * 100).toFixed(2))
        : 0,
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
      min_margin: data.margins.length > 0 ? parseFloat(Math.min(...data.margins).toFixed(2)) : 0,
      max_margin: data.margins.length > 0 ? parseFloat(Math.max(...data.margins).toFixed(2)) : 0,
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // ANALYZE BY BLUEPRINT TYPE
    // ============================================
    const byBlueprintType = new Map();

    invoiceCalculations.forEach(inv => {
      if (inv.blueprints.length === 0) {
        // Track invoices without blueprints
        const current = byBlueprintType.get("no_blueprint") || {
          total_revenue: 0,
          total_cost: 0,
          total_profit: 0,
          usage_count: 0,
          margins: [],
        };
        current.total_revenue += inv.revenue;
        current.total_cost += inv.cost;
        current.total_profit += inv.profit;
        current.usage_count += 1;
        current.margins.push(inv.margin);
        byBlueprintType.set("no_blueprint", current);
      } else {
        inv.blueprints.forEach((bp: any) => {
          const blueprintType = bp.type || "unknown";
          const current = byBlueprintType.get(blueprintType) || {
            total_revenue: 0,
            total_cost: 0,
            total_profit: 0,
            usage_count: 0,
            margins: [],
          };
          current.total_revenue += inv.revenue;
          current.total_cost += inv.cost;
          current.total_profit += inv.profit;
          current.usage_count += 1;
          current.margins.push(inv.margin);
          byBlueprintType.set(blueprintType, current);
        });
      }
    });

    const blueprintTypeAnalysis = Array.from(byBlueprintType.entries()).map(([type, data]) => ({
      blueprint_type: type,
      usage_count: data.usage_count,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: data.total_revenue > 0
        ? parseFloat(((data.total_profit / data.total_revenue) * 100).toFixed(2))
        : 0,
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // ANALYZE BY SPECIFIC BLUEPRINT
    // ============================================
    const byBlueprint = new Map();

    invoiceCalculations.forEach(inv => {
      inv.blueprints.forEach((bp: any) => {
        if (!bp.id) return;

        const current = byBlueprint.get(bp.id) || {
          blueprint_name: bp.name || "Unknown",
          total_revenue: 0,
          total_cost: 0,
          total_profit: 0,
          usage_count: 0,
          margins: [],
        };

        current.total_revenue += inv.revenue;
        current.total_cost += inv.cost;
        current.total_profit += inv.profit;
        current.usage_count += 1;
        current.margins.push(inv.margin);

        byBlueprint.set(bp.id, current);
      });
    });

    const blueprintAnalysis = Array.from(byBlueprint.entries()).map(([id, data]) => ({
      blueprint_id: id,
      blueprint_name: data.blueprint_name,
      usage_count: data.usage_count,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: data.total_revenue > 0
        ? parseFloat(((data.total_profit / data.total_revenue) * 100).toFixed(2))
        : 0,
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // LOW & HIGH MARGIN JOBS
    // ============================================
    const lowMarginJobs = invoiceCalculations
      .filter(job => job.margin < min_margin)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10)
      .map(job => ({
        invoice_id: job.invoice_id,
        invoice_number: job.invoice_number,
        client: job.client,
        service_type: job.service_type,
        revenue: job.revenue,
        cost: job.cost,
        profit: job.profit,
        margin: job.margin,
        invoice_date: job.invoice_date,
        has_cost_data: job.has_cost_data,
      }));

    const highMarginJobs = invoiceCalculations
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10)
      .map(job => ({
        invoice_id: job.invoice_id,
        invoice_number: job.invoice_number,
        client: job.client,
        service_type: job.service_type,
        revenue: job.revenue,
        cost: job.cost,
        profit: job.profit,
        margin: job.margin,
        invoice_date: job.invoice_date,
        has_cost_data: job.has_cost_data,
      }));

    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    const allMargins = invoiceCalculations.map(j => j.margin);
    const averageMargin = allMargins.length > 0
      ? allMargins.reduce((sum, m) => sum + m, 0) / allMargins.length
      : 0;
    const medianMargin = getMedian(allMargins);
    const jobsBelowThreshold = invoiceCalculations.filter(j => j.margin < min_margin).length;
    const jobsWithCostData = invoiceCalculations.filter(j => j.has_cost_data).length;

    return new Response(
      JSON.stringify({
        success: true,
        period: {
          start_date: startDate,
          end_date: endDate,
        },
        by_service_type: serviceTypeAnalysis,
        by_blueprint_type: blueprintTypeAnalysis,
        by_blueprint: blueprintAnalysis.slice(0, 20),
        low_margin_jobs: lowMarginJobs,
        high_margin_jobs: highMarginJobs,
        summary: {
          total_jobs_analyzed: invoices.length,
          jobs_with_cost_data: jobsWithCostData,
          jobs_without_cost_data: invoices.length - jobsWithCostData,
          average_margin: parseFloat(averageMargin.toFixed(2)),
          median_margin: parseFloat(medianMargin.toFixed(2)),
          min_margin_threshold: min_margin,
          jobs_below_threshold: jobsBelowThreshold,
          jobs_below_threshold_percent: invoices.length > 0
            ? parseFloat(((jobsBelowThreshold / invoices.length) * 100).toFixed(2))
            : 0,
        },
        data_quality: {
          message: jobsWithCostData === 0
            ? "No cost data available. Link bank transactions to invoices to see accurate margin analysis."
            : jobsWithCostData < invoices.length
              ? `${jobsWithCostData} of ${invoices.length} invoices have cost data. Margins for invoices without cost data assume 100% margin.`
              : "All invoices have cost data for accurate margin analysis.",
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

function getMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}