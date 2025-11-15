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
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    const min_margin = parseFloat(url.searchParams.get("min_margin") || "0");

    const startDate = start_date || `${new Date().getFullYear()}-01-01`;
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // ============================================
    // GET INVOICES WITH COST TRACKING
    // ============================================
    const { data: invoices, error: invoicesError } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        blueprint_usage (
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type
          )
        )
      `)
      .eq("user_id", user.id)
      .not("total_actual_cost", "is", null)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate);

    if (invoicesError) {
      throw invoicesError;
    }

    if (!invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No invoices with cost tracking found",
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
    // ANALYZE BY SERVICE TYPE
    // ============================================
    const byServiceType = new Map();

    invoices.forEach(inv => {
      const serviceType = inv.service_type || "Uncategorized";
      const revenue = parseFloat(inv.amount || 0);
      const cost = parseFloat(inv.total_actual_cost || 0);
      const profit = parseFloat(inv.actual_profit || 0);
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      const current = byServiceType.get(serviceType) || {
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        job_count: 0,
        margins: [],
      };

      current.total_revenue += revenue;
      current.total_cost += cost;
      current.total_profit += profit;
      current.job_count += 1;
      current.margins.push(margin);

      byServiceType.set(serviceType, current);
    });

    const serviceTypeAnalysis = Array.from(byServiceType.entries()).map(([type, data]) => ({
      service_type: type,
      job_count: data.job_count,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: parseFloat((data.total_profit / data.total_revenue * 100).toFixed(2)),
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
      min_margin: parseFloat(Math.min(...data.margins).toFixed(2)),
      max_margin: parseFloat(Math.max(...data.margins).toFixed(2)),
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // ANALYZE BY BLUEPRINT TYPE
    // ============================================
    const byBlueprintType = new Map();

    invoices.forEach(inv => {
      inv.blueprint_usage?.forEach((usage: any) => {
        const blueprintType = usage.cost_blueprints?.blueprint_type || "no_blueprint";
        const revenue = parseFloat(inv.amount || 0);
        const cost = parseFloat(inv.total_actual_cost || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        const current = byBlueprintType.get(blueprintType) || {
          total_revenue: 0,
          total_cost: 0,
          total_profit: 0,
          usage_count: 0,
          margins: [],
        };

        current.total_revenue += revenue;
        current.total_cost += cost;
        current.total_profit += profit;
        current.usage_count += 1;
        current.margins.push(margin);

        byBlueprintType.set(blueprintType, current);
      });
    });

    const blueprintTypeAnalysis = Array.from(byBlueprintType.entries()).map(([type, data]) => ({
      blueprint_type: type,
      usage_count: data.usage_count,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: parseFloat((data.total_profit / data.total_revenue * 100).toFixed(2)),
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // ANALYZE BY SPECIFIC BLUEPRINT
    // ============================================
    const byBlueprint = new Map();

    invoices.forEach(inv => {
      inv.blueprint_usage?.forEach((usage: any) => {
        const blueprintId = usage.cost_blueprints?.id;
        const blueprintName = usage.cost_blueprints?.name || "Unknown";
        
        if (!blueprintId) return;

        const revenue = parseFloat(inv.amount || 0);
        const cost = parseFloat(inv.total_actual_cost || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        const current = byBlueprint.get(blueprintId) || {
          blueprint_name: blueprintName,
          total_revenue: 0,
          total_cost: 0,
          total_profit: 0,
          usage_count: 0,
          margins: [],
        };

        current.total_revenue += revenue;
        current.total_cost += cost;
        current.total_profit += profit;
        current.usage_count += 1;
        current.margins.push(margin);

        byBlueprint.set(blueprintId, current);
      });
    });

    const blueprintAnalysis = Array.from(byBlueprint.entries()).map(([id, data]) => ({
      blueprint_id: id,
      blueprint_name: data.blueprint_name,
      usage_count: data.usage_count,
      total_revenue: parseFloat(data.total_revenue.toFixed(2)),
      total_cost: parseFloat(data.total_cost.toFixed(2)),
      total_profit: parseFloat(data.total_profit.toFixed(2)),
      average_margin: parseFloat((data.total_profit / data.total_revenue * 100).toFixed(2)),
      median_margin: parseFloat(getMedian(data.margins).toFixed(2)),
    })).sort((a, b) => b.average_margin - a.average_margin);

    // ============================================
    // LOW & HIGH MARGIN JOBS
    // ============================================
    const jobsWithMargins = invoices.map(inv => {
      const revenue = parseFloat(inv.amount || 0);
      const profit = parseFloat(inv.actual_profit || 0);
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type,
        revenue,
        cost: parseFloat(inv.total_actual_cost || 0),
        profit,
        margin: parseFloat(margin.toFixed(2)),
        invoice_date: inv.invoice_date,
      };
    });

    const lowMarginJobs = jobsWithMargins
      .filter(job => job.margin < min_margin)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10);

    const highMarginJobs = jobsWithMargins
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10);

    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    const allMargins = jobsWithMargins.map(j => j.margin);
    const averageMargin = allMargins.reduce((sum, m) => sum + m, 0) / allMargins.length;
    const medianMargin = getMedian(allMargins);
    const jobsBelowThreshold = jobsWithMargins.filter(j => j.margin < min_margin).length;

    return new Response(
      JSON.stringify({
        success: true,
        period: {
          start_date: startDate,
          end_date: endDate,
        },
        by_service_type: serviceTypeAnalysis,
        by_blueprint_type: blueprintTypeAnalysis,
        by_blueprint: blueprintAnalysis.slice(0, 20), // Top 20
        low_margin_jobs: lowMarginJobs,
        high_margin_jobs: highMarginJobs,
        summary: {
          total_jobs_analyzed: invoices.length,
          average_margin: parseFloat(averageMargin.toFixed(2)),
          median_margin: parseFloat(medianMargin.toFixed(2)),
          min_margin_threshold: min_margin,
          jobs_below_threshold: jobsBelowThreshold,
          jobs_below_threshold_percent: parseFloat(((jobsBelowThreshold / invoices.length) * 100).toFixed(2)),
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