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

    if (txError) {
      throw txError;
    }

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No uncategorized transactions to process",
          categorized: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's categorization rules
    const { data: rules, error: rulesError } = await supabaseClient
      .from("categorization_rules")
      .select(`
        id,
        category_id,
        rule_type,
        match_value,
        min_amount,
        max_amount,
        priority,
        confidence_score,
        expense_categories (
          id,
          name
        )
      `)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rulesError) {
      console.error("Error fetching rules:", rulesError);
    }

    console.log(`Found ${rules?.length || 0} active categorization rules for user`);

    const categorizations: any[] = [];
    const ruleUpdates: Map<string, number> = new Map();

    console.log(`Processing ${transactions.length} uncategorized transactions...`);

    // Process each transaction
    for (const transaction of transactions) {
      let matchedRule = null;
      let matchedCategory = null;

      // Try to match with rules (ordered by priority)
      if (rules && rules.length > 0) {
        for (const rule of rules) {
          let isMatch = false;

          switch (rule.rule_type) {
            case "vendor_exact":
              isMatch = 
                transaction.merchant_name?.toLowerCase() === rule.match_value.toLowerCase() ||
                transaction.name?.toLowerCase() === rule.match_value.toLowerCase();
              break;

            case "vendor_contains":
              isMatch = 
                transaction.merchant_name?.toLowerCase().includes(rule.match_value.toLowerCase()) ||
                transaction.name?.toLowerCase().includes(rule.match_value.toLowerCase());
              break;

            case "description_contains":
              isMatch = transaction.name?.toLowerCase().includes(rule.match_value.toLowerCase());
              break;

            case "amount_range":
              const amount = Math.abs(parseFloat(transaction.amount));
              isMatch = 
                (!rule.min_amount || amount >= parseFloat(rule.min_amount)) &&
                (!rule.max_amount || amount <= parseFloat(rule.max_amount));
              break;
          }

          if (isMatch) {
            matchedRule = rule;
            matchedCategory = rule.expense_categories;
            console.log(`Matched transaction "${transaction.name}" to rule "${rule.match_value}" -> ${matchedCategory?.name}`);
            break; // Use first matching rule (highest priority)
          }
        }
      } else {
        console.log("No categorization rules found - skipping transaction categorization");
      }

      // If rule matched, create categorization
      if (matchedRule && matchedCategory) {
        categorizations.push({
          transaction_id: transaction.id,
          category_id: matchedRule.category_id,
          method: "rule",
          rule_id: matchedRule.id,
          confidence: matchedRule.confidence_score || 0.95,
          is_user_override: false,
        });

        // Track rule usage for updating times_applied
        const currentCount = ruleUpdates.get(matchedRule.id) || 0;
        ruleUpdates.set(matchedRule.id, currentCount + 1);
      } else if (Deno.env.get("OPENAI_API_KEY")) {
        // AI FALLBACK: If no rule matched, try AI categorization
        try {
          console.log(`No rule matched for "${transaction.name}" - trying AI...`);
          
          // Get all available categories for this user
          const { data: categories } = await supabaseClient
            .from("expense_categories")
            .select("id, name, description")
            .eq("user_id", user.id);

          if (categories && categories.length > 0) {
            const categoryList = categories.map(c => c.name).join(", ");
            
            const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: `You categorize business transactions. Available categories: ${categoryList}. Respond ONLY with valid JSON: {"category": "exact category name", "confidence": 0.0-1.0}`
                  },
                  {
                    role: "user",
                    content: `Transaction: "${transaction.name}", Amount: $${transaction.amount}`
                  }
                ],
                temperature: 0.3,
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const aiResult = JSON.parse(
                aiData.choices[0].message.content
                  .replace(/```json\n?/g, "")
                  .replace(/```\n?/g, "")
                  .trim()
              );

              // Find matching category
              const matchedCategory = categories.find(
                c => c.name.toLowerCase() === aiResult.category.toLowerCase()
              );

              if (matchedCategory && aiResult.confidence >= 0.7) {
                categorizations.push({
                  transaction_id: transaction.id,
                  category_id: matchedCategory.id,
                  method: "ai",
                  rule_id: null,
                  confidence: aiResult.confidence,
                  is_user_override: false,
                });
                console.log(`AI categorized "${transaction.name}" as "${matchedCategory.name}" (confidence: ${aiResult.confidence})`);
              }
            }
          }
        } catch (aiError) {
          console.error("AI categorization error:", aiError);
          // Continue to next transaction
        }
      }
    }

    // Insert categorizations
    let categorizedCount = 0;
    if (categorizations.length > 0) {
      const { error: categorizationError } = await supabaseClient
        .from("transaction_categorizations")
        .insert(categorizations);

      if (categorizationError) {
        console.error("Categorization error:", categorizationError);
      } else {
        categorizedCount = categorizations.length;
      }

      // Update rule usage counts
      for (const [ruleId, count] of ruleUpdates.entries()) {
        await supabaseClient
          .from("categorization_rules")
          .update({
            times_applied: supabaseClient.raw(`times_applied + ${count}`),
            last_applied_at: new Date().toISOString(),
          })
          .eq("id", ruleId);
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