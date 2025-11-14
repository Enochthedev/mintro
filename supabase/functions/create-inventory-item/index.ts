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
      sku,
      category,
      unit_cost,
      current_quantity = 0,
      minimum_quantity = 0,
      supplier_name,
      supplier_contact,
    } = await req.json();

    if (!name || unit_cost === undefined) {
      return new Response(
        JSON.stringify({ error: "name and unit_cost are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create inventory item
    const { data: item, error: insertError } = await supabaseClient
      .from("inventory_items")
      .insert({
        user_id: user.id,
        name,
        description,
        sku,
        category,
        unit_cost,
        current_quantity,
        minimum_quantity,
        supplier_name,
        supplier_contact,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // If initial quantity > 0, create inventory transaction
    if (current_quantity > 0) {
      await supabaseClient
        .from("inventory_transactions")
        .insert({
          user_id: user.id,
          inventory_item_id: item.id,
          transaction_type: "purchase",
          quantity_change: current_quantity,
          unit_cost,
          reference_type: "manual",
          notes: "Initial inventory",
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        item,
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