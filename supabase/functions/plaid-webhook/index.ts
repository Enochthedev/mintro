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
  "Access-Control-Allow-Headers": "*",
};

serve(async (req) => {
  console.log("📨 Webhook request received");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const webhookData = await req.json();
    console.log("Webhook data:", JSON.stringify(webhookData, null, 2));

    const { webhook_type, webhook_code, item_id, error } = webhookData;

    // Log webhook (fixed - removed .catch())
    const { error: logError } = await supabaseClient.from("plaid_webhook_logs").insert({
      webhook_type,
      webhook_code,
      item_id,
      payload: webhookData,
      received_at: new Date().toISOString(),
    });
    
    if (logError) {
      console.error("Failed to log webhook:", logError);
    }

    // ============================================
    // Handle SYNC_UPDATES_AVAILABLE
    // ============================================
    if (webhook_code === "SYNC_UPDATES_AVAILABLE") {
      console.log(`🔄 Sync updates available for item: ${item_id}`);

      const { data: plaidItem, error: fetchError } = await supabaseClient
        .from("plaid_items")
        .select("*")
        .eq("item_id", item_id)
        .single();

      if (fetchError || !plaidItem) {
        console.error("❌ Plaid item not found:", item_id);
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const syncResponse = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": PLAID_CLIENT_ID!,
            "PLAID-SECRET": PLAID_SECRET!,
          },
          body: JSON.stringify({
            access_token: plaidItem.access_token,
            cursor: plaidItem.cursor || undefined,
          }),
        });

        const syncData = await syncResponse.json();

        if (!syncResponse.ok) {
          console.error("❌ Plaid sync error:", syncData);
          
          if (syncData.error_code === "ITEM_LOGIN_REQUIRED") {
            await supabaseClient
              .from("plaid_items")
              .update({
                status: "requires_update",
                error_code: syncData.error_code,
                error_message: syncData.error_message,
              })
              .eq("id", plaidItem.id);
          }

          return new Response(JSON.stringify({ error: syncData.error_message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { added, modified, removed, next_cursor } = syncData;
        console.log(`📊 Changes: +${added?.length || 0} ~${modified?.length || 0} -${removed?.length || 0}`);

        const { data: bankAccounts } = await supabaseClient
          .from("bank_accounts")
          .select("id, account_id")
          .eq("plaid_item_id", plaidItem.id);

        const accountMap = new Map(
          bankAccounts?.map((acc) => [acc.account_id, acc.id]) || []
        );

        let transactionsAdded = 0;
        let transactionsModified = 0;
        let transactionsRemoved = 0;

        // Process added transactions
        if (added && added.length > 0) {
          const transactionsToInsert = added
            .map((txn: any) => ({
              transaction_id: txn.transaction_id,
              bank_account_id: accountMap.get(txn.account_id),
              user_id: plaidItem.user_id,
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
            const { error: insertError } = await supabaseClient
              .from("transactions")
              .upsert(transactionsToInsert, {
                onConflict: "transaction_id",
                ignoreDuplicates: false,
              });

            if (!insertError) {
              transactionsAdded = transactionsToInsert.length;
            } else {
              console.error("Insert error:", insertError);
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
                plaid_category: txn.category,
              })
              .eq("transaction_id", txn.transaction_id);

            transactionsModified++;
          }
        }

        // Process removed transactions
        if (removed && removed.length > 0) {
          await supabaseClient
            .from("transactions")
            .delete()
            .in("transaction_id", removed.map((txn: any) => txn.transaction_id));

          transactionsRemoved = removed.length;
        }

        // Update plaid_item
        await supabaseClient
          .from("plaid_items")
          .update({
            cursor: next_cursor,
            last_successful_sync: new Date().toISOString(),
            needs_sync: false,
            status: "active",
            error_code: null,
            error_message: null,
          })
          .eq("id", plaidItem.id);

        // Log sync
        await supabaseClient.from("plaid_sync_logs").insert({
          plaid_item_id: plaidItem.id,
          user_id: plaidItem.user_id,
          status: "success",
          transactions_added: transactionsAdded,
          transactions_modified: transactionsModified,
          transactions_removed: transactionsRemoved,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });

        console.log(`✅ Sync complete: +${transactionsAdded} ~${transactionsModified} -${transactionsRemoved}`);

        return new Response(
          JSON.stringify({
            success: true,
            transactions_added: transactionsAdded,
            transactions_modified: transactionsModified,
            transactions_removed: transactionsRemoved,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (syncError: any) {
        console.error("❌ Sync error:", syncError);
        
        await supabaseClient
          .from("plaid_items")
          .update({ needs_sync: true })
          .eq("id", plaidItem.id);

        return new Response(JSON.stringify({ error: "Sync failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle INITIAL_UPDATE
    if (webhook_code === "INITIAL_UPDATE") {
      console.log(`🎉 Initial update ready for item: ${item_id}`);
      await supabaseClient
        .from("plaid_items")
        .update({ needs_sync: true })
        .eq("item_id", item_id);
    }

    // Handle HISTORICAL_UPDATE
    if (webhook_code === "HISTORICAL_UPDATE") {
      console.log(`📚 Historical update ready for item: ${item_id}`);
      await supabaseClient
        .from("plaid_items")
        .update({ needs_sync: true })
        .eq("item_id", item_id);
    }

    // Handle errors
    if (webhook_type === "ERROR" || error?.error_code === "ITEM_LOGIN_REQUIRED") {
      console.error(`❌ Error webhook:`, error);
      await supabaseClient
        .from("plaid_items")
        .update({
          status: "requires_update",
          error_code: error?.error_code,
          error_message: error?.error_message,
        })
        .eq("item_id", item_id);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Webhook processed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});