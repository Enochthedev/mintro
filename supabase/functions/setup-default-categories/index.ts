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

    // Check if user already has categories
    const { data: existingCategories, error: checkError } = await supabaseClient
      .from("expense_categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    if (checkError) {
      throw checkError;
    }

    if (existingCategories && existingCategories.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Categories already exist",
          setup_needed: false,
          categories: existingCategories, // FIXED: Now returns categories
          categories_count: existingCategories.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call the database function to create default categories
    const { error: setupError } = await supabaseClient.rpc(
      "create_default_expense_categories",
      { p_user_id: user.id }
    );

    if (setupError) {
      throw setupError;
    }

    // Get the created categories
    const { data: categories, error: fetchError } = await supabaseClient
      .from("expense_categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    if (fetchError) {
      throw fetchError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Default categories created",
        categories_count: categories?.length || 0,
        categories,
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