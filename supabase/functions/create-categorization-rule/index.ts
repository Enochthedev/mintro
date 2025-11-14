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
      category_id,
      rule_type,
      match_value,
      min_amount,
      max_amount,
      priority = 0,
      confidence_score = 0.95,
    } = await req.json();

    // Validation
    if (!category_id || !rule_type || !match_value) {
      return new Response(
        JSON.stringify({ error: "category_id, rule_type, and match_value are required" }),
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

    // Verify category belongs to user
    const { data: category, error: categoryError } = await supabaseClient
      .from("expense_categories")
      .select("id")
      .eq("id", category_id)
      .eq("user_id", user.id)
      .single();

    if (categoryError || !category) {
      return new Response(
        JSON.stringify({ error: "Category not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create rule
    const { data: rule, error: insertError } = await supabaseClient
      .from("categorization_rules")
      .insert({
        user_id: user.id,
        category_id,
        rule_type,
        match_value: match_value.toLowerCase(), // Store lowercase for case-insensitive matching
        min_amount,
        max_amount,
        priority,
        confidence_score,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        rule,
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