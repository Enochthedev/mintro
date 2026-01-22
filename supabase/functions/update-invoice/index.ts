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

    const {
      invoice_id,
      client,
      amount,
      status,
      due_date,
      invoice_date,
      service_type,
      notes,
      tags,
      items, // Array of line items to replace existing items
      transaction_ids, // Array of transaction IDs to link (replaces existing)
      // Cost breakdown fields (for manual override)
      actual_materials_cost,
      actual_labor_cost,
      actual_overhead_cost,
      cost_override_reason,
    } = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object
    // Note: updated_at is handled automatically by database trigger
    const updates: any = {};

    if (client !== undefined) updates.client = client;
    if (amount !== undefined) updates.amount = amount;
    if (status !== undefined) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (invoice_date !== undefined) updates.invoice_date = invoice_date;
    if (service_type !== undefined) updates.service_type = service_type;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;
    
    // Handle cost breakdown if provided (manual override)
    if (actual_materials_cost !== undefined) updates.actual_materials_cost = actual_materials_cost;
    if (actual_labor_cost !== undefined) updates.actual_labor_cost = actual_labor_cost;
    if (actual_overhead_cost !== undefined) updates.actual_overhead_cost = actual_overhead_cost;
    
    // Calculate total cost and profit if any cost field is provided
    if (actual_materials_cost !== undefined || actual_labor_cost !== undefined || actual_overhead_cost !== undefined) {
      const currentAmount = amount ?? (await supabaseClient.from("invoices").select("amount").eq("id", invoice_id).single()).data?.amount ?? 0;
      
      const totalCost = (actual_materials_cost ?? 0) + (actual_labor_cost ?? 0) + (actual_overhead_cost ?? 0);
      updates.total_actual_cost = totalCost;
      // actual_profit is a GENERATED column - computed automatically as: amount - total_actual_cost
      updates.cost_data_source = "user_verified";
      updates.cost_override_by_user = true;
      if (cost_override_reason) updates.cost_override_reason = cost_override_reason;
    }

    // Only update invoice fields if we have fields to update
    let updated: any = null;
    
    // First, check if this is a QB invoice that's being edited
    // We need to mark it and store original values for merged P&L
    const { data: currentInvoice } = await supabaseClient
      .from("invoices")
      .select("source, quickbooks_invoice_id, amount, total_actual_cost, original_qb_amount, edited_after_sync")
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .single();

    if (currentInvoice?.source === "quickbooks" && Object.keys(updates).length > 0) {
      // This is a QB invoice being edited - mark it and preserve original values
      if (!currentInvoice.edited_after_sync) {
        updates.edited_after_sync = true;
        // Store original QB values if not already stored
        if (!currentInvoice.original_qb_amount) {
          updates.original_qb_amount = currentInvoice.amount;
          updates.original_qb_cost = currentInvoice.total_actual_cost;
        }
      }
    }
    
    if (Object.keys(updates).length > 0) {
      const { data, error: updateError } = await supabaseClient
        .from("invoices")
        .update(updates)
        .eq("id", invoice_id)
        .eq("user_id", user.id)
        .select()
        .single();
      
      if (updateError) {
        throw updateError;
      }
      
      if (!data) {
        return new Response(
          JSON.stringify({ error: "Invoice not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      updated = data;
    } else {
      // No fields to update - just fetch the current invoice
      const { data, error: fetchError } = await supabaseClient
        .from("invoices")
        .select()
        .eq("id", invoice_id)
        .eq("user_id", user.id)
        .single();
      
      if (fetchError) {
        throw fetchError;
      }
      
      if (!data) {
        return new Response(
          JSON.stringify({ error: "Invoice not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      updated = data;
    }

    // Handle line items update if items provided
    let itemsUpdated = false;
    let finalAmount = parseFloat(updated.amount || 0);

    if (items !== undefined) {
      // Delete existing invoice items
      await supabaseClient
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoice_id);

      // Insert new invoice items if provided
      if (items && Array.isArray(items) && items.length > 0) {
        // Validate override_split if present
        for (const item of items) {
          if (item.override_split) {
            const itemTotal = (item.qty ?? 1) * (item.unit_price ?? 0);
            const splitIncome = parseFloat(item.override_split.income || 0);
            const splitCost = parseFloat(item.override_split.cost || 0);

            // Validation: income + cost must equal the line item total
            if (Math.abs((splitIncome + splitCost) - itemTotal) > 0.01) {
              return new Response(JSON.stringify({
                error: `Invalid override_split for "${item.description}": income + cost (${splitIncome + splitCost}) must equal item total (${itemTotal})`,
                details: {
                  item_description: item.description,
                  item_total: itemTotal,
                  override_income: splitIncome,
                  override_cost: splitCost
                }
              }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        }

        const itemsToInsert = items.map((item: any) => {
          // Only allow override_split if category is "revenue"
          const isRevenueCategory = item.category?.toLowerCase() === 'revenue';
          const hasValidOverride = item.override_split && isRevenueCategory;
          
          return {
            invoice_id: invoice_id,
            description: item.description,
            category: item.category,
            qty: item.qty ?? 1,
            unit_price: item.unit_price ?? 0,
            // Only add override columns if override_split is provided AND category is "revenue"
            // Otherwise explicitly clear them to prevent stale values
            override_income: hasValidOverride ? parseFloat(item.override_split.income || 0) : null,
            override_cost: hasValidOverride ? parseFloat(item.override_split.cost || 0) : null,
            is_override: hasValidOverride ? true : false,
          };
        });

        // Insert and get back the actual inserted items
        const { data: insertedItems, error: itemsError } = await supabaseClient
          .from("invoice_items")
          .insert(itemsToInsert)
          .select(); // Get back the inserted items with their actual DB values

        if (itemsError) {
          console.error("Error inserting invoice items:", itemsError);
          throw itemsError; // Throw error instead of continuing
        }

        // Use the ACTUAL inserted items from the database (not itemsToInsert)
        // Calculate the grand total from inserted items
        finalAmount = insertedItems.reduce((sum: number, item: any) => {
          return sum + (item.qty * parseFloat(item.unit_price || 0));
        }, 0);

        // Build JSONB array from INSERTED items (actual DB values)
        const lineItemsJsonb = insertedItems.map((item: any) => ({
          id: item.id, // Include the DB-generated ID
          description: item.description,
          category: item.category,
          qty: item.qty,
          unit_price: parseFloat(item.unit_price),
          total: item.qty * parseFloat(item.unit_price),
          is_override: item.is_override || false,
          override_income: item.override_income || null,
          override_cost: item.override_cost || null,
        }));

        // Update the invoice amount AND line_items JSONB
        const { error: updateAmountError } = await supabaseClient
          .from("invoices")
          .update({ 
            amount: finalAmount,
            line_items: lineItemsJsonb,
          })
          .eq("id", invoice_id);

        if (updateAmountError) {
          console.error("Error updating invoice amount:", updateAmountError);
          throw updateAmountError; // Throw error instead of just logging
        }
        
        itemsUpdated = true;
        updated.amount = finalAmount;
        updated.line_items = lineItemsJsonb;
      } else {
        // If items array is empty, set amount to 0 and clear line_items
        const { error: updateAmountError } = await supabaseClient
          .from("invoices")
          .update({ amount: 0, line_items: [] })
          .eq("id", invoice_id);

        if (!updateAmountError) {
          finalAmount = 0;
          updated.amount = 0;
          updated.line_items = [];
          itemsUpdated = true;
        }
      }
    }


    // Handle transaction linking if transaction_ids provided
    let transactionsLinked = 0;
    let transactionsUnlinked = 0;

    if (transaction_ids !== undefined) {
      // Remove all existing transaction links
      const { data: existingLinks } = await supabaseClient
        .from("transaction_job_allocations")
        .select("id")
        .eq("job_id", invoice_id);

      if (existingLinks && existingLinks.length > 0) {
        await supabaseClient
          .from("transaction_job_allocations")
          .delete()
          .eq("job_id", invoice_id);

        transactionsUnlinked = existingLinks.length;
      }

      // Link new transactions (each 100%)
      if (transaction_ids && transaction_ids.length > 0) {
        const { data: transactions } = await supabaseClient
          .from("transactions")
          .select("id, amount, name")
          .in("id", transaction_ids)
          .eq("user_id", user.id);

        if (transactions) {
          // Validate allocations
          for (const tx of transactions) {
            const { data: existingAllocations } = await supabaseClient
              .from("transaction_job_allocations")
              .select("allocation_amount")
              .eq("transaction_id", tx.id);

            // Calculate total allocated to OTHER jobs (since we just deleted links for this job)
            const totalAllocated = existingAllocations?.reduce((sum: number, a: any) => sum + Math.abs(Number(a.allocation_amount) || 0), 0) || 0;
            const txAmount = Math.abs(parseFloat(tx.amount));

            // Check if adding 100% of this transaction would exceed the total amount
            // We use 100% because this endpoint links the full transaction
            if (totalAllocated + txAmount > txAmount + 0.01) {
              return new Response(
                JSON.stringify({
                  error: `Transaction "${tx.name || tx.id}" is already partially or fully allocated to other jobs. Cannot link 100% to this invoice.`,
                  details: {
                    transaction_id: tx.id,
                    total_amount: txAmount,
                    already_allocated: totalAllocated,
                    attempted_allocation: txAmount
                  }
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }

          const allocations = transactions.map((tx: any) => ({
            user_id: user.id,
            transaction_id: tx.id,
            job_id: invoice_id,
            allocation_amount: Math.abs(parseFloat(tx.amount)),
            allocation_percentage: 100,
          }));

          const { error: linkError } = await supabaseClient
            .from("transaction_job_allocations")
            .insert(allocations);

          if (!linkError) {
            transactionsLinked = allocations.length;
          } else {
            throw linkError;
          }
        }
      }
    }

    // ============================================
    // ALWAYS RECALCULATE COSTS after items or transactions change
    // This was the bug - we only recalculated when transaction_ids was provided!
    // ============================================
    if (items !== undefined || transaction_ids !== undefined) {
      // Get all linked transaction costs
      const { data: allAllocations } = await supabaseClient
        .from("transaction_job_allocations")
        .select("allocation_amount")
        .eq("job_id", invoice_id);

      const transactionCosts = allAllocations?.reduce(
        (sum: number, alloc: any) => sum + Math.abs(Number(alloc.allocation_amount) || 0),
        0
      ) || 0;

      // Get line item costs (including overrides)
      const { data: lineItems } = await supabaseClient
        .from("invoice_items")
        .select("category, qty, unit_price, is_override, override_cost")
        .eq("invoice_id", invoice_id);

      const lineItemCosts = lineItems?.reduce((sum: number, item: any) => {
        if (item.is_override) {
          // Use manual override cost
          return sum + parseFloat(item.override_cost || 0);
        } else if (!item.category || item.category.toLowerCase() !== 'revenue') {
          // Cost/expense items (anything that is NOT revenue is a cost)
          return sum + (item.qty * parseFloat(item.unit_price || 0));
        }
        return sum;
      }, 0) || 0;

      const totalActualCost = transactionCosts + lineItemCosts;

      // actual_profit is a GENERATED column - no need to calculate or update it
      // The database automatically computes: amount - total_actual_cost

      // Update invoice with new totals
      const { data: finalInvoice } = await supabaseClient
        .from("invoices")
        .update({
          total_actual_cost: totalActualCost > 0 ? totalActualCost : null,
          // actual_profit is computed automatically by the database
          // Set cost source based on what data we have
          cost_data_source: transactionCosts > 0 ? 'transaction_linked' : (lineItemCosts > 0 ? 'line_items' : null),
        })
        .eq("id", invoice_id)
        .select()
        .single();

      updated.total_actual_cost = finalInvoice?.total_actual_cost;
      updated.actual_profit = finalInvoice?.actual_profit; // Read from DB (computed)
      updated.cost_data_source = finalInvoice?.cost_data_source;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invoice updated successfully",
        invoice: updated,
        ...(items !== undefined && {
          items_updated: itemsUpdated,
        }),
        ...(transaction_ids !== undefined && {
          transactions_linked: transactionsLinked,
          transactions_unlinked: transactionsUnlinked,
        }),
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