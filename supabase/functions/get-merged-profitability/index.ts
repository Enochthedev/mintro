import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
/**
 * get-merged-profitability
 * 
 * Returns BOTH QuickBooks official P&L (real-time) AND Mintro's calculated profitability
 * so users can see both numbers and understand any discrepancies.
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
    // ========== 1. GET QUICKBOOKS OFFICIAL P&L (REAL-TIME) ==========
    let quickbooksPnl = {
      total_income: 0,
      cogs: 0,
      gross_profit: 0,
      total_expenses: 0,
      net_income: 0,
      connected: false,
      company_name: null
    };
    const { data: qbAuth } = await supabaseClient.from("quickbooks_connections").select("id, access_token, refresh_token, realm_id, token_expires_at, company_name").eq("user_id", user.id).eq("status", "active").single();
    if (qbAuth) {
      quickbooksPnl.connected = true;
      quickbooksPnl.company_name = qbAuth.company_name;
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
          quickbooksPnl.total_income = parsed.totalIncome;
          quickbooksPnl.cogs = parsed.totalCOGS;
          quickbooksPnl.gross_profit = parsed.grossProfit;
          quickbooksPnl.total_expenses = parsed.totalExpenses;
          quickbooksPnl.net_income = parsed.netIncome;
        }
      } catch (e) {
        console.error("Error fetching QB P&L:", e);
      }
    }
    // ========== 2. GET MINTRO CALCULATED PROFITABILITY ==========
    const { data: allInvoices } = await supabaseClient.from("invoices").select(`
        id, amount, total_actual_cost, cost_data_source,
        quickbooks_id, source, invoice_date
      `).eq("user_id", user.id).gte("invoice_date", startDate).lte("invoice_date", endDate);
    const qbInvoices = allInvoices?.filter((inv)=>inv.quickbooks_id) || [];
    const mintroOnlyInvoices = allInvoices?.filter((inv)=>!inv.quickbooks_id) || [];
    const mintroQbRevenue = qbInvoices.reduce((sum, inv)=>sum + Number(inv.amount || 0), 0);
    const mintroQbCost = qbInvoices.reduce((sum, inv)=>sum + Number(inv.total_actual_cost || 0), 0);
    const mintroQbProfit = mintroQbRevenue - mintroQbCost;
    const mintroOnlyRevenue = mintroOnlyInvoices.reduce((sum, inv)=>sum + Number(inv.amount || 0), 0);
    const mintroOnlyCost = mintroOnlyInvoices.reduce((sum, inv)=>sum + Number(inv.total_actual_cost || 0), 0);
    const mintroOnlyProfit = mintroOnlyRevenue - mintroOnlyCost;
    const invoicesWithRealCost = qbInvoices.filter((inv)=>inv.cost_data_source === 'qb_item_cost').length;
    const dataQualityPercent = qbInvoices.length > 0 ? Math.round(invoicesWithRealCost / qbInvoices.length * 100) : 0;
    // ========== 3. GET EXPENSES FROM QUICKBOOKS ==========
    const { data: qbExpenses } = await supabaseClient.from("quickbooks_expenses").select("total_amount, expense_type").eq("user_id", user.id).gte("transaction_date", startDate).lte("transaction_date", endDate);
    const totalQbExpenses = qbExpenses?.reduce((sum, exp)=>sum + Number(exp.total_amount || 0), 0) || 0;
    // ========== 4. BUILD COMPARISON ==========
    const mintroPnl = {
      total_income: mintroQbRevenue + mintroOnlyRevenue,
      cogs: mintroQbCost + mintroOnlyCost,
      gross_profit: mintroQbRevenue + mintroOnlyRevenue - (mintroQbCost + mintroOnlyCost),
      total_expenses: totalQbExpenses,
      net_income: mintroQbRevenue + mintroOnlyRevenue - (mintroQbCost + mintroOnlyCost) - totalQbExpenses
    };
    const cogsDiscrepancy = quickbooksPnl.cogs - mintroPnl.cogs;
    let recommendation;
    let recommendedSource;
    if (Math.abs(cogsDiscrepancy) < 100 && dataQualityPercent > 80) {
      recommendation = "Your QuickBooks data is well-maintained. Both numbers are reliable.";
      recommendedSource = 'quickbooks';
    } else if (dataQualityPercent > 50) {
      recommendation = "Mintro's calculation uses actual item costs and may be more accurate for job-level profitability.";
      recommendedSource = 'mintro';
    } else {
      recommendation = "Consider adding PurchaseCost to your QuickBooks Items for more accurate profit tracking.";
      recommendedSource = 'mintro';
    }
    return new Response(JSON.stringify({
      success: true,
      source: "merged_comparison_realtime",
      period: {
        start_date: startDate,
        end_date: endDate,
        accounting_method: accountingMethod
      },
      comparison: {
        quickbooks_official: {
          connected: quickbooksPnl.connected,
          company_name: quickbooksPnl.company_name,
          total_income: round(quickbooksPnl.total_income),
          cogs: round(quickbooksPnl.cogs),
          gross_profit: round(quickbooksPnl.gross_profit),
          total_expenses: round(quickbooksPnl.total_expenses),
          net_income: round(quickbooksPnl.net_income),
          source: "QuickBooks P&L Report (real-time)",
          description: "Official accounting numbers from QuickBooks"
        },
        mintro_calculated: {
          total_income: round(mintroPnl.total_income),
          cogs: round(mintroPnl.cogs),
          gross_profit: round(mintroPnl.gross_profit),
          total_expenses: round(mintroPnl.total_expenses),
          net_income: round(mintroPnl.net_income),
          source: "Mintro (Item.PurchaseCost × Qty)",
          description: "Calculated from actual item costs per invoice"
        },
        discrepancy: {
          cogs: round(cogsDiscrepancy),
          note: cogsDiscrepancy !== 0 ? `COGS differs by $${Math.abs(cogsDiscrepancy).toFixed(2)} - QB COGS = what's posted to COGS accounts, Mintro = Item.PurchaseCost × Qty` : "Numbers match!"
        }
      },
      recommendation: {
        use: recommendedSource,
        reason: recommendation,
        data_quality: {
          invoices_with_real_cost: invoicesWithRealCost,
          total_qb_invoices: qbInvoices.length,
          percentage: dataQualityPercent,
          rating: dataQualityPercent >= 80 ? 'excellent' : dataQualityPercent >= 50 ? 'good' : dataQualityPercent >= 25 ? 'fair' : 'needs_improvement'
        }
      },
      breakdown: {
        qb_invoices: {
          count: qbInvoices.length,
          revenue: round(mintroQbRevenue),
          cost: round(mintroQbCost),
          profit: round(mintroQbProfit)
        },
        mintro_only_invoices: {
          count: mintroOnlyInvoices.length,
          revenue: round(mintroOnlyRevenue),
          cost: round(mintroOnlyCost),
          profit: round(mintroOnlyProfit)
        }
      },
      fetched_at: new Date().toISOString()
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
function parsePnLReport(report) {
  const result = {
    totalIncome: 0,
    totalCOGS: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netIncome: 0
  };
  if (!report?.Rows?.Row) return result;
  for (const section of report.Rows.Row){
    const sectionName = section.Header?.ColData?.[0]?.value || section.group || "";
    const sectionNameLower = sectionName.toLowerCase();
    if (section.type === "Section" && section.Summary) {
      const summaryValue = parseFloat(section.Summary.ColData?.[1]?.value || 0);
      if (sectionNameLower.includes("income") && !sectionNameLower.includes("net") && !sectionNameLower.includes("other")) {
        result.totalIncome = summaryValue;
      } else if (sectionNameLower.includes("cogs") || sectionNameLower.includes("cost of goods")) {
        result.totalCOGS = summaryValue;
      } else if (sectionNameLower.includes("gross profit")) {
        result.grossProfit = summaryValue;
      } else if (sectionNameLower.includes("expense") && !sectionNameLower.includes("other")) {
        result.totalExpenses = summaryValue;
      } else if (sectionNameLower.includes("net income")) {
        result.netIncome = summaryValue;
      }
    }
    if (section.group) {
      const groupName = section.group.toLowerCase();
      if (groupName === "income") {
        result.totalIncome = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
      } else if (groupName === "cogs") {
        result.totalCOGS = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
      } else if (groupName === "expenses") {
        result.totalExpenses = parseFloat(section.Summary?.ColData?.[1]?.value || 0);
      }
    }
  }
  if (result.grossProfit === 0 && result.totalIncome > 0) {
    result.grossProfit = result.totalIncome - result.totalCOGS;
  }
  if (result.netIncome === 0) {
    result.netIncome = result.grossProfit - result.totalExpenses;
  }
  return result;
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
