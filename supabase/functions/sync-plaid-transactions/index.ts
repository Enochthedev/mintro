import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";
const PLAID_BASE_URL = 
  PLAID_ENV === "production" ? "https://production.plaid.com" :
  PLAID_ENV === "development" ? "https://development.plaid.com" :
  "https://sandbox.plaid.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = req.headers.get("X-Cron-Secret");
    
    // Verify this is called by cron job or authorized system
    if (cronSecret !== Deno.env.get("CRON_SECRET")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get all items that need syncing
    const { data: plaidItems, error: fetchError } = await supabaseClient
      .from("plaid_items")
      .select(`
        *,
        business_profiles!inner(subscription_tier, user_id)
      `)
      .eq("status", "active")
      .eq("needs_sync", true)
      .limit(50); // Process max 50 items per run

    if (fetchError || !plaidItems || plaidItems.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No items need syncing",
          synced_items: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`Syncing ${plaidItems.length} items`);
    const syncResults = [];

    for (const item of plaidItems) {
      const logEntry = {
        plaid_item_id: item.id,
        user_id: item.user_id,
        status: "success",
        transactions_added: 0,
        transactions_modified: 0,
        transactions_removed: 0,
        started_at: new Date().toISOString()
      };

      try {
        const syncResponse = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": PLAID_CLIENT_ID!,
            "PLAID-SECRET": PLAID_SECRET!
          },
          body: JSON.stringify({
            access_token: item.access_token,
            cursor: item.cursor || undefined
          })
        });

        const syncData = await syncResponse.json();

        if (!syncResponse.ok) {
          console.error("Plaid sync error:", syncData);
          logEntry.status = "error";
          logEntry.error_code = syncData.error_code;
          logEntry.error_message = syncData.error_message;

          if (syncData.error_code === "ITEM_LOGIN_REQUIRED") {
            await supabaseClient
              .from("plaid_items")
              .update({
                status: "requires_update",
                error_code: syncData.error_code,
                error_message: syncData.error_message,
                needs_sync: false
              })
              .eq("id", item.id);
          }

          syncResults.push({
            item_id: item.id,
            institution: item.institution_name,
            error: syncData.error_message
          });
          continue;
        }

        const { added, modified, removed, next_cursor } = syncData;

        // Get bank accounts for this item
        const { data: bankAccounts } = await supabaseClient
          .from("bank_accounts")
          .select("id, account_id")
          .eq("plaid_item_id", item.id);

        const accountMap = new Map(
          bankAccounts?.map(acc => [acc.account_id, acc.id]) || []
        );

        // Process added transactions
        if (added && added.length > 0) {
          const transactionsToInsert = added
            .map(txn => ({
              transaction_id: txn.transaction_id,
              bank_account_id: accountMap.get(txn.account_id),
              user_id: item.user_id,
              date: txn.date,
              amount: txn.amount,
              name: txn.name,
              merchant_name: txn.merchant_name,
              plaid_category: txn.category,
              pending: txn.pending,
              payment_channel: txn.payment_channel
            }))
            .filter(txn => txn.bank_account_id);

          if (transactionsToInsert.length > 0) {
            const { error: insertError } = await supabaseClient
              .from("transactions")
              .upsert(transactionsToInsert, {
                onConflict: "transaction_id",
                ignoreDuplicates: false
              });

            if (!insertError) {
              logEntry.transactions_added = transactionsToInsert.length;
            }
          }
        }

        // Process modified transactions
        if (modified && modified.length > 0) {
          for (const txn of modified) {
            await supabaseClient
              .from("transactions")
              .update({
                date: txn.date,
                amount: txn.amount,
                name: txn.name,
                merchant_name: txn.merchant_name,
                pending: txn.pending,
                plaid_category: txn.category
              })
              .eq("transaction_id", txn.transaction_id);

            logEntry.transactions_modified++;
          }
        }

        // Process removed transactions
        if (removed && removed.length > 0) {
          await supabaseClient
            .from("transactions")
            .delete()
            .in("transaction_id", removed.map(txn => txn.transaction_id));

          logEntry.transactions_removed = removed.length;
        }

        // Update item: mark as synced, update cursor
        await supabaseClient
          .from("plaid_items")
          .update({
            cursor: next_cursor,
            last_successful_sync: new Date().toISOString(),
            needs_sync: false,
            status: "active",
            error_code: null,
            error_message: null
          })
          .eq("id", item.id);

        syncResults.push({
          item_id: item.id,
          institution: item.institution_name,
          added: logEntry.transactions_added,
          modified: logEntry.transactions_modified,
          removed: logEntry.transactions_removed
        });

      } catch (error) {
        console.error("Sync error for item:", item.id, error);
        logEntry.status = "error";
        logEntry.error_message = error.message;

        syncResults.push({
          item_id: item.id,
          institution: item.institution_name,
          error: error.message
        });
      } finally {
        logEntry.completed_at = new Date().toISOString();
        await supabaseClient.from("plaid_sync_logs").insert(logEntry);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced_items: syncResults.length,
        results: syncResults
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});