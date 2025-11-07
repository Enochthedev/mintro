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

    const { data: connections, error: connectionsError } = await supabaseClient
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id);

    if (connectionsError) {
      throw connectionsError;
    }

    const formattedConnections = connections?.map(conn => {
      const tokenExpired = new Date(conn.token_expires_at) < new Date();
      
      return {
        id: conn.id,
        company_name: conn.company_name,
        realm_id: conn.realm_id,
        status: tokenExpired ? "expired" : conn.status,
        last_sync: conn.last_sync,
        created_at: conn.created_at,
        needs_reauth: tokenExpired,
      };
    }) || [];

    return new Response(
      JSON.stringify({
        success: true,
        connections: formattedConnections,
        total_connections: formattedConnections.length,
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