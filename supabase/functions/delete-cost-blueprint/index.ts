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

    const { blueprint_id, permanent = false } = await req.json();

    if (!blueprint_id) {
      return new Response(
        JSON.stringify({ error: "blueprint_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if blueprint exists and belongs to user
    const { data: blueprint, error: blueprintError } = await supabaseClient
      .from("cost_blueprints")
      .select("*")
      .eq("id", blueprint_id)
      .eq("user_id", user.id)
      .single();

    if (blueprintError || !blueprint) {
      return new Response(
        JSON.stringify({ error: "Blueprint not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if blueprint has been used in any jobs
    const { data: usageRecords, error: usageError } = await supabaseClient
      .from("blueprint_usage")
      .select("id, invoice_id, completed_date")
      .eq("blueprint_id", blueprint_id)
      .limit(5);

    if (usageError) {
      console.error("Error checking usage:", usageError);
    }

    const hasUsage = usageRecords && usageRecords.length > 0;

    // If blueprint has been used and not permanent delete, only soft delete
    if (hasUsage && !permanent) {
      const { data: deactivated, error: deactivateError } = await supabaseClient
        .from("cost_blueprints")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", blueprint_id)
        .select()
        .single();

      if (deactivateError) {
        throw deactivateError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Blueprint deactivated (soft delete)",
          blueprint: deactivated,
          reason: "Blueprint has been used in jobs and cannot be permanently deleted",
          usage_count: usageRecords.length,
          suggestion: "Set permanent=true to force delete (this will also delete all usage records)",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Permanent delete
    if (permanent) {
      // Delete blueprint usage records first (cascade)
      if (hasUsage) {
        await supabaseClient
          .from("blueprint_usage")
          .delete()
          .eq("blueprint_id", blueprint_id);
      }

      // Delete blueprint inventory items
      await supabaseClient
        .from("blueprint_inventory_items")
        .delete()
        .eq("blueprint_id", blueprint_id);

      // Delete blueprint transaction rules
      await supabaseClient
        .from("blueprint_transaction_rules")
        .delete()
        .eq("blueprint_id", blueprint_id);

      // Delete the blueprint itself
      const { error: deleteError } = await supabaseClient
        .from("cost_blueprints")
        .delete()
        .eq("id", blueprint_id);

      if (deleteError) {
        throw deleteError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Blueprint permanently deleted",
          blueprint_name: blueprint.name,
          deleted_usage_records: usageRecords?.length || 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Soft delete (no usage records)
    const { data: deactivated, error: deactivateError } = await supabaseClient
      .from("cost_blueprints")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", blueprint_id)
      .select()
      .single();

    if (deactivateError) {
      throw deactivateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Blueprint deactivated",
        blueprint: deactivated,
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