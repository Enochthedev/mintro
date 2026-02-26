import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
/**
 * get-quickbooks-profitability
 * 
 * Returns REAL-TIME QuickBooks P&L for the requested date range.
 * Calls QuickBooks API directly with the dates you specify.
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
    // Parse params from URL or body
    const url = new URL(req.url);
    let startDate = url.searchParams.get("start_date") || "";
    let endDate = url.searchParams.get("end_date") || "";
    let accountingMethod = url.searchParams.get("accounting_method") || "Accrual";
    if (req.method === "POST") {
      const body = await req.json().catch(()=>({}));
      if (body.start_date) startDate = body.start_date;
      if (body.end_date) endDate = body.end_date;
      if (body.accounting_method) accountingMethod = body.accounting_method;
    }
    // Default to current year
    const now = new Date();
    if (!startDate) startDate = `${now.getFullYear()}-01-01`;
    if (!endDate) endDate = now.toISOString().split('T')[0];
    // Get QuickBooks tokens
    const { data: qbAuth, error: qbAuthError } = await supabaseClient.from("quickbooks_connections").select("id, access_token, refresh_token, realm_id, token_expires_at").eq("user_id", user.id).eq("status", "active").single();
    if (qbAuthError || !qbAuth) {
      return new Response(JSON.stringify({
        error: "QuickBooks not connected",
        hint: "Connect QuickBooks first using quickbooks-auth-url"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Check token expiration and refresh if needed
    let accessToken = qbAuth.access_token;
    const expiresAt = new Date(qbAuth.token_expires_at);
    if (expiresAt <= new Date()) {
      const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
      if (!refreshResult.success) {
        return new Response(JSON.stringify({
          error: "Failed to refresh QuickBooks token. Please reconnect."
        }), {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      accessToken = refreshResult.access_token;
      await supabaseClient.from("quickbooks_connections").update({
        access_token: refreshResult.access_token,
        refresh_token: refreshResult.refresh_token,
        token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString()
      }).eq("id", qbAuth.id);
    }
    const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
    // Fetch P&L Report from QuickBooks with the requested dates
    const pnlUrl = `${baseUrl}/v3/company/${qbAuth.realm_id}/reports/ProfitAndLoss?` + `start_date=${startDate}&end_date=${endDate}&accounting_method=${accountingMethod}`;
    console.log(`Fetching QB P&L: ${startDate} to ${endDate}`);
    const pnlResponse = await fetch(pnlUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    if (!pnlResponse.ok) {
      const errorText = await pnlResponse.text();
      console.error("QB P&L error:", errorText);
      return new Response(JSON.stringify({
        error: "Failed to fetch P&L from QuickBooks",
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const pnlData = await pnlResponse.json();
    const parsed = parsePnLReport(pnlData);
    // Calculate margins
    const grossMargin = parsed.totalIncome > 0 ? Math.round(parsed.grossProfit / parsed.totalIncome * 10000) / 100 : 0;
    const netMargin = parsed.totalIncome > 0 ? Math.round(parsed.netIncome / parsed.totalIncome * 10000) / 100 : 0;
    return new Response(JSON.stringify({
      success: true,
      source: "quickbooks_pnl_realtime",
      period: {
        start_date: startDate,
        end_date: endDate,
        accounting_method: accountingMethod
      },
      pnl: {
        total_income: parsed.totalIncome,
        total_cogs: parsed.totalCOGS,
        gross_profit: parsed.grossProfit,
        total_expenses: parsed.totalExpenses,
        net_operating_income: parsed.netOperatingIncome,
        net_income: parsed.netIncome
      },
      metrics: {
        gross_margin: grossMargin,
        net_margin: netMargin
      },
      breakdown: {
        income: parsed.incomeBreakdown,
        cogs: parsed.cogsBreakdown,
        expenses: parsed.expenseBreakdown
      },
      fetched_at: new Date().toISOString(),
      note: "Real-time data from QuickBooks API"
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
    cogsBreakdown: [],
    expenseBreakdown: []
  };
  if (!report?.Rows?.Row) {
    return result;
  }
  for (const section of report.Rows.Row){
    const sectionName = section.Header?.ColData?.[0]?.value || section.group || "";
    if (section.type === "Section" && section.Summary) {
      const summaryValue = parseFloat(section.Summary.ColData?.[1]?.value || 0);
      if (sectionName.toLowerCase().includes("income") && !sectionName.toLowerCase().includes("net") && !sectionName.toLowerCase().includes("other")) {
        result.totalIncome = summaryValue;
        result.incomeBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (sectionName.toLowerCase().includes("cogs") || sectionName.toLowerCase().includes("cost of goods")) {
        result.totalCOGS = summaryValue;
        result.cogsBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (sectionName.toLowerCase().includes("gross profit")) {
        result.grossProfit = summaryValue;
      } else if (sectionName.toLowerCase().includes("expense") && !sectionName.toLowerCase().includes("other")) {
        result.totalExpenses = summaryValue;
        result.expenseBreakdown = extractLineItems(section.Rows?.Row || []);
      } else if (sectionName.toLowerCase().includes("net operating income")) {
        result.netOperatingIncome = summaryValue;
      } else if (sectionName.toLowerCase().includes("net income")) {
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
        result.cogsBreakdown = extractLineItems(section.Rows?.Row || []);
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
      if (name && amount !== 0) {
        items.push({
          name,
          amount
        });
      }
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
