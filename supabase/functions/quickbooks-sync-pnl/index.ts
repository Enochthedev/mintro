import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * quickbooks-sync-pnl
 * 
 * Syncs the Profit & Loss report from QuickBooks.
 * This gives us the ACTUAL P&L from QuickBooks which we can then
 * merge with Mintro's own calculated P&L (for non-QB invoices).
 * 
 * Usage:
 *   POST /functions/v1/quickbooks-sync-pnl
 *   Body: { start_date?: string, end_date?: string, accounting_method?: "Accrual" | "Cash" }
 */

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
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body = await req.json().catch(() => ({}));
        
        // Default to current year
        const now = new Date();
        const startDate = body.start_date || `${now.getFullYear()}-01-01`;
        const endDate = body.end_date || now.toISOString().split('T')[0];
        const accountingMethod = body.accounting_method || "Accrual";

        // Get QuickBooks tokens from quickbooks_connections
        const { data: qbAuth, error: qbAuthError } = await supabaseClient
            .from("quickbooks_connections")
            .select("id, access_token, refresh_token, realm_id, token_expires_at")
            .eq("user_id", user.id)
            .eq("status", "active")
            .single();

        if (qbAuthError || !qbAuth) {
            console.error("QB connection error:", qbAuthError);
            console.log("User ID:", user.id);
            return new Response(
                JSON.stringify({ 
                    error: "QuickBooks not connected",
                    details: qbAuthError?.message || "No active connection found",
                    user_id: user.id
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
        
        console.log("Found QB connection:", qbAuth.id, "realm:", qbAuth.realm_id);

        // Check token expiration and refresh if needed
        let accessToken = qbAuth.access_token;
        const expiresAt = new Date(qbAuth.token_expires_at);

        if (expiresAt <= new Date()) {
            const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
            if (!refreshResult.success) {
                return new Response(
                    JSON.stringify({ error: "Failed to refresh QuickBooks token" }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            accessToken = refreshResult.access_token;

            await supabaseClient
                .from("quickbooks_connections")
                .update({
                    access_token: refreshResult.access_token,
                    refresh_token: refreshResult.refresh_token,
                    token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
                })
                .eq("id", qbAuth.id);
        }

        const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox"
            ? "https://sandbox-quickbooks.api.intuit.com"
            : "https://quickbooks.api.intuit.com";

        // Fetch P&L Report from QuickBooks
        // https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/profitandloss
        const pnlUrl = `${baseUrl}/v3/company/${qbAuth.realm_id}/reports/ProfitAndLoss?` +
            `start_date=${startDate}&end_date=${endDate}&accounting_method=${accountingMethod}`;

        console.log(`Fetching QB P&L: ${startDate} to ${endDate}`);

        const pnlResponse = await fetch(pnlUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
            },
        });

        if (!pnlResponse.ok) {
            const errorText = await pnlResponse.text();
            console.error("QB P&L error:", errorText);
            return new Response(
                JSON.stringify({ error: "Failed to fetch P&L from QuickBooks", details: errorText }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const pnlData = await pnlResponse.json();

        // Parse the P&L report structure
        // QB reports have a complex nested structure with Rows/Columns
        const parsed = parsePnLReport(pnlData);

        // Store in database
        const { data: savedReport, error: saveError } = await supabaseClient
            .from("quickbooks_pnl_reports")
            .upsert({
                user_id: user.id,
                start_date: startDate,
                end_date: endDate,
                report_basis: accountingMethod,
                total_income: parsed.totalIncome,
                total_cost_of_goods_sold: parsed.totalCOGS,
                gross_profit: parsed.grossProfit,
                total_expenses: parsed.totalExpenses,
                net_operating_income: parsed.netOperatingIncome,
                net_income: parsed.netIncome,
                income_breakdown: parsed.incomeBreakdown,
                cogs_breakdown: parsed.cogsBreakdown,
                expense_breakdown: parsed.expenseBreakdown,
                raw_report_data: pnlData,
                synced_at: new Date().toISOString(),
            }, {
                onConflict: "user_id,start_date,end_date,report_basis"
            })
            .select()
            .single();

        if (saveError) {
            console.error("Error saving P&L:", saveError);
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Synced QuickBooks P&L for ${startDate} to ${endDate}`,
                period: { start_date: startDate, end_date: endDate },
                quickbooks_pnl: {
                    total_income: parsed.totalIncome,
                    total_cost_of_goods_sold: parsed.totalCOGS,
                    gross_profit: parsed.grossProfit,
                    total_expenses: parsed.totalExpenses,
                    net_operating_income: parsed.netOperatingIncome,
                    net_income: parsed.netIncome,
                },
                breakdown: {
                    income: parsed.incomeBreakdown,
                    cogs: parsed.cogsBreakdown,
                    expenses: parsed.expenseBreakdown,
                },
                report_id: savedReport?.id,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});

/**
 * Parse QuickBooks P&L Report structure
 * QB reports have nested Rows with ColData arrays
 */
function parsePnLReport(report: any): {
    totalIncome: number;
    totalCOGS: number;
    grossProfit: number;
    totalExpenses: number;
    netOperatingIncome: number;
    netIncome: number;
    incomeBreakdown: any[];
    cogsBreakdown: any[];
    expenseBreakdown: any[];
} {
    const result = {
        totalIncome: 0,
        totalCOGS: 0,
        grossProfit: 0,
        totalExpenses: 0,
        netOperatingIncome: 0,
        netIncome: 0,
        incomeBreakdown: [] as any[],
        cogsBreakdown: [] as any[],
        expenseBreakdown: [] as any[],
    };

    if (!report?.Rows?.Row) {
        return result;
    }

    // QB P&L structure:
    // - Income section (group = "Income")
    // - COGS section (group = "COGS")  
    // - Gross Profit (type = "Section", "Gross Profit")
    // - Expenses section (group = "Expenses")
    // - Net Operating Income
    // - Other Income/Expenses
    // - Net Income

    for (const section of report.Rows.Row) {
        const sectionName = section.Header?.ColData?.[0]?.value || section.group || "";
        
        if (section.type === "Section" && section.Summary) {
            const summaryValue = parseFloat(section.Summary.ColData?.[1]?.value || 0);
            
            if (sectionName.toLowerCase().includes("income") && !sectionName.toLowerCase().includes("net")) {
                result.totalIncome = summaryValue;
                result.incomeBreakdown = extractLineItems(section.Rows?.Row || []);
            } else if (sectionName.toLowerCase().includes("cogs") || sectionName.toLowerCase().includes("cost of goods")) {
                result.totalCOGS = summaryValue;
                result.cogsBreakdown = extractLineItems(section.Rows?.Row || []);
            } else if (sectionName.toLowerCase().includes("gross profit")) {
                result.grossProfit = summaryValue;
            } else if (sectionName.toLowerCase().includes("expense")) {
                result.totalExpenses = summaryValue;
                result.expenseBreakdown = extractLineItems(section.Rows?.Row || []);
            } else if (sectionName.toLowerCase().includes("net operating income")) {
                result.netOperatingIncome = summaryValue;
            } else if (sectionName.toLowerCase().includes("net income")) {
                result.netIncome = summaryValue;
            }
        }

        // Handle "group" type sections
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

    // Calculate derived values if not found
    if (result.grossProfit === 0 && result.totalIncome > 0) {
        result.grossProfit = result.totalIncome - result.totalCOGS;
    }
    if (result.netOperatingIncome === 0) {
        result.netOperatingIncome = result.grossProfit - result.totalExpenses;
    }
    if (result.netIncome === 0) {
        result.netIncome = result.netOperatingIncome; // Simplified, ignoring other income/expenses
    }

    return result;
}

/**
 * Extract line items from a section's rows
 */
function extractLineItems(rows: any[]): any[] {
    const items: any[] = [];
    
    for (const row of rows) {
        if (row.type === "Data" && row.ColData) {
            const name = row.ColData[0]?.value || "";
            const amount = parseFloat(row.ColData[1]?.value || 0);
            if (name && amount !== 0) {
                items.push({ name, amount });
            }
        } else if (row.Rows?.Row) {
            // Nested section - recurse
            items.push(...extractLineItems(row.Rows.Row));
        }
    }
    
    return items;
}

/**
 * Refresh QB access token
 */
async function refreshAccessToken(refreshToken: string): Promise<any> {
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");

    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });

    if (!response.ok) return { success: false };
    const data = await response.json();
    return { success: true, ...data };
}
