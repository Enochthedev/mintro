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

    const accountsResponse = await fetch(`${PLAID_BASE_URL}/accounts/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
        "PLAID-SECRET": PLAID_SECRET,
      },
      body: JSON.stringify({ access_token: plaidItem.access_token }),
    });

    const accountsData = await accountsResponse.json();

    if (!accountsResponse.ok) {
      console.error("Plaid accounts error:", accountsData);
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts", details: accountsData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingAccounts } = await supabaseClient
      .from("bank_accounts")
      .select("account_id")
      .eq("plaid_item_id", plaid_item_id);

    const existingAccountIds = new Set(
      existingAccounts?.map(acc => acc.account_id) || []
    );

    const newAccounts = accountsData.accounts.filter(
      (acc: any) => !existingAccountIds.has(acc.account_id)
    );

    let accountsAdded = 0;

    if (newAccounts.length > 0) {
      const accountsToInsert = newAccounts.map((account: any) => ({
        plaid_item_id: plaidItem.id,
        user_id: user.id,
        account_id: account.account_id,
        name: account.name,
        official_name: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        current_balance: account.balances.current,
        available_balance: account.balances.available,
        currency_code: account.balances.iso_currency_code || "USD",
        is_active: true,
      }));

      const { error: insertError } = await supabaseClient
        .from("bank_accounts")
        .insert(accountsToInsert);

      if (insertError) {
        console.error("Error inserting accounts:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save accounts", details: insertError }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      accountsAdded = accountsToInsert.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        institution_name: plaidItem.institution_name,
        total_accounts: accountsData.accounts.length,
        accounts_added: accountsAdded,
        accounts_already_existed: existingAccounts?.length || 0,
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