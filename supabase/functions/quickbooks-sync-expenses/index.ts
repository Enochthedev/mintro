import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * quickbooks-sync-expenses
 * 
 * Syncs ACTUAL COSTS from QuickBooks:
 * - Purchase entities (expenses, checks, CC charges)
 * - Bill entities (vendor bills/accounts payable)
 * - Item entities (products with PurchaseCost)
 * 
 * These represent what YOU PAID (costs), not what customers paid (revenue).
 * Use the customer_ref_id to link expenses to specific invoices/jobs.
 */

interface QBExpense {
    Id: string;
    TotalAmt: number;
    CurrencyRef?: { value: string };
    PaymentType?: string;
    EntityRef?: { value: string; name: string };
    TxnDate: string;
    DueDate?: string;
    PrivateNote?: string;
    Line?: any[];
}

interface QBItem {
    Id: string;
    Name: string;
    Sku?: string;
    Description?: string;
    Type: string;
    UnitPrice?: number;
    PurchaseCost?: number;
    QtyOnHand?: number;
    Active: boolean;
    IncomeAccountRef?: { value: string; name: string };
    ExpenseAccountRef?: { value: string; name: string };
    AssetAccountRef?: { value: string; name: string };
}

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

        // Get QuickBooks tokens from quickbooks_connections
        const { data: qbAuth, error: qbAuthError } = await supabaseClient
            .from("quickbooks_connections")
            .select("access_token, refresh_token, realm_id, token_expires_at")
            .eq("user_id", user.id)
            .eq("status", "active")
            .single();

        if (qbAuthError || !qbAuth) {
            return new Response(
                JSON.stringify({ error: "QuickBooks not connected. Please connect your QuickBooks account first." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check token expiration and refresh if needed
        let accessToken = qbAuth.access_token;
        const expiresAt = new Date(qbAuth.token_expires_at);

        if (expiresAt <= new Date()) {
            console.log("Token expired, refreshing...");
            const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
            if (!refreshResult.success) {
                return new Response(
                    JSON.stringify({ error: "Failed to refresh QuickBooks token. Please reconnect." }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            accessToken = refreshResult.access_token;

            // Update stored tokens
            await supabaseClient
                .from("quickbooks_connections")
                .update({
                    access_token: refreshResult.access_token,
                    refresh_token: refreshResult.refresh_token,
                    token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
                })
                .eq("user_id", user.id)
                .eq("status", "active");
        }

        const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox"
            ? "https://sandbox-quickbooks.api.intuit.com"
            : "https://quickbooks.api.intuit.com";

        const results = {
            purchases: { synced: 0, errors: [] as string[] },
            bills: { synced: 0, errors: [] as string[] },
            items: { synced: 0, errors: [] as string[] },
        };

        // ========== 1. SYNC PURCHASES ==========
        console.log("Syncing Purchase entities...");
        try {
            const purchaseQuery = encodeURIComponent("SELECT * FROM Purchase MAXRESULTS 1000");
            const purchaseResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${purchaseQuery}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: "application/json",
                    },
                }
            );

            if (purchaseResponse.ok) {
                const purchaseData = await purchaseResponse.json();
                const purchases: QBExpense[] = purchaseData.QueryResponse?.Purchase || [];
                console.log(`Found ${purchases.length} purchases`);

                for (const purchase of purchases) {
                    try {
                        const { customerRefId, customerRefName, classRefId, classRefName, accountRefId, accountRefName } =
                            extractLineRefs(purchase.Line);

                        await supabaseClient.from("quickbooks_expenses").upsert({
                            user_id: user.id,
                            quickbooks_expense_id: purchase.Id,
                            expense_type: "purchase",
                            vendor_name: purchase.EntityRef?.name || null,
                            vendor_id: purchase.EntityRef?.value || null,
                            total_amount: purchase.TotalAmt,
                            currency: purchase.CurrencyRef?.value || "USD",
                            payment_type: purchase.PaymentType || null,
                            account_ref_id: accountRefId,
                            account_ref_name: accountRefName,
                            customer_ref_id: customerRefId,
                            customer_ref_name: customerRefName,
                            class_ref_id: classRefId,
                            class_ref_name: classRefName,
                            transaction_date: purchase.TxnDate,
                            line_items: purchase.Line,
                            memo: purchase.PrivateNote || null,
                            synced_at: new Date().toISOString(),
                        }, { onConflict: "user_id,quickbooks_expense_id" });

                        results.purchases.synced++;
                    } catch (err: any) {
                        results.purchases.errors.push(`Purchase ${purchase.Id}: ${err.message}`);
                    }
                }
            }
        } catch (err: any) {
            results.purchases.errors.push(`Query failed: ${err.message}`);
        }

        // ========== 2. SYNC BILLS ==========
        console.log("Syncing Bill entities...");
        try {
            const billQuery = encodeURIComponent("SELECT * FROM Bill MAXRESULTS 1000");
            const billResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${billQuery}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: "application/json",
                    },
                }
            );

            if (billResponse.ok) {
                const billData = await billResponse.json();
                const bills: QBExpense[] = billData.QueryResponse?.Bill || [];
                console.log(`Found ${bills.length} bills`);

                for (const bill of bills) {
                    try {
                        const { customerRefId, customerRefName, classRefId, classRefName, accountRefId, accountRefName } =
                            extractLineRefs(bill.Line);

                        await supabaseClient.from("quickbooks_expenses").upsert({
                            user_id: user.id,
                            quickbooks_expense_id: bill.Id,
                            expense_type: "bill",
                            vendor_name: (bill as any).VendorRef?.name || null,
                            vendor_id: (bill as any).VendorRef?.value || null,
                            total_amount: bill.TotalAmt,
                            currency: bill.CurrencyRef?.value || "USD",
                            account_ref_id: accountRefId,
                            account_ref_name: accountRefName,
                            customer_ref_id: customerRefId,
                            customer_ref_name: customerRefName,
                            class_ref_id: classRefId,
                            class_ref_name: classRefName,
                            transaction_date: bill.TxnDate,
                            due_date: bill.DueDate || null,
                            line_items: bill.Line,
                            memo: bill.PrivateNote || null,
                            synced_at: new Date().toISOString(),
                        }, { onConflict: "user_id,quickbooks_expense_id" });

                        results.bills.synced++;
                    } catch (err: any) {
                        results.bills.errors.push(`Bill ${bill.Id}: ${err.message}`);
                    }
                }
            }
        } catch (err: any) {
            results.bills.errors.push(`Query failed: ${err.message}`);
        }

        // ========== 3. SYNC ITEMS WITH PURCHASE COST ==========
        console.log("Syncing Item entities...");
        try {
            const itemQuery = encodeURIComponent("SELECT * FROM Item MAXRESULTS 1000");
            const itemResponse = await fetch(
                `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${itemQuery}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: "application/json",
                    },
                }
            );

            if (itemResponse.ok) {
                const itemData = await itemResponse.json();
                const items: QBItem[] = itemData.QueryResponse?.Item || [];
                console.log(`Found ${items.length} items`);

                for (const item of items) {
                    try {
                        await supabaseClient.from("quickbooks_items").upsert({
                            user_id: user.id,
                            quickbooks_item_id: item.Id,
                            name: item.Name,
                            sku: item.Sku || null,
                            description: item.Description || null,
                            item_type: item.Type,
                            unit_price: item.UnitPrice || null,
                            purchase_cost: item.PurchaseCost || null,  // KEY FIELD!
                            qty_on_hand: item.QtyOnHand || 0,
                            income_account_ref: item.IncomeAccountRef?.name || null,
                            expense_account_ref: item.ExpenseAccountRef?.name || null,
                            asset_account_ref: item.AssetAccountRef?.name || null,
                            is_active: item.Active,
                            synced_at: new Date().toISOString(),
                        }, { onConflict: "user_id,quickbooks_item_id" });

                        results.items.synced++;
                    } catch (err: any) {
                        results.items.errors.push(`Item ${item.Id}: ${err.message}`);
                    }
                }
            }
        } catch (err: any) {
            results.items.errors.push(`Query failed: ${err.message}`);
        }

        // ========== 4. SUMMARY STATS ==========
        const { data: summaryData } = await supabaseClient
            .from("quickbooks_expenses")
            .select("expense_type, total_amount, customer_ref_id")
            .eq("user_id", user.id);

        const summary = {
            total_expenses: summaryData?.length || 0,
            total_amount: summaryData?.reduce((sum, e) => sum + (e.total_amount || 0), 0) || 0,
            by_type: {
                purchase: summaryData?.filter(e => e.expense_type === "purchase").length || 0,
                bill: summaryData?.filter(e => e.expense_type === "bill").length || 0,
            },
            with_customer_ref: summaryData?.filter(e => e.customer_ref_id).length || 0,
            without_customer_ref: summaryData?.filter(e => !e.customer_ref_id).length || 0,
        };

        const { data: itemSummary } = await supabaseClient
            .from("quickbooks_items")
            .select("item_type, purchase_cost, unit_price")
            .eq("user_id", user.id);

        const itemStats = {
            total_items: itemSummary?.length || 0,
            with_purchase_cost: itemSummary?.filter(i => i.purchase_cost !== null).length || 0,
            inventory_items: itemSummary?.filter(i => i.item_type === "Inventory").length || 0,
            service_items: itemSummary?.filter(i => i.item_type === "Service").length || 0,
        };

        return new Response(
            JSON.stringify({
                success: true,
                message: `Synced ${results.purchases.synced} purchases, ${results.bills.synced} bills, ${results.items.synced} items`,
                results,
                expense_summary: summary,
                item_summary: itemStats,
                usage_tip: "Expenses with customer_ref_id can be automatically linked to invoices. Use quickbooks-link-expenses-to-invoices to match them.",
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

// Helper: Extract CustomerRef, ClassRef, AccountRef from line items
function extractLineRefs(lines: any[]): {
    customerRefId: string | null;
    customerRefName: string | null;
    classRefId: string | null;
    classRefName: string | null;
    accountRefId: string | null;
    accountRefName: string | null;
} {
    let customerRefId: string | null = null;
    let customerRefName: string | null = null;
    let classRefId: string | null = null;
    let classRefName: string | null = null;
    let accountRefId: string | null = null;
    let accountRefName: string | null = null;

    if (!lines || lines.length === 0) {
        return { customerRefId, customerRefName, classRefId, classRefName, accountRefId, accountRefName };
    }

    for (const line of lines) {
        const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
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

    return { customerRefId, customerRefName, classRefId, classRefName, accountRefId, accountRefName };
}

// Helper: Refresh access token
async function refreshAccessToken(refreshToken: string): Promise<any> {
    const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");

    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
    });

    if (!response.ok) {
        return { success: false };
    }

    const data = await response.json();
    return {
        success: true,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
    };
}
