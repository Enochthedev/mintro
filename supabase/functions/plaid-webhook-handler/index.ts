import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const webhook = await req.json();
    console.log("Received webhook:", webhook.webhook_type);

    // Log the webhook
    await supabaseClient.from("webhook_logs").insert({
      webhook_type: webhook.webhook_type,
      payload: webhook,
      received_at: new Date().toISOString()
    });

    // Handle different webhook types
    switch (webhook.webhook_type) {
      case "SYNC_UPDATES_AVAILABLE":
      case "DEFAULT_UPDATE":
      case "HISTORICAL_UPDATE":
        // Mark item for sync
        const { data: item } = await supabaseClient
          .from("plaid_items")
          .select("id, user_id")
          .eq("item_id", webhook.item_id)
          .single();

        if (item) {
          await supabaseClient
            .from("plaid_items")
            .update({
              needs_sync: true,
              last_webhook_received: new Date().toISOString()
            })
            .eq("id", item.id);

          // Trigger sync job
          const syncJobUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-plaid-transactions`;
          fetch(syncJobUrl, {
            method: "POST",
            headers: {
              "X-Cron-Secret": Deno.env.get("CRON_SECRET")!,
              "Content-Type": "application/json"
            }
          }).catch(err => console.error("Failed to trigger sync:", err));
        }
        break;

      case "ITEM_ERROR":
        // Handle errors
        await supabaseClient
          .from("plaid_items")
          .update({
            status: webhook.error?.error_code === "ITEM_LOGIN_REQUIRED" 
              ? "requires_update" 
              : "error",
            error_code: webhook.error?.error_code,
            error_message: webhook.error?.error_message
          })
          .eq("item_id", webhook.item_id);
        break;
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});