import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { keep_data } = body;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find the pending_switch connection
    const { data: connection, error: connError } = await adminClient
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending_switch")
      .single();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: "No pending company switch found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If keep_data is false, clear old data (same cleanup as disconnect)
    let cleaned = null;
    if (keep_data === false) {
      // Get QB expenses to find affected invoices
      const { data: qbExpenses } = await adminClient
        .from("quickbooks_expenses")
        .select("id, linked_invoice_id, is_linked_to_invoice")
        .eq("user_id", user.id);

      const qbIds = (qbExpenses || []).map((e: any) => e.id);
      const invSet = new Set<string>();
      (qbExpenses || []).forEach((e: any) => {
        if (e.is_linked_to_invoice && e.linked_invoice_id) invSet.add(e.linked_invoice_id);
      });
      const affectedInvoiceIds = Array.from(invSet);

      // Clear duplicate flags on Plaid transactions
      if (qbIds.length > 0) {
        await adminClient
          .from("transactions")
          .update({ potential_qb_duplicate_id: null, duplicate_confidence: null, duplicate_status: null })
          .eq("user_id", user.id)
          .in("potential_qb_duplicate_id", qbIds);
      }

      // Delete QB expenses
      const { data: expResult } = await adminClient
        .from("quickbooks_expenses")
        .delete()
        .eq("user_id", user.id)
        .select("id");

      // Delete QB P&L reports
      const { data: pnlResult } = await adminClient
        .from("quickbooks_pnl_reports")
        .delete()
        .eq("user_id", user.id)
        .select("id");

      // Delete QB invoice mappings
      const { data: mapResult } = await adminClient
        .from("quickbooks_invoice_mappings")
        .delete()
        .eq("user_id", user.id)
        .select("id");

      // Recalculate affected invoice costs
      let recalculated = 0;
      for (const invoiceId of affectedInvoiceIds) {
        try {
          const { data: plaidAllocs } = await adminClient
            .from("transaction_job_allocations")
            .select("allocation_amount")
            .eq("job_id", invoiceId)
            .eq("user_id", user.id);

          const overhead = (plaidAllocs || []).reduce(
            (s: number, a: any) => s + Math.abs(Number(a.allocation_amount || 0)), 0
          );

          await adminClient.from("invoices").update({
            actual_materials_cost: 0,
            actual_labor_cost: 0,
            actual_overhead_cost: overhead,
            total_actual_cost: overhead,
            updated_at: new Date().toISOString(),
          }).eq("id", invoiceId);

          recalculated++;
        } catch (e: any) {
          console.error("Recalc failed for " + invoiceId + ":", e.message);
        }
      }

      cleaned = {
        expenses_deleted: (expResult || []).length,
        pnl_reports_deleted: (pnlResult || []).length,
        invoice_mappings_deleted: (mapResult || []).length,
        invoices_recalculated: recalculated,
      };
    }

    // Activate the connection
    const { error: activateError } = await adminClient
      .from("quickbooks_connections")
      .update({ status: "active" })
      .eq("id", connection.id);

    if (activateError) {
      throw activateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: keep_data === false
          ? `Switched to ${connection.company_name} and cleared old data`
          : `Switched to ${connection.company_name} (old data preserved)`,
        company_name: connection.company_name,
        data_cleared: keep_data === false,
        cleaned,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
