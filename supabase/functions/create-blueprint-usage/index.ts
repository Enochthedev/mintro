import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const requestBody = await req.json();

    // ✅ DETECT IF SINGLE OR BATCH
    // If blueprint_usages array exists, it's a batch
    // Otherwise, treat entire body as single usage
    const isBatch = Array.isArray(requestBody.blueprint_usages);
    
    let invoice_id: string | undefined;
    let blueprint_usages: any[];
    let deduct_inventory = true;

    if (isBatch) {
      // Batch mode
      invoice_id = requestBody.invoice_id;
      blueprint_usages = requestBody.blueprint_usages;
      deduct_inventory = requestBody.deduct_inventory !== false;
    } else {
      // Single mode - wrap in array for uniform processing
      invoice_id = requestBody.invoice_id;
      blueprint_usages = [{
        blueprint_id: requestBody.blueprint_id,
        actual_materials_cost: requestBody.actual_materials_cost || 0,
        actual_labor_cost: requestBody.actual_labor_cost || 0,
        actual_overhead_cost: requestBody.actual_overhead_cost || 0,
        actual_sale_price: requestBody.actual_sale_price,
        completed_date: requestBody.completed_date,
        notes: requestBody.notes,
      }];
      deduct_inventory = requestBody.deduct_inventory !== false;
    }

    // Validation
    if (!blueprint_usages || blueprint_usages.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: isBatch 
            ? "blueprint_usages array cannot be empty"
            : "blueprint_id is required"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate each usage has required fields
    for (let i = 0; i < blueprint_usages.length; i++) {
      const usage = blueprint_usages[i];
      if (!usage.blueprint_id || usage.actual_sale_price === undefined) {
        return new Response(
          JSON.stringify({ 
            error: `Blueprint usage at index ${i} missing required fields (blueprint_id, actual_sale_price)`
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ✅ STEP 1: VALIDATE ALL BLUEPRINTS EXIST
    const blueprintIds = blueprint_usages.map(u => u.blueprint_id);
    const { data: blueprints, error: blueprintsError } = await supabaseClient
      .from("cost_blueprints")
      .select(`
        *,
        blueprint_inventory_items (
          *,
          inventory_items (*)
        )
      `)
      .eq("user_id", user.id)
      .in("id", blueprintIds);

    if (blueprintsError) {
      throw blueprintsError;
    }

    if (!blueprints || blueprints.length !== blueprintIds.length) {
      const foundIds = blueprints?.map(b => b.id) || [];
      const missingIds = blueprintIds.filter(id => !foundIds.includes(id));
      
      return new Response(
        JSON.stringify({ 
          error: isBatch 
            ? "One or more blueprints not found"
            : "Blueprint not found",
          missing_blueprint_ids: missingIds
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ STEP 2: CHECK INVENTORY AVAILABILITY
    const inventoryChecks: any[] = [];
    const inventoryAggregation = new Map();

    if (deduct_inventory) {
      for (const usage of blueprint_usages) {
        const blueprint = blueprints.find(b => b.id === usage.blueprint_id);
        
        if (blueprint?.blueprint_inventory_items?.length > 0) {
          for (const item of blueprint.blueprint_inventory_items) {
            const itemId = item.inventory_item_id;
            const required = item.quantity_required || 0;
            
            const currentTotal = inventoryAggregation.get(itemId) || 0;
            inventoryAggregation.set(itemId, currentTotal + required);
          }
        }
      }

      for (const [itemId, totalRequired] of inventoryAggregation.entries()) {
        const { data: inventoryItem } = await supabaseClient
          .from("inventory_items")
          .select("*")
          .eq("id", itemId)
          .single();

        if (inventoryItem) {
          const currentQty = inventoryItem.current_quantity || 0;
          
          if (currentQty < totalRequired) {
            inventoryChecks.push({
              item_id: itemId,
              item_name: inventoryItem.name,
              current: currentQty,
              required: totalRequired,
              shortage: totalRequired - currentQty,
            });
          }
        }
      }

      if (inventoryChecks.length > 0) {
        return new Response(
          JSON.stringify({ 
            error: "Insufficient inventory",
            shortages: inventoryChecks,
            message: "No changes were made"
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ✅ STEP 3: CREATE ALL BLUEPRINT USAGES (ATOMIC)
    const usagesToCreate = blueprint_usages.map(usage => ({
      user_id: user.id,
      blueprint_id: usage.blueprint_id,
      invoice_id: invoice_id || null,
      actual_materials_cost: usage.actual_materials_cost || 0,
      actual_labor_cost: usage.actual_labor_cost || 0,
      actual_overhead_cost: usage.actual_overhead_cost || 0,
      actual_sale_price: usage.actual_sale_price || 0,
      completed_date: usage.completed_date || new Date().toISOString().split('T')[0],
      notes: usage.notes || (invoice_id ? `Invoice ${invoice_id}` : null),
    }));

    const { data: createdUsages, error: usagesError } = await supabaseClient
      .from("blueprint_usage")
      .insert(usagesToCreate)
      .select();

    if (usagesError) {
      throw new Error(`Failed to create blueprint usages: ${usagesError.message}`);
    }

    // ✅ STEP 4: DEDUCT INVENTORY
    const inventoryDeductions: any[] = [];
    const inventoryTransactions: any[] = [];

    if (deduct_inventory) {
      for (let i = 0; i < blueprint_usages.length; i++) {
        const usage = blueprint_usages[i];
        const createdUsage = createdUsages[i];
        const blueprint = blueprints.find(b => b.id === usage.blueprint_id);

        if (blueprint?.blueprint_inventory_items?.length > 0) {
          for (const item of blueprint.blueprint_inventory_items) {
            const inventoryItemId = item.inventory_item_id;
            const quantityUsed = item.quantity_required || 0;

            const { data: currentItem } = await supabaseClient
              .from("inventory_items")
              .select("current_quantity, minimum_quantity, name, unit_cost")
              .eq("id", inventoryItemId)
              .single();

            if (currentItem) {
              const newQty = (currentItem.current_quantity || 0) - quantityUsed;

              const { error: updateError } = await supabaseClient
                .from("inventory_items")
                .update({ 
                  current_quantity: newQty,
                  updated_at: new Date().toISOString()
                })
                .eq("id", inventoryItemId);

              if (updateError) {
                throw new Error(`Failed to update inventory: ${updateError.message}`);
              }

              inventoryDeductions.push({
                item_id: inventoryItemId,
                item_name: currentItem.name,
                quantity_used: quantityUsed,
                quantity_remaining: newQty,
                is_low_stock: newQty <= (currentItem.minimum_quantity || 0),
                blueprint_name: blueprint.name,
              });

              inventoryTransactions.push({
                user_id: user.id,
                inventory_item_id: inventoryItemId,
                transaction_type: "blueprint_usage",
                quantity_change: -quantityUsed,
                unit_cost: currentItem.unit_cost,
                reference_id: createdUsage.id,
                reference_type: "blueprint_usage",
                notes: `Used for ${blueprint.name}${invoice_id ? ` (Invoice: ${invoice_id})` : ''}`,
              });
            }
          }
        }
      }

      if (inventoryTransactions.length > 0) {
        const { error: transactionsError } = await supabaseClient
          .from("inventory_transactions")
          .insert(inventoryTransactions);

        if (transactionsError) {
          console.error("Error logging inventory transactions:", transactionsError);
        }
      }
    }

    // ✅ STEP 5: BUILD RESPONSE
    const totalActualCost = createdUsages.reduce((sum, usage) => 
      sum + (usage.actual_materials_cost || 0) + 
      (usage.actual_labor_cost || 0) + 
      (usage.actual_overhead_cost || 0), 0
    );

    const totalActualRevenue = createdUsages.reduce((sum, usage) => 
      sum + (usage.actual_sale_price || 0), 0
    );

    const totalActualProfit = totalActualRevenue - totalActualCost;
    const lowStockItems = inventoryDeductions.filter(d => d.is_low_stock);

    // Return different response format for single vs batch
    if (isBatch) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully created ${createdUsages.length} blueprint usage${createdUsages.length > 1 ? 's' : ''}`,
          mode: "batch",
          summary: {
            blueprints_used: createdUsages.length,
            total_actual_cost: totalActualCost,
            total_actual_revenue: totalActualRevenue,
            total_actual_profit: totalActualProfit,
            profit_margin: totalActualRevenue > 0 
              ? parseFloat(((totalActualProfit / totalActualRevenue) * 100).toFixed(2))
              : 0,
          },
          usages: createdUsages,
          inventory_deductions: inventoryDeductions,
          total_items_deducted: inventoryDeductions.length,
          low_stock_alerts: lowStockItems,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      // Single mode - return simpler response (backwards compatible)
      return new Response(
        JSON.stringify({
          success: true,
          message: "Blueprint usage created successfully",
          mode: "single",
          usage: createdUsages[0],
          inventory_deductions: inventoryDeductions,
          total_items_deducted: inventoryDeductions.length,
          low_stock_alerts: lowStockItems,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error: any) {
    console.error("Error:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        message: "Transaction failed - no changes were made"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});