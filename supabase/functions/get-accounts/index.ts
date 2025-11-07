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

    const { data: accounts, error: accountsError } = await supabaseClient
      .from("bank_accounts")
      .select(`
        *,
        plaid_items!inner (
          id,
          institution_name,
          institution_id,
          status,
          last_successful_sync
        )
      `)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (accountsError) {
      throw accountsError;
    }

    const institutionMap = new Map();

    for (const account of accounts || []) {
      const institutionName = account.plaid_items.institution_name;
      
      if (!institutionMap.has(institutionName)) {
        institutionMap.set(institutionName, {
          institution_name: institutionName,
          institution_id: account.plaid_items.institution_id,
          plaid_item_id: account.plaid_items.id,
          status: account.plaid_items.status,
          last_sync: account.plaid_items.last_successful_sync,
          accounts: [],
        });
      }

      institutionMap.get(institutionName).accounts.push({
        id: account.id,
        account_id: account.account_id,
        name: account.name,
        official_name: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        current_balance: account.current_balance,
        available_balance: account.available_balance,
        currency_code: account.currency_code,
      });
    }

    const institutions = Array.from(institutionMap.values());

    const totalBalance = accounts?.reduce(
      (sum, acc) => sum + (parseFloat(acc.current_balance) || 0),
      0
    ) || 0;

    return new Response(
      JSON.stringify({
        success: true,
        total_institutions: plaidItems?.length || 0,
        total_accounts: accounts?.length || 0,
        total_balance: totalBalance.toFixed(2),
        institutions,
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