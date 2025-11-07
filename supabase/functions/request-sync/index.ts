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
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! }
        }
      }
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Check if user is premium
    const { data: profile } = await supabaseClient
      .from("business_profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (!profile || profile.subscription_tier !== "premium") {
      return new Response(
        JSON.stringify({ 
          error: "This feature is only available for premium users",
          upgrade_required: true
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Check rate limit (max 3 syncs per day for premium)
    const today = new Date().toISOString().split('T')[0];
    const { data: syncCount } = await supabaseClient
      .from("plaid_sync_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("started_at", `${today}T00:00:00Z`)
      .eq("status", "success");

    if (syncCount && syncCount >= 3) {
      return new Response(
        JSON.stringify({ 
          error: "Daily sync limit reached. You can sync 3 times per day.",
          rate_limited: true
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Get user's plaid items
    const { data: plaidItems } = await supabaseClient
      .from("plaid_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (!plaidItems || plaidItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active bank connections found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Mark all user's items for immediate sync
    await supabaseClient
      .from("plaid_items")
      .update({ 
        needs_sync: true,
        last_manual_sync_request: new Date().toISOString()
      })
      .eq("user_id", user.id)
      .eq("status", "active");

    // Call the sync job endpoint directly (or queue it)
    const syncJobUrl = Deno.env.get("SYNC_JOB_URL");
    if (syncJobUrl) {
      // Trigger sync job asynchronously
      fetch(syncJobUrl, {
        method: "POST",
        headers: {
          "X-Cron-Secret": Deno.env.get("CRON_SECRET")!,
          "Content-Type": "application/json"
        }
      }).catch(err => console.error("Failed to trigger sync:", err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sync requested. Your transactions will be updated shortly.",
        items_queued: plaidItems.length
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
});supabase functions deploy request-sync