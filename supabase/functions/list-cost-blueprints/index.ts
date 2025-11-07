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
    const activeOnly = url.searchParams.get("active_only") === "true";
    const blueprintType = url.searchParams.get("type");

    let query = supabaseClient
      .from("cost_blueprints")
      .select(`
        *,
        blueprint_inventory_items (
          *,
          inventory_items (*)
        )
      `)
      .eq("user_id", user.id)
      .order("name");

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    if (blueprintType) {
      query = query.eq("blueprint_type", blueprintType);
    }

    const { data: blueprints, error: blueprintsError } = await query;

    if (blueprintsError) {
      throw blueprintsError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        blueprints: blueprints || [],
        total_blueprints: blueprints?.length || 0,
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