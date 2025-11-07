import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";

const PLAID_BASE_URL =
  PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : PLAID_ENV === "development"
    ? "https://development.plaid.com"
    : "https://sandbox.plaid.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json().catch(() => ({}));
    const { plaid_item_id } = body;

    let query = supabaseClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (plaid_item_id) {
      query = query.eq("id", plaid_item_id);
    }

    const { data: plaidItems, error: fetchError } = await query;

    if (fetchError || !plaidItems || plaidItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active bank connections found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncResults = [];

    for (const item of plaidItems) {
      const logEntry = {
        plaid_item_id: item.id,
        user_id: user.id,
        status: "success" as const,
        transactions_added: 0,
        transactions_modified: 0,
        transactions_removed: 0,
        started_at: new Date().toISOString(),
      };

      try {
        const syncResponse = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
            "PLAID-SECRET": PLAID_SECRET,
          },
          body: JSON.stringify({
            access_token: item.access_token,
            cursor: item.cursor || undefined,
          }),
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
                error_message: syncData.error_message 
              })
              .eq("id", item.id);
          }

          syncResults.push({
            item_id: item.id,
            institution: item.institution_name,
            error: syncData.error_message,
          });
          continue;
        }

        const { added, modified, removed, next_cursor, has_more } = syncData;

        const { data: bankAccounts } = await supabaseClient
          .from("bank_accounts")
          .select("id, account_id")
          .eq("plaid_item_id", item.id);

        const accountMap = new Map(
          bankAccounts?.map(acc => [acc.account_id, acc.id]) || []
        );

        if (added && added.length > 0) {
          const transactionsToInsert = added.map((txn: any) => ({
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
          })).filter(txn => txn.bank_account_id);

          if (transactionsToInsert.length > 0) {
            const { error: insertError } = await supabaseClient
              .from("transactions")
              .upsert(transactionsToInsert, { 
                onConflict: "transaction_id",
                ignoreDuplicates: false 
              });

            if (insertError) {
              console.error("Error inserting transactions:", insertError);
            } else {
              logEntry.transactions_added = transactionsToInsert.length;
            }
          }
        }

        if (modified && modified.length > 0) {
          for (const txn of modified) {
            const { error: updateError } = await supabaseClient
              .from("transactions")
              .update({
                date: txn.date,
                amount: txn.amount,
                name: txn.name,
                merchant_name: txn.merchant_name,
                pending: txn.pending,
                plaid_category: txn.category,
              })
              .eq("transaction_id", txn.transaction_id);

            if (!updateError) {
              logEntry.transactions_modified++;
            }
          }
        }

        if (removed && removed.length > 0) {
          const { error: deleteError } = await supabaseClient
            .from("transactions")
            .delete()
            .in("transaction_id", removed.map((txn: any) => txn.transaction_id));

          if (!deleteError) {
            logEntry.transactions_removed = removed.length;
          }
        }

        await supabaseClient
          .from("plaid_items")
          .update({
            cursor: next_cursor,
            last_successful_sync: new Date().toISOString(),
            status: "active",
            error_code: null,
            error_message: null,
          })
          .eq("id", item.id);

        syncResults.push({
          item_id: item.id,
          institution: item.institution_name,
          added: logEntry.transactions_added,
          modified: logEntry.transactions_modified,
          removed: logEntry.transactions_removed,
          has_more,
        });

      } catch (error) {
        console.error("Sync error for item:", item.id, error);
        logEntry.status = "error";
        logEntry.error_message = error.message;
        
        syncResults.push({
          item_id: item.id,
          institution: item.institution_name,
          error: error.message,
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
        results: syncResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});