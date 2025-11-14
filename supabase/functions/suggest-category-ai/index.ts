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

    const { 
      transaction_id, 
      merchant_name, 
      description, 
      amount,
      batch_mode = false,
      transactions = [] // For batch processing
    } = await req.json();

    // Get user's categories
    const { data: categories, error: categoriesError } = await supabaseClient
      .from("expense_categories")
      .select("id, name, description")
      .eq("user_id", user.id);

    if (categoriesError) {
      throw categoriesError;
    }

    if (!categories || categories.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No categories found. Please setup categories first." 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare the prompt
    const categoriesText = categories
      .map(c => `- ${c.name}: ${c.description || 'No description'}`)
      .join('\n');

    let prompt = '';
    
    if (batch_mode && transactions.length > 0) {
      // Batch processing
      const transactionsText = transactions
        .map((t: any, i: number) => `${i + 1}. Merchant: "${t.merchant_name}", Amount: $${t.amount}`)
        .join('\n');

      prompt = `You are a financial categorization assistant. Categorize these transactions:

${transactionsText}

Available categories:
${categoriesText}

Return a JSON array with ONE category per transaction. Format:
[
  {"transaction_index": 1, "category_id": "uuid", "category_name": "name", "confidence": 0.95, "reason": "brief reason"},
  {"transaction_index": 2, "category_id": "uuid", "category_name": "name", "confidence": 0.90, "reason": "brief reason"}
]`;
    } else {
      // Single transaction
      prompt = `You are a financial categorization assistant. Given this transaction:
- Merchant: "${merchant_name}"
- Description: "${description || merchant_name}"
- Amount: $${amount}

Available categories:
${categoriesText}

Return the top 3 most likely categories with confidence scores (0.0-1.0).
Respond ONLY with valid JSON in this exact format:
{
  "suggestions": [
    {"category_id": "actual-uuid-from-list", "category_name": "name", "confidence": 0.95, "reason": "why this matches"},
    {"category_id": "actual-uuid-from-list", "category_name": "name", "confidence": 0.75, "reason": "alternative match"},
    {"category_id": "actual-uuid-from-list", "category_name": "name", "confidence": 0.50, "reason": "possible match"}
  ]
}`;
    }

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Cost-effective model
        messages: [
          {
            role: "system",
            content: "You are a financial categorization expert. Always respond with valid JSON only, no markdown or explanations."
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent results
        max_tokens: 500,
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.json();
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const aiResult = await openaiResponse.json();
    const content = aiResult.choices[0].message.content;

    // Parse JSON response (handle potential markdown wrapping)
    let parsedContent;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedContent = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("AI returned invalid JSON");
    }

    // Validate and match category IDs
    if (batch_mode) {
      const validatedSuggestions = parsedContent.map((suggestion: any) => {
        const category = categories.find(c => 
          c.name.toLowerCase() === suggestion.category_name.toLowerCase()
        );
        return {
          ...suggestion,
          category_id: category?.id || suggestion.category_id,
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          batch: true,
          suggestions: validatedSuggestions,
          total: validatedSuggestions.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      // Validate category IDs for single transaction
      const validatedSuggestions = parsedContent.suggestions.map((suggestion: any) => {
        const category = categories.find(c => 
          c.name.toLowerCase() === suggestion.category_name.toLowerCase()
        );
        return {
          ...suggestion,
          category_id: category?.id || suggestion.category_id,
          category_valid: !!category,
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          transaction_id,
          suggestions: validatedSuggestions,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});