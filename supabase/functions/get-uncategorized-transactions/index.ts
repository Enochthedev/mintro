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
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Get all categorized transaction IDs
    const { data: categorizedIds, error: catError } = await supabaseClient
      .from("transaction_categorizations")
      .select("transaction_id");

    if (catError) {
      throw catError;
    }

    const categorizedTransactionIds = categorizedIds?.map(c => c.transaction_id) || [];

    // Get uncategorized transactions
    let query = supabaseClient
      .from("transactions")
      .select(`
        *,
        bank_accounts!inner (
          id,
          name,
          mask,
          type,
          plaid_items!inner (
            institution_name
          )
        )
      `, { count: "exact" })
      .eq("user_id", user.id);

    // Exclude already categorized transactions
    if (categorizedTransactionIds.length > 0) {
      query = query.not("id", "in", `(${categorizedTransactionIds.join(",")})`);
    }

    query = query
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: transactions, error: txError, count } = await query;

    if (txError) {
      throw txError;
    }

    const formattedTransactions = transactions?.map(tx => ({
      id: tx.id,
      transaction_id: tx.transaction_id,
      date: tx.date,
      amount: tx.amount,
      name: tx.name,
      merchant_name: tx.merchant_name,
      pending: tx.pending,
      account: {
        id: tx.bank_accounts.id,
        name: tx.bank_accounts.name,
        mask: tx.bank_accounts.mask,
        type: tx.bank_accounts.type,
        institution: tx.bank_accounts.plaid_items.institution_name,
      },
    })) || [];

    return new Response(
      JSON.stringify({
        success: true,
        transactions: formattedTransactions,
        pagination: {
          total: count,
          limit,
          offset,
          has_more: count ? offset + limit < count : false,
        },
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