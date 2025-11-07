import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const transactionId = url.searchParams.get("transaction_id");

    if (!transactionId) {
      return new Response(
        JSON.stringify({ error: "transaction_id query parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get transaction
    const { data: transaction, error: txError } = await supabaseClient
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get blueprint allocations
    const { data: blueprintAllocs, error: bpError } = await supabaseClient
      .from("blueprint_expense_allocations")
      .select(`
        *,
        blueprint_usage (
          id,
          blueprint_id,
          cost_blueprints (name, blueprint_type)
        )
      `)
      .eq("transaction_id", transactionId);

    if (bpError) throw bpError;

    // Get job allocations - FIXED COLUMNS
    const { data: jobAllocs, error: jobError } = await supabaseClient
      .from("transaction_job_allocations")
      .select(`
        *,
        invoices (id, invoice, client)
      `)
      .eq("transaction_id", transactionId);

    if (jobError) throw jobError;

    // Calculate totals
    const totalBlueprintAllocated = blueprintAllocs?.reduce(
      (sum, alloc) => sum + parseFloat(alloc.allocation_amount),
      0
    ) || 0;

    const totalJobAllocated = jobAllocs?.reduce(
      (sum, alloc) => sum + parseFloat(alloc.allocation_amount),
      0
    ) || 0;

    const totalAllocated = totalBlueprintAllocated + totalJobAllocated;
    const transactionAmount = Math.abs(parseFloat(transaction.amount));
    const unallocated = transactionAmount - totalAllocated;
    const allocationPercentage = transactionAmount > 0 
      ? (totalAllocated / transactionAmount) * 100 
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        transaction: {
          id: transaction.id,
          date: transaction.date,
          amount: transaction.amount,
          name: transaction.name,
          merchant_name: transaction.merchant_name,
        },
        allocations: {
          blueprints: blueprintAllocs?.map(alloc => ({
            id: alloc.id,
            blueprint_name: alloc.blueprint_usage?.cost_blueprints?.name,
            expense_type: alloc.expense_type,
            amount: alloc.allocation_amount,
            notes: alloc.notes,
          })) || [],
          jobs: jobAllocs?.map(alloc => ({
            id: alloc.id,
            invoice_number: alloc.invoices?.invoice,
            client: alloc.invoices?.client,
            amount: alloc.allocation_amount,
            notes: alloc.notes,
          })) || [],
        },
        summary: {
          transaction_amount: transactionAmount,
          total_allocated: totalAllocated,
          unallocated: unallocated,
          allocation_percentage: allocationPercentage,
          is_fully_allocated: Math.abs(unallocated) < 0.01,
          is_over_allocated: totalAllocated > transactionAmount,
        },
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