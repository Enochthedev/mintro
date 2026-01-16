import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";

const QUICKBOOKS_API_BASE_URL =
    QUICKBOOKS_ENVIRONMENT === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * quickbooks-sync-chart-of-accounts
 * 
 * Syncs the Chart of Accounts from QuickBooks to enable proper expense classification.
 * This should be called after connecting to QuickBooks and periodically to stay updated.
 * 
 * Account Type Classification:
 * - Expense, Cost of Goods Sold, Other Expense → Real expenses (count as costs)
 * - Income, Other Income → Revenue
 * - Bank, Credit Card, Loan, Equity → Non-P&L (exclude from expense calculations)
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

        const {
            data: { user },
            error: userError,
        } = await supabaseClient.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Get QuickBooks connection
        const { data: connection, error: connectionError } = await supabaseClient
            .from("quickbooks_connections")
            .select("*")
            .eq("user_id", user.id)
            .eq("status", "active")
            .single();

        if (connectionError || !connection) {
            return new Response(
                JSON.stringify({ error: "No active QuickBooks connection found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Fetch Chart of Accounts from QuickBooks
        const accountsUrl = `${QUICKBOOKS_API_BASE_URL}/v3/company/${connection.realm_id}/query?query=SELECT * FROM Account MAXRESULTS 1000`;

        console.log("Fetching Chart of Accounts from QuickBooks...");

        const accountsResponse = await fetch(accountsUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${connection.access_token}`,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
        });

        const accountsData = await accountsResponse.json();

        if (!accountsResponse.ok) {
            const errorMsg = accountsData.Fault?.Error?.[0]?.Message || "Failed to fetch accounts";
            console.log("QB API Error:", errorMsg);
            return new Response(
                JSON.stringify({ error: errorMsg, qb_response: accountsData }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const qbAccounts = accountsData.QueryResponse?.Account || [];
        console.log("Found", qbAccounts.length, "accounts from QuickBooks");

        // Classify and upsert accounts
        let syncedCount = 0;
        const errors: any[] = [];

        for (const account of qbAccounts) {
            try {
                // Determine Mintro category based on AccountType
                let mintroCategory = "other";
                const accountType = account.AccountType || "";

                if (["Expense", "Other Expense"].includes(accountType)) {
                    mintroCategory = "expense";
                } else if (accountType === "Cost of Goods Sold") {
                    mintroCategory = "cogs";
                } else if (["Income", "Other Income"].includes(accountType)) {
                    mintroCategory = "revenue";
                } else if (["Bank", "Credit Card"].includes(accountType)) {
                    mintroCategory = "transfer";
                } else if (["Loan", "Equity", "Long Term Liability"].includes(accountType)) {
                    mintroCategory = "exclude";
                } else if (["Accounts Receivable", "Accounts Payable", "Other Current Asset", "Other Current Liability", "Fixed Asset", "Other Asset"].includes(accountType)) {
                    mintroCategory = "exclude";
                }

                const accountData = {
                    user_id: user.id,
                    quickbooks_account_id: account.Id,
                    name: account.Name || account.FullyQualifiedName || "Unknown",
                    account_type: accountType,
                    account_sub_type: account.AccountSubType || null,
                    classification: account.Classification || null,
                    mintro_category: mintroCategory,
                    is_active: account.Active !== false,
                    synced_at: new Date().toISOString(),
                };

                // Upsert (insert or update)
                const { error: upsertError } = await supabaseClient
                    .from("quickbooks_chart_of_accounts")
                    .upsert(accountData, {
                        onConflict: "user_id,quickbooks_account_id",
                        ignoreDuplicates: false
                    });

                if (upsertError) {
                    console.log("Error upserting account:", account.Id, upsertError);
                    errors.push({ account_id: account.Id, name: account.Name, error: upsertError.message });
                } else {
                    syncedCount++;
                }
            } catch (accountError: any) {
                errors.push({ account_id: account.Id, error: accountError.message });
            }
        }

        // Summary by category
        const { data: allAccounts } = await supabaseClient
            .from("quickbooks_chart_of_accounts")
            .select("mintro_category, account_type, name")
            .eq("user_id", user.id);

        const categoryBreakdown: { [key: string]: number } = {};
        const accountTypesFound: { [key: string]: number } = {};
        const excludedFromCosts: {
            bank_accounts: string[];
            credit_cards: string[];
            loans: string[];
            equity: string[];
        } = {
            bank_accounts: [],
            credit_cards: [],
            loans: [],
            equity: [],
        };

        (allAccounts || []).forEach((acc: { mintro_category: string; account_type: string; name: string }) => {
            // Category breakdown
            categoryBreakdown[acc.mintro_category] = (categoryBreakdown[acc.mintro_category] || 0) + 1;

            // Account types found
            accountTypesFound[acc.account_type] = (accountTypesFound[acc.account_type] || 0) + 1;

            // Track excluded accounts for potential Plaid mapping
            if (acc.account_type === "Bank") {
                excludedFromCosts.bank_accounts.push(acc.name);
            } else if (acc.account_type === "Credit Card") {
                excludedFromCosts.credit_cards.push(acc.name);
            } else if (acc.account_type === "Loan" || acc.account_type === "Long Term Liability") {
                excludedFromCosts.loans.push(acc.name);
            } else if (acc.account_type === "Equity") {
                excludedFromCosts.equity.push(acc.name);
            }
        });

        return new Response(
            JSON.stringify({
                success: true,
                message: `Synced ${syncedCount} accounts from QuickBooks`,
                synced: syncedCount,
                errors: errors.length > 0 ? errors : undefined,
                category_breakdown: {
                    expense: categoryBreakdown.expense || 0,
                    cogs: categoryBreakdown.cogs || 0,
                    revenue: categoryBreakdown.revenue || 0,
                    transfer: categoryBreakdown.transfer || 0,
                    exclude: categoryBreakdown.exclude || 0,
                    other: categoryBreakdown.other || 0,
                },
                account_types_found: accountTypesFound,
                excluded_from_costs: excludedFromCosts,
                usage_tip: "Bank/CC accounts can be mapped to connected Plaid accounts. Use excluded_from_costs to identify potential matches.",
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error: any) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
