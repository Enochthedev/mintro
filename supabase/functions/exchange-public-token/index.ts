import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@15.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID"),
      "PLAID-SECRET": Deno.env.get("PLAID_SECRET"),
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);
const PLAID_BASE_URL = "https://sandbox.plaid.com";

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

    const { public_token } = await req.json();

    if (!public_token) {
      return new Response(
        JSON.stringify({ error: "public_token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get accounts and institution info
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts;
    const institutionId = accountsResponse.data.item.institution_id;

    // Get institution name
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId!,
      country_codes: ["US" as any],
    });

    const institutionName = institutionResponse.data.institution.name;

    // Save Plaid item to database
    const { data: plaidItem, error: itemError } = await supabaseClient
      .from("plaid_items")
      .insert({
        user_id: user.id,
        item_id: itemId,
        access_token: accessToken,
        institution_id: institutionId,
        institution_name: institutionName,
        status: "active",
        needs_sync: false,
      })
      .select()
      .single();

    if (itemError) {
      throw itemError;
    }

    // Save accounts to database
    const accountsToInsert = accounts.map((account) => ({
      user_id: user.id,
      plaid_item_id: plaidItem.id,
      account_id: account.account_id,
      name: account.name,
      official_name: account.official_name,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      current_balance: account.balances.current,
      available_balance: account.balances.available,
    }));

    const { data: insertedAccounts, error: accountsError } = await supabaseClient
      .from("bank_accounts")
      .insert(accountsToInsert)
      .select();

    if (accountsError) {
      throw accountsError;
    }

    // ============================================
    // STEP 0: ENSURE USER HAS EXPENSE CATEGORIES
    // ============================================
    console.log("Checking expense categories...");
    
    const { count: categoryCount } = await supabaseClient
      .from("expense_categories")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (!categoryCount || categoryCount === 0) {
      console.log("No categories found - setting up defaults...");
      try {
        const setupResponse = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/setup-default-categories`,
          {
            method: "POST",
            headers: {
              "Authorization": req.headers.get("Authorization")!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );
        
        if (setupResponse.ok) {
          const setupResult = await setupResponse.json();
          console.log(`✅ Created ${setupResult.categories_count} default categories`);
        } else {
          console.error("Failed to setup default categories:", await setupResponse.text());
        }
      } catch (setupError) {
        console.error("Category setup error (non-fatal):", setupError);
      }
    } else {
      console.log(`User already has ${categoryCount} categories`);
    }

    // ============================================
    // STEP 1: SYNC TRANSACTIONS IMMEDIATELY
    // ============================================
    console.log("Starting immediate transaction sync...");
    let transactionsAdded = 0;
    let insertedTransactionIds: string[] = [];

    try {
      const syncResponse = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID")!,
          "PLAID-SECRET": Deno.env.get("PLAID_SECRET")!,
        },
        body: JSON.stringify({
          access_token: accessToken,
          cursor: null,
        }),
      });

      const syncData = await syncResponse.json();

      if (syncResponse.ok && syncData.added && syncData.added.length > 0) {
        console.log(`Fetched ${syncData.added.length} transactions from Plaid`);

        const accountMap = new Map(
          insertedAccounts?.map((acc) => [acc.account_id, acc.id]) || []
        );

        const transactionsToInsert = syncData.added
          .map((txn: any) => ({
            transaction_id: txn.transaction_id,
            bank_account_id: accountMap.get(txn.account_id),
            user_id: user.id,
            date: txn.date,
            amount: txn.amount,
            name: txn.name,
            merchant_name: txn.merchant_name,
            plaid_category: txn.category,
            pending: txn.pending,
            payment_channel: txn.payment_channel,
          }))
          .filter((txn: any) => txn.bank_account_id);

        if (transactionsToInsert.length > 0) {
          const { data: txData, error: txError } = await supabaseClient
            .from("transactions")
            .insert(transactionsToInsert)
            .select();

          if (!txError && txData) {
            insertedTransactionIds = txData.map(t => t.id);
            transactionsAdded = txData.length;
            console.log(`✅ Successfully added ${transactionsAdded} transactions`);
          } else {
            console.error("Transaction insert error:", txError);
          }
        }

        await supabaseClient
          .from("plaid_items")
          .update({
            cursor: syncData.next_cursor,
            last_successful_sync: new Date().toISOString(),
          })
          .eq("id", plaidItem.id);

        await supabaseClient.from("plaid_sync_logs").insert({
          plaid_item_id: plaidItem.id,
          user_id: user.id,
          status: "success",
          transactions_added: transactionsAdded,
          transactions_modified: 0,
          transactions_removed: 0,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
      }
    } catch (syncError) {
      console.error("Transaction sync error:", syncError);
      await supabaseClient
        .from("plaid_items")
        .update({ needs_sync: true })
        .eq("id", plaidItem.id);
    }

    // ============================================
    // STEP 2: AUTO-CATEGORIZE TRANSACTIONS
    // ============================================
    let categorizedCount = 0;

    if (insertedTransactionIds.length > 0) {
      console.log(`Auto-categorizing ${insertedTransactionIds.length} transactions...`);
      
      try {
        const categorizationResponse = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-categorize-transactions`,
          {
            method: "POST",
            headers: {
              "Authorization": req.headers.get("Authorization")!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              transaction_ids: insertedTransactionIds,
            }),
          }
        );

        if (categorizationResponse.ok) {
          const categorizationResult = await categorizationResponse.json();
          categorizedCount = categorizationResult.categorized || 0;
          console.log(`✅ Auto-categorization complete: ${categorizedCount} transactions categorized`);
        } else {
          console.error("Auto-categorization failed:", await categorizationResponse.text());
        }
      } catch (catError) {
        console.error("Auto-categorization error (non-fatal):", catError);
        // Don't throw - categorization failure shouldn't break bank connection
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: transactionsAdded > 0 
          ? `Bank connected! Synced ${transactionsAdded} transactions${categorizedCount > 0 ? `, categorized ${categorizedCount}` : ''}.`
          : "Bank connected successfully.",
        institution_name: institutionName,
        accounts_added: accounts.length,
        transactions_added: transactionsAdded,
        categorized: categorizedCount,
        plaid_item_id: plaidItem.id,
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