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

    const { invoice_id, force = false } = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if invoice exists
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for linked data
    const { data: blueprintUsages } = await supabaseClient
      .from("blueprint_usage")
      .select("id")
      .eq("invoice_id", invoice_id);

    const { data: transactionLinks } = await supabaseClient
      .from("transaction_job_allocations")
      .select("id")
      .eq("job_id", invoice_id);

    const hasLinkedData = 
      (blueprintUsages && blueprintUsages.length > 0) ||
      (transactionLinks && transactionLinks.length > 0);

    if (hasLinkedData && !force) {
      return new Response(
        JSON.stringify({
          error: "Invoice has linked data",
          message: "This invoice has linked blueprint usages or transactions. Set force=true to delete anyway.",
          linked_data: {
            blueprint_usages: blueprintUsages?.length || 0,
            transaction_links: transactionLinks?.length || 0,
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete related data first (CASCADE should handle this, but being explicit)
    if (force) {
      // Delete blueprint usages
      if (blueprintUsages && blueprintUsages.length > 0) {
        await supabaseClient
          .from("blueprint_usage")
          .delete()
          .eq("invoice_id", invoice_id);
      }

      // Delete transaction allocations
      if (transactionLinks && transactionLinks.length > 0) {
        await supabaseClient
          .from("transaction_job_allocations")
          .delete()
          .eq("job_id", invoice_id);
      }

      // Delete invoice items
      await supabaseClient
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoice_id);

      // Delete cost overrides
      await supabaseClient
        .from("invoice_cost_overrides")
        .delete()
        .eq("invoice_id", invoice_id);
    }

    // Delete invoice
    const { error: deleteError } = await supabaseClient
      .from("invoices")
      .delete()
      .eq("id", invoice_id);

    if (deleteError) {
      throw deleteError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invoice deleted successfully",
        invoice_number: invoice.invoice,
        deleted_data: force ? {
          blueprint_usages: blueprintUsages?.length || 0,
          transaction_links: transactionLinks?.length || 0,
        } : null,
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