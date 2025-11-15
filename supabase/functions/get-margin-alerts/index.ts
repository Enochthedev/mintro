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
    const margin_threshold = parseFloat(url.searchParams.get("margin_threshold") || "20");
    const cost_spike_threshold = parseFloat(url.searchParams.get("cost_spike_threshold") || "25");
    const days_back = parseInt(url.searchParams.get("days_back") || "30");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days_back);

    // ============================================
    // 1. LOW MARGIN JOBS
    // ============================================
    const { data: recentInvoices } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        blueprint_usage (
          *,
          cost_blueprints (
            name,
            target_profit_margin
          )
        )
      `)
      .eq("user_id", user.id)
      .not("total_actual_cost", "is", null)
      .gte("invoice_date", startDate.toISOString().split('T')[0]);

    const lowMarginJobs = recentInvoices
      ?.map(inv => {
        const revenue = parseFloat(inv.amount || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        return {
          invoice_id: inv.id,
          invoice_number: inv.invoice,
          client: inv.client,
          service_type: inv.service_type,
          invoice_date: inv.invoice_date,
          revenue,
          cost: parseFloat(inv.total_actual_cost || 0),
          profit,
          margin: parseFloat(margin.toFixed(2)),
          expected_margin: inv.blueprint_usage?.[0]?.cost_blueprints?.target_profit_margin || null,
        };
      })
      .filter(job => job.margin < margin_threshold && job.margin >= 0)
      .sort((a, b) => a.margin - b.margin) || [];

    // ============================================
    // 2. NEGATIVE PROFIT JOBS
    // ============================================
    const negativeJobs = recentInvoices
      ?.map(inv => {
        const revenue = parseFloat(inv.amount || 0);
        const cost = parseFloat(inv.total_actual_cost || 0);
        const profit = parseFloat(inv.actual_profit || 0);

        return {
          invoice_id: inv.id,
          invoice_number: inv.invoice,
          client: inv.client,
          service_type: inv.service_type,
          invoice_date: inv.invoice_date,
          revenue,
          cost,
          loss: Math.abs(profit),
        };
      })
      .filter(job => job.loss > 0 && job.revenue - job.cost < 0)
      .sort((a, b) => b.loss - a.loss) || [];

    // ============================================
    // 3. COST SPIKES (vs Blueprint Estimates)
    // ============================================
    const costSpikes = recentInvoices
      ?.filter(inv => inv.blueprint_usage && inv.blueprint_usage.length > 0)
      .map(inv => {
        const estimatedCost = inv.blueprint_usage.reduce(
          (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
          0
        );
        const actualCost = parseFloat(inv.total_actual_cost || 0);
        const variance = actualCost - estimatedCost;
        const variancePercent = estimatedCost > 0 ? (variance / estimatedCost) * 100 : 0;

        return {
          invoice_id: inv.id,
          invoice_number: inv.invoice,
          client: inv.client,
          service_type: inv.service_type,
          invoice_date: inv.invoice_date,
          estimated_cost: parseFloat(estimatedCost.toFixed(2)),
          actual_cost: parseFloat(actualCost.toFixed(2)),
          variance: parseFloat(variance.toFixed(2)),
          variance_percent: parseFloat(variancePercent.toFixed(2)),
          blueprints_used: inv.blueprint_usage.map((u: any) => u.cost_blueprints?.name).filter(Boolean),
        };
      })
      .filter(job => job.variance_percent > cost_spike_threshold)
      .sort((a, b) => b.variance_percent - a.variance_percent) || [];

    // ============================================
    // 4. DECLINING MARGIN TREND
    // ============================================
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: historicalInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .not("total_actual_cost", "is", null)
      .gte("invoice_date", threeMonthsAgo.toISOString().split('T')[0])
      .order("invoice_date", { ascending: true });

    let decliningTrend = null;

    if (historicalInvoices && historicalInvoices.length >= 6) {
      const half = Math.floor(historicalInvoices.length / 2);
      const firstHalf = historicalInvoices.slice(0, half);
      const secondHalf = historicalInvoices.slice(half);

      const avgMarginFirst = firstHalf.reduce((sum, inv) => {
        const revenue = parseFloat(inv.amount || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        return sum + (revenue > 0 ? (profit / revenue) * 100 : 0);
      }, 0) / firstHalf.length;

      const avgMarginSecond = secondHalf.reduce((sum, inv) => {
        const revenue = parseFloat(inv.amount || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        return sum + (revenue > 0 ? (profit / revenue) * 100 : 0);
      }, 0) / secondHalf.length;

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

    recentInvoices?.forEach(inv => {
      inv.blueprint_usage?.forEach((usage: any) => {
        const blueprintId = usage.cost_blueprints?.id;
        if (!blueprintId) return;

        const revenue = parseFloat(inv.amount || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        const current = blueprintPerformance.get(blueprintId) || {
          blueprint_name: usage.cost_blueprints?.name,
          margins: [],
          usage_count: 0,
        };

        current.margins.push(margin);
        current.usage_count += 1;

        blueprintPerformance.set(blueprintId, current);
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
      .sort((a, b) => a.average_margin - b.average_margin);

    // ============================================
    // SUMMARY
    // ============================================
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
        },
        alerts: {
          low_margin_jobs: lowMarginJobs.slice(0, 10),
          negative_profit_jobs: negativeJobs.slice(0, 10),
          cost_spikes: costSpikes.slice(0, 10),
          underperforming_blueprints: underperformingBlueprints.slice(0, 5),
          declining_margin_trend: decliningTrend,
        },
        recommendations: generateRecommendations(
          lowMarginJobs.length,
          negativeJobs.length,
          costSpikes.length,
          decliningTrend
        ),
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
  decliningTrend: any
): string[] {
  const recommendations: string[] = [];

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