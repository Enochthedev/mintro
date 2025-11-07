import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";

const PLAID_BASE_URL =
  PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : PLAID_ENV === "development"
    ? "https://development.plaid.com"
    : "https://sandbox.plaid.com";

const LINK_TOKEN_EXPIRY = 4 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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

    const body = await req.json().catch(() => ({}));
    const { plaid_item_id, force_new = false } = body;

    if (!force_new && !plaid_item_id) {
      const { data: cachedToken } = await supabaseClient
        .from("link_tokens")
        .select("token, created_at")
        .eq("user_id", user.id)
        .is("plaid_item_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (cachedToken) {
        const tokenAge = Date.now() - new Date(cachedToken.created_at).getTime();
        
        if (tokenAge < LINK_TOKEN_EXPIRY - 30 * 60 * 1000) {
          console.log("Reusing existing link token for user:", user.id);
          return new Response(
            JSON.stringify({ 
              link_token: cachedToken.token,
              cached: true 
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    const { data: recentRequests } = await supabaseClient
      .from("link_tokens")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 60000).toISOString())
      .order("created_at", { ascending: false });

    if (recentRequests && recentRequests.length >= 5) {
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded. Please wait a moment before trying again." 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": "60" 
          } 
        }
      );
    }

    // ✅ ADD: Webhook URL
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-webhook`;

    let linkTokenRequest: any = {
      user: {
        client_user_id: user.id,
      },
      client_name: "Mintro",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      webhook: webhookUrl, // ✅ ADD THIS LINE
    };

    if (plaid_item_id) {
      const { data: plaidItem } = await supabaseClient
        .from("plaid_items")
        .select("access_token")
        .eq("id", plaid_item_id)
        .eq("user_id", user.id)
        .single();

      if (!plaidItem) {
        return new Response(
          JSON.stringify({ error: "Plaid item not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      linkTokenRequest.access_token = plaidItem.access_token;
      delete linkTokenRequest.products;
      
      console.log("Creating link token in UPDATE mode for item:", plaid_item_id);
    } else {
      console.log("Creating link token in CONNECT mode for user:", user.id);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let plaidResponse;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        plaidResponse = await fetch(`${PLAID_BASE_URL}/link/token/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
            "PLAID-SECRET": PLAID_SECRET,
          },
          body: JSON.stringify(linkTokenRequest),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        break;
      } catch (error) {
        attempts++;
        console.error(`Plaid request attempt ${attempts} failed:`, error);
        
        if (attempts >= maxAttempts) {
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const data = await plaidResponse!.json();

    if (!plaidResponse!.ok) {
      console.error("Plaid error:", data);
      
      if (data.error_code === "INVALID_ACCESS_TOKEN") {
        return new Response(
          JSON.stringify({ 
            error: "Invalid access token. Please reconnect your account.",
            error_code: "INVALID_ACCESS_TOKEN"
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          error: "Failed to create link token", 
          details: data.error_message || data 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: cacheError } = await supabaseClient
      .from("link_tokens")
      .insert({
        user_id: user.id,
        token: data.link_token,
        plaid_item_id: plaid_item_id || null,
        created_at: new Date().toISOString(),
      });

    if (cacheError) {
      console.error("Failed to cache link token:", cacheError);
    }

    return new Response(
      JSON.stringify({ 
        link_token: data.link_token,
        cached: false,
        expiration: data.expiration,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    
    if (error.name === "AbortError") {
      return new Response(
        JSON.stringify({ 
          error: "Request timeout. Please try again.",
          error_code: "TIMEOUT"
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});