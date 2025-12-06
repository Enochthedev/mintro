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
    } = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (client !== undefined) updates.client = client;
    if (amount !== undefined) updates.amount = amount;
    if (status !== undefined) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (invoice_date !== undefined) updates.invoice_date = invoice_date;
    if (service_type !== undefined) updates.service_type = service_type;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;

    // Update invoice
    const { data: updated, error: updateError } = await supabaseClient
      .from("invoices")
      .update(updates)
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

        const itemsToInsert = items.map((item: any) => ({
          invoice_id: invoice_id,
          description: item.description,
          category: item.category,
          qty: item.qty ?? 1,
          unit_price: item.unit_price ?? 0,
          // Add override columns if override_split is provided
          ...(item.override_split && {
            override_income: parseFloat(item.override_split.income || 0),
            override_cost: parseFloat(item.override_split.cost || 0),
            is_override: true
          })
        }));

        const { error: itemsError } = await supabaseClient
          .from("invoice_items")
          .insert(itemsToInsert);

        if (itemsError) {
          console.error("Error updating invoice items:", itemsError);
        } else {
          // Calculate the grand total from line items
          finalAmount = itemsToInsert.reduce((sum, item) => {
            return sum + (item.qty * item.unit_price);
          }, 0);

          // Update the invoice amount to reflect the line items total
          const { error: updateAmountError } = await supabaseClient
            .from("invoices")
            .update({ amount: finalAmount })
            .eq("id", invoice_id);

          if (updateAmountError) {
            console.error("Error updating invoice amount:", updateAmountError);
          } else {
            itemsUpdated = true;
            updated.amount = finalAmount;
          }
        }
      } else {
        // If items array is empty, set amount to 0
        const { error: updateAmountError } = await supabaseClient
          .from("invoices")
          .update({ amount: 0 })
          .eq("id", invoice_id);

        if (!updateAmountError) {
          finalAmount = 0;
          updated.amount = 0;
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

      // Recalculate invoice totals
      const { data: allAllocations } = await supabaseClient
        .from("transaction_job_allocations")
        .select("allocation_amount")
        .eq("job_id", invoice_id);

      const transactionCosts = allAllocations?.reduce(
        (sum: number, alloc: any) => sum + Math.abs(Number(alloc.allocation_amount) || 0),
        0
      ) || 0;

      // NEW: Get line item costs (including overrides)
      const { data: lineItems } = await supabaseClient
        .from("invoice_items")
        .select("category, qty, unit_price, is_override, override_cost")
        .eq("invoice_id", invoice_id);

      const lineItemCosts = lineItems?.reduce((sum: number, item: any) => {
        if (item.is_override) {
          // Use manual override cost
          return sum + parseFloat(item.override_cost || 0);
        } else if (!item.category || item.category.toLowerCase() !== 'revenue') {
          // Cost/expense items
          return sum + (item.qty * parseFloat(item.unit_price || 0));
        }
        return sum;
      }, 0) || 0;

      const totalActualCost = transactionCosts + lineItemCosts;

      const actualProfit = totalActualCost > 0
        ? (finalAmount - totalActualCost)
        : null;

      // Update invoice with new totals
      const { data: finalInvoice } = await supabaseClient
        .from("invoices")
        .update({
          total_actual_cost: totalActualCost > 0 ? totalActualCost : null,
          actual_profit: actualProfit,
        })
        .eq("id", invoice_id)
        .select()
        .single();

      updated.total_actual_cost = finalInvoice?.total_actual_cost;
      updated.actual_profit = finalInvoice?.actual_profit;
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