import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUICKBOOKS_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID")!;
const QUICKBOOKS_REDIRECT_URI = Deno.env.get("QUICKBOOKS_REDIRECT_URI")!;
const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";

const QUICKBOOKS_AUTH_BASE_URL =
  QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://appcenter.intuit.com/connect/oauth2"
    : "https://appcenter.intuit.com/connect/oauth2";

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

    // Generate state parameter (for security)
    const state = btoa(JSON.stringify({ user_id: user.id, timestamp: Date.now() }));

    // QuickBooks OAuth scopes
    const scopes = [
      "com.intuit.quickbooks.accounting",
      "openid",
      "email",
      "profile",
    ].join(" ");

    // Build authorization URL
    const authUrl = new URL(QUICKBOOKS_AUTH_BASE_URL);
    authUrl.searchParams.set("client_id", QUICKBOOKS_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", QUICKBOOKS_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);

    return new Response(
      JSON.stringify({
        success: true,
        auth_url: authUrl.toString(),
        state,
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