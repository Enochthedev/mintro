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

    // Get active rules (ordered by priority)
    const { data: rules, error: rulesError } = await supabaseClient
      .from("categorization_rules")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rulesError) {
      throw rulesError;
    }

    if (!rules || rules.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No active rules found",
          categorized: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // FIXED: Get already categorized transaction IDs
    const { data: categorizedTransactions, error: catError } = await supabaseClient
      .from("transaction_categorizations")
      .select("transaction_id");

    if (catError) {
      throw catError;
    }

    const categorizedIds = categorizedTransactions?.map(c => c.transaction_id) || [];

    // FIXED: Get uncategorized transactions using filter
    let query = supabaseClient
      .from("transactions")
      .select("id, name, merchant_name, amount")
      .eq("user_id", user.id)
      .limit(100);

    // Only exclude if there are categorized transactions
    if (categorizedIds.length > 0) {
      // Use filter with not.in for array of IDs
      query = query.filter('id', 'not.in', `(${categorizedIds.join(',')})`);
    }

    const { data: transactions, error: txError } = await query;

    if (txError) {
      throw txError;
    }

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No uncategorized transactions found",
          categorized: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let categorizedCount = 0;

    // Apply rules to each transaction
    for (const tx of transactions) {
      const vendorName = (tx.merchant_name || tx.name || "").toLowerCase();
      const amount = parseFloat(tx.amount);

      // Try to match with rules (highest priority first)
      for (const rule of rules) {
        let matched = false;

        switch (rule.rule_type) {
          case 'vendor_exact':
            matched = vendorName === rule.match_value.toLowerCase();
            break;
          
          case 'vendor_contains':
            matched = vendorName.includes(rule.match_value.toLowerCase());
            break;
          
          case 'description_contains':
            matched = vendorName.includes(rule.match_value.toLowerCase());
            break;
          
          case 'amount_range':
            if (rule.min_amount !== null && rule.max_amount !== null) {
              matched = amount >= rule.min_amount && amount <= rule.max_amount;
            }
            break;
        }

        if (matched) {
          // Categorize this transaction
          const { error: insertError } = await supabaseClient
            .from("transaction_categorizations")
            .insert({
              transaction_id: tx.id,
              category_id: rule.category_id,
              method: "rule",
              rule_id: rule.id,
              confidence: rule.confidence_score,
            });

          if (!insertError) {
            categorizedCount++;

            // Update rule stats
            await supabaseClient
              .from("categorization_rules")
              .update({
                times_applied: rule.times_applied + 1,
                last_applied_at: new Date().toISOString(),
              })
              .eq("id", rule.id);

            break; // Stop checking other rules for this transaction
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        categorized: categorizedCount,
        total_processed: transactions.length,
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