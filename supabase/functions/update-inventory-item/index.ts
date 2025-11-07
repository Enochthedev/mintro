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
      name,
      description,
      sku,
      category,
      unit_cost,
      minimum_quantity,
      supplier_name,
      supplier_contact,
    } = await req.json();

    if (!inventory_item_id) {
      return new Response(
        JSON.stringify({ error: "inventory_item_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object (only include provided fields)
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (sku !== undefined) updates.sku = sku;
    if (category !== undefined) updates.category = category;
    if (unit_cost !== undefined) updates.unit_cost = unit_cost;
    if (minimum_quantity !== undefined) updates.minimum_quantity = minimum_quantity;
    if (supplier_name !== undefined) updates.supplier_name = supplier_name;
    if (supplier_contact !== undefined) updates.supplier_contact = supplier_contact;

    // Update inventory item
    const { data: updated, error: updateError } = await supabaseClient
      .from("inventory_items")
      .update(updates)
      .eq("id", inventory_item_id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Inventory item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Inventory item updated",
        item: updated,
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