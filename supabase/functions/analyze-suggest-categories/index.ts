import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Base categories that are always useful
const BASE_CATEGORIES = [
  { name: "Other Expenses", description: "Miscellaneous business expenses", color: "#455A64", icon: "help-circle" },
];

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { auto_create = false, limit = 100 } = body;

    // Get user's transactions
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, name, merchant_name, amount, plaid_category")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(limit);

    if (txError) throw txError;

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No transactions to analyze",
          suggested_categories: BASE_CATEGORIES,
          analysis: { transaction_count: 0 }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Analyze transaction patterns
    const merchantCounts: Map<string, number> = new Map();
    const plaidCategories: Map<string, number> = new Map();
    const amountRanges = { small: 0, medium: 0, large: 0 };

    for (const tx of transactions) {
      // Count merchants
      const merchant = (tx.merchant_name || tx.name || "").toLowerCase();
      if (merchant) {
        merchantCounts.set(merchant, (merchantCounts.get(merchant) || 0) + 1);
      }

      // Count Plaid categories
      if (tx.plaid_category && Array.isArray(tx.plaid_category)) {
        const primaryCat = tx.plaid_category[0];
        if (primaryCat) {
          plaidCategories.set(primaryCat, (plaidCategories.get(primaryCat) || 0) + 1);
        }
      }

      // Analyze amounts
      const amount = Math.abs(parseFloat(tx.amount));
      if (amount < 50) amountRanges.small++;
      else if (amount < 500) amountRanges.medium++;
      else amountRanges.large++;
    }

    // Get top merchants and categories
    const topMerchants = [...merchantCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topPlaidCategories = [...plaidCategories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Use AI to suggest categories based on transaction patterns
    let suggestedCategories: any[] = [];
    
    if (Deno.env.get("OPENAI_API_KEY")) {
      try {
        const analysisPrompt = `Analyze these business transaction patterns and suggest expense categories:

Top Merchants (name: count):
${topMerchants.map(([m, c]) => `- ${m}: ${c} transactions`).join("\n")}

Plaid Categories:
${topPlaidCategories.map(([c, count]) => `- ${c}: ${count}`).join("\n")}

Amount Distribution:
- Small (<$50): ${amountRanges.small} transactions
- Medium ($50-$500): ${amountRanges.medium} transactions  
- Large (>$500): ${amountRanges.large} transactions

Based on this data, suggest 8-15 expense categories that would be most useful for this business.
For each category, provide: name, description, suggested_color (hex), icon (from: package, users, tool, coffee, edit, shield, megaphone, zap, briefcase, map-pin, settings, monitor, fuel, truck, home, shopping-cart, credit-card, dollar-sign, file-text, phone).

Respond ONLY with a JSON array:
[{"name": "Category Name", "description": "Brief description", "color": "#hexcode", "icon": "icon-name"}, ...]`;

        const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a financial categorization expert. Suggest practical expense categories based on transaction patterns. Always respond with valid JSON only." },
              { role: "user", content: analysisPrompt }
            ],
            temperature: 0.5,
            max_tokens: 1500,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices[0].message.content
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim();
          
          suggestedCategories = JSON.parse(content);
        }
      } catch (aiError) {
        console.error("AI suggestion error:", aiError);
      }
    }

    // Fallback to pattern-based suggestions if AI fails
    if (suggestedCategories.length === 0) {
      suggestedCategories = generateFallbackCategories(topMerchants, topPlaidCategories);
    }

    // Ensure "Other Expenses" is always included
    if (!suggestedCategories.find(c => c.name.toLowerCase().includes("other"))) {
      suggestedCategories.push(BASE_CATEGORIES[0]);
    }

    // Check existing categories to avoid duplicates
    const { data: existingCategories } = await supabaseClient
      .from("expense_categories")
      .select("name")
      .eq("user_id", user.id);

    const existingNames = new Set((existingCategories || []).map(c => c.name.toLowerCase()));
    const newCategories = suggestedCategories.filter(c => !existingNames.has(c.name.toLowerCase()));

    // Auto-create if requested
    let createdCategories: any[] = [];
    if (auto_create && newCategories.length > 0) {
      const categoriesToInsert = newCategories.map(cat => ({
        user_id: user.id,
        name: cat.name,
        description: cat.description,
        color: cat.color,
        icon: cat.icon,
        is_system_default: false,
      }));

      const { data: inserted, error: insertError } = await supabaseClient
        .from("expense_categories")
        .insert(categoriesToInsert)
        .select();

      if (!insertError) {
        createdCategories = inserted || [];
      }
    }

    // Generate suggested rules based on top merchants
    const suggestedRules = topMerchants
      .filter(([_, count]) => count >= 2)
      .slice(0, 5)
      .map(([merchant, count]) => ({
        merchant,
        transaction_count: count,
        suggested_rule_type: "vendor_contains",
        suggested_match_value: merchant,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          transaction_count: transactions.length,
          unique_merchants: merchantCounts.size,
          top_merchants: topMerchants.slice(0, 5).map(([m, c]) => ({ merchant: m, count: c })),
          plaid_categories: topPlaidCategories.map(([c, count]) => ({ category: c, count })),
          amount_distribution: amountRanges,
        },
        suggested_categories: suggestedCategories,
        new_categories: newCategories,
        existing_categories_count: existingNames.size,
        created_categories: auto_create ? createdCategories : null,
        suggested_rules: suggestedRules,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateFallbackCategories(
  topMerchants: [string, number][],
  plaidCategories: [string, number][]
): any[] {
  const categories: any[] = [];
  const categoryMap: Record<string, any> = {
    "Food and Drink": { name: "Business Meals", description: "Client dinners and team lunches", color: "#F44336", icon: "coffee" },
    "Travel": { name: "Travel", description: "Flights, hotels, and transportation", color: "#03A9F4", icon: "map-pin" },
    "Shops": { name: "Supplies & Materials", description: "Business supplies and materials", color: "#4CAF50", icon: "shopping-cart" },
    "Service": { name: "Professional Services", description: "Legal, accounting, and consulting", color: "#00BCD4", icon: "briefcase" },
    "Transfer": { name: "Transfers", description: "Bank transfers and payments", color: "#9E9E9E", icon: "credit-card" },
    "Payment": { name: "Payments", description: "Bill payments and subscriptions", color: "#607D8B", icon: "dollar-sign" },
    "Recreation": { name: "Entertainment", description: "Client entertainment and events", color: "#E91E63", icon: "megaphone" },
  };

  // Add categories based on Plaid categories found
  for (const [plaidCat] of plaidCategories) {
    if (categoryMap[plaidCat] && !categories.find(c => c.name === categoryMap[plaidCat].name)) {
      categories.push(categoryMap[plaidCat]);
    }
  }

  // Add common business categories if not enough
  const commonCategories = [
    { name: "Materials", description: "Raw materials and supplies", color: "#4CAF50", icon: "package" },
    { name: "Labor", description: "Wages and contractor fees", color: "#2196F3", icon: "users" },
    { name: "Equipment", description: "Tools and equipment", color: "#FF9800", icon: "tool" },
    { name: "Software", description: "SaaS and software licenses", color: "#607D8B", icon: "monitor" },
    { name: "Utilities", description: "Electricity, internet, phone", color: "#009688", icon: "zap" },
  ];

  for (const cat of commonCategories) {
    if (categories.length < 10 && !categories.find(c => c.name === cat.name)) {
      categories.push(cat);
    }
  }

  return categories;
}
