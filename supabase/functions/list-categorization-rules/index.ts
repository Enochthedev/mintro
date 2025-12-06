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

    // Parse query params for pagination and filtering
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const category_id = url.searchParams.get("category_id");
    const rule_type = url.searchParams.get("rule_type");
    const is_active = url.searchParams.get("is_active");

    let query = supabaseClient
      .from("categorization_rules")
      .select(`
        *,
        expense_categories!inner (
          id,
          name,
          color,
          icon
        )
      `, { count: "exact" })
      .eq("user_id", user.id);

    // Apply filters
    if (category_id) {
      query = query.eq("category_id", category_id);
    }
    if (rule_type) {
      query = query.eq("rule_type", rule_type);
    }
    if (is_active !== null && is_active !== undefined) {
      query = query.eq("is_active", is_active === "true");
    }

    // Apply ordering and pagination
    query = query
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: rules, error: rulesError, count } = await query;

    if (rulesError) {
      throw rulesError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        rules: rules || [],
        pagination: {
          total: count || 0,
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