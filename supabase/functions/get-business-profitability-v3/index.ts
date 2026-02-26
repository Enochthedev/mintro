import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
function round(n) {
  return Math.round(n * 100) / 100;
}
function getQL(s) {
  if ([
    "qb_item_cost",
    "qb_expense_linked"
  ].includes(s)) return "excellent";
  if ([
    "user_verified",
    "transaction_linked"
  ].includes(s)) return "good";
  if ([
    "blueprint_linked",
    "chart_of_accounts"
  ].includes(s)) return "fair";
  if ([
    "estimated",
    "keyword_fallback"
  ].includes(s)) return "poor";
  return "none";
}
serve(async (req)=>{
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
    if (ue || !user) return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
    const url = new URL(req.url);
    const startDate = url.searchParams.get("start_date") || `${new Date().getFullYear()}-01-01`;
    const endDate = url.searchParams.get("end_date") || new Date().toISOString().split("T")[0];
    // Load all data
    const { data: invoices, error: ie } = await sc.from("invoices").select("id, invoice, client, amount, invoice_date, service_type, status, total_actual_cost, actual_materials_cost, actual_labor_cost, actual_overhead_cost, actual_profit, cost_override_by_user, cost_data_source, source, quickbooks_id").eq("user_id", user.id).gte("invoice_date", startDate).lte("invoice_date", endDate);
    if (ie) throw ie;
    const { data: plaidTxns, error: pe } = await sc.from("transactions").select("id, amount, date, merchant_name, name, category, linked_invoice_id").eq("user_id", user.id).gte("date", startDate).lte("date", endDate);
    if (pe) throw pe;
    const { data: allocs } = await sc.from("transaction_job_allocations").select("transaction_id, job_id, allocation_amount").eq("user_id", user.id);
    const linkedIds = new Set((allocs || []).map((a)=>a.transaction_id));
    const { data: qbExp, error: qe } = await sc.from("quickbooks_expenses").select("id, quickbooks_expense_id, vendor_name, total_amount, transaction_date, account_ref_name, is_linked_to_invoice, linked_invoice_id").eq("user_id", user.id).gte("transaction_date", startDate).lte("transaction_date", endDate);
    if (qe) throw qe;
    // Separate linked vs unlinked (NO DOUBLE COUNTING)
    const unlinkedPlaid = (plaidTxns || []).filter((t)=>!linkedIds.has(t.id) && !t.linked_invoice_id);
    const linkedPlaid = (plaidTxns || []).filter((t)=>linkedIds.has(t.id) || t.linked_invoice_id);
    const linkedQb = (qbExp || []).filter((e)=>e.is_linked_to_invoice && e.linked_invoice_id);
    const unlinkedQb = (qbExp || []).filter((e)=>!e.is_linked_to_invoice || !e.linked_invoice_id);
    // Unlinked expenses
    const unlinkedPlaidTotal = unlinkedPlaid.reduce((s, t)=>{
      const a = parseFloat(t.amount || "0");
      const c = (t.category || "").toLowerCase();
      if (c === "revenue") return s;
      return a < 0 ? s + Math.abs(a) : s;
    }, 0);
    const unlinkedQbTotal = unlinkedQb.reduce((s, e)=>s + Math.abs(Number(e.total_amount || 0)), 0);
    const txIncome = (plaidTxns || []).reduce((s, t)=>{
      const a = parseFloat(t.amount || "0");
      const c = (t.category || "").toLowerCase();
      if (c === "revenue") return s + Math.abs(a);
      return a > 0 ? s + a : s;
    }, 0);
    // Per-job costs
    const allocByInv = new Map();
    (allocs || []).forEach((a)=>{
      allocByInv.set(a.job_id, (allocByInv.get(a.job_id) || 0) + Math.abs(parseFloat(String(a.allocation_amount || 0))));
    });
    const qbByInv = new Map();
    linkedQb.forEach((e)=>{
      if (e.linked_invoice_id) qbByInv.set(e.linked_invoice_id, (qbByInv.get(e.linked_invoice_id) || 0) + Math.abs(Number(e.total_amount || 0)));
    });
    const invCalcs = (invoices || []).map((inv)=>{
      const rev = parseFloat(inv.amount || "0");
      const override = inv.cost_override_by_user || false;
      const stored = inv.total_actual_cost !== null ? parseFloat(inv.total_actual_cost || "0") : null;
      const cs = inv.cost_data_source || "none";
      const lPlaid = allocByInv.get(inv.id) || 0;
      const lQb = qbByInv.get(inv.id) || 0;
      const totalLinked = lPlaid + lQb;
      let eCost, eSrc;
      if (override && stored !== null) {
        eCost = stored;
        eSrc = "user_verified";
      } else if (stored !== null && cs !== "none" && cs !== "auto_linked") {
        eCost = stored;
        eSrc = cs;
      } else if (totalLinked > 0) {
        eCost = totalLinked;
        eSrc = "transaction_linked";
      } else {
        eCost = 0;
        eSrc = "none";
      }
      const profit = rev - eCost;
      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        service_type: inv.service_type,
        invoice_date: inv.invoice_date,
        revenue: rev,
        costs: {
          from_linked_plaid: lPlaid,
          from_linked_qb: lQb,
          total_linked: totalLinked,
          stored,
          effective: eCost
        },
        cost_breakdown: {
          materials: parseFloat(inv.actual_materials_cost || "0"),
          labor: parseFloat(inv.actual_labor_cost || "0"),
          overhead: parseFloat(inv.actual_overhead_cost || "0")
        },
        profit,
        margin: rev > 0 ? round(profit / rev * 100) : 0,
        has_cost_data: eCost > 0,
        cost_source: eSrc,
        quality_level: getQL(eSrc)
      };
    });
    const invRev = invCalcs.reduce((s, c)=>s + c.revenue, 0);
    const invCost = invCalcs.reduce((s, c)=>s + c.costs.effective, 0);
    const invProfit = invCalcs.reduce((s, c)=>s + c.profit, 0);
    const totalRev = invRev + txIncome;
    const totalExp = invCost + unlinkedPlaidTotal + unlinkedQbTotal;
    const netProfit = totalRev - totalExp;
    // Expense breakdown
    const expCat = new Map();
    unlinkedPlaid.forEach((t)=>{
      const a = parseFloat(t.amount || "0");
      const c = t.category || "Uncategorized";
      if (c.toLowerCase() === "revenue") return;
      if (a < 0) expCat.set(c, (expCat.get(c) || 0) + Math.abs(a));
    });
    unlinkedQb.forEach((e)=>{
      const c = e.account_ref_name || "QB Uncategorized";
      expCat.set(c, (expCat.get(c) || 0) + Math.abs(Number(e.total_amount || 0)));
    });
    const expBreakdown = Array.from(expCat.entries()).map(([c, a])=>({
        category: c,
        amount: round(a)
      })).sort((a, b)=>b.amount - a.amount);
    // Duplicate detection
    const dupes = [];
    for (const qe of qbExp || []){
      const qa = Math.abs(Number(qe.total_amount || 0));
      const qd = new Date(qe.transaction_date);
      const qv = (qe.vendor_name || "").toLowerCase();
      for (const pt of plaidTxns || []){
        const pa = Math.abs(parseFloat(pt.amount || "0"));
        if (Math.abs(qa - pa) > 0.01) continue;
        const pd = new Date(pt.date);
        const dd = Math.abs((qd.getTime() - pd.getTime()) / 86400000);
        if (dd > 3) continue;
        const pm = (pt.merchant_name || pt.name || "").toLowerCase();
        const vm = qv.length > 4 && pm.length > 4 && (qv.includes(pm.substring(0, 5)) || pm.includes(qv.substring(0, 5)));
        dupes.push({
          plaid_id: pt.id,
          plaid_merchant: pt.merchant_name || pt.name,
          plaid_amount: pa,
          plaid_date: pt.date,
          qb_id: qe.quickbooks_expense_id,
          qb_vendor: qe.vendor_name,
          qb_amount: qa,
          qb_date: qe.transaction_date,
          qb_account: qe.account_ref_name,
          days_apart: Math.round(dd),
          vendor_match: vm,
          confidence: vm ? "high" : "medium"
        });
      }
    }
    // Service type
    const stMap = new Map();
    invCalcs.forEach((i)=>{
      const s = i.service_type || "Uncategorized";
      const c = stMap.get(s) || {
        revenue: 0,
        cost: 0,
        profit: 0,
        count: 0
      };
      c.revenue += i.revenue;
      c.cost += i.costs.effective;
      c.profit += i.profit;
      c.count++;
      stMap.set(s, c);
    });
    const stArr = Array.from(stMap.entries()).map(([t, d])=>({
        service_type: t,
        revenue: round(d.revenue),
        cost: round(d.cost),
        profit: round(d.profit),
        margin: d.revenue > 0 ? round(d.profit / d.revenue * 100) : 0,
        count: d.count
      })).sort((a, b)=>b.revenue - a.revenue);
    // MoM
    const now = new Date();
    const cms = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const lmy = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const lms = `${lmy}-${String(lm + 1).padStart(2, "0")}-01`;
    const lme = `${lmy}-${String(lm + 1).padStart(2, "0")}-${new Date(lmy, lm + 1, 0).getDate()}`;
    const cmI = invCalcs.filter((i)=>i.invoice_date >= cms);
    const lmI = invCalcs.filter((i)=>i.invoice_date >= lms && i.invoice_date <= lme);
    // QB merged
    let qbPnl = null;
    const { data: qr } = await sc.from("quickbooks_pnl_reports").select("*").eq("user_id", user.id).lte("start_date", startDate).gte("end_date", endDate).order("synced_at", {
      ascending: false
    }).limit(1).single();
    if (qr) {
      const mo = (invoices || []).filter((i)=>i.source !== "quickbooks");
      const mr = mo.reduce((s, i)=>s + Number(i.amount || 0), 0);
      const me = mo.reduce((s, i)=>s + Number(i.total_actual_cost || 0), 0);
      const mRev = Number(qr.total_income || 0) + mr;
      const mExp = Number(qr.total_expenses || 0) + me;
      qbPnl = {
        enabled: true,
        last_synced: qr.synced_at,
        merged: {
          revenue: round(mRev),
          expenses: round(mExp),
          profit: round(mRev - mExp),
          margin: mRev > 0 ? round((mRev - mExp) / mRev * 100) : 0
        }
      };
    }
    return new Response(JSON.stringify({
      success: true,
      period: {
        start_date: startDate,
        end_date: endDate
      },
      overview: {
        total_revenue: round(totalRev),
        total_expenses: round(totalExp),
        net_profit: round(netProfit),
        profit_margin: totalRev > 0 ? round(netProfit / totalRev * 100) : 0,
        expense_sources: {
          from_invoice_linked_costs: round(invCost),
          from_unlinked_plaid: round(unlinkedPlaidTotal),
          from_unlinked_qb: round(unlinkedQbTotal)
        }
      },
      job_metrics: {
        total_invoices: invoices?.length || 0,
        invoices_with_costs: invCalcs.filter((c)=>c.has_cost_data).length,
        total_job_revenue: round(invRev),
        total_job_costs: round(invCost),
        total_job_profit: round(invProfit),
        average_job_margin: invRev > 0 ? round(invProfit / invRev * 100) : 0
      },
      transaction_stats: {
        plaid: {
          total: plaidTxns?.length || 0,
          linked: linkedPlaid.length,
          unlinked: unlinkedPlaid.length,
          unlinked_total: round(unlinkedPlaidTotal)
        },
        quickbooks: {
          total: qbExp?.length || 0,
          linked: linkedQb.length,
          unlinked: unlinkedQb.length,
          unlinked_total: round(unlinkedQbTotal)
        }
      },
      service_type_breakdown: stArr,
      expense_breakdown: expBreakdown,
      potential_duplicates: {
        count: dupes.length,
        items: dupes,
        message: dupes.length > 0 ? `Found ${dupes.length} potential duplicate(s). Review and merge or keep both.` : "No duplicates detected."
      },
      month_over_month: {
        current: {
          revenue: round(cmI.reduce((s, i)=>s + i.revenue, 0)),
          profit: round(cmI.reduce((s, i)=>s + i.profit, 0))
        },
        last: {
          revenue: round(lmI.reduce((s, i)=>s + i.revenue, 0)),
          profit: round(lmI.reduce((s, i)=>s + i.profit, 0))
        }
      },
      invoices: invCalcs,
      quickbooks_merged_pnl: qbPnl
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
