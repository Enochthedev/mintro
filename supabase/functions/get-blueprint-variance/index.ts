import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const blueprintId = url.searchParams.get("blueprint_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

    // Get blueprint usages
    let query = supabaseClient
      .from("blueprint_usage")
      .select(`
        *,
        cost_blueprints (
          id,
          name,
          blueprint_type,
          estimated_materials_cost,
          estimated_labor_cost,
          estimated_overhead_cost,
          total_estimated_cost,
          target_sale_price
        )
      `)
      .eq("user_id", user.id);

    if (blueprintId) {
      query = query.eq("blueprint_id", blueprintId);
    }

    if (startDate) {
      query = query.gte("completed_date", startDate);
    }

    if (endDate) {
      query = query.lte("completed_date", endDate);
    }

    const { data: usages, error: usageError } = await query
      .order("completed_date", { ascending: false });

    if (usageError) throw usageError;

    // Calculate variances
    const variances = (usages || []).map((usage: any) => {
      const bp = usage.cost_blueprints;
      
      const materialsVariance = (usage.actual_materials_cost || 0) - (bp.estimated_materials_cost || 0);
      const laborVariance = (usage.actual_labor_cost || 0) - (bp.estimated_labor_cost || 0);
      const overheadVariance = (usage.actual_overhead_cost || 0) - (bp.estimated_overhead_cost || 0);
      const totalCostVariance = (usage.total_actual_cost || 0) - (bp.total_estimated_cost || 0);
      
      const targetProfit = (bp.target_sale_price || 0) - (bp.total_estimated_cost || 0);
      const actualProfit = (usage.actual_sale_price || 0) - (usage.total_actual_cost || 0);
      const profitVariance = actualProfit - targetProfit;

      return {
        usage_id: usage.id,
        blueprint_id: bp.id,
        blueprint_name: bp.name,
        blueprint_type: bp.blueprint_type,
        completed_date: usage.completed_date,
        estimated: {
          materials: bp.estimated_materials_cost || 0,
          labor: bp.estimated_labor_cost || 0,
          overhead: bp.estimated_overhead_cost || 0,
          total_cost: bp.total_estimated_cost || 0,
          sale_price: bp.target_sale_price || 0,
          profit: targetProfit,
        },
        actual: {
          materials: usage.actual_materials_cost || 0,
          labor: usage.actual_labor_cost || 0,
          overhead: usage.actual_overhead_cost || 0,
          total_cost: usage.total_actual_cost || 0,
          sale_price: usage.actual_sale_price || 0,
          profit: actualProfit,
        },
        variance: {
          materials: materialsVariance,
          labor: laborVariance,
          overhead: overheadVariance,
          total_cost: totalCostVariance,
          profit: profitVariance,
        },
        variance_percentage: {
          materials: bp.estimated_materials_cost > 0 
            ? (materialsVariance / bp.estimated_materials_cost) * 100 
            : 0,
          labor: bp.estimated_labor_cost > 0 
            ? (laborVariance / bp.estimated_labor_cost) * 100 
            : 0,
          overhead: bp.estimated_overhead_cost > 0 
            ? (overheadVariance / bp.estimated_overhead_cost) * 100 
            : 0,
          total_cost: bp.total_estimated_cost > 0 
            ? (totalCostVariance / bp.total_estimated_cost) * 100 
            : 0,
          profit: targetProfit > 0 
            ? (profitVariance / targetProfit) * 100 
            : 0,
        },
        performance: totalCostVariance <= 0 ? "under_budget" : "over_budget",
      };
    });

    // Calculate summary statistics
    const totalJobs = variances.length;
    const avgMaterialsVariance = totalJobs > 0
      ? variances.reduce((sum, v) => sum + v.variance.materials, 0) / totalJobs
      : 0;
    const avgLaborVariance = totalJobs > 0
      ? variances.reduce((sum, v) => sum + v.variance.labor, 0) / totalJobs
      : 0;
    const avgOverheadVariance = totalJobs > 0
      ? variances.reduce((sum, v) => sum + v.variance.overhead, 0) / totalJobs
      : 0;
    const avgTotalVariance = totalJobs > 0
      ? variances.reduce((sum, v) => sum + v.variance.total_cost, 0) / totalJobs
      : 0;

    const jobsOverBudget = variances.filter(v => v.variance.total_cost > 0).length;
    const jobsUnderBudget = variances.filter(v => v.variance.total_cost < 0).length;
    const jobsOnBudget = variances.filter(v => Math.abs(v.variance.total_cost) < 1).length;

    return new Response(
      JSON.stringify({
        success: true,
        variances,
        summary: {
          total_jobs: totalJobs,
          avg_variances: {
            materials: avgMaterialsVariance,
            labor: avgLaborVariance,
            overhead: avgOverheadVariance,
            total: avgTotalVariance,
          },
          performance: {
            over_budget: jobsOverBudget,
            under_budget: jobsUnderBudget,
            on_budget: jobsOnBudget,
          },
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