import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
/**
 * get-combined-profitability
 * 
 * RECOMMENDED APPROACH:
 * QuickBooks P&L (real-time) + Mintro-only invoices = Complete Picture
 * 
 * Calls QB API directly with the requested date range.
 */ serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
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
    // Parse params
    let startDate, endDate, accountingMethod;
    if (req.method === "POST") {
      const body = await req.json().catch(()=>({}));
      startDate = body.start_date;
      endDate = body.end_date;
      accountingMethod = body.accounting_method || "Accrual";
    } else {
      const url = new URL(req.url);
      startDate = url.searchParams.get("start_date") || "";
      endDate = url.searchParams.get("end_date") || "";
      accountingMethod = url.searchParams.get("accounting_method") || "Accrual";
    }
    const now = new Date();
    if (!startDate) startDate = `${now.getFullYear()}-01-01`;
    if (!endDate) endDate = now.toISOString().split('T')[0];
    // ========== 1. GET QUICKBOOKS P&L (REAL-TIME) ==========
    let qbPnl = {
      total_income: 0,
      total_cogs: 0,
      gross_profit: 0,
      total_expenses: 0,
      net_operating_income: 0,
      net_income: 0,
      income_breakdown: [],
      expense_breakdown: []
    };
    let qbConnected = false;
    let qbCompanyName = null;
    // Get QuickBooks connection
    const { data: qbAuth } = await supabaseClient.from("quickbooks_connections").select("id, access_token, refresh_token, realm_id, token_expires_at, company_name").eq("user_id", user.id).eq("status", "active").single();
    if (qbAuth) {
      qbConnected = true;
      qbCompanyName = qbAuth.company_name;
      // Check token expiration and refresh if needed
      let accessToken = qbAuth.access_token;
      const expiresAt = new Date(qbAuth.token_expires_at);
      if (expiresAt <= new Date()) {
        const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
        if (refreshResult.success) {
          accessToken = refreshResult.access_token;
          await supabaseClient.from("quickbooks_connections").update({
            access_token: refreshResult.access_token,
            refresh_token: refreshResult.refresh_token,
            token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString()
          }).eq("id", qbAuth.id);
        }
      }
      // Call QuickBooks P&L API
      const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
      const pnlUrl = `${baseUrl}/v3/company/${qbAuth.realm_id}/reports/ProfitAndLoss?` + `start_date=${startDate}&end_date=${endDate}&accounting_method=${accountingMethod}`;
      try {
        const pnlResponse = await fetch(pnlUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });
        if (pnlResponse.ok) {
          const pnlData = await pnlResponse.json();
          const parsed = parsePnLReport(pnlData);
          qbPnl = {
            total_income: parsed.totalIncome,
            total_cogs: parsed.totalCOGS,
            gross_profit: parsed.grossProfit,
            total_expenses: parsed.totalExpenses,
            net_operating_income: parsed.netOperatingIncome,
            net_income: parsed.netIncome,
            income_breakdown: parsed.incomeBreakdown,
            expense_breakdown: parsed.expenseBreakdown
          };
        }
      } catch (e) {
        console.error("Error fetching QB P&L:", e);
      }
    }
    // ========== 2. GET MINTRO-ONLY INVOICES ==========
    const { data: mintroInvoices } = await supabaseClient.from("invoices").select("id, amount, total_actual_cost, client, invoice_date, invoice_number").eq("user_id", user.id).is("quickbooks_id", null).gte("invoice_date", startDate).lte("invoice_date", endDate);
    const mintroRevenue = mintroInvoices?.reduce((sum, inv)=>sum + Number(inv.amount || 0), 0) || 0;
    const mintroCost = mintroInvoices?.reduce((sum, inv)=>sum + Number(inv.total_actual_cost || 0), 0) || 0;
    const mintroProfit = mintroRevenue - mintroCost;
    // ========== 3. COMBINE TOTALS ==========
    const totalIncome = qbPnl.total_income + mintroRevenue;
    const totalCogs = qbPnl.total_cogs + mintroCost;
    const totalGrossProfit = totalIncome - totalCogs;
    const totalExpenses = qbPnl.total_expenses;
    const totalNetIncome = totalGrossProfit - totalExpenses;
    const profitMargin = totalIncome > 0 ? totalNetIncome / totalIncome * 100 : 0;
    return new Response(JSON.stringify({
      success: true,
      source: "combined_realtime",
      period: {
        start_date: startDate,
        end_date: endDate,
        accounting_method: accountingMethod
      },
      // ===== COMBINED TOTALS (USE THESE) =====
      profitability: {
        total_income: round(totalIncome),
        cost_of_goods_sold: round(totalCogs),
        gross_profit: round(totalGrossProfit),
        operating_expenses: round(totalExpenses),
        net_income: round(totalNetIncome),
        profit_margin: round(profitMargin)
      },
      // ===== BREAKDOWN BY SOURCE =====
      sources: {
        quickbooks: {
          connected: qbConnected,
          company_name: qbCompanyName,
          income: round(qbPnl.total_income),
          cogs: round(qbPnl.total_cogs),
          gross_profit: round(qbPnl.gross_profit),
          expenses: round(qbPnl.total_expenses),
          net_income: round(qbPnl.net_income),
          income_breakdown: qbPnl.income_breakdown,
          expense_breakdown: qbPnl.expense_breakdown
        },
        mintro_only: {
          invoice_count: mintroInvoices?.length || 0,
          revenue: round(mintroRevenue),
          cost: round(mintroCost),
          profit: round(mintroProfit),
          invoices: mintroInvoices?.map((inv)=>({
              id: inv.id,
              invoice_number: inv.invoice_number,
              client: inv.client,
              amount: Number(inv.amount),
              cost: Number(inv.total_actual_cost || 0),
              date: inv.invoice_date
            })) || []
        }
      },
      fetched_at: new Date().toISOString(),
      note: qbConnected ? "Real-time QB P&L + Mintro-only invoices" : "Mintro invoices only (QuickBooks not connected)"
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
function round(num) {
  return Math.round(num * 100) / 100;
}
/**
 * Parse QuickBooks P&L Report structure
 */ function parsePnLReport(report) {
  const result = {
    totalIncome: 0,
    totalCOGS: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netOperatingIncome: 0,
    netIncome: 0,
    incomeBreakdown: [],
    expenseBreakdown: []
  };
  if (!report?.Rows?.Row) return result;
  for (const section of report.Rows.Row){
    const sectionName = section.Header?.ColData?.[0]?.value || section.group || "";
    const sectionNameLower = sectionName.toLowerCase();
    if (section.type === "Section" && section.Summary) {
      const summaryValue = parseFloat(section.Summary.ColData?.[1]?.value || 0);
      if (sectionNameLower.includes("income") && !sectionNameLower.includes("net") && !sectionNameLower.includes("other")) {
        result.totalIncome = summaryValue;
        result.incomeBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (sectionNameLower.includes("cogs") || sectionNameLower.includes("cost of goods")) {
        result.totalCOGS = summaryValue;
      } else if (sectionNameLower.includes("gross profit")) {
        result.grossProfit = summaryValue;
      } else if (sectionNameLower.includes("expense") && !sectionNameLower.includes("other")) {
        result.totalExpenses = summaryValue;
        result.expenseBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (sectionNameLower.includes("net operating income")) {
        result.netOperatingIncome = summaryValue;
      } else if (sectionNameLower.includes("net income")) {
        result.netIncome = summaryValue;
      }
    }
    if (section.group) {
      const groupName = section.group.toLowerCase();
      if (groupName === "income") {
        result.totalIncome = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
        result.incomeBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (groupName === "cogs") {
        result.totalCOGS = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
      } else if (groupName === "expenses") {
        result.totalExpenses = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
        result.expenseBreakdown = extractLineItems(section.Rows?.Row || []);
      }
    }
  }
  if (result.grossProfit === 0 && result.totalIncome > 0) {
    result.grossProfit = result.totalIncome - result.totalCOGS;
  }
  if (result.netOperatingIncome === 0) {
    result.netOperatingIncome = result.grossProfit - result.totalExpenses;
  }
  if (result.netIncome === 0) {
    result.netIncome = result.netOperatingIncome;
  }
  return result;
}
function extractLineItems(rows) {
  const items = [];
  for (const row of rows){
    if (row.type === "Data" && row.ColData) {
      const name = row.ColData[0]?.value || "";
      const amount = parseFloat(row.ColData[1]?.value || 0);
      if (name && amount !== 0) items.push({
        name,
        amount
      });
    } else if (row.Rows?.Row) {
      items.push(...extractLineItems(row.Rows.Row));
    }
  }
  return items;
}
async function refreshAccessToken(refreshToken) {
  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  if (!response.ok) return {
    success: false
  };
  const data = await response.json();
  return {
    success: true,
    ...data
  };
}
