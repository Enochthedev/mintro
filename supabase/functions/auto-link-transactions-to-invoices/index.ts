import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
/**
 * auto-link-transactions-to-invoices
 * 
 * Scans unlinked Plaid transactions AND QuickBooks expenses,
 * then matches them to invoices (jobs) using smart matching:
 * 
 * MATCHING STRATEGIES (priority order):
 * 1. QB CustomerRef → Invoice client (exact QB customer match)
 * 2. Client name fuzzy match (vendor/merchant vs invoice client name)
 * 3. Job expense detection (QB account contains "Job Expenses" → nearest invoice by date)
 * 4. Date proximity (within configurable window)
 * 
 * EXPENSE CLASSIFICATION:
 * - Direct job costs: "Job Expenses", "Job Materials" → linked to specific invoice
 * - Overhead: "Insurance", "Rent", "Utilities" → skipped (not job-specific)
 * - Ambiguous: only linked if strong client/date match
 * 
 * DRY RUN MODE:
 * - dry_run: true  → shows what WOULD be linked, changes nothing in DB
 * - dry_run: false → actually writes the links to DB
 * 
 * Frontend flow:
 * 1. Call with dry_run: true → show user the preview list
 * 2. User reviews matches, confirms
 * 3. Call with dry_run: false → commits the links
 */ const DIRECT_JOB_COST_PATTERNS = [
  "job expenses",
  "job materials",
  "cost of goods",
  "cogs",
  "subcontract",
  "landscaping services"
];
const OVERHEAD_PATTERNS = [
  "automobile",
  "fuel",
  "insurance",
  "rent",
  "utilities",
  "office expenses",
  "legal & professional",
  "advertising",
  "maintenance and repair",
  "miscellaneous",
  "meals and entertainment",
  "equipment rental"
];
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization")
        }
      }
    });
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
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
    const { dry_run = true, date_window_days = 14, include_plaid = true, include_quickbooks = true, force_relink = false } = body;
    // 1. LOAD ALL INVOICES
    const { data: invoices, error: invoiceErr } = await supabaseClient.from("invoices").select("id, client, amount, invoice_date, service_type, quickbooks_id").eq("user_id", user.id).order("invoice_date", {
      ascending: false
    });
    if (invoiceErr) throw invoiceErr;
    if (!invoices?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No invoices found",
        results: {
          linked: 0
        }
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const links = [];
    const skipped = [];
    // 2. PROCESS QUICKBOOKS EXPENSES
    if (include_quickbooks) {
      let qbQuery = supabaseClient.from("quickbooks_expenses").select("*").eq("user_id", user.id);
      if (!force_relink) qbQuery = qbQuery.or("is_linked_to_invoice.is.null,is_linked_to_invoice.eq.false");
      const { data: qbExpenses, error: qbErr } = await qbQuery;
      if (qbErr) throw qbErr;
      for (const expense of qbExpenses || []){
        const accountName = (expense.account_ref_name || "").toLowerCase();
        const expenseType = classifyExpense(accountName);
        if (expenseType === "overhead") {
          skipped.push({
            id: expense.quickbooks_expense_id,
            source: "quickbooks",
            vendor: expense.vendor_name,
            amount: expense.total_amount,
            reason: `Overhead expense (${expense.account_ref_name})`
          });
          continue;
        }
        if (expense.customer_ref_name) {
          const matchedInvoice = findInvoiceByClientName(invoices, expense.customer_ref_name, expense.transaction_date, date_window_days);
          if (matchedInvoice) {
            links.push({
              expense_id: expense.id,
              source: "quickbooks",
              vendor: expense.vendor_name,
              amount: Number(expense.total_amount),
              expense_date: expense.transaction_date,
              invoice_id: matchedInvoice.id,
              invoice_client: matchedInvoice.client,
              invoice_amount: Number(matchedInvoice.amount),
              invoice_date: matchedInvoice.invoice_date,
              match_method: "qb_customer_ref",
              confidence: "high",
              expense_type: expenseType
            });
            continue;
          }
        }
        if (expenseType === "direct_job_cost") {
          const nearestInvoice = findNearestInvoiceByDate(invoices, expense.transaction_date, date_window_days);
          if (nearestInvoice) {
            links.push({
              expense_id: expense.id,
              source: "quickbooks",
              vendor: expense.vendor_name,
              amount: Number(expense.total_amount),
              expense_date: expense.transaction_date,
              invoice_id: nearestInvoice.id,
              invoice_client: nearestInvoice.client,
              invoice_amount: Number(nearestInvoice.amount),
              invoice_date: nearestInvoice.invoice_date,
              match_method: "job_expense_date_proximity",
              confidence: "medium",
              expense_type: expenseType
            });
            continue;
          }
        }
        skipped.push({
          id: expense.quickbooks_expense_id,
          source: "quickbooks",
          vendor: expense.vendor_name,
          amount: expense.total_amount,
          account: expense.account_ref_name,
          reason: "No matching invoice found"
        });
      }
    }
    // 3. PROCESS PLAID TRANSACTIONS
    if (include_plaid) {
      let plaidQuery = supabaseClient.from("transactions").select("id, amount, date, merchant_name, name, category, linked_invoice_id").eq("user_id", user.id).lt("amount", 0);
      if (!force_relink) plaidQuery = plaidQuery.is("linked_invoice_id", null);
      const { data: plaidTxns, error: plaidErr } = await plaidQuery;
      if (plaidErr) throw plaidErr;
      const { data: existingAllocations } = await supabaseClient.from("transaction_job_allocations").select("transaction_id").eq("user_id", user.id);
      const alreadyLinkedTxnIds = new Set((existingAllocations || []).map((a)=>a.transaction_id));
      for (const txn of plaidTxns || []){
        if (!force_relink && alreadyLinkedTxnIds.has(txn.id)) continue;
        const merchantName = txn.merchant_name || txn.name || "";
        const matchedInvoice = findInvoiceByClientName(invoices, merchantName, txn.date, date_window_days);
        if (matchedInvoice) {
          links.push({
            expense_id: txn.id,
            source: "plaid",
            vendor: merchantName,
            amount: Math.abs(Number(txn.amount)),
            expense_date: txn.date,
            invoice_id: matchedInvoice.id,
            invoice_client: matchedInvoice.client,
            invoice_amount: Number(matchedInvoice.amount),
            invoice_date: matchedInvoice.invoice_date,
            match_method: "plaid_merchant_client_match",
            confidence: "medium",
            expense_type: "ambiguous"
          });
        }
      }
    }
    // 4. COMMIT OR PREVIEW
    let committed = 0;
    if (!dry_run && links.length > 0) {
      for (const link of links){
        try {
          if (link.source === "quickbooks") {
            await supabaseClient.from("quickbooks_expenses").update({
              is_linked_to_invoice: true,
              linked_invoice_id: link.invoice_id,
              updated_at: new Date().toISOString()
            }).eq("id", link.expense_id);
            committed++;
          } else if (link.source === "plaid") {
            const { error: allocErr } = await supabaseClient.from("transaction_job_allocations").upsert({
              user_id: user.id,
              transaction_id: link.expense_id,
              job_id: link.invoice_id,
              allocation_amount: link.amount,
              allocation_percentage: 100,
              notes: `Auto-linked: ${link.match_method} (${link.confidence} confidence)`
            }, {
              onConflict: "transaction_id,job_id"
            });
            if (!allocErr) {
              await supabaseClient.from("transactions").update({
                linked_invoice_id: link.invoice_id
              }).eq("id", link.expense_id);
              committed++;
            }
          }
        } catch (e) {
          console.error(`Failed to link ${link.expense_id}:`, e.message);
        }
      }
      const affectedInvoiceIds = [
        ...new Set(links.map((l)=>l.invoice_id))
      ];
      for (const invoiceId of affectedInvoiceIds){
        await recalculateInvoiceCosts(supabaseClient, invoiceId, user.id);
      }
    }
    // 5. SUMMARY
    const byMethod = {};
    const byConfidence = {};
    const bySource = {};
    links.forEach((l)=>{
      byMethod[l.match_method] = (byMethod[l.match_method] || 0) + 1;
      byConfidence[l.confidence] = (byConfidence[l.confidence] || 0) + 1;
      bySource[l.source] = (bySource[l.source] || 0) + 1;
    });
    return new Response(JSON.stringify({
      success: true,
      dry_run,
      message: dry_run ? `Preview: ${links.length} transactions would be linked to invoices` : `Linked ${committed} transactions to invoices`,
      results: {
        total_matched: links.length,
        committed: dry_run ? 0 : committed,
        skipped: skipped.length,
        by_method: byMethod,
        by_confidence: byConfidence,
        by_source: bySource,
        affected_invoices: [
          ...new Set(links.map((l)=>l.invoice_id))
        ].length
      },
      links: links.map((l)=>({
          ...l,
          summary: `${l.vendor || "Unknown"} ($${l.amount}) → ${l.invoice_client} [${l.match_method}]`
        })),
      skipped,
      config: {
        date_window_days,
        include_plaid,
        include_quickbooks,
        force_relink
      }
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
function classifyExpense(accountName) {
  const lower = accountName.toLowerCase();
  if (DIRECT_JOB_COST_PATTERNS.some((p)=>lower.includes(p))) return "direct_job_cost";
  if (OVERHEAD_PATTERNS.some((p)=>lower.includes(p))) return "overhead";
  return "ambiguous";
}
function findInvoiceByClientName(invoices, searchName, expenseDate, windowDays) {
  const searchLower = searchName.toLowerCase().trim();
  if (!searchLower || searchLower.length < 3) return null;
  const scored = invoices.filter((inv)=>{
    const clientLower = inv.client.toLowerCase();
    return clientLower.includes(searchLower) || searchLower.includes(clientLower) || wordOverlap(clientLower, searchLower) >= 0.5;
  }).map((inv)=>{
    const daysDiff = dateDiffDays(expenseDate, inv.invoice_date);
    return {
      ...inv,
      daysDiff,
      score: calculateMatchScore(inv.client, searchName, daysDiff, windowDays)
    };
  }).filter((inv)=>inv.daysDiff <= windowDays && inv.score > 0).sort((a, b)=>b.score - a.score);
  return scored.length > 0 ? scored[0] : null;
}
function findNearestInvoiceByDate(invoices, expenseDate, windowDays) {
  const scored = invoices.map((inv)=>({
      ...inv,
      daysDiff: dateDiffDays(expenseDate, inv.invoice_date)
    })).filter((inv)=>inv.daysDiff <= windowDays).sort((a, b)=>a.daysDiff - b.daysDiff);
  return scored.length > 0 ? scored[0] : null;
}
function dateDiffDays(date1, date2) {
  return Math.abs(Math.floor((new Date(date1).getTime() - new Date(date2).getTime()) / 86400000));
}
function wordOverlap(str1, str2) {
  const words1 = new Set(str1.split(/\s+/).filter((w)=>w.length > 2));
  const words2 = new Set(str2.split(/\s+/).filter((w)=>w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  words1.forEach((w)=>{
    if (words2.has(w)) overlap++;
  });
  return overlap / Math.min(words1.size, words2.size);
}
function calculateMatchScore(clientName, searchName, daysDiff, windowDays) {
  let score = 0;
  const clientLower = clientName.toLowerCase();
  const searchLower = searchName.toLowerCase();
  if (clientLower === searchLower) score += 50;
  else if (clientLower.includes(searchLower) || searchLower.includes(clientLower)) score += 40;
  else score += wordOverlap(clientLower, searchLower) * 30;
  score += Math.max(0, 50 * (1 - daysDiff / windowDays));
  return score;
}
async function recalculateInvoiceCosts(supabase, invoiceId, userId) {
  const { data: qbExpenses } = await supabase.from("quickbooks_expenses").select("total_amount, account_ref_name, vendor_name").eq("linked_invoice_id", invoiceId).eq("user_id", userId);
  const { data: plaidAllocations } = await supabase.from("transaction_job_allocations").select("allocation_amount").eq("job_id", invoiceId).eq("user_id", userId);
  let materialsCost = 0, laborCost = 0, overheadCost = 0;
  for (const exp of qbExpenses || []){
    const accountName = (exp.account_ref_name || "").toLowerCase();
    const amount = Math.abs(Number(exp.total_amount || 0));
    if (accountName.includes("material") || accountName.includes("cogs") || accountName.includes("inventory") || accountName.includes("job expenses") || accountName.includes("plants") || accountName.includes("decks") || accountName.includes("sprinkler")) materialsCost += amount;
    else if (accountName.includes("labor") || accountName.includes("subcontract") || accountName.includes("payroll")) laborCost += amount;
    else overheadCost += amount;
  }
  overheadCost += (plaidAllocations || []).reduce((sum, a)=>sum + Math.abs(Number(a.allocation_amount || 0)), 0);
  const totalCost = materialsCost + laborCost + overheadCost;
  await supabase.from("invoices").update({
    actual_materials_cost: materialsCost,
    actual_labor_cost: laborCost,
    actual_overhead_cost: overheadCost,
    total_actual_cost: totalCost,
    cost_data_source: "auto_linked",
    updated_at: new Date().toISOString()
  }).eq("id", invoiceId);
}
