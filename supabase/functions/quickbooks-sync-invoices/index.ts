import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";

const QUICKBOOKS_API_BASE_URL =
  QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper: Extract billing address from QB BillAddr
function extractBillingAddress(billAddr: any): string | null {
  if (!billAddr) return null;

  const lines = [
    billAddr.Line1,
    billAddr.Line2,
    billAddr.Line3,
    billAddr.Line4,
    billAddr.Line5,
  ].filter(Boolean);

  // If we have City/State/PostalCode format, build properly
  if (billAddr.City || billAddr.PostalCode) {
    const cityLine = [
      billAddr.City,
      billAddr.CountrySubDivisionCode, // State/Province
      billAddr.PostalCode
    ].filter(Boolean).join(", ");
    if (cityLine && !lines.some(l => l?.includes(billAddr.City))) {
      lines.push(cityLine);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// Helper: Derive service_type from line items
function deriveServiceType(lines: any[]): string | null {
  if (!lines || lines.length === 0) return null;

  // Priority order for service types
  const serviceTypeMap: { [key: string]: string[] } = {
    "Design": ["design", "custom design"],
    "Installation": ["installation", "install"],
    "Landscaping": ["landscaping", "landscape", "gardening", "garden"],
    "Pest Control": ["pest control", "pest"],
    "Maintenance": ["maintenance", "trimming", "mowing"],
    "Products": ["fountain", "pump", "rocks", "sod", "soil", "plants", "sprinkler"],
    "Services": ["services", "labor", "hours"],
  };

  // Count occurrences of each type based on line items
  const typeCounts: { [key: string]: number } = {};

  for (const line of lines) {
    if (line.DetailType !== "SalesItemLineDetail") continue;

    const itemName = (line.SalesItemLineDetail?.ItemRef?.name || "").toLowerCase();
    const description = (line.Description || "").toLowerCase();
    const accountName = (line.SalesItemLineDetail?.ItemAccountRef?.name || "").toLowerCase();
    const searchText = `${itemName} ${description} ${accountName}`;

    for (const [serviceType, keywords] of Object.entries(serviceTypeMap)) {
      if (keywords.some(kw => searchText.includes(kw))) {
        typeCounts[serviceType] = (typeCounts[serviceType] || 0) + 1;
      }
    }
  }

  // Return the most common service type
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  return sortedTypes.length > 0 ? sortedTypes[0][0] : null;
}

// Helper: Calculate costs from line items using Chart of Accounts classification
// Uses QB AccountType for proper P&L classification, falls back to keywords only when missing
function calculateCostsFromLineItems(
  lines: any[],
  accountMap: Map<string, { category: string; accountType: string }> | null
): {
  materials: number;
  labor: number;
  overhead: number;
  totalCost: number;
  classification_method: "chart_of_accounts" | "keyword_fallback" | "none";
} {
  if (!lines || lines.length === 0) {
    return { materials: 0, labor: 0, overhead: 0, totalCost: 0, classification_method: "none" };
  }

  let materials = 0;
  let labor = 0;
  let usedChartOfAccounts = false;
  let usedKeywordFallback = false;

  for (const line of lines) {
    if (line.DetailType !== "SalesItemLineDetail") continue;

    const amount = parseFloat(line.Amount || 0);
    const accountRef = line.SalesItemLineDetail?.ItemAccountRef?.value;
    const accountName = (line.SalesItemLineDetail?.ItemAccountRef?.name || "").toLowerCase();
    const itemName = (line.SalesItemLineDetail?.ItemRef?.name || "").toLowerCase();

    // Try to classify using Chart of Accounts first
    let classified = false;
    if (accountMap && accountRef) {
      const accountInfo = accountMap.get(accountRef);
      if (accountInfo) {
        usedChartOfAccounts = true;
        classified = true;

        // Use AccountType for classification
        const accountType = accountInfo.accountType;

        if (accountType === "Cost of Goods Sold") {
          // COGS = direct material/product costs (use higher cost ratio ~60%)
          materials += amount * 0.60;
        } else if (accountType === "Expense" || accountType === "Other Expense") {
          // Expense accounts = operating costs (use moderate cost ratio ~40%)
          labor += amount * 0.40;
        } else if (accountType === "Income" || accountType === "Other Income") {
          // Revenue items - these are sales, not costs
          // We might capture a small margin for overhead
          labor += amount * 0.15; // Minimal cost allocation for services
        }
        // Non-P&L accounts (Bank, Credit Card, etc.) are ignored
      }
    }

    // Fallback to keyword-based classification if no account mapping
    if (!classified) {
      usedKeywordFallback = true;

      // Check if this is a product/material
      const isProduct =
        accountName.includes("product") ||
        accountName.includes("materials") ||
        accountName.includes("inventory") ||
        accountName.includes("cost of goods") ||
        ["fountain", "pump", "rocks", "sod", "soil", "plants", "pipes", "heads", "concrete"].some(p => itemName.includes(p));

      // Check if this is labor/service
      const isLabor =
        accountName.includes("service") ||
        accountName.includes("labor") ||
        accountName.includes("installation") ||
        ["design", "gardening", "trimming", "installation", "maintenance", "pest control", "lighting"].some(s => itemName.includes(s));

      if (isProduct) {
        materials += amount * 0.55;
      } else if (isLabor) {
        labor += amount * 0.35;
      } else {
        // Generic fallback
        materials += amount * 0.20;
        labor += amount * 0.20;
      }
    }
  }

  // Overhead is typically 10% of materials + labor
  const overhead = (materials + labor) * 0.10;

  // Determine classification method used
  let classification_method: "chart_of_accounts" | "keyword_fallback" | "none" = "none";
  if (usedChartOfAccounts && !usedKeywordFallback) {
    classification_method = "chart_of_accounts";
  } else if (usedChartOfAccounts || usedKeywordFallback) {
    classification_method = usedKeywordFallback ? "keyword_fallback" : "chart_of_accounts";
  }

  return {
    materials: Math.round(materials * 100) / 100,
    labor: Math.round(labor * 100) / 100,
    overhead: Math.round(overhead * 100) / 100,
    totalCost: Math.round((materials + labor + overhead) * 100) / 100,
    classification_method,
  };
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

    // Parse body properly
    let body: any = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (e) {
      console.log("Body parse error:", e);
    }

    const force_resync = body.force_resync === true;
    const update_existing = body.update_existing !== false;

    console.log("Parsed body:", JSON.stringify(body));
    console.log("force_resync:", force_resync);

    // Get QuickBooks connection
    const { data: connection, error: connectionError } = await supabaseClient
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active QuickBooks connection found", details: connectionError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Connection found:", connection.id, connection.company_name);

    // If force_resync, delete all existing QB data for this user
    if (force_resync) {
      console.log("Force resync - deleting all QB data...");

      // Delete all invoices with quickbooks_id
      const { data: qbInvoices } = await supabaseClient
        .from("invoices")
        .select("id")
        .eq("user_id", user.id)
        .not("quickbooks_id", "is", null);

      console.log("Found invoices with quickbooks_id:", qbInvoices?.length || 0);

      // Also get all mapped invoices
      const { data: mappings } = await supabaseClient
        .from("quickbooks_invoice_mappings")
        .select("our_invoice_id");

      console.log("Found mappings:", mappings?.length || 0);

      const allIds = [
        ...((qbInvoices || []).map((i: any) => i.id)),
        ...((mappings || []).map((m: any) => m.our_invoice_id))
      ];
      const uniqueIds = [...new Set(allIds)];
      console.log("Unique invoice IDs to delete:", uniqueIds.length);

      if (uniqueIds.length > 0) {
        // Delete items
        await supabaseClient
          .from("invoice_items")
          .delete()
          .in("invoice_id", uniqueIds);

        // Delete invoices
        await supabaseClient
          .from("invoices")
          .delete()
          .in("id", uniqueIds);
      }

      // Delete all mappings
      await supabaseClient
        .from("quickbooks_invoice_mappings")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all
    }

    // Query QuickBooks for invoices
    const query = "SELECT * FROM Invoice MAXRESULTS 500";
    console.log("Querying QuickBooks...");

    const invoicesResponse = await fetch(
      `${QUICKBOOKS_API_BASE_URL}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}`,
      {
        headers: {
          "Authorization": `Bearer ${connection.access_token}`,
          "Accept": "application/json",
        },
      }
    );

    const invoicesData = await invoicesResponse.json();

    if (!invoicesResponse.ok) {
      const errorMsg = invoicesData.Fault?.Error?.[0]?.Message || "Failed to fetch invoices";
      console.log("QB API Error:", errorMsg);
      return new Response(
        JSON.stringify({ error: errorMsg, qb_response: invoicesData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const qbInvoices = invoicesData.QueryResponse?.Invoice || [];
    console.log("Found", qbInvoices.length, "invoices from QuickBooks");

    // Load Chart of Accounts for proper expense classification
    const { data: chartOfAccounts } = await supabaseClient
      .from("quickbooks_chart_of_accounts")
      .select("quickbooks_account_id, mintro_category, account_type")
      .eq("user_id", user.id);

    // Create a map for quick lookups
    const accountMap = new Map<string, { category: string; accountType: string }>();
    (chartOfAccounts || []).forEach((acc: any) => {
      accountMap.set(acc.quickbooks_account_id, {
        category: acc.mintro_category,
        accountType: acc.account_type,
      });
    });

    console.log("Loaded", accountMap.size, "accounts from Chart of Accounts for classification");

    let syncedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: any[] = [];

    for (const qbInvoice of qbInvoices) {
      try {
        console.log("Processing invoice:", qbInvoice.Id, qbInvoice.DocNumber);

        // Check if already exists by quickbooks_id
        const { data: existing } = await supabaseClient
          .from("invoices")
          .select("id")
          .eq("user_id", user.id)
          .eq("quickbooks_id", qbInvoice.Id)
          .single();

        if (existing) {
          if (update_existing) {
            // Update existing - NOTE: 'invoice' is a GENERATED column, don't update it
            // Extract enhanced data from QB invoice
            const billingAddress = extractBillingAddress(qbInvoice.BillAddr);
            const serviceType = deriveServiceType(qbInvoice.Line);
            const estimatedCosts = calculateCostsFromLineItems(qbInvoice.Line, accountMap.size > 0 ? accountMap : null);

            const updateData = {
              qb_doc_number: qbInvoice.DocNumber || null,
              client: qbInvoice.CustomerRef?.name || "Unknown Customer",
              amount: qbInvoice.TotalAmt || 0,
              status: qbInvoice.Balance === 0 ? "paid" : (qbInvoice.Balance < qbInvoice.TotalAmt ? "partial" : "unpaid"),
              invoice_date: qbInvoice.TxnDate || null,
              due_date: qbInvoice.DueDate || null,
              notes: qbInvoice.CustomerMemo?.value || qbInvoice.PrivateNote || null,
              billing_address: billingAddress,
              service_type: serviceType,
              // Estimated costs from QB line items (can be overridden later)
              actual_materials_cost: estimatedCosts.materials > 0 ? estimatedCosts.materials : null,
              actual_labor_cost: estimatedCosts.labor > 0 ? estimatedCosts.labor : null,
              actual_overhead_cost: estimatedCosts.overhead > 0 ? estimatedCosts.overhead : null,
              total_actual_cost: estimatedCosts.totalCost > 0 ? estimatedCosts.totalCost : null,
              actual_profit: estimatedCosts.totalCost > 0
                ? Math.round((qbInvoice.TotalAmt - estimatedCosts.totalCost) * 100) / 100
                : null,
              // Mark as estimated so frontend knows this needs verification
              cost_data_source: estimatedCosts.totalCost > 0 ? "estimated" : null,
              quickbooks_raw_data: qbInvoice,
            };

            const { error: updateError } = await supabaseClient
              .from("invoices")
              .update(updateData)
              .eq("id", existing.id);

            if (updateError) {
              console.log("Update error:", updateError);
              errors.push({ invoice: qbInvoice.Id, error: updateError.message, type: "update" });
            } else {
              // Also update line items for existing invoices
              await rebuildLineItems(supabaseClient, existing.id, qbInvoice.Line);
              updatedCount++;
            }
          } else {
            skippedCount++;
          }
          continue;
        }

        // Check by mapping
        const { data: mapping } = await supabaseClient
          .from("quickbooks_invoice_mappings")
          .select("our_invoice_id")
          .eq("quickbooks_invoice_id", qbInvoice.Id)
          .single();

        if (mapping) {
          skippedCount++;
          continue;
        }

        // Create new invoice - use minimal fields that should exist
        // NOTE: 'invoice' column is GENERATED, so we don't set it
        // Extract enhanced data from QB invoice
        const billingAddress = extractBillingAddress(qbInvoice.BillAddr);
        const serviceType = deriveServiceType(qbInvoice.Line);
        const estimatedCosts = calculateCostsFromLineItems(qbInvoice.Line, accountMap.size > 0 ? accountMap : null);

        // Build line_items JSONB for quick access
        const qbLineItems = (qbInvoice.Line || []).filter((line: any) =>
          line.DetailType === "SalesItemLineDetail"
        );
        const lineItemsJsonb = qbLineItems.map((line: any) => ({
          description: line.Description || line.SalesItemLineDetail?.ItemRef?.name || "Item",
          category: null, // QB doesn't provide category directly
          qty: Math.round(line.SalesItemLineDetail?.Qty || 1),
          unit_price: line.SalesItemLineDetail?.UnitPrice || 0,
          total: Math.round(line.SalesItemLineDetail?.Qty || 1) * (line.SalesItemLineDetail?.UnitPrice || 0),
          qb_item_ref: line.SalesItemLineDetail?.ItemRef?.value || null,
          qb_item_name: line.SalesItemLineDetail?.ItemRef?.name || null,
        }));

        const invoiceData = {
          user_id: user.id,
          qb_doc_number: qbInvoice.DocNumber || null,
          client: qbInvoice.CustomerRef?.name || "Unknown Customer",
          amount: qbInvoice.TotalAmt || 0,
          status: qbInvoice.Balance === 0 ? "paid" : "unpaid",
          invoice_date: qbInvoice.TxnDate || new Date().toISOString().split('T')[0],
          due_date: qbInvoice.DueDate || null,
          notes: qbInvoice.CustomerMemo?.value || null,
          billing_address: billingAddress,
          service_type: serviceType,
          // Line items as JSONB for quick access
          line_items: lineItemsJsonb,
          // Estimated costs from QB line items (can be overridden later by user)
          actual_materials_cost: estimatedCosts.materials > 0 ? estimatedCosts.materials : null,
          actual_labor_cost: estimatedCosts.labor > 0 ? estimatedCosts.labor : null,
          actual_overhead_cost: estimatedCosts.overhead > 0 ? estimatedCosts.overhead : null,
          total_actual_cost: estimatedCosts.totalCost > 0 ? estimatedCosts.totalCost : null,
          actual_profit: estimatedCosts.totalCost > 0
            ? Math.round((qbInvoice.TotalAmt - estimatedCosts.totalCost) * 100) / 100
            : null,
          // Mark as estimated so frontend knows this needs verification
          cost_data_source: estimatedCosts.totalCost > 0 ? "estimated" : null,
          quickbooks_id: qbInvoice.Id,
          quickbooks_raw_data: qbInvoice,
        };

        console.log("Creating invoice with data:", JSON.stringify(invoiceData).substring(0, 200));

        const { data: newInvoice, error: invoiceError } = await supabaseClient
          .from("invoices")
          .insert(invoiceData)
          .select()
          .single();

        if (invoiceError) {
          console.log("Insert error for invoice", qbInvoice.Id, ":", invoiceError);
          errors.push({
            invoice: qbInvoice.Id,
            doc_number: qbInvoice.DocNumber,
            error: invoiceError.message,
            code: invoiceError.code,
            type: "insert"
          });
          continue;
        }

        console.log("Created invoice:", newInvoice.id);

        // Create line items
        const lineItems = (qbInvoice.Line || []).filter((line: any) =>
          line.DetailType === "SalesItemLineDetail"
        );

        if (lineItems.length > 0) {
          const itemsToInsert = lineItems.map((line: any) => ({
            invoice_id: newInvoice.id,
            description: line.Description || line.SalesItemLineDetail?.ItemRef?.name || "Item",
            qty: Math.round(line.SalesItemLineDetail?.Qty || 1),
            unit_price: line.SalesItemLineDetail?.UnitPrice || 0,
            quickbooks_item_ref: line.SalesItemLineDetail?.ItemRef?.value || null,
            quickbooks_item_name: line.SalesItemLineDetail?.ItemRef?.name || null,
            quickbooks_raw_data: line,
          }));

          console.log(`Inserting ${itemsToInsert.length} line items for invoice ${newInvoice.id}`);

          const { error: itemsError } = await supabaseClient
            .from("invoice_items")
            .insert(itemsToInsert);

          if (itemsError) {
            console.log("Line items error:", itemsError);
            errors.push({
              invoice: qbInvoice.Id,
              doc_number: qbInvoice.DocNumber,
              error: itemsError.message,
              code: itemsError.code,
              type: "line_items"
            });
          } else {
            console.log(`Successfully created ${itemsToInsert.length} line items`);
          }
        }

        // Create mapping
        await supabaseClient
          .from("quickbooks_invoice_mappings")
          .insert({
            quickbooks_connection_id: connection.id,
            quickbooks_invoice_id: qbInvoice.Id,
            our_invoice_id: newInvoice.id,
          });

        syncedCount++;

      } catch (itemError: any) {
        console.error("Error processing invoice:", qbInvoice.Id, itemError);
        errors.push({ invoice: qbInvoice.Id, error: itemError.message, type: "exception" });
      }
    }

    // Update connection last_sync
    await supabaseClient
      .from("quickbooks_connections")
      .update({ last_sync: new Date().toISOString() })
      .eq("id", connection.id);

    return new Response(
      JSON.stringify({
        success: true,
        invoices_synced: syncedCount,
        invoices_updated: updatedCount,
        invoices_skipped: skippedCount,
        total_found: qbInvoices.length,
        force_resync: force_resync,
        errors: errors.length > 0 ? errors : undefined,
        message: force_resync
          ? `Force resync complete! Created ${syncedCount} invoices from QuickBooks`
          : `Synced ${syncedCount} new, updated ${updatedCount} existing, skipped ${skippedCount}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to rebuild line items for an invoice
async function rebuildLineItems(supabaseClient: any, invoiceId: string, lines: any[]) {
  if (!lines) return;

  // Delete existing line items
  await supabaseClient
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoiceId);

  // Filter for sales line items
  const lineItems = lines.filter((line: any) =>
    line.DetailType === "SalesItemLineDetail"
  );

  if (lineItems.length === 0) {
    // Clear line_items JSONB if no items
    await supabaseClient
      .from("invoices")
      .update({ line_items: [] })
      .eq("id", invoiceId);
    return;
  }

  const itemsToInsert = lineItems.map((line: any) => ({
    invoice_id: invoiceId,
    description: line.Description || line.SalesItemLineDetail?.ItemRef?.name || "Item",
    qty: Math.round(line.SalesItemLineDetail?.Qty || 1),
    unit_price: line.SalesItemLineDetail?.UnitPrice || 0,
    quickbooks_item_ref: line.SalesItemLineDetail?.ItemRef?.value || null,
    quickbooks_item_name: line.SalesItemLineDetail?.ItemRef?.name || null,
    quickbooks_raw_data: line,
  }));

  const { error } = await supabaseClient
    .from("invoice_items")
    .insert(itemsToInsert);

  if (error) {
    console.log("Line items rebuild error:", error);
  }

  // Also update line_items JSONB on the invoice for quick access
  const lineItemsJsonb = itemsToInsert.map(item => ({
    description: item.description,
    category: null,
    qty: item.qty,
    unit_price: item.unit_price,
    total: item.qty * item.unit_price,
    qb_item_ref: item.quickbooks_item_ref,
    qb_item_name: item.quickbooks_item_name,
  }));

  await supabaseClient
    .from("invoices")
    .update({ line_items: lineItemsJsonb })
    .eq("id", invoiceId);
}