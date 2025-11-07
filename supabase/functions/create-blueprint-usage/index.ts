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

    const {
      blueprint_id,
      invoice_id,
      actual_materials_cost = 0,
      actual_labor_cost = 0,
      actual_overhead_cost = 0,
      actual_sale_price,
      completed_date,
      notes,
      deduct_inventory = true,
    } = await req.json();

    if (!blueprint_id || !actual_sale_price) {
      return new Response(
        JSON.stringify({ error: "blueprint_id and actual_sale_price are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get blueprint with inventory items
    const { data: blueprint, error: blueprintError } = await supabaseClient
      .from("cost_blueprints")
      .select(`
        *,
        blueprint_inventory_items (
          *,
          inventory_items (*)
        )
      `)
      .eq("id", blueprint_id)
      .eq("user_id", user.id)
      .single();

    if (blueprintError || !blueprint) {
      return new Response(
        JSON.stringify({ error: "Blueprint not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ CHECK INVENTORY BEFORE CREATING USAGE
    const inventoryChecks: any[] = [];
    if (deduct_inventory && blueprint.blueprint_inventory_items?.length > 0) {
      for (const item of blueprint.blueprint_inventory_items) {
        const currentQty = item.inventory_items.current_quantity || 0;
        const required = item.quantity_required || 0;
        
        if (currentQty < required) {
          inventoryChecks.push({
            item_id: item.inventory_items.id,
            item_name: item.inventory_items.name,
            current: currentQty,
            required: required,
            shortage: required - currentQty,
          });
        }
      }
      
      if (inventoryChecks.length > 0) {
        return new Response(
          JSON.stringify({ 
            error: "Insufficient inventory",
            shortages: inventoryChecks 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create blueprint usage
    const { data: usage, error: usageError } = await supabaseClient
      .from("blueprint_usage")
      .insert({
        user_id: user.id,
        blueprint_id,
        invoice_id,
        actual_materials_cost,
        actual_labor_cost,
        actual_overhead_cost,
        actual_sale_price,
        completed_date: completed_date || new Date().toISOString().split('T')[0],
        notes,
      })
      .select()
      .single();

    if (usageError) {
      throw usageError;
    }

    // ✅ DEDUCT INVENTORY AND UPDATE QUANTITIES
    const inventoryDeductions: any[] = [];
    if (deduct_inventory && blueprint.blueprint_inventory_items?.length > 0) {
      for (const item of blueprint.blueprint_inventory_items) {
        const inventoryItemId = item.inventory_item_id;
        const quantityUsed = item.quantity_required || 0;
        const currentQty = item.inventory_items.current_quantity || 0;
        const newQty = currentQty - quantityUsed;

        // Update inventory quantity
        const { error: updateError } = await supabaseClient
          .from("inventory_items")
          .update({ 
            current_quantity: newQty,
            updated_at: new Date().toISOString()
          })
          .eq("id", inventoryItemId);

        if (updateError) {
          console.error("Error updating inventory:", updateError);
          continue;
        }

        // Log inventory transaction
        await supabaseClient
          .from("inventory_transactions")
          .insert({
            user_id: user.id,
            inventory_item_id: inventoryItemId,
            transaction_type: "blueprint_usage",
            quantity_change: -quantityUsed,
            unit_cost: item.inventory_items.unit_cost,
            reference_id: usage.id,
            reference_type: "blueprint_usage",
            notes: `Used for ${blueprint.name}${invoice_id ? ` (Invoice: ${invoice_id})` : ''}`,
          });

        inventoryDeductions.push({
          item_id: inventoryItemId,
          item_name: item.inventory_items.name,
          quantity_used: quantityUsed,
          quantity_remaining: newQty,
          is_low_stock: newQty <= (item.inventory_items.minimum_quantity || 0),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        usage,
        inventory_deductions: inventoryDeductions,
        total_items_deducted: inventoryDeductions.length,
        low_stock_alerts: inventoryDeductions.filter(d => d.is_low_stock),
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