import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
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
    const { data: qbAuth, error: qbErr } = await sc.from("quickbooks_connections").select("access_token, refresh_token, realm_id, token_expires_at").eq("user_id", user.id).eq("status", "active").single();
    if (qbErr || !qbAuth) return new Response(JSON.stringify({
      error: "QuickBooks not connected."
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
    let accessToken = qbAuth.access_token;
    if (new Date(qbAuth.token_expires_at) <= new Date()) {
      const r = await refreshToken(qbAuth.refresh_token);
      if (!r.success) return new Response(JSON.stringify({
        error: "Token refresh failed. Reconnect QB."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      accessToken = r.access_token;
      await sc.from("quickbooks_connections").update({
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString()
      }).eq("user_id", user.id).eq("status", "active");
    }
    const base = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
    const results = {};
    async function qbQuery(entity) {
      const q = encodeURIComponent(`SELECT * FROM ${entity} MAXRESULTS 1000`);
      const res = await fetch(`${base}/v3/company/${qbAuth.realm_id}/query?query=${q}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        console.error(`${entity} query failed:`, res.status);
        return [];
      }
      const data = await res.json();
      return data.QueryResponse?.[entity] || [];
    }
    const entityConfigs = [
      {
        entity: "Purchase",
        type: "purchase",
        getVendor: (e)=>e.EntityRef?.name,
        getVendorId: (e)=>e.EntityRef?.value
      },
      {
        entity: "Bill",
        type: "bill",
        getVendor: (e)=>e.VendorRef?.name,
        getVendorId: (e)=>e.VendorRef?.value
      },
      {
        entity: "BillPayment",
        type: "bill_payment",
        getVendor: (e)=>e.VendorRef?.name,
        getVendorId: (e)=>e.VendorRef?.value
      },
      {
        entity: "VendorCredit",
        type: "vendor_credit",
        getVendor: (e)=>e.VendorRef?.name,
        getVendorId: (e)=>e.VendorRef?.value
      },
      {
        entity: "Deposit",
        type: "deposit",
        getVendor: ()=>null,
        getVendorId: ()=>null
      },
      {
        entity: "Transfer",
        type: "transfer",
        getVendor: ()=>null,
        getVendorId: ()=>null
      },
      {
        entity: "SalesReceipt",
        type: "sales_receipt",
        getVendor: ()=>null,
        getVendorId: ()=>null
      }
    ];
    for (const cfg of entityConfigs){
      results[cfg.type] = {
        synced: 0,
        errors: []
      };
      try {
        const entities = await qbQuery(cfg.entity);
        console.log(`Found ${entities.length} ${cfg.entity} entities`);
        for (const e of entities){
          try {
            const refs = extractLineRefs(e.Line);
            const idPrefix = cfg.type === "bill" ? "bill-" : cfg.type === "bill_payment" ? "bp-" : cfg.type === "vendor_credit" ? "vc-" : cfg.type === "deposit" ? "dep-" : cfg.type === "transfer" ? "xfr-" : cfg.type === "sales_receipt" ? "sr-" : "";
            const custId = cfg.type === "sales_receipt" ? e.CustomerRef?.value || refs.customerRefId : refs.customerRefId;
            const custName = cfg.type === "sales_receipt" ? e.CustomerRef?.name || refs.customerRefName : refs.customerRefName;
            let qbLinkedInvoiceRef = null;
            if (cfg.entity === "BillPayment" || cfg.entity === "SalesReceipt") {
              const linkedTxns = e.Line?.flatMap((l)=>l.LinkedTxn || []) || [];
              const invoiceLink = linkedTxns.find((lt)=>lt.TxnType === "Invoice" || lt.TxnType === "Bill");
              if (invoiceLink) qbLinkedInvoiceRef = invoiceLink.TxnId;
            }
            await sc.from("quickbooks_expenses").upsert({
              user_id: user.id,
              quickbooks_expense_id: `${idPrefix}${e.Id}`,
              expense_type: cfg.type,
              vendor_name: cfg.getVendor(e) || null,
              vendor_id: cfg.getVendorId(e) || null,
              total_amount: e.TotalAmt,
              currency: e.CurrencyRef?.value || "USD",
              payment_type: e.PaymentType || null,
              account_ref_id: refs.accountRefId,
              account_ref_name: refs.accountRefName,
              customer_ref_id: custId,
              customer_ref_name: custName,
              class_ref_id: refs.classRefId,
              class_ref_name: refs.classRefName,
              transaction_date: e.TxnDate,
              due_date: e.DueDate || null,
              line_items: e.Line,
              memo: e.PrivateNote || null,
              qb_linked_invoice_ref: qbLinkedInvoiceRef,
              synced_at: new Date().toISOString()
            }, {
              onConflict: "user_id,quickbooks_expense_id"
            });
            results[cfg.type].synced++;
          } catch (err) {
            results[cfg.type].errors.push(`${cfg.entity} ${e.Id}: ${err.message}`);
          }
        }
      } catch (err) {
        results[cfg.type].errors.push(`Query failed: ${err.message}`);
      }
    }
    // PAYMENTS (special - auto-links to invoices)
    results.payment = {
      synced: 0,
      errors: []
    };
    const autoLinked = [];
    try {
      const payments = await qbQuery("Payment");
      console.log(`Found ${payments.length} Payment entities`);
      const { data: ourInvoices } = await sc.from("invoices").select("id, client, amount, invoice_date, quickbooks_id").eq("user_id", user.id);
      const { data: plaidTxns } = await sc.from("transactions").select("id, amount, date, merchant_name, name, linked_invoice_id").eq("user_id", user.id);
      for (const pmt of payments){
        try {
          const linkedTxns = (pmt.Line || []).flatMap((l)=>l.LinkedTxn || []);
          const invoiceLinks = linkedTxns.filter((lt)=>lt.TxnType === "Invoice");
          const qbInvoiceId = invoiceLinks.length > 0 ? invoiceLinks[0].TxnId : null;
          await sc.from("quickbooks_expenses").upsert({
            user_id: user.id,
            quickbooks_expense_id: `pmt-${pmt.Id}`,
            expense_type: "payment",
            vendor_name: pmt.CustomerRef?.name || null,
            vendor_id: pmt.CustomerRef?.value || null,
            total_amount: pmt.TotalAmt,
            currency: pmt.CurrencyRef?.value || "USD",
            payment_type: pmt.PaymentMethodRef?.name || null,
            customer_ref_id: pmt.CustomerRef?.value || null,
            customer_ref_name: pmt.CustomerRef?.name || null,
            transaction_date: pmt.TxnDate,
            line_items: pmt.Line,
            memo: pmt.PrivateNote || null,
            qb_linked_invoice_ref: qbInvoiceId,
            synced_at: new Date().toISOString()
          }, {
            onConflict: "user_id,quickbooks_expense_id"
          });
          results.payment.synced++;
          if (qbInvoiceId && ourInvoices && plaidTxns) {
            const matchedInvoice = ourInvoices.find((inv)=>inv.quickbooks_id === qbInvoiceId);
            if (matchedInvoice) {
              const pmtAmount = Math.abs(pmt.TotalAmt);
              const pmtDate = new Date(pmt.TxnDate);
              const candidateTxn = (plaidTxns || []).find((t)=>{
                if (t.linked_invoice_id) return false;
                const txnAmount = Math.abs(parseFloat(t.amount || "0"));
                const txnDate = new Date(t.date);
                return Math.abs(txnAmount - pmtAmount) <= 0.01 && Math.abs((pmtDate.getTime() - txnDate.getTime()) / 86400000) <= 3;
              });
              if (candidateTxn) {
                const { error: allocErr } = await sc.from("transaction_job_allocations").upsert({
                  user_id: user.id,
                  transaction_id: candidateTxn.id,
                  job_id: matchedInvoice.id,
                  allocation_amount: Math.abs(parseFloat(candidateTxn.amount || "0")),
                  allocation_percentage: 100,
                  notes: `Auto-linked via QB Payment ${pmt.Id} -> QB Invoice ${qbInvoiceId}`
                }, {
                  onConflict: "transaction_id,job_id"
                });
                if (!allocErr) {
                  await sc.from("transactions").update({
                    linked_invoice_id: matchedInvoice.id
                  }).eq("id", candidateTxn.id);
                  autoLinked.push({
                    qb_payment_id: pmt.Id,
                    qb_invoice_id: qbInvoiceId,
                    mintro_invoice_id: matchedInvoice.id,
                    mintro_invoice_client: matchedInvoice.client,
                    plaid_transaction_id: candidateTxn.id,
                    amount: pmtAmount
                  });
                }
              }
            }
          }
        } catch (err) {
          results.payment.errors.push(`Payment ${pmt.Id}: ${err.message}`);
        }
      }
    } catch (err) {
      results.payment.errors.push(`Query failed: ${err.message}`);
    }
    // ITEMS
    results.items = {
      synced: 0,
      errors: []
    };
    try {
      const items = await qbQuery("Item");
      for (const item of items){
        try {
          await sc.from("quickbooks_items").upsert({
            user_id: user.id,
            quickbooks_item_id: item.Id,
            name: item.Name,
            sku: item.Sku || null,
            description: item.Description || null,
            item_type: item.Type,
            unit_price: item.UnitPrice || null,
            purchase_cost: item.PurchaseCost || null,
            qty_on_hand: item.QtyOnHand || 0,
            income_account_ref: item.IncomeAccountRef?.name || null,
            expense_account_ref: item.ExpenseAccountRef?.name || null,
            asset_account_ref: item.AssetAccountRef?.name || null,
            is_active: item.Active,
            synced_at: new Date().toISOString()
          }, {
            onConflict: "user_id,quickbooks_item_id"
          });
          results.items.synced++;
        } catch (err) {
          results.items.errors.push(`Item ${item.Id}: ${err.message}`);
        }
      }
    } catch (err) {
      results.items.errors.push(`Query failed: ${err.message}`);
    }
    // DUPLICATE DETECTION
    console.log("Running duplicate detection...");
    const duplicatesFound = [];
    const { data: allQbExp } = await sc.from("quickbooks_expenses").select("id, quickbooks_expense_id, vendor_name, total_amount, transaction_date, expense_type, potential_plaid_duplicate_id").eq("user_id", user.id);
    const { data: allPlaid } = await sc.from("transactions").select("id, amount, date, merchant_name, name, potential_qb_duplicate_id").eq("user_id", user.id);
    if (allQbExp && allPlaid) {
      for (const qb of allQbExp){
        if (qb.potential_plaid_duplicate_id) continue;
        if ([
          "deposit",
          "payment",
          "sales_receipt",
          "transfer"
        ].includes(qb.expense_type)) continue;
        const qbAmt = Math.abs(Number(qb.total_amount || 0));
        const qbDate = new Date(qb.transaction_date);
        const qbVendor = (qb.vendor_name || "").toLowerCase();
        for (const pt of allPlaid){
          if (pt.potential_qb_duplicate_id) continue;
          const plaidAmt = Math.abs(parseFloat(pt.amount || "0"));
          if (Math.abs(qbAmt - plaidAmt) > 0.01) continue;
          const plaidDate = new Date(pt.date);
          const days = Math.abs((qbDate.getTime() - plaidDate.getTime()) / 86400000);
          if (days > 3) continue;
          const pm = (pt.merchant_name || pt.name || "").toLowerCase();
          const vendorMatch = qbVendor.length > 4 && pm.length > 4 && (qbVendor.includes(pm.substring(0, 5)) || pm.includes(qbVendor.substring(0, 5)));
          const confidence = vendorMatch ? "high" : "medium";
          await sc.from("quickbooks_expenses").update({
            potential_plaid_duplicate_id: pt.id,
            duplicate_confidence: confidence,
            duplicate_status: "pending"
          }).eq("id", qb.id);
          await sc.from("transactions").update({
            potential_qb_duplicate_id: qb.id,
            duplicate_confidence: confidence,
            duplicate_status: "pending"
          }).eq("id", pt.id);
          duplicatesFound.push({
            qb_id: qb.quickbooks_expense_id,
            qb_vendor: qb.vendor_name,
            qb_amount: qbAmt,
            qb_date: qb.transaction_date,
            plaid_id: pt.id,
            plaid_merchant: pt.merchant_name || pt.name,
            plaid_amount: plaidAmt,
            plaid_date: pt.date,
            confidence,
            days_apart: Math.round(days),
            vendor_match: vendorMatch
          });
          break;
        }
      }
    }
    const totalSynced = Object.values(results).reduce((s, r)=>s + r.synced, 0);
    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${totalSynced} entities from QuickBooks`,
      results,
      auto_linked: {
        count: autoLinked.length,
        items: autoLinked,
        message: autoLinked.length > 0 ? `Auto-linked ${autoLinked.length} Plaid transaction(s) to invoices via QB Payment data.` : "No auto-links created."
      },
      duplicates: {
        count: duplicatesFound.length,
        items: duplicatesFound,
        message: duplicatesFound.length > 0 ? `Flagged ${duplicatesFound.length} potential Plaid/QB duplicate(s).` : "No duplicates detected."
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
function extractLineRefs(lines) {
  let customerRefId = null, customerRefName = null;
  let classRefId = null, classRefName = null;
  let accountRefId = null, accountRefName = null;
  if (!lines?.length) return {
    customerRefId,
    customerRefName,
    classRefId,
    classRefName,
    accountRefId,
    accountRefName
  };
  for (const line of lines){
    const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || line.DepositLineDetail;
    if (detail) {
      if (detail.CustomerRef && !customerRefId) {
        customerRefId = detail.CustomerRef.value;
        customerRefName = detail.CustomerRef.name;
      }
      if (detail.ClassRef && !classRefId) {
        classRefId = detail.ClassRef.value;
        classRefName = detail.ClassRef.name;
      }
      if (detail.AccountRef && !accountRefId) {
        accountRefId = detail.AccountRef.value;
        accountRefName = detail.AccountRef.name;
      }
    }
  }
  return {
    customerRefId,
    customerRefName,
    classRefId,
    classRefName,
    accountRefId,
    accountRefName
  };
}
async function refreshToken(refreshTkn) {
  const cid = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const cs = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${cid}:${cs}`)}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTkn
    })
  });
  if (!res.ok) return {
    success: false
  };
  const d = await res.json();
  return {
    success: true,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_in: d.expires_in
  };
}
