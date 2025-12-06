import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const { rule_type, match_value, min_amount, max_amount, limit = 20 } = await req.json();

    // Validation
    if (!rule_type || !match_value) {
      return new Response(
        JSON.stringify({ error: "rule_type and match_value are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validRuleTypes = ['vendor_exact', 'vendor_contains', 'description_contains', 'amount_range'];
    if (!validRuleTypes.includes(rule_type)) {
      return new Response(
        JSON.stringify({ error: `rule_type must be one of: ${validRuleTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's transactions
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, name, merchant_name, amount, date")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(500); // Check against recent 500 transactions

    if (txError) {
      throw txError;
    }

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          matches: [],
          match_count: 0,
          message: "No transactions to test against"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const matchedTransactions: any[] = [];
    const matchValueLower = match_value.toLowerCase();

    for (const tx of transactions) {
      let isMatch = false;
      const vendorName = (tx.merchant_name || tx.name || "").toLowerCase();
      const amount = Math.abs(parseFloat(tx.amount));

      switch (rule_type) {
        case "vendor_exact":
          isMatch = vendorName === matchValueLower || 
                    tx.name?.toLowerCase() === matchValueLower;
          break;

        case "vendor_contains":
          isMatch = vendorName.includes(matchValueLower) || 
                    tx.name?.toLowerCase().includes(matchValueLower);
          break;

        case "description_contains":
          isMatch = tx.name?.toLowerCase().includes(matchValueLower);
          break;

        case "amount_range":
          isMatch = (!min_amount || amount >= parseFloat(min_amount)) &&
                    (!max_amount || amount <= parseFloat(max_amount));
          break;
      }

      if (isMatch) {
        matchedTransactions.push({
          id: tx.id,
          name: tx.name,
          merchant_name: tx.merchant_name,
          amount: tx.amount,
          date: tx.date,
        });
      }
    }

    // Return limited results
    const limitedMatches = matchedTransactions.slice(0, limit);

    return new Response(
      JSON.stringify({
        success: true,
        rule_preview: {
          rule_type,
          match_value,
          min_amount,
          max_amount,
        },
        matches: limitedMatches,
        match_count: matchedTransactions.length,
        showing: limitedMatches.length,
        transactions_checked: transactions.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
