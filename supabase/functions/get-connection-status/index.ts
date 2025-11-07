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

    const { data: plaidItems, error: itemsError } = await supabaseClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (itemsError) {
      throw itemsError;
    }

    const connections = plaidItems?.map(item => {
      let statusMessage = "";
      let needsAction = false;

      switch (item.status) {
        case "active":
          statusMessage = "Connected and syncing";
          needsAction = false;
          break;
        case "requires_update":
          statusMessage = "Requires re-authentication";
          needsAction = true;
          break;
        case "error":
          statusMessage = item.error_message || "Connection error";
          needsAction = true;
          break;
        default:
          statusMessage = "Unknown status";
      }

      const lastSync = item.last_successful_sync 
        ? new Date(item.last_successful_sync)
        : null;
      const hoursSinceSync = lastSync
        ? (Date.now() - lastSync.getTime()) / (1000 * 60 * 60)
        : null;

      if (hoursSinceSync && hoursSinceSync > 24 && item.status === "active") {
        statusMessage = "Sync may be delayed";
      }

      return {
        id: item.id,
        institution_name: item.institution_name,
        institution_id: item.institution_id,
        status: item.status,
        status_message: statusMessage,
        needs_action: needsAction,
        error_code: item.error_code,
        last_successful_sync: item.last_successful_sync,
        hours_since_sync: hoursSinceSync ? Math.round(hoursSinceSync) : null,
        created_at: item.created_at,
      };
    }) || [];

    const needsAttention = connections.filter(c => c.needs_action);

    return new Response(
      JSON.stringify({
        success: true,
        total_connections: connections.length,
        connections_needing_attention: needsAttention.length,
        connections,
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