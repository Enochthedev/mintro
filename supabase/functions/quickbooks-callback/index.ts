import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUICKBOOKS_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID")!;
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get("QUICKBOOKS_CLIENT_SECRET")!;
const QUICKBOOKS_REDIRECT_URI = Deno.env.get("QUICKBOOKS_REDIRECT_URI")!;
const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";

const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const QUICKBOOKS_API_BASE_URL =
  QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get query parameters (works for both GET and POST)
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    const error = url.searchParams.get("error");

    console.log("Callback received:", {
      method: req.method,
      code: code ? "present" : "missing",
      state: state ? "present" : "missing",
      realmId,
      error
    });

    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";

    if (error) {
      console.error("QuickBooks authorization failed:", error);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=${encodeURIComponent(error)}`,
        },
      });
    }

    if (!code || !realmId || !state) {
      console.error("Missing required parameters:", { code: !!code, realmId, state: !!state });
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=missing_params`,
        },
      });
    }

    // Decode state to get user_id
    let userId: string;
    try {
      const stateData = JSON.parse(atob(state));
      userId = stateData.user_id;
      console.log("Decoded user_id from state:", userId);
    } catch (e) {
      console.error("Failed to decode state:", e);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=invalid_state`,
        },
      });
    }

    // Exchange code for tokens
    const basicAuth = btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`);

    console.log("Exchanging code for tokens...");
    const tokenResponse = await fetch(QUICKBOOKS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: QUICKBOOKS_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("QuickBooks token exchange failed:", tokenData);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=token_exchange_failed`,
        },
      });
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    console.log("Token exchange successful, expires_in:", expires_in);

    // Get company info
    console.log("Fetching company info...");
    const companyResponse = await fetch(
      `${QUICKBOOKS_API_BASE_URL}/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        headers: {
          "Authorization": `Bearer ${access_token}`,
          "Accept": "application/json",
        },
      }
    );

    const companyData = await companyResponse.json();
    const companyInfo = companyData.CompanyInfo || {};
    console.log("Company name:", companyInfo.CompanyName);

    // Use service role key to save to database
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    console.log("Saving connection to database...");
    const { data: connection, error: insertError } = await supabaseClient
      .from("quickbooks_connections")
      .upsert({
        user_id: userId,
        realm_id: realmId,
        access_token, // TODO: Encrypt in production
        refresh_token, // TODO: Encrypt in production
        token_expires_at: expiresAt.toISOString(),
        company_name: companyInfo.CompanyName || "Unknown",
        country: companyInfo.Country || "US",
        status: "active",
      }, {
        onConflict: "user_id,realm_id",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Database insert error:", insertError);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=database_error`,
        },
      });
    }

    console.log("Connection saved successfully:", connection.id);

    // Redirect to success page
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `${frontendUrl}/quickbooks?status=success&company=${encodeURIComponent(companyInfo.CompanyName || "Unknown")}`,
      },
    });

  } catch (error) {
    console.error("Callback error:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `${frontendUrl}/quickbooks?status=error&message=${encodeURIComponent(error.message)}`,
      },
    });
  }
});