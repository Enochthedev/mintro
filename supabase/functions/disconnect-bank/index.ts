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

    const { plaid_item_id } = await req.json();

    if (!plaid_item_id) {
      return new Response(
        JSON.stringify({ error: "plaid_item_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: plaidItem, error: itemError } = await supabaseClient
      .from("plaid_items")
      .select("*")
      .eq("id", plaid_item_id)
      .eq("user_id", user.id)
      .single();

    if (itemError || !plaidItem) {
      return new Response(
        JSON.stringify({ error: "Plaid item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const plaidResponse = await fetch(`${PLAID_BASE_URL}/item/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
          "PLAID-SECRET": PLAID_SECRET,
        },
        body: JSON.stringify({
          access_token: plaidItem.access_token,
        }),
      });

      const plaidData = await plaidResponse.json();

      if (!plaidResponse.ok) {
        console.error("Plaid remove error:", plaidData);
      }
    } catch (plaidError) {
      console.error("Error calling Plaid remove:", plaidError);
    }

    const { error: deleteError } = await supabaseClient
      .from("plaid_items")
      .delete()
      .eq("id", plaid_item_id)
      .eq("user_id", user.id);

    if (deleteError) {
      throw deleteError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Disconnected ${plaidItem.institution_name}`,
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