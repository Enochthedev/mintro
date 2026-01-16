import { createClient } from "npm:@supabase/supabase-js@2.29.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? ""
        }
      }
    });
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    const user = userData?.user ?? null;
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const payload = await req.json().catch(() => ({}));
    const { client, amount, status = "draft", due_date, invoice_date, service_type, notes, tags, items, blueprint_ids, blueprint_usages, transaction_ids, auto_calculate_from_blueprints = false } = payload;

    if (!client || amount === undefined && !auto_calculate_from_blueprints) {
      return new Response(JSON.stringify({
        error: "client and amount are required (or provide blueprint_ids with auto_calculate_from_blueprints=true)"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    let calculatedAmount = amount;
    let blueprints = [];

    // Determine which IDs to fetch
    // Support both 'blueprint_usages' (with overrides) and 'blueprint_ids' (all blueprints)
    // Frontend may send:
    //   - blueprint_ids: ALL blueprints to link (e.g., ["bp-1", "bp-2"])
    //   - blueprint_usages: ONLY blueprints with overrides (e.g., [{ blueprint_id: "bp-2", actual_sale_price: 9999 }])
    // We need to fetch ALL unique IDs from both sources
    let idsToFetch = [];
    const usageIds = blueprint_usages && Array.isArray(blueprint_usages) && blueprint_usages.length > 0
      ? blueprint_usages.map((b: any) => b.blueprint_id)
      : [];
    const directIds = blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0
      ? blueprint_ids
      : [];

    // Merge and deduplicate IDs from both sources
    idsToFetch = Array.from(new Set([...usageIds, ...directIds]));

    if (idsToFetch.length > 0) {
      const { data: fetchedBlueprints, error: blueprintError } = await supabaseClient.from("cost_blueprints").select("*").eq("user_id", user.id).in("id", idsToFetch);
      if (blueprintError) throw blueprintError;

      if (!fetchedBlueprints || fetchedBlueprints.length !== idsToFetch.length) {
        return new Response(JSON.stringify({
          error: "One or more blueprints not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      // Merge fetched blueprints with overrides from input
      blueprints = fetchedBlueprints.map(dbBp => {
        // Find matching input usage if it exists
        const inputUsage = blueprint_usages?.find((b: any) => b.blueprint_id === dbBp.id);

        if (inputUsage) {
          // Apply overrides if present (using standard field names)
          return {
            ...dbBp,
            target_sale_price: inputUsage.actual_sale_price ?? dbBp.target_sale_price,
            estimated_materials_cost: inputUsage.actual_materials_cost ?? dbBp.estimated_materials_cost,
            estimated_labor_cost: inputUsage.actual_labor_cost ?? dbBp.estimated_labor_cost,
            estimated_overhead_cost: inputUsage.actual_overhead_cost ?? dbBp.estimated_overhead_cost
          };
        }
        return dbBp;
      });

      if (auto_calculate_from_blueprints) {
        calculatedAmount = blueprints.reduce((sum, bp) => {
          const val = bp?.target_sale_price ?? 0;
          const n = typeof val === "number" ? val : parseFloat(String(val)) || 0;
          return sum + n;
        }, 0);
      }
    }
    const invoiceDate = invoice_date ?? new Date().toISOString().split("T")[0];
    const { data: invoice, error: invoiceError } = await supabaseClient.from("invoices").insert({
      user_id: user.id,
      client,
      amount: calculatedAmount,
      status,
      due_date,
      invoice_date: invoiceDate,
      service_type,
      notes,
      tags
    }).select().single();
    if (invoiceError) throw invoiceError;
    if (!invoice) throw new Error("Failed to create invoice");

    // Track whether we have blueprints (regardless of auto_calculate flag)
    const hasBlueprints = blueprints && blueprints.length > 0;

    // Calculate total from line items if provided
    // LOGIC UPDATE:
    // 1. Invoice Amount = Blueprints Sale Price + ALL Line Items (Revenue AND Expenses)
    // 2. Total Actual Cost = Blueprint Costs + Expense Line Items (Revenue items excluded)
    let finalAmount = calculatedAmount;
    let lineItemRevenue = 0;
    let lineItemCosts = 0;

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
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            });
          }
        }
      }

      const itemsToInsert = items.map((item) => ({
        invoice_id: invoice.id,
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
      const { error: itemsError } = await supabaseClient.from("invoice_items").insert(itemsToInsert);
      if (itemsError) {
        console.error("Error creating invoice items:", itemsError);
      } else {
        // Separate line items for cost tracking
        // NEW LOGIC: Use override_cost if present, otherwise use category-based logic
        items.forEach((item, index) => {
          const itemTotal = (item.qty ?? 1) * (item.unit_price ?? 0);

          if (item.override_split) {
            // Use manual override
            lineItemRevenue += parseFloat(item.override_split.income || 0);
            lineItemCosts += parseFloat(item.override_split.cost || 0);
          } else if (item.category && item.category.toLowerCase() === 'revenue') {
            // Revenue items: Add to Amount, Exclude from Cost
            lineItemRevenue += itemTotal;
          } else {
            // Cost/Expense items: Add to Amount (charged to client), Add to Cost (expense incurred)
            lineItemCosts += itemTotal;
          }
        });

        // Calculate total of ALL line items for the Invoice Amount
        const allLineItemsTotal = lineItemRevenue + lineItemCosts;

        // Calculate final invoice amount
        if (hasBlueprints && blueprints.length > 0) {
          const blueprintTotal = blueprints.reduce((sum, bp) => {
            const val = bp?.target_sale_price ?? 0;
            const n = typeof val === "number" ? val : parseFloat(String(val)) || 0;
            return sum + n;
          }, 0);
          // Invoice Amount = blueprint sale prices + ALL line items
          finalAmount = blueprintTotal + allLineItemsTotal;
        } else {
          // No blueprints: ALL line items
          finalAmount = allLineItemsTotal > 0 ? allLineItemsTotal : calculatedAmount;
        }

        // Update the invoice amount to reflect the calculated total
        const { error: updateAmountError } = await supabaseClient
          .from("invoices")
          .update({ amount: finalAmount })
          .eq("id", invoice.id);

        if (updateAmountError) {
          console.error("Error updating invoice amount:", updateAmountError);
        }
      }
    }
    let blueprintUsages = [];
    let blueprintTotalCost = 0;
    if (blueprints.length > 0) {
      console.log(`Processing ${blueprints.length} blueprints for invoice ${invoice.id}`);
      const usagesToCreate = blueprints.map((bp) => {
        const estMaterialsCost = parseFloat(bp.estimated_materials_cost || 0);
        const estLaborCost = parseFloat(bp.estimated_labor_cost || 0);
        const estOverheadCost = parseFloat(bp.estimated_overhead_cost || 0);

        return {
          user_id: user.id,
          blueprint_id: bp.id,
          invoice_id: invoice.id,
          // Use estimated costs as initial actual costs
          actual_materials_cost: estMaterialsCost,
          actual_labor_cost: estLaborCost,
          actual_overhead_cost: estOverheadCost,
          // total_actual_cost is a GENERATED column - don't include it
          // actual_profit is a GENERATED column - don't include it
          actual_sale_price: bp.target_sale_price ?? 0,
          completed_date: invoiceDate,
          notes: `Created with invoice ${invoice.invoice}`
        };
      });

      // Calculate total cost from all blueprints for the invoice-level calculation
      // (blueprint_usage records will have their own generated total_actual_cost)
      blueprintTotalCost = usagesToCreate.reduce((sum, usage) => {
        return sum + usage.actual_materials_cost + usage.actual_labor_cost + usage.actual_overhead_cost;
      }, 0);
      console.log(`Blueprint total cost: ${blueprintTotalCost}`);

      const { data: createdUsages, error: usageError } = await supabaseClient.from("blueprint_usage").insert(usagesToCreate).select(`
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price
          )
        `);
      if (usageError) {
        console.error("Error creating blueprint usage:", usageError);
      } else {
        blueprintUsages = createdUsages ?? [];
        console.log(`Created ${blueprintUsages.length} blueprint usage records`);
      }
    } else {
      console.log("No blueprints to process");
    }
    let linkedTransactionsCount = 0;
    let transactionCosts = 0;
    if (transaction_ids && Array.isArray(transaction_ids) && transaction_ids.length > 0) {
      const { data: transactions, error: txError } = await supabaseClient.from("transactions").select("id, amount, name").eq("user_id", user.id).in("id", transaction_ids);
      if (txError) {
        console.error("Error fetching transactions:", txError);
      } else if (transactions && transactions.length > 0) {

        // VALIDATION: Check for over-allocation
        for (const tx of transactions) {
          const { data: existingAllocations } = await supabaseClient
            .from("transaction_job_allocations")
            .select("allocation_amount")
            .eq("transaction_id", tx.id);

          const totalAllocated = existingAllocations?.reduce((sum: number, a: any) => sum + Math.abs(Number(a.allocation_amount) || 0), 0) || 0;
          const txAmount = Math.abs(parseFloat(tx.amount));

          if (totalAllocated + txAmount > txAmount + 0.01) {
            return new Response(JSON.stringify({
              error: `Transaction "${tx.name || tx.id}" is already partially or fully allocated to other jobs. Cannot link 100% to this invoice.`,
              details: {
                transaction_id: tx.id,
                total_amount: txAmount,
                already_allocated: totalAllocated,
                attempted_allocation: txAmount
              }
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            });
          }
        }

        const allocationsToCreate = transactions.map((tx) => {
          const amt = Math.abs(Number(tx.amount) || 0);
          return {
            user_id: user.id,
            transaction_id: tx.id,
            job_id: invoice.id,
            allocation_amount: amt,
            allocation_percentage: 100,
            notes: "Linked during invoice creation"
          };
        });
        const { data: allocations, error: allocError } = await supabaseClient.from("transaction_job_allocations").insert(allocationsToCreate).select();
        if (allocError) {
          console.error("Error creating allocations:", allocError);
        } else {
          linkedTransactionsCount = allocations?.length ?? 0;
          transactionCosts = transactions.reduce((sum, tx) => {
            return sum + Math.abs(Number(tx.amount) || 0);
          }, 0);
        }
      }
    }

    // Calculate total actual cost from blueprints, transactions, and cost line items
    // total_actual_cost = blueprint costs + transaction costs + cost line items (NOT revenue items)
    const totalActualCost = blueprintTotalCost + transactionCosts + lineItemCosts;
    const actualProfit = totalActualCost > 0 ? ((Number(finalAmount) || 0) - totalActualCost) : null;

    // Determine cost data source for frontend display
    let costDataSource = null;
    if (transactionCosts > 0) {
      costDataSource = "transaction_linked"; // Most reliable - actual bank data
    } else if (blueprintTotalCost > 0) {
      costDataSource = "blueprint_linked"; // Good - user's estimates
    } else if (lineItemCosts > 0) {
      costDataSource = "user_verified"; // User entered line items
    }

    // Update invoice with cost totals if there are any costs to track
    if (totalActualCost > 0 || blueprintTotalCost > 0) {
      await supabaseClient.from("invoices").update({
        total_actual_cost: totalActualCost > 0 ? totalActualCost : null,
        actual_profit: actualProfit,
        cost_data_source: costDataSource,
      }).eq("id", invoice.id);
    }
    const { data: completeInvoice } = await supabaseClient.from("invoices").select(`
        *,
        invoice_items (*),
        blueprint_usage (
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price
          )
        ),
        transaction_job_allocations (
          id,
          allocation_amount,
          allocation_percentage,
          notes,
          created_at,
          transactions (
            id,
            date,
            name,
            merchant_name,
            amount,
            category
          )
        )
      `).eq("id", invoice.id).single();
    return new Response(JSON.stringify({
      success: true,
      message: "Invoice created successfully",
      invoice: completeInvoice ?? invoice,
      blueprints_linked: blueprintUsages.length,
      transactions_linked: linkedTransactionsCount,
      total_actual_cost: totalActualCost > 0 ? totalActualCost : null
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error?.message ?? String(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
