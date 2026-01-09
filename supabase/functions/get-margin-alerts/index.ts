import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-margin-alerts
 * 
 * REFACTORED: Now analyzes ALL invoices, not just those with pre-set costs.
 * Calculates costs from linked transactions (transaction_job_allocations) as primary source.
 * Alerts are generated based on calculated margins, not just stored values.
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
    const margin_threshold = parseFloat(url.searchParams.get("margin_threshold") || "20");
    const cost_spike_threshold = parseFloat(url.searchParams.get("cost_spike_threshold") || "25");
    const days_back = parseInt(url.searchParams.get("days_back") || "30");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days_back);

    // ============================================
    // GET ALL INVOICES (no cost filter)
    // ============================================
    const { data: recentInvoices, error: invoicesError } = await supabaseClient
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
            target_profit_margin,
            total_estimated_cost
          )
        )
      `)
      .eq("user_id", user.id)
      .gte("invoice_date", startDate.toISOString().split('T')[0]);

    if (invoicesError) {
      throw invoicesError;
    }

    // ============================================
    // GET LINKED TRANSACTIONS FOR ALL INVOICES
    // ============================================
    const invoiceIds = recentInvoices?.map(inv => inv.id) || [];

    const { data: allAllocations, error: allocError } = await supabaseClient
      .from("transaction_job_allocations")
      .select("job_id, allocation_amount")
      .in("job_id", invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

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
    const invoiceCalculations = (recentInvoices || []).map(inv => {
      const revenue = parseFloat(inv.amount || 0);

      // Get costs from linked transactions (primary source)
      const transactionCosts = allocationsByInvoice.get(inv.id) || 0;

      // Get estimated costs from blueprints (if any)
      const blueprintCosts = (inv.blueprint_usage || []).reduce(
        (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
        0
      );

      // Determine effective cost
      let effectiveCost: number;
      if (inv.cost_override_by_user && inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
      } else if (inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else {
        effectiveCost = 0;
      }

      const profit = revenue - effectiveCost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const hasCostData = transactionCosts > 0 || blueprintCosts > 0 || inv.total_actual_cost !== null;

      // Get blueprint info
      const blueprints = (inv.blueprint_usage || []).map((usage: any) => ({
        id: usage.cost_blueprints?.id,
        name: usage.cost_blueprints?.name,
        target_margin: usage.cost_blueprints?.target_profit_margin,
        estimated_cost: parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
      })).filter((bp: any) => bp.id);

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type,
        invoice_date: inv.invoice_date,
        revenue,
        cost: effectiveCost,
        profit,
        margin: parseFloat(margin.toFixed(2)),
        has_cost_data: hasCostData,
        blueprints,
        estimated_cost: blueprintCosts,
        cost_variance: blueprintCosts > 0 ? effectiveCost - blueprintCosts : null,
        cost_variance_percent: blueprintCosts > 0 ? ((effectiveCost - blueprintCosts) / blueprintCosts) * 100 : null,
        expected_margin: blueprints[0]?.target_margin || null,
      };
    });

    // ============================================
    // 1. LOW MARGIN JOBS (only those with cost data)
    // ============================================
    const lowMarginJobs = invoiceCalculations
      .filter(job => job.has_cost_data && job.margin < margin_threshold && job.margin >= 0)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10)
      .map(job => ({
        invoice_id: job.invoice_id,
        invoice_number: job.invoice_number,
        client: job.client,
        service_type: job.service_type,
        invoice_date: job.invoice_date,
        revenue: job.revenue,
        cost: job.cost,
        profit: job.profit,
        margin: job.margin,
        expected_margin: job.expected_margin,
      }));

    // ============================================
    // 2. NEGATIVE PROFIT JOBS (only those with cost data)
    // ============================================
    const negativeJobs = invoiceCalculations
      .filter(job => job.has_cost_data && job.profit < 0)
      .sort((a, b) => a.profit - b.profit)
      .slice(0, 10)
      .map(job => ({
        invoice_id: job.invoice_id,
        invoice_number: job.invoice_number,
        client: job.client,
        service_type: job.service_type,
        invoice_date: job.invoice_date,
        revenue: job.revenue,
        cost: job.cost,
        loss: Math.abs(job.profit),
      }));

    // ============================================
    // 3. COST SPIKES (vs Blueprint Estimates)
    // ============================================
    const costSpikes = invoiceCalculations
      .filter(job => job.has_cost_data && job.cost_variance_percent !== null && job.cost_variance_percent > cost_spike_threshold)
      .sort((a, b) => (b.cost_variance_percent || 0) - (a.cost_variance_percent || 0))
      .slice(0, 10)
      .map(job => ({
        invoice_id: job.invoice_id,
        invoice_number: job.invoice_number,
        client: job.client,
        service_type: job.service_type,
        invoice_date: job.invoice_date,
        estimated_cost: parseFloat(job.estimated_cost.toFixed(2)),
        actual_cost: parseFloat(job.cost.toFixed(2)),
        variance: parseFloat((job.cost_variance || 0).toFixed(2)),
        variance_percent: parseFloat((job.cost_variance_percent || 0).toFixed(2)),
        blueprints_used: job.blueprints.map(bp => bp.name).filter(Boolean),
      }));

    // ============================================
    // 4. DECLINING MARGIN TREND
    // ============================================
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: historicalInvoices } = await supabaseClient
      .from("invoices")
      .select("id, amount, invoice_date, total_actual_cost, cost_override_by_user")
      .eq("user_id", user.id)
      .gte("invoice_date", threeMonthsAgo.toISOString().split('T')[0])
      .order("invoice_date", { ascending: true });

    // Get allocations for historical invoices too
    const historicalIds = historicalInvoices?.map(inv => inv.id) || [];
    const { data: historicalAllocations } = await supabaseClient
      .from("transaction_job_allocations")
      .select("job_id, allocation_amount")
      .in("job_id", historicalIds.length > 0 ? historicalIds : ['00000000-0000-0000-0000-000000000000']);

    const historicalAllocationsByInvoice = new Map<string, number>();
    (historicalAllocations || []).forEach((alloc: { job_id: string; allocation_amount: number | string }) => {
      const current = historicalAllocationsByInvoice.get(alloc.job_id) || 0;
      historicalAllocationsByInvoice.set(alloc.job_id, current + Math.abs(parseFloat(String(alloc.allocation_amount || 0))));
    });

    let decliningTrend = null;

    const historicalCalcs = (historicalInvoices || []).map(inv => {
      const revenue = parseFloat(inv.amount || 0);
      const transactionCosts = historicalAllocationsByInvoice.get(inv.id) || 0;
      let effectiveCost = 0;

      if (inv.cost_override_by_user && inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
      } else if (inv.total_actual_cost !== null) {
        effectiveCost = parseFloat(inv.total_actual_cost || 0);
      }

      const profit = revenue - effectiveCost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const hasCostData = transactionCosts > 0 || inv.total_actual_cost !== null;

      return { margin, hasCostData };
    }).filter(c => c.hasCostData);

    if (historicalCalcs.length >= 6) {
      const half = Math.floor(historicalCalcs.length / 2);
      const firstHalf = historicalCalcs.slice(0, half);
      const secondHalf = historicalCalcs.slice(half);

      const avgMarginFirst = firstHalf.reduce((sum, c) => sum + c.margin, 0) / firstHalf.length;
      const avgMarginSecond = secondHalf.reduce((sum, c) => sum + c.margin, 0) / secondHalf.length;
      const decline = avgMarginFirst - avgMarginSecond;

      if (decline > 5) {
        decliningTrend = {
          alert: true,
          first_period_avg_margin: parseFloat(avgMarginFirst.toFixed(2)),
          second_period_avg_margin: parseFloat(avgMarginSecond.toFixed(2)),
          decline_percent: parseFloat(decline.toFixed(2)),
          message: `Profit margins have declined by ${decline.toFixed(1)}% over the past 3 months`,
        };
      }
    }

    // ============================================
    // 5. BLUEPRINT PERFORMANCE ALERTS
    // ============================================
    const blueprintPerformance = new Map();

    invoiceCalculations.filter(c => c.has_cost_data).forEach(inv => {
      inv.blueprints.forEach((bp: any) => {
        if (!bp.id) return;

        const current = blueprintPerformance.get(bp.id) || {
          blueprint_name: bp.name,
          margins: [],
          usage_count: 0,
        };

        current.margins.push(inv.margin);
        current.usage_count += 1;
        blueprintPerformance.set(bp.id, current);
      });
    });

    const underperformingBlueprints = Array.from(blueprintPerformance.entries())
      .map(([id, data]) => {
        const avgMargin = data.margins.reduce((sum: number, m: number) => sum + m, 0) / data.margins.length;
        return {
          blueprint_id: id,
          blueprint_name: data.blueprint_name,
          usage_count: data.usage_count,
          average_margin: parseFloat(avgMargin.toFixed(2)),
        };
      })
      .filter(bp => bp.average_margin < margin_threshold)
      .sort((a, b) => a.average_margin - b.average_margin)
      .slice(0, 5);

    // ============================================
    // 6. INVOICES WITHOUT COST DATA
    // ============================================
    const invoicesWithoutCostData = invoiceCalculations
      .filter(inv => !inv.has_cost_data)
      .slice(0, 5)
      .map(inv => ({
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        client: inv.client,
        invoice_date: inv.invoice_date,
        revenue: inv.revenue,
        message: "No cost data. Link transactions to track profit.",
      }));

    // ============================================
    // SUMMARY
    // ============================================
    const invoicesWithCostData = invoiceCalculations.filter(c => c.has_cost_data).length;
    const totalInvoices = invoiceCalculations.length;

    const totalAlerts =
      lowMarginJobs.length +
      negativeJobs.length +
      costSpikes.length +
      underperformingBlueprints.length +
      (decliningTrend ? 1 : 0);

    const totalRevenueLost = negativeJobs.reduce((sum, job) => sum + job.loss, 0);

    return new Response(
      JSON.stringify({
        success: true,
        alert_settings: {
          margin_threshold,
          cost_spike_threshold,
          days_analyzed: days_back,
        },
        summary: {
          total_alerts: totalAlerts,
          low_margin_jobs_count: lowMarginJobs.length,
          negative_jobs_count: negativeJobs.length,
          cost_spikes_count: costSpikes.length,
          underperforming_blueprints_count: underperformingBlueprints.length,
          total_revenue_lost: parseFloat(totalRevenueLost.toFixed(2)),
          invoices_analyzed: totalInvoices,
          invoices_with_cost_data: invoicesWithCostData,
        },
        alerts: {
          low_margin_jobs: lowMarginJobs,
          negative_profit_jobs: negativeJobs,
          cost_spikes: costSpikes,
          underperforming_blueprints: underperformingBlueprints,
          declining_margin_trend: decliningTrend,
          missing_cost_data: invoicesWithoutCostData,
        },
        recommendations: generateRecommendations(
          lowMarginJobs.length,
          negativeJobs.length,
          costSpikes.length,
          decliningTrend,
          invoicesWithoutCostData.length,
          totalInvoices
        ),
        data_quality: {
          message: invoicesWithCostData === 0
            ? "No cost data available. Link bank transactions to invoices to see margin alerts."
            : invoicesWithCostData < totalInvoices
              ? `${invoicesWithCostData} of ${totalInvoices} invoices have cost data. Alerts may be incomplete.`
              : "All invoices have cost data for comprehensive alerting.",
          cost_data_coverage: totalInvoices > 0
            ? parseFloat(((invoicesWithCostData / totalInvoices) * 100).toFixed(2))
            : 0,
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

function generateRecommendations(
  lowMarginCount: number,
  negativeCount: number,
  spikeCount: number,
  decliningTrend: any,
  missingCostDataCount: number,
  totalInvoices: number
): string[] {
  const recommendations: string[] = [];

  if (missingCostDataCount > 0 && missingCostDataCount > totalInvoices * 0.5) {
    recommendations.push("📌 Most invoices are missing cost data. Link bank transactions to invoices to track profitability.");
  }

  if (negativeCount > 0) {
    recommendations.push("⚠️ You have jobs losing money. Review pricing strategy immediately.");
  }

  if (lowMarginCount > 3) {
    recommendations.push("📊 Multiple low-margin jobs detected. Consider raising prices or reducing costs.");
  }

  if (spikeCount > 2) {
    recommendations.push("💰 Cost overruns detected. Update blueprint estimates or improve cost control.");
  }

  if (decliningTrend) {
    recommendations.push("📉 Margins are trending down. Investigate vendor pricing or operational changes.");
  }

  if (recommendations.length === 0) {
    recommendations.push("✅ No major margin issues detected. Keep monitoring for changes.");
  }

  return recommendations;
}