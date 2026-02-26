import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
/**
 * clear-quickbooks-transactions
 *
 * Clears QB transactions from Mintro with full cascade cleanup.
 *
 * Two modes:
 *   1. Pass transaction_ids: ["id1", "id2"] → clears specific ones
 *   2. Pass clear_all: true → wipes ALL QB transactions for the user
 *
 * Cascade cleanup for each cleared transaction:
 *   - If it was linked to an invoice → unlinks it
 *   - Resets invoice actual costs (recalculates without the removed transaction)
 *   - Removes duplicate flags on Plaid transactions that referenced it
 *
 * After clearing, user can re-import fresh via quickbooks-sync-expenses.
 */ serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const sc = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization")
        }
      }
    });
    const { data: { user }, error: ue } = await sc.auth.getUser();
    if (ue || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const body = await req.json().catch(()=>({}));
    const { transaction_ids, clear_all } = body;
    if (!clear_all && (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0)) {
      return new Response(JSON.stringify({
        error: "Provide either transaction_ids (array of quickbooks_expenses IDs) or clear_all: true"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 1. Get the QB expenses we're about to delete
    let query = sc.from("quickbooks_expenses").select("id, linked_invoice_id, is_linked_to_invoice").eq("user_id", user.id);
    if (!clear_all) {
      query = query.in("id", transaction_ids);
    }
    const { data: toDelete, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;
    if (!toDelete || toDelete.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No QB transactions found to clear",
        cleared: 0
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const qbIds = toDelete.map((t)=>t.id);
    const affectedInvoiceIds = [
      ...new Set(toDelete.filter((t)=>t.is_linked_to_invoice && t.linked_invoice_id).map((t)=>t.linked_invoice_id))
    ];
    // 2. Clear duplicate flags on Plaid transactions that reference these QB expenses
    const { error: dupeClearErr } = await sc.from("transactions").update({
      potential_qb_duplicate_id: null,
      duplicate_confidence: null,
      duplicate_status: null
    }).eq("user_id", user.id).in("potential_qb_duplicate_id", qbIds);
    if (dupeClearErr) console.error("Failed to clear dupe flags:", dupeClearErr.message);
    // 3. Delete the QB expenses
    let deleteQuery = sc.from("quickbooks_expenses").delete().eq("user_id", user.id);
    if (!clear_all) {
      deleteQuery = deleteQuery.in("id", qbIds);
    }
    const { error: deleteErr } = await deleteQuery;
    if (deleteErr) throw deleteErr;
    // 4. Recalculate affected invoices (their costs just changed)
    let recalculated = 0;
    for (const invoiceId of affectedInvoiceIds){
      try {
        // Check what's still linked to this invoice
        const { data: remainingQb } = await sc.from("quickbooks_expenses").select("total_amount, account_ref_name").eq("linked_invoice_id", invoiceId).eq("user_id", user.id);
        const { data: plaidAllocs } = await sc.from("transaction_job_allocations").select("allocation_amount").eq("job_id", invoiceId).eq("user_id", user.id);
        let materials = 0, labor = 0, overhead = 0;
        for (const exp of remainingQb || []){
          const acct = (exp.account_ref_name || "").toLowerCase();
          const amt = Math.abs(Number(exp.total_amount || 0));
          if (acct.includes("material") || acct.includes("cogs") || acct.includes("job expenses") || acct.includes("plants")) {
            materials += amt;
          } else if (acct.includes("labor") || acct.includes("subcontract") || acct.includes("payroll")) {
            labor += amt;
          } else {
            overhead += amt;
          }
        }
        overhead += (plaidAllocs || []).reduce((s, a)=>s + Math.abs(Number(a.allocation_amount || 0)), 0);
        const total = materials + labor + overhead;
        await sc.from("invoices").update({
          actual_materials_cost: materials,
          actual_labor_cost: labor,
          actual_overhead_cost: overhead,
          total_actual_cost: total,
          updated_at: new Date().toISOString()
        }).eq("id", invoiceId);
        recalculated++;
      } catch (e) {
        console.error(`Failed to recalculate invoice ${invoiceId}:`, e.message);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: clear_all ? `Cleared all ${toDelete.length} QB transactions from Mintro` : `Cleared ${toDelete.length} QB transaction(s) from Mintro`,
      cleared: toDelete.length,
      invoices_recalculated: recalculated,
      affected_invoice_ids: affectedInvoiceIds,
      next_step: "Run quickbooks-sync-expenses to re-import fresh from QuickBooks"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
