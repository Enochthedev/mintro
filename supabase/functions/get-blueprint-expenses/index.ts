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
    const blueprint_usage_id = url.searchParams.get("blueprint_usage_id");

    if (!blueprint_usage_id) {
      return new Response(
        JSON.stringify({ error: "blueprint_usage_id query parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify blueprint usage belongs to user
    const { data: usage, error: usageError } = await supabaseClient
      .from("blueprint_usage")
      .select(`
        *,
        cost_blueprints (
          id,
          name,
          description,
          blueprint_type,
          estimated_materials_cost,
          estimated_labor_cost,
          estimated_overhead_cost,
          total_estimated_cost,
          target_sale_price
        )
      `)
      .eq("id", blueprint_usage_id)
      .eq("user_id", user.id)
      .single();

    if (usageError || !usage) {
      return new Response(
        JSON.stringify({ error: "Blueprint usage not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all expense allocations
    const { data: allocations, error: allocError } = await supabaseClient
      .from("blueprint_expense_allocations")
      .select(`
        *,
        transactions (
          id,
          transaction_id,
          date,
          amount,
          name,
          merchant_name,
          pending
        )
      `)
      .eq("blueprint_usage_id", blueprint_usage_id)
      .order("created_at", { ascending: false });

    if (allocError) {
      throw allocError;
    }

    // Group expenses by type
    const expensesByType = {
      materials: allocations?.filter(a => a.expense_type === 'materials') || [],
      labor: allocations?.filter(a => a.expense_type === 'labor') || [],
      overhead: allocations?.filter(a => a.expense_type === 'overhead') || [],
    };

    return new Response(
      JSON.stringify({
        success: true,
        blueprint_usage: {
          id: usage.id,
          completed_date: usage.completed_date,
          actual_sale_price: usage.actual_sale_price,
          notes: usage.notes,
        },
        blueprint: usage.cost_blueprints,
        expenses: {
          all: allocations || [],
          by_type: expensesByType,
        },
        summary: {
          estimated: {
            materials: usage.cost_blueprints.estimated_materials_cost,
            labor: usage.cost_blueprints.estimated_labor_cost,
            overhead: usage.cost_blueprints.estimated_overhead_cost,
            total: usage.cost_blueprints.total_estimated_cost,
          },
          actual: {
            materials: usage.actual_materials_cost,
            labor: usage.actual_labor_cost,
            overhead: usage.actual_overhead_cost,
            total: usage.total_actual_cost,
          },
          variance: {
            materials: usage.actual_materials_cost - usage.cost_blueprints.estimated_materials_cost,
            labor: usage.actual_labor_cost - usage.cost_blueprints.estimated_labor_cost,
            overhead: usage.actual_overhead_cost - usage.cost_blueprints.estimated_overhead_cost,
            total: usage.cost_variance,
          },
          profit: {
            actual: usage.actual_profit,
            target: usage.cost_blueprints.target_sale_price - usage.cost_blueprints.total_estimated_cost,
            variance: usage.profit_variance,
          },
        },
        expense_count: allocations?.length || 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});