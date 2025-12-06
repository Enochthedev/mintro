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

    const { transaction_ids } = await req.json();

    if (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "transaction_ids array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get uncategorized transactions
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, transaction_id, name, merchant_name, amount, category")
      .eq("user_id", user.id)
      .in("id", transaction_ids)
      .is("category", null);

    if (txError) throw txError;

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No uncategorized transactions to process", categorized: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's categorization rules
    const { data: rules, error: rulesError } = await supabaseClient
      .from("categorization_rules")
      .select(`id, category_id, rule_type, match_value, min_amount, max_amount, priority, confidence_score, expense_categories (id, name)`)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rulesError) console.error("Error fetching rules:", rulesError);

    const categorizations: any[] = [];
    const ruleUpdates: Map<string, number> = new Map();
    const unmatchedTransactions: any[] = [];

    // Process each transaction with rules first
    for (const transaction of transactions) {
      let matchedRule = null;
      let matchedCategory = null;

      if (rules && rules.length > 0) {
        for (const rule of rules) {
          let isMatch = false;
          switch (rule.rule_type) {
            case "vendor_exact":
              isMatch = transaction.merchant_name?.toLowerCase() === rule.match_value.toLowerCase() ||
                        transaction.name?.toLowerCase() === rule.match_value.toLowerCase();
              break;
            case "vendor_contains":
              isMatch = transaction.merchant_name?.toLowerCase().includes(rule.match_value.toLowerCase()) ||
                        transaction.name?.toLowerCase().includes(rule.match_value.toLowerCase());
              break;
            case "description_contains":
              isMatch = transaction.name?.toLowerCase().includes(rule.match_value.toLowerCase());
              break;
            case "amount_range":
              const amount = Math.abs(parseFloat(transaction.amount));
              isMatch = (!rule.min_amount || amount >= parseFloat(rule.min_amount)) &&
                        (!rule.max_amount || amount <= parseFloat(rule.max_amount));
              break;
          }
          if (isMatch) {
            matchedRule = rule;
            matchedCategory = rule.expense_categories;
            break;
          }
        }
      }

      if (matchedRule && matchedCategory) {
        categorizations.push({
          transaction_id: transaction.id,
          category_id: matchedRule.category_id,
          method: "rule",
          rule_id: matchedRule.id,
          confidence: matchedRule.confidence_score || 0.95,
          is_user_override: false,
        });
        const currentCount = ruleUpdates.get(matchedRule.id) || 0;
        ruleUpdates.set(matchedRule.id, currentCount + 1);
      } else {
        unmatchedTransactions.push(transaction);
      }
    }

    // BATCHED AI FALLBACK
    if (unmatchedTransactions.length > 0 && Deno.env.get("OPENAI_API_KEY")) {
      const { data: categories } = await supabaseClient
        .from("expense_categories")
        .select("id, name, description")
        .eq("user_id", user.id);

      if (categories && categories.length > 0) {
        const categoryList = categories.map(c => `${c.name}: ${c.description || 'No description'}`).join("\n");
        const BATCH_SIZE = 10;

        for (let i = 0; i < unmatchedTransactions.length; i += BATCH_SIZE) {
          const batch = unmatchedTransactions.slice(i, i + BATCH_SIZE);
          try {
            const transactionsText = batch.map((t, idx) => `${idx + 1}. "${t.name}" - $${Math.abs(t.amount)}`).join("\n");
            const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: `You categorize business transactions. Available categories:\n${categoryList}\n\nRespond ONLY with a JSON array. Each item must have: index (1-based), category (exact name from list), confidence (0.0-1.0).` },
                  { role: "user", content: `Categorize these transactions:\n${transactionsText}` }
                ],
                temperature: 0.3,
                max_tokens: 1000,
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const content = aiData.choices[0].message.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
              const aiResults = JSON.parse(content);

              for (const result of aiResults) {
                const txIndex = result.index - 1;
                if (txIndex >= 0 && txIndex < batch.length) {
                  const transaction = batch[txIndex];
                  const matchedCategory = categories.find(c => c.name.toLowerCase() === result.category.toLowerCase());
                  if (matchedCategory && result.confidence >= 0.7) {
                    categorizations.push({
                      transaction_id: transaction.id,
                      category_id: matchedCategory.id,
                      method: "ai",
                      rule_id: null,
                      confidence: result.confidence,
                      is_user_override: false,
                    });
                  }
                }
              }
            }
          } catch (aiError) {
            console.error("AI batch categorization error:", aiError);
          }
        }
      }
    }

    // Insert categorizations
    let categorizedCount = 0;
    if (categorizations.length > 0) {
      const { error: categorizationError } = await supabaseClient.from("transaction_categorizations").insert(categorizations);
      if (categorizationError) console.error("Categorization error:", categorizationError);
      else categorizedCount = categorizations.length;

      // Update rule usage counts
      for (const [ruleId, count] of ruleUpdates.entries()) {
        const { data: currentRule } = await supabaseClient.from("categorization_rules").select("times_applied").eq("id", ruleId).single();
        await supabaseClient.from("categorization_rules").update({ times_applied: (currentRule?.times_applied || 0) + count, last_applied_at: new Date().toISOString() }).eq("id", ruleId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully categorized ${categorizedCount} of ${transactions.length} transactions`,
        categorized: categorizedCount,
        skipped: transactions.length - categorizedCount,
        breakdown: {
          rule_matched: categorizations.filter(c => c.method === "rule").length,
          ai_categorized: categorizations.filter(c => c.method === "ai").length,
          needs_review: transactions.length - categorizedCount
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
