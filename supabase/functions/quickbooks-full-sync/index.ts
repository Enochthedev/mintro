import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * quickbooks-full-sync
 * 
 * COMPREHENSIVE QuickBooks sync that properly calculates profit:
 * 
 * 1. Sync Items (products/services) - Gets ACTUAL PurchaseCost per item
 * 2. Sync Chart of Accounts - For expense classification
 * 3. Sync Invoices - Revenue with line items
 * 4. Calculate REAL costs using Item.PurchaseCost × Quantity
 * 5. Sync Purchases/Bills - Direct expenses that can be linked to customers
 * 
 * KEY INSIGHT: QuickBooks Items have PurchaseCost (what you pay) and UnitPrice (what you charge).
 * Invoice line items reference these Items, so we can calculate ACTUAL cost per invoice.
 */

interface SyncResults {
  items: { synced: number; with_cost: number; errors: string[] };
  accounts: { synced: number; errors: string[] };
  invoices: { synced: number; updated: number; errors: string[] };
  expenses: { purchases: number; bills: number; errors: string[] };
  cost_calculation: { invoices_with_real_costs: number; total_revenue: number; total_cost: number };
}

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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get QuickBooks connection
    const { data: qbAuth, error: qbAuthError } = await supabaseClient
      .from("quickbooks_connections")
      .select("id, access_token, refresh_token, realm_id, token_expires_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (qbAuthError || !qbAuth) {
      return new Response(
        JSON.stringify({ error: "QuickBooks not connected. Please connect your QuickBooks account first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check token expiration and refresh if needed
    let accessToken = qbAuth.access_token;
    const expiresAt = new Date(qbAuth.token_expires_at);

    if (expiresAt <= new Date()) {
      console.log("Token expired, refreshing...");
      const refreshResult = await refreshAccessToken(qbAuth.refresh_token);
      if (!refreshResult.success) {
        return new Response(
          JSON.stringify({ error: "Failed to refresh QuickBooks token. Please reconnect." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      accessToken = refreshResult.access_token;

      await supabaseClient
        .from("quickbooks_connections")
        .update({
          access_token: refreshResult.access_token,
          refresh_token: refreshResult.refresh_token,
          token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
        })
        .eq("id", qbAuth.id);
    }

    const baseUrl = Deno.env.get("QUICKBOOKS_ENVIRONMENT") === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    const results: SyncResults = {
      items: { synced: 0, with_cost: 0, errors: [] },
      accounts: { synced: 0, errors: [] },
      invoices: { synced: 0, updated: 0, errors: [] },
      expenses: { purchases: 0, bills: 0, errors: [] },
      cost_calculation: { invoices_with_real_costs: 0, total_revenue: 0, total_cost: 0 },
    };

    // ========== STEP 1: SYNC ITEMS (CRITICAL FOR COST CALCULATION) ==========
    console.log("Step 1: Syncing Items with PurchaseCost...");
    const itemCostMap = new Map<string, { purchaseCost: number; unitPrice: number; name: string; type: string }>();

    try {
      const itemQuery = encodeURIComponent("SELECT * FROM Item MAXRESULTS 1000");
      const itemResponse = await fetch(
        `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${itemQuery}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );

      if (itemResponse.ok) {
        const itemData = await itemResponse.json();
        const items = itemData.QueryResponse?.Item || [];
        console.log(`Found ${items.length} items from QuickBooks`);

        for (const item of items) {
          // Store in map for invoice cost calculation
          itemCostMap.set(item.Id, {
            purchaseCost: item.PurchaseCost || 0,
            unitPrice: item.UnitPrice || 0,
            name: item.Name,
            type: item.Type,
          });

          // Upsert to database
          const { error } = await supabaseClient.from("quickbooks_items").upsert({
            user_id: user.id,
            quickbooks_item_id: item.Id,
            name: item.Name,
            sku: item.Sku || null,
            description: item.Description || null,
            item_type: item.Type,
            unit_price: item.UnitPrice || null,
            purchase_cost: item.PurchaseCost || null,
            qty_on_hand: item.QtyOnHand || 0,
            income_account_ref: item.IncomeAccountRef?.name || null,
            expense_account_ref: item.ExpenseAccountRef?.name || null,
            asset_account_ref: item.AssetAccountRef?.name || null,
            is_active: item.Active !== false,
            synced_at: new Date().toISOString(),
          }, { onConflict: "user_id,quickbooks_item_id" });

          if (error) {
            results.items.errors.push(`Item ${item.Id}: ${error.message}`);
          } else {
            results.items.synced++;
            if (item.PurchaseCost && item.PurchaseCost > 0) {
              results.items.with_cost++;
            }
          }
        }
      }
    } catch (err: any) {
      results.items.errors.push(`Query failed: ${err.message}`);
    }

    console.log(`Items synced: ${results.items.synced}, with PurchaseCost: ${results.items.with_cost}`);

    // ========== STEP 2: SYNC CHART OF ACCOUNTS ==========
    console.log("Step 2: Syncing Chart of Accounts...");
    const accountMap = new Map<string, { category: string; accountType: string; name: string }>();

    try {
      const accountQuery = encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000");
      const accountResponse = await fetch(
        `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${accountQuery}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );

      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        const accounts = accountData.QueryResponse?.Account || [];

        for (const account of accounts) {
          const mintroCategory = classifyAccountType(account.AccountType);
          
          accountMap.set(account.Id, {
            category: mintroCategory,
            accountType: account.AccountType,
            name: account.Name,
          });

          const { error } = await supabaseClient.from("quickbooks_chart_of_accounts").upsert({
            user_id: user.id,
            quickbooks_account_id: account.Id,
            name: account.Name,
            account_type: account.AccountType,
            account_sub_type: account.AccountSubType || null,
            classification: account.Classification || null,
            mintro_category: mintroCategory,
            is_active: account.Active !== false,
            synced_at: new Date().toISOString(),
          }, { onConflict: "user_id,quickbooks_account_id" });

          if (error) {
            results.accounts.errors.push(`Account ${account.Id}: ${error.message}`);
          } else {
            results.accounts.synced++;
          }
        }
      }
    } catch (err: any) {
      results.accounts.errors.push(`Query failed: ${err.message}`);
    }

    // ========== STEP 3: SYNC INVOICES WITH REAL COST CALCULATION ==========
    console.log("Step 3: Syncing Invoices with real cost calculation...");

    try {
      const invoiceQuery = encodeURIComponent("SELECT * FROM Invoice MAXRESULTS 1000");
      const invoiceResponse = await fetch(
        `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${invoiceQuery}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );

      if (invoiceResponse.ok) {
        const invoiceData = await invoiceResponse.json();
        const qbInvoices = invoiceData.QueryResponse?.Invoice || [];
        console.log(`Found ${qbInvoices.length} invoices from QuickBooks`);

        for (const qbInvoice of qbInvoices) {
          try {
            // Calculate REAL costs from line items using Item.PurchaseCost
            const costCalc = calculateRealCosts(qbInvoice.Line, itemCostMap);
            const revenue = qbInvoice.TotalAmt || 0;

            results.cost_calculation.total_revenue += revenue;
            results.cost_calculation.total_cost += costCalc.totalCost;
            if (costCalc.hasRealCost) {
              results.cost_calculation.invoices_with_real_costs++;
            }

            // Build line items JSONB
            const lineItemsJsonb = buildLineItemsJsonb(qbInvoice.Line, itemCostMap);

            // Check if invoice exists
            const { data: existing } = await supabaseClient
              .from("invoices")
              .select("id, edited_after_sync, cost_data_source")
              .eq("user_id", user.id)
              .eq("quickbooks_id", qbInvoice.Id)
              .single();

            const invoiceRecord: any = {
              user_id: user.id,
              quickbooks_id: qbInvoice.Id,
              qb_doc_number: qbInvoice.DocNumber || null,
              client: qbInvoice.CustomerRef?.name || "Unknown Customer",
              amount: revenue,
              status: mapQBStatus(qbInvoice.Balance, revenue),
              invoice_date: qbInvoice.TxnDate || null,
              due_date: qbInvoice.DueDate || null,
              billing_address: extractBillingAddress(qbInvoice.BillAddr),
              service_type: deriveServiceType(qbInvoice.Line),
              notes: qbInvoice.CustomerMemo?.value || qbInvoice.PrivateNote || null,
              line_items: lineItemsJsonb,
              quickbooks_raw_data: qbInvoice,
              source: 'quickbooks',
              original_qb_amount: revenue,
              qb_last_synced_at: new Date().toISOString(),
            };

            // Only update costs if not manually edited
            const shouldUpdateCosts = !existing?.edited_after_sync;
            if (shouldUpdateCosts) {
              invoiceRecord.actual_materials_cost = costCalc.materials;
              invoiceRecord.actual_labor_cost = costCalc.labor;
              invoiceRecord.actual_overhead_cost = costCalc.overhead;
              invoiceRecord.total_actual_cost = costCalc.totalCost;
              invoiceRecord.original_qb_cost = costCalc.totalCost;
              invoiceRecord.cost_data_source = costCalc.source;
            }

            if (existing) {
              const { error } = await supabaseClient
                .from("invoices")
                .update(invoiceRecord)
                .eq("id", existing.id);

              if (error) {
                results.invoices.errors.push(`Update ${qbInvoice.Id}: ${error.message}`);
              } else {
                // Update line items
                await syncLineItems(supabaseClient, existing.id, qbInvoice.Line, itemCostMap);
                results.invoices.updated++;
              }
            } else {
              const { data: newInvoice, error } = await supabaseClient
                .from("invoices")
                .insert(invoiceRecord)
                .select("id")
                .single();

              if (error) {
                results.invoices.errors.push(`Insert ${qbInvoice.Id}: ${error.message}`);
              } else {
                // Create line items
                await syncLineItems(supabaseClient, newInvoice.id, qbInvoice.Line, itemCostMap);
                results.invoices.synced++;
              }
            }
          } catch (invErr: any) {
            results.invoices.errors.push(`Invoice ${qbInvoice.Id}: ${invErr.message}`);
          }
        }
      }
    } catch (err: any) {
      results.invoices.errors.push(`Query failed: ${err.message}`);
    }

    // ========== STEP 4: SYNC PURCHASES (DIRECT EXPENSES) ==========
    console.log("Step 4: Syncing Purchases...");
    try {
      const purchaseQuery = encodeURIComponent("SELECT * FROM Purchase MAXRESULTS 1000");
      const purchaseResponse = await fetch(
        `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${purchaseQuery}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );

      if (purchaseResponse.ok) {
        const purchaseData = await purchaseResponse.json();
        const purchases = purchaseData.QueryResponse?.Purchase || [];

        for (const purchase of purchases) {
          const refs = extractLineRefs(purchase.Line);

          const { error } = await supabaseClient.from("quickbooks_expenses").upsert({
            user_id: user.id,
            quickbooks_expense_id: purchase.Id,
            expense_type: "purchase",
            vendor_name: purchase.EntityRef?.name || null,
            vendor_id: purchase.EntityRef?.value || null,
            total_amount: purchase.TotalAmt,
            currency: purchase.CurrencyRef?.value || "USD",
            payment_type: purchase.PaymentType || null,
            customer_ref_id: refs.customerRefId,
            customer_ref_name: refs.customerRefName,
            account_ref_id: refs.accountRefId,
            account_ref_name: refs.accountRefName,
            transaction_date: purchase.TxnDate,
            line_items: purchase.Line,
            memo: purchase.PrivateNote || null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "user_id,quickbooks_expense_id" });

          if (!error) results.expenses.purchases++;
        }
      }
    } catch (err: any) {
      results.expenses.errors.push(`Purchases: ${err.message}`);
    }

    // ========== STEP 5: SYNC BILLS ==========
    console.log("Step 5: Syncing Bills...");
    try {
      const billQuery = encodeURIComponent("SELECT * FROM Bill MAXRESULTS 1000");
      const billResponse = await fetch(
        `${baseUrl}/v3/company/${qbAuth.realm_id}/query?query=${billQuery}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );

      if (billResponse.ok) {
        const billData = await billResponse.json();
        const bills = billData.QueryResponse?.Bill || [];

        for (const bill of bills) {
          const refs = extractLineRefs(bill.Line);

          const { error } = await supabaseClient.from("quickbooks_expenses").upsert({
            user_id: user.id,
            quickbooks_expense_id: `bill-${bill.Id}`,
            expense_type: "bill",
            vendor_name: bill.VendorRef?.name || null,
            vendor_id: bill.VendorRef?.value || null,
            total_amount: bill.TotalAmt,
            currency: bill.CurrencyRef?.value || "USD",
            customer_ref_id: refs.customerRefId,
            customer_ref_name: refs.customerRefName,
            account_ref_id: refs.accountRefId,
            account_ref_name: refs.accountRefName,
            transaction_date: bill.TxnDate,
            due_date: bill.DueDate || null,
            line_items: bill.Line,
            memo: bill.PrivateNote || null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "user_id,quickbooks_expense_id" });

          if (!error) results.expenses.bills++;
        }
      }
    } catch (err: any) {
      results.expenses.errors.push(`Bills: ${err.message}`);
    }

    // Update connection last_sync
    await supabaseClient
      .from("quickbooks_connections")
      .update({ last_sync: new Date().toISOString() })
      .eq("id", qbAuth.id);

    // Calculate summary
    const totalProfit = results.cost_calculation.total_revenue - results.cost_calculation.total_cost;
    const profitMargin = results.cost_calculation.total_revenue > 0
      ? (totalProfit / results.cost_calculation.total_revenue) * 100
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Full sync complete! ${results.items.synced} items, ${results.accounts.synced} accounts, ${results.invoices.synced + results.invoices.updated} invoices, ${results.expenses.purchases + results.expenses.bills} expenses`,
        results,
        profitability_summary: {
          total_revenue: parseFloat(results.cost_calculation.total_revenue.toFixed(2)),
          total_cost: parseFloat(results.cost_calculation.total_cost.toFixed(2)),
          total_profit: parseFloat(totalProfit.toFixed(2)),
          profit_margin: parseFloat(profitMargin.toFixed(2)),
          invoices_with_real_costs: results.cost_calculation.invoices_with_real_costs,
          items_with_purchase_cost: results.items.with_cost,
        },
        data_quality: {
          items_with_cost_percentage: results.items.synced > 0
            ? parseFloat(((results.items.with_cost / results.items.synced) * 100).toFixed(1))
            : 0,
          invoices_with_real_cost_percentage: (results.invoices.synced + results.invoices.updated) > 0
            ? parseFloat(((results.cost_calculation.invoices_with_real_costs / (results.invoices.synced + results.invoices.updated)) * 100).toFixed(1))
            : 0,
          recommendation: results.items.with_cost < results.items.synced * 0.5
            ? "Add PurchaseCost to your QuickBooks Items for more accurate profit tracking"
            : "Good coverage of item costs!",
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// ========== HELPER FUNCTIONS ==========

/**
 * Calculate REAL costs from invoice line items using Item.PurchaseCost
 * This is the KEY function - it uses actual cost data from QuickBooks Items
 */
function calculateRealCosts(
  lines: any[],
  itemCostMap: Map<string, { purchaseCost: number; unitPrice: number; name: string; type: string }>
): {
  materials: number;
  labor: number;
  overhead: number;
  totalCost: number;
  source: string;
  hasRealCost: boolean;
  details: any[];
} {
  let materials = 0;
  let labor = 0;
  let overhead = 0;
  let hasRealCost = false;
  const details: any[] = [];

  for (const line of lines || []) {
    if (line.DetailType !== "SalesItemLineDetail" || !line.SalesItemLineDetail) continue;

    const itemRef = line.SalesItemLineDetail.ItemRef;
    const qty = line.SalesItemLineDetail.Qty || 1;
    const lineAmount = line.Amount || 0;

    if (!itemRef) continue;

    const itemData = itemCostMap.get(itemRef.value);

    if (itemData && itemData.purchaseCost > 0) {
      // We have REAL cost data from QuickBooks Item!
      const actualCost = itemData.purchaseCost * qty;
      hasRealCost = true;

      // Classify based on item type
      if (itemData.type === "Inventory" || itemData.type === "NonInventory") {
        materials += actualCost;
      } else if (itemData.type === "Service") {
        labor += actualCost;
      } else {
        overhead += actualCost;
      }

      details.push({
        item: itemData.name,
        qty,
        unit_cost: itemData.purchaseCost,
        total_cost: actualCost,
        sale_price: lineAmount,
        margin: lineAmount - actualCost,
        source: "qb_item_cost",
      });
    } else {
      // No PurchaseCost - use conservative estimate based on typical margins
      // Service businesses typically have 30-40% cost, product businesses 50-60%
      const itemType = itemData?.type || "Unknown";
      let estimatedCostRatio = 0.35; // Default 35% cost ratio

      if (itemType === "Inventory" || itemType === "NonInventory") {
        estimatedCostRatio = 0.55; // Products typically have higher cost ratio
        materials += lineAmount * estimatedCostRatio;
      } else if (itemType === "Service") {
        estimatedCostRatio = 0.30; // Services typically have lower direct cost
        labor += lineAmount * estimatedCostRatio;
      } else {
        overhead += lineAmount * 0.10; // Minimal overhead for unknown items
      }

      details.push({
        item: itemData?.name || itemRef.name || "Unknown",
        qty,
        unit_cost: null,
        total_cost: lineAmount * estimatedCostRatio,
        sale_price: lineAmount,
        margin: lineAmount * (1 - estimatedCostRatio),
        source: "estimated",
      });
    }
  }

  const totalCost = materials + labor + overhead;

  return {
    materials: Math.round(materials * 100) / 100,
    labor: Math.round(labor * 100) / 100,
    overhead: Math.round(overhead * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    source: hasRealCost ? "qb_item_cost" : "estimated",
    hasRealCost,
    details,
  };
}

/**
 * Build line items JSONB with cost data for quick access
 */
function buildLineItemsJsonb(
  lines: any[],
  itemCostMap: Map<string, { purchaseCost: number; unitPrice: number; name: string; type: string }>
): any[] {
  return (lines || [])
    .filter(line => line.DetailType === "SalesItemLineDetail")
    .map(line => {
      const detail = line.SalesItemLineDetail;
      const itemRef = detail?.ItemRef;
      const itemData = itemRef ? itemCostMap.get(itemRef.value) : null;
      const qty = detail?.Qty || 1;
      const unitPrice = detail?.UnitPrice || 0;

      return {
        description: line.Description || itemRef?.name || "Item",
        category: null,
        qty,
        unit_price: unitPrice,
        total: qty * unitPrice,
        qb_item_ref: itemRef?.value || null,
        qb_item_name: itemRef?.name || null,
        // Cost data
        unit_cost: itemData?.purchaseCost || null,
        total_cost: itemData?.purchaseCost ? itemData.purchaseCost * qty : null,
        has_real_cost: !!(itemData?.purchaseCost && itemData.purchaseCost > 0),
      };
    });
}

/**
 * Sync line items to invoice_items table
 */
async function syncLineItems(
  supabaseClient: any,
  invoiceId: string,
  lines: any[],
  itemCostMap: Map<string, { purchaseCost: number; unitPrice: number; name: string; type: string }>
) {
  // Delete existing line items
  await supabaseClient
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoiceId);

  const lineItems = (lines || []).filter(line => line.DetailType === "SalesItemLineDetail");

  if (lineItems.length === 0) return;

  const itemsToInsert = lineItems.map(line => {
    const detail = line.SalesItemLineDetail;
    const itemRef = detail?.ItemRef;
    const itemData = itemRef ? itemCostMap.get(itemRef.value) : null;
    const qty = detail?.Qty || 1;

    return {
      invoice_id: invoiceId,
      description: line.Description || itemRef?.name || "Item",
      qty: Math.round(qty),
      unit_price: detail?.UnitPrice || 0,
      quickbooks_item_ref: itemRef?.value || null,
      quickbooks_item_name: itemRef?.name || null,
      quickbooks_line_id: line.Id || null,
      quickbooks_raw_data: line,
      // Store cost data if available
      override_cost: itemData?.purchaseCost ? itemData.purchaseCost * qty : null,
      is_override: false, // This is QB data, not user override
    };
  });

  await supabaseClient.from("invoice_items").insert(itemsToInsert);
}

/**
 * Classify QB AccountType to Mintro category
 */
function classifyAccountType(accountType: string): string {
  const type = (accountType || "").toLowerCase();
  if (type.includes("cost of goods")) return "cogs";
  if (type.includes("expense") || type === "other expense") return "expense";
  if (type.includes("income") || type === "other income") return "revenue";
  if (type.includes("bank") || type.includes("credit card")) return "transfer";
  if (type.includes("loan") || type.includes("equity") || type.includes("liability")) return "exclude";
  if (type.includes("receivable") || type.includes("payable") || type.includes("asset")) return "exclude";
  return "other";
}

/**
 * Extract refs from expense line items
 */
function extractLineRefs(lines: any[]): {
  customerRefId: string | null;
  customerRefName: string | null;
  accountRefId: string | null;
  accountRefName: string | null;
} {
  let customerRefId = null, customerRefName = null, accountRefId = null, accountRefName = null;

  for (const line of lines || []) {
    const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
    if (detail) {
      if (detail.CustomerRef && !customerRefId) {
        customerRefId = detail.CustomerRef.value;
        customerRefName = detail.CustomerRef.name;
      }
      if (detail.AccountRef && !accountRefId) {
        accountRefId = detail.AccountRef.value;
        accountRefName = detail.AccountRef.name;
      }
    }
  }
  return { customerRefId, customerRefName, accountRefId, accountRefName };
}

/**
 * Map QB invoice status
 */
function mapQBStatus(balance: number, total: number): string {
  if (balance === 0) return "paid";
  if (balance < total) return "partial";
  return "sent";
}

/**
 * Extract billing address from QB BillAddr
 */
function extractBillingAddress(billAddr: any): string | null {
  if (!billAddr) return null;

  const lines = [billAddr.Line1, billAddr.Line2, billAddr.Line3, billAddr.Line4, billAddr.Line5].filter(Boolean);

  if (billAddr.City || billAddr.PostalCode) {
    const cityLine = [billAddr.City, billAddr.CountrySubDivisionCode, billAddr.PostalCode].filter(Boolean).join(", ");
    if (cityLine && !lines.some(l => l?.includes(billAddr.City))) {
      lines.push(cityLine);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Derive service type from line items
 */
function deriveServiceType(lines: any[]): string {
  const keywords: Record<string, string[]> = {
    "Landscaping": ["landscape", "lawn", "garden", "plant", "tree", "shrub", "sod"],
    "Design": ["design", "consult", "plan", "architect"],
    "Installation": ["install", "setup", "build", "construct", "fountain"],
    "Maintenance": ["maint", "repair", "service", "clean", "trimming"],
  };

  for (const line of lines || []) {
    const desc = (line.Description || line.SalesItemLineDetail?.ItemRef?.name || "").toLowerCase();
    for (const [type, words] of Object.entries(keywords)) {
      if (words.some(w => desc.includes(w))) return type;
    }
  }
  return "General";
}

/**
 * Refresh QB access token
 */
async function refreshAccessToken(refreshToken: string): Promise<any> {
  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");

  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!response.ok) return { success: false };
  const data = await response.json();
  return { success: true, ...data };
}
