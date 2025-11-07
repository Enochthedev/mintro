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
      inventory_item_id,
      transaction_type, // 'purchase', 'usage', 'adjustment', 'waste', 'return'
      quantity_change,
      unit_cost,
      reference_id,
      reference_type, // 'transaction', 'blueprint_usage', 'manual', 'job'
      notes,
    } = await req.json();

    if (!inventory_item_id || !transaction_type || quantity_change === undefined) {
      return new Response(
        JSON.stringify({ error: "inventory_item_id, transaction_type, and quantity_change are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate transaction type
    const validTypes = ['purchase', 'usage', 'adjustment', 'waste', 'return', 'blueprint_usage'];
    if (!validTypes.includes(transaction_type)) {
      return new Response(
        JSON.stringify({ error: `transaction_type must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get current inventory item
    const { data: item, error: itemError } = await supabaseClient
      .from("inventory_items")
      .select("*")
      .eq("id", inventory_item_id)
      .eq("user_id", user.id)
      .single();

    if (itemError || !item) {
      return new Response(
        JSON.stringify({ error: "Inventory item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const quantityBefore = item.current_quantity;
    const quantityAfter = quantityBefore + quantity_change;

    // Check for negative inventory
    if (quantityAfter < 0) {
      return new Response(
        JSON.stringify({ 
          error: "Insufficient inventory",
          current: quantityBefore,
          requested: Math.abs(quantity_change),
          shortage: Math.abs(quantityAfter)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update inventory
    const { error: updateError } = await supabaseClient
      .from("inventory_items")
      .update({
        current_quantity: quantityAfter,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inventory_item_id);

    if (updateError) throw updateError;

    // Log transaction
    const { data: invTx, error: txError } = await supabaseClient
      .from("inventory_transactions")
      .insert({
        user_id: user.id,
        inventory_item_id,
        transaction_type,
        quantity_change,
        unit_cost: unit_cost || item.unit_cost,
        reference_id,
        reference_type,
        notes,
      })
      .select()
      .single();

    if (txError) throw txError;

    // Check if now below minimum
    const isLowStock = quantityAfter <= item.minimum_quantity;

    return new Response(
      JSON.stringify({
        success: true,
        inventory_transaction: invTx,
        inventory_status: {
          item_name: item.name,
          quantity_before: quantityBefore,
          quantity_after: quantityAfter,
          quantity_change: quantity_change,
          is_low_stock: isLowStock,
          minimum_quantity: item.minimum_quantity,
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