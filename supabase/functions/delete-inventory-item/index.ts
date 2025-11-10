import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
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

    const { inventory_item_id, permanent = false } = await req.json();

    if (!inventory_item_id) {
      return new Response(
        JSON.stringify({ error: "inventory_item_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get inventory item
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

    // Check if item is used in any active blueprints
    const { data: blueprintUsage, error: blueprintError } = await supabaseClient
      .from("blueprint_inventory_items")
      .select(`
        blueprint_id,
        cost_blueprints!inner(name, is_active)
      `)
      .eq("inventory_item_id", inventory_item_id);

    if (blueprintError) {
      console.error("Blueprint check error:", blueprintError);
    }

    const activeBlueprints = blueprintUsage?.filter(
      (bp: any) => bp.cost_blueprints?.is_active
    );

    if (activeBlueprints && activeBlueprints.length > 0 && !permanent) {
      return new Response(
        JSON.stringify({
          error: "Cannot delete item used in active blueprints",
          active_blueprints: activeBlueprints.map((bp: any) => bp.cost_blueprints?.name),
          suggestion: "Deactivate the blueprints first or set permanent=true to force delete",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (permanent) {
      // Hard delete - removes from database
      // This will cascade delete related records (transactions, blueprint links)
      const { error: deleteError } = await supabaseClient
        .from("inventory_items")
        .delete()
        .eq("id", inventory_item_id);

      if (deleteError) {
        throw deleteError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Inventory item permanently deleted",
          item_name: item.name,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      // Soft delete - mark as inactive
      const { data: updated, error: updateError } = await supabaseClient
        .from("inventory_items")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inventory_item_id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Inventory item deactivated",
          item: updated,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});