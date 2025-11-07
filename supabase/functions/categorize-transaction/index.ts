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

    const { transaction_id, category_id, create_rule = false } = await req.json();

    if (!transaction_id || !category_id) {
      return new Response(
        JSON.stringify({ error: "transaction_id and category_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify transaction belongs to user
    const { data: transaction, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, name, merchant_name")
      .eq("id", transaction_id)
      .eq("user_id", user.id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify category belongs to user
    const { data: category, error: catError } = await supabaseClient
      .from("expense_categories")
      .select("id, name")
      .eq("id", category_id)
      .eq("user_id", user.id)
      .single();

    if (catError || !category) {
      return new Response(
        JSON.stringify({ error: "Category not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if transaction already categorized
    const { data: existing, error: existingError } = await supabaseClient
      .from("transaction_categorizations")
      .select("id, category_id")
      .eq("transaction_id", transaction_id)
      .single();

    let result;
    const previousCategoryId = existing?.category_id || null;

    if (existing) {
      // Update existing categorization
      const { data, error: updateError } = await supabaseClient
        .from("transaction_categorizations")
        .update({
          category_id,
          method: "manual",
          is_user_override: true,
          previous_category_id: previousCategoryId,
          confidence: 1.0,
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (updateError) throw updateError;
      result = data;
    } else {
      // Create new categorization
      const { data, error: insertError } = await supabaseClient
        .from("transaction_categorizations")
        .insert({
          transaction_id,
          category_id,
          method: "manual",
          is_user_override: true,
          confidence: 1.0,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      result = data;
    }

    // Optionally create a rule based on this categorization
    let newRule = null;
    if (create_rule && transaction.merchant_name) {
      const { data: ruleData, error: ruleError } = await supabaseClient
        .from("categorization_rules")
        .insert({
          user_id: user.id,
          category_id,
          rule_type: "vendor_contains",
          match_value: transaction.merchant_name.toLowerCase(),
          priority: 0,
          confidence_score: 0.9,
          is_active: true,
        })
        .select()
        .single();

      if (!ruleError) {
        newRule = ruleData;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        categorization: result,
        rule_created: !!newRule,
        rule: newRule,
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