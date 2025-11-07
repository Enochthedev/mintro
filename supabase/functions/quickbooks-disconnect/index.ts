import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUICKBOOKS_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID")!;
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get("QUICKBOOKS_CLIENT_SECRET")!;
const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";

const QUICKBOOKS_REVOKE_URL =
  QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
    : "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

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

    const { quickbooks_connection_id } = await req.json();

    if (!quickbooks_connection_id) {
      return new Response(
        JSON.stringify({ error: "quickbooks_connection_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: connection, error: connectionError } = await supabaseClient
      .from("quickbooks_connections")
      .select("*")
      .eq("id", quickbooks_connection_id)
      .eq("user_id", user.id)
      .single();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: "QuickBooks connection not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Revoke token with QuickBooks
    try {
      const basicAuth = btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`);

      await fetch(QUICKBOOKS_REVOKE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: connection.refresh_token,
        }),
      });
    } catch (revokeError) {
      console.error("Error revoking token:", revokeError);
      // Continue anyway
    }

    // Delete from database
    const { error: deleteError } = await supabaseClient
      .from("quickbooks_connections")
      .delete()
      .eq("id", quickbooks_connection_id)
      .eq("user_id", user.id);

    if (deleteError) {
      throw deleteError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Disconnected ${connection.company_name}`,
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