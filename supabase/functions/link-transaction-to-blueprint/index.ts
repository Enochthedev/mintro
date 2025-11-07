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

    const {
      transaction_id,
      blueprint_usage_id,
      expense_type,
      allocation_amount,
      notes,
    } = await req.json();

    if (!transaction_id || !blueprint_usage_id || !expense_type) {
      return new Response(
        JSON.stringify({ 
          error: "transaction_id, blueprint_usage_id, and expense_type are required" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validExpenseTypes = ['materials', 'labor', 'overhead'];
    if (!validExpenseTypes.includes(expense_type)) {
      return new Response(
        JSON.stringify({ 
          error: `expense_type must be one of: ${validExpenseTypes.join(', ')}` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify transaction belongs to user
    const { data: transaction, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, amount, name, merchant_name, date")
      .eq("id", transaction_id)
      .eq("user_id", user.id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify blueprint usage belongs to user
    const { data: blueprintUsage, error: usageError } = await supabaseClient
      .from("blueprint_usage")
      .select(`
        *,
        cost_blueprints (id, name, blueprint_type)
      `)
      .eq("id", blueprint_usage_id)
      .eq("user_id", user.id)
      .single();

    if (usageError || !blueprintUsage) {
      return new Response(
        JSON.stringify({ error: "Blueprint usage not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use transaction amount if allocation_amount not provided
    const finalAllocationAmount = allocation_amount || Math.abs(parseFloat(transaction.amount));

    // Check if allocation already exists
    const { data: existingAllocation, error: checkError } = await supabaseClient
      .from("blueprint_expense_allocations")
      .select("id")
      .eq("blueprint_usage_id", blueprint_usage_id)
      .eq("transaction_id", transaction_id)
      .single();

    if (existingAllocation) {
      // Update existing allocation
      const { data: updated, error: updateError } = await supabaseClient
        .from("blueprint_expense_allocations")
        .update({
          allocation_amount: finalAllocationAmount,
          expense_type,
          notes,
        })
        .eq("id", existingAllocation.id)
        .select(`
          *,
          transactions (id, name, merchant_name, amount, date)
        `)
        .single();

      if (updateError) throw updateError;

      // Update blueprint usage actual costs
      await updateBlueprintUsageCosts(
        supabaseClient,
        blueprint_usage_id
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Expense allocation updated",
          allocation: updated,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create new allocation
    const { data: allocation, error: allocationError } = await supabaseClient
      .from("blueprint_expense_allocations")
      .insert({
        blueprint_usage_id,
        transaction_id,
        allocation_amount: finalAllocationAmount,
        expense_type,
        notes,
      })
      .select(`
        *,
        transactions (id, name, merchant_name, amount, date)
      `)
      .single();

    if (allocationError) {
      throw allocationError;
    }

    // Update blueprint usage actual costs
    await updateBlueprintUsageCosts(
      supabaseClient,
      blueprint_usage_id
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Transaction linked to blueprint successfully",
        allocation,
        transaction: {
          id: transaction.id,
          name: transaction.name,
          merchant_name: transaction.merchant_name,
          amount: transaction.amount,
          date: transaction.date,
        },
        blueprint: {
          id: blueprintUsage.cost_blueprints.id,
          name: blueprintUsage.cost_blueprints.name,
          type: blueprintUsage.cost_blueprints.blueprint_type,
        },
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

// Helper function to recalculate blueprint usage costs
async function updateBlueprintUsageCosts(
  supabaseClient: any,
  blueprint_usage_id: string
) {
  // Get all allocations for this blueprint usage
  const { data: allocations, error: allocError } = await supabaseClient
    .from("blueprint_expense_allocations")
    .select("expense_type, allocation_amount")
    .eq("blueprint_usage_id", blueprint_usage_id);

  if (allocError || !allocations) return;

  // Calculate totals by expense type
  const totals = {
    materials: 0,
    labor: 0,
    overhead: 0,
  };

  for (const alloc of allocations) {
    totals[alloc.expense_type as keyof typeof totals] += parseFloat(alloc.allocation_amount);
  }

  // Update blueprint usage with recalculated costs
  await supabaseClient
    .from("blueprint_usage")
    .update({
      actual_materials_cost: totals.materials,
      actual_labor_cost: totals.labor,
      actual_overhead_cost: totals.overhead,
    })
    .eq("id", blueprint_usage_id);
}