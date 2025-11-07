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

    // Get all active inventory items
    const { data: items, error: itemsError } = await supabaseClient
      .from("inventory_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("name");

    if (itemsError) throw itemsError;

    // Categorize alerts
    const outOfStock: any[] = [];
    const lowStock: any[] = [];
    const nearLowStock: any[] = [];

    for (const item of items || []) {
      const current = item.current_quantity || 0;
      const minimum = item.minimum_quantity || 0;

      if (current <= 0) {
        outOfStock.push({
          ...item,
          status: "out_of_stock",
          alert_level: "critical",
        });
      } else if (current <= minimum) {
        lowStock.push({
          ...item,
          status: "low_stock",
          alert_level: "warning",
          units_below_minimum: minimum - current,
        });
      } else if (minimum > 0 && current <= minimum * 1.5) {
        nearLowStock.push({
          ...item,
          status: "near_low_stock",
          alert_level: "info",
          units_above_minimum: current - minimum,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alerts: {
          out_of_stock: outOfStock,
          low_stock: lowStock,
          near_low_stock: nearLowStock,
        },
        summary: {
          total_alerts: outOfStock.length + lowStock.length + nearLowStock.length,
          critical: outOfStock.length,
          warnings: lowStock.length,
          info: nearLowStock.length,
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