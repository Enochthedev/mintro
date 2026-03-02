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
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find active connection for this user
    const { data: connection, error: connError } = await adminClient
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (connError || !connection) {
      return new Response(JSON.stringify({ error: "No QuickBooks connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Revoke token with QuickBooks
    try {
      var cid = Deno.env.get("QUICKBOOKS_CLIENT_ID") || "";
      var cs = Deno.env.get("QUICKBOOKS_CLIENT_SECRET") || "";
      var basicAuth = btoa(cid + ":" + cs);
      await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + basicAuth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: connection.refresh_token }),
      });
    } catch (revokeError) {
      console.error("Error revoking token:", revokeError);
    }

    // Full cleanup - always clear all synced data
    var { data: qbExpenses } = await adminClient
      .from("quickbooks_expenses")
      .select("id, linked_invoice_id, is_linked_to_invoice")
      .eq("user_id", user.id);

    var qbIds = (qbExpenses || []).map(function(e) { return e.id; });
    var affectedInvoiceIds = [];
    var seen = {};
    for (var i = 0; i < (qbExpenses || []).length; i++) {
      var e = qbExpenses[i];
      if (e.is_linked_to_invoice && e.linked_invoice_id && !seen[e.linked_invoice_id]) {
        seen[e.linked_invoice_id] = true;
        affectedInvoiceIds.push(e.linked_invoice_id);
      }
    }

    // Clear duplicate flags on Plaid transactions
    if (qbIds.length > 0) {
      await adminClient
        .from("transactions")
        .update({ potential_qb_duplicate_id: null, duplicate_confidence: null, duplicate_status: null })
        .eq("user_id", user.id)
        .in("potential_qb_duplicate_id", qbIds);
    }

    // Delete QB expenses
    var { data: delExp } = await adminClient
      .from("quickbooks_expenses")
      .delete()
      .eq("user_id", user.id)
      .select("id");

    // Delete QB P&L reports
    var { data: delPnl } = await adminClient
      .from("quickbooks_pnl_reports")
      .delete()
      .eq("user_id", user.id)
      .select("id");

    // Delete QB invoice mappings
    var { data: delMap } = await adminClient
      .from("quickbooks_invoice_mappings")
      .delete()
      .eq("user_id", user.id)
      .select("id");

    // Recalculate affected invoice costs
    var recalculated = 0;
    for (var i = 0; i < affectedInvoiceIds.length; i++) {
      var invoiceId = affectedInvoiceIds[i];
      try {
        var allocResult = await adminClient
          .from("transaction_job_allocations")
          .select("allocation_amount")
          .eq("job_id", invoiceId)
          .eq("user_id", user.id);

        var overhead = 0;
        var allocs = allocResult.data || [];
        for (var j = 0; j < allocs.length; j++) {
          overhead += Math.abs(Number(allocs[j].allocation_amount || 0));
        }

        await adminClient.from("invoices").update({
          actual_materials_cost: 0,
          actual_labor_cost: 0,
          actual_overhead_cost: overhead,
          total_actual_cost: overhead,
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);

        recalculated++;
      } catch (e) {
        console.error("Recalc failed for " + invoiceId);
      }
    }

    // Delete the connection
    var deleteResult = await adminClient
      .from("quickbooks_connections")
      .delete()
      .eq("id", connection.id)
      .eq("user_id", user.id);

    if (deleteResult.error) throw deleteResult.error;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Disconnected " + connection.company_name + " and cleared all synced data",
        cleaned: {
          expenses_deleted: (delExp || []).length,
          pnl_reports_deleted: (delPnl || []).length,
          invoice_mappings_deleted: (delMap || []).length,
          invoices_recalculated: recalculated,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
