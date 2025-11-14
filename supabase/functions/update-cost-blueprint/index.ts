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
      blueprint_id,
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
      is_active,
      inventory_items, // Array of { inventory_item_id, quantity_required, cost_per_unit?, notes? }
    } = await req.json();

    if (!blueprint_id) {
      return new Response(
        JSON.stringify({ error: "blueprint_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if blueprint exists and belongs to user
    const { data: existingBlueprint, error: checkError } = await supabaseClient
      .from("cost_blueprints")
      .select("*")
      .eq("id", blueprint_id)
      .eq("user_id", user.id)
      .single();

    if (checkError || !existingBlueprint) {
      return new Response(
        JSON.stringify({ error: "Blueprint not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object (only include provided fields)
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (blueprint_type !== undefined) updates.blueprint_type = blueprint_type;
    if (estimated_materials_cost !== undefined) updates.estimated_materials_cost = estimated_materials_cost;
    if (estimated_labor_cost !== undefined) updates.estimated_labor_cost = estimated_labor_cost;
    if (estimated_overhead_cost !== undefined) updates.estimated_overhead_cost = estimated_overhead_cost;
    if (target_sale_price !== undefined) updates.target_sale_price = target_sale_price;
    if (target_profit_margin !== undefined) updates.target_profit_margin = target_profit_margin;
    if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours;
    if (billing_frequency !== undefined) updates.billing_frequency = billing_frequency;
    if (is_active !== undefined) updates.is_active = is_active;

    // Update blueprint
    const { data: updatedBlueprint, error: updateError } = await supabaseClient
      .from("cost_blueprints")
      .update(updates)
      .eq("id", blueprint_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Update inventory items if provided
    if (inventory_items && Array.isArray(inventory_items)) {
      // Delete existing inventory item associations
      await supabaseClient
        .from("blueprint_inventory_items")
        .delete()
        .eq("blueprint_id", blueprint_id);

      // Insert new associations
      if (inventory_items.length > 0) {
        const inventoryInserts = inventory_items.map((item: any) => ({
          blueprint_id,
          inventory_item_id: item.inventory_item_id,
          quantity_required: item.quantity_required,
          cost_per_unit: item.cost_per_unit,
          notes: item.notes,
        }));

        const { error: inventoryError } = await supabaseClient
          .from("blueprint_inventory_items")
          .insert(inventoryInserts);

        if (inventoryError) {
          console.error("Error updating inventory items:", inventoryError);
        }
      }
    }

    // Fetch updated blueprint with inventory items
    const { data: fullBlueprint } = await supabaseClient
      .from("cost_blueprints")
      .select(`
        *,
        blueprint_inventory_items (
          *,
          inventory_items (*)
        )
      `)
      .eq("id", blueprint_id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Blueprint updated successfully",
        blueprint: fullBlueprint || updatedBlueprint,
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