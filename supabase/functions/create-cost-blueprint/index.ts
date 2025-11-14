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
      name,
      description,
      blueprint_type,
      estimated_materials_cost = 0,
      estimated_labor_cost = 0,
      estimated_overhead_cost = 0,
      target_sale_price,
      target_profit_margin,
      estimated_hours,
      billing_frequency,
      inventory_items = [], // Array of {inventory_item_id, quantity_required}
    } = await req.json();

    if (!name || !blueprint_type || !target_sale_price) {
      return new Response(
        JSON.stringify({ error: "name, blueprint_type, and target_sale_price are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes = ['service', 'product', 'subscription'];
    if (!validTypes.includes(blueprint_type)) {
      return new Response(
        JSON.stringify({ error: `blueprint_type must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create blueprint
    const { data: blueprint, error: insertError } = await supabaseClient
      .from("cost_blueprints")
      .insert({
        user_id: user.id,
        name,
        description,
        blueprint_type,
        estimated_materials_cost,
        estimated_labor_cost,
        estimated_overhead_cost,
        target_sale_price,
        target_profit_margin,
        estimated_hours,
        billing_frequency,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // Link inventory items
    if (inventory_items.length > 0) {
      const inventoryLinks = inventory_items.map((item: any) => ({
        blueprint_id: blueprint.id,
        inventory_item_id: item.inventory_item_id,
        quantity_required: item.quantity_required,
        cost_per_unit: item.cost_per_unit || null,
        notes: item.notes || null,
      }));

      const { error: linkError } = await supabaseClient
        .from("blueprint_inventory_items")
        .insert(inventoryLinks);

      if (linkError) {
        console.error("Error linking inventory items:", linkError);
      }
    }

    // Fetch complete blueprint with inventory items
    const { data: completeBlueprint } = await supabaseClient
      .from("cost_blueprints")
      .select(`
        *,
        blueprint_inventory_items (
          *,
          inventory_items (*)
        )
      `)
      .eq("id", blueprint.id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        blueprint: completeBlueprint,
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