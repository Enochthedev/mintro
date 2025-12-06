import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_CATEGORIES = [
  { name: "Materials", description: "Raw materials and building supplies", color: "#4CAF50", icon: "package" },
  { name: "Labor", description: "Wages, contractor fees, and labor costs", color: "#2196F3", icon: "users" },
  { name: "Equipment", description: "Tools, machinery, and equipment rentals", color: "#FF9800", icon: "tool" },
  { name: "Business Meals", description: "Client dinners and team lunches", color: "#F44336", icon: "coffee" },
  { name: "Office Supplies", description: "Stationery, printing, and office essentials", color: "#9C27B0", icon: "edit" },
  { name: "Insurance", description: "Business liability and property insurance", color: "#3F51B5", icon: "shield" },
  { name: "Marketing", description: "Advertising, website, and promotion", color: "#E91E63", icon: "megaphone" },
  { name: "Utilities", description: "Electricity, water, internet, and phone", color: "#009688", icon: "zap" },
  { name: "Professional Services", description: "Legal, accounting, and consulting fees", color: "#00BCD4", icon: "briefcase" },
  { name: "Travel", description: "Flights, hotels, and transportation", color: "#03A9F4", icon: "map-pin" },
  { name: "Maintenance", description: "Repairs and recurring maintenance", color: "#795548", icon: "settings" },
  { name: "Software", description: "SaaS subscriptions and software licenses", color: "#607D8B", icon: "monitor" },
  { name: "Fuel & Gas", description: "Vehicle fuel and gas expenses", color: "#FF5722", icon: "fuel" },
  { name: "Vehicle Expenses", description: "Vehicle maintenance, repairs, and registration", color: "#8BC34A", icon: "truck" },
  { name: "Rent & Lease", description: "Office or workspace rent and lease payments", color: "#673AB7", icon: "home" },
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

    // Parse request body for options
    let body: { force?: boolean; add_missing?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body provided, use defaults
    }
    const { force = false, add_missing = false } = body;

    // Check existing categories
    const { data: existingCategories, error: checkError } = await supabaseClient
      .from("expense_categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    if (checkError) {
      throw checkError;
    }

    const existingNames = new Set((existingCategories || []).map(c => c.name.toLowerCase()));
    const hasCategories = existingCategories && existingCategories.length > 0;

    // If user has categories and not forcing/adding missing, return existing
    if (hasCategories && !force && !add_missing) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Categories already exist. Use force=true to reset or add_missing=true to add new defaults.",
          setup_needed: false,
          categories: existingCategories,
          categories_count: existingCategories.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If force=true, delete all existing categories first (cascade will handle linked data)
    if (force && hasCategories) {
      // Delete categorizations first (they reference categories)
      await supabaseClient
        .from("transaction_categorizations")
        .delete()
        .in("category_id", existingCategories.map(c => c.id));

      // Delete rules that reference these categories
      await supabaseClient
        .from("categorization_rules")
        .delete()
        .eq("user_id", user.id);

      // Delete all categories
      await supabaseClient
        .from("expense_categories")
        .delete()
        .eq("user_id", user.id);
    }

    // Determine which categories to insert
    let categoriesToInsert;
    if (add_missing && !force) {
      // Only add categories that don't exist yet
      categoriesToInsert = DEFAULT_CATEGORIES
        .filter(cat => !existingNames.has(cat.name.toLowerCase()))
        .map(cat => ({
          user_id: user.id,
          name: cat.name,
          description: cat.description,
          color: cat.color,
          icon: cat.icon,
          is_system_default: true,
        }));
    } else {
      // Insert all defaults
      categoriesToInsert = DEFAULT_CATEGORIES.map(cat => ({
        user_id: user.id,
        name: cat.name,
        description: cat.description,
        color: cat.color,
        icon: cat.icon,
        is_system_default: true,
      }));
    }

    if (categoriesToInsert.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "All default categories already exist",
          categories_added: 0,
          categories: existingCategories,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert categories
    const { data: insertedCategories, error: insertError } = await supabaseClient
      .from("expense_categories")
      .insert(categoriesToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    // Get final list of all categories
    const { data: allCategories } = await supabaseClient
      .from("expense_categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    return new Response(
      JSON.stringify({
        success: true,
        message: force 
          ? "Default categories reset successfully" 
          : add_missing 
            ? `Added ${insertedCategories?.length || 0} missing default categories`
            : "Default categories created",
        categories_added: insertedCategories?.length || 0,
        categories_count: allCategories?.length || 0,
        categories: allCategories,
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