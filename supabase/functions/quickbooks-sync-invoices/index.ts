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

    // Get QuickBooks connection
    const { data: connection, error: connectionError } = await supabaseClient
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active QuickBooks connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Start sync log
    const logEntry = {
      quickbooks_connection_id: connection.id,
      user_id: user.id,
      sync_type: "invoices",
      status: "success" as const,
      items_synced: 0,
      started_at: new Date().toISOString(),
    };

    try {
      // Query QuickBooks for invoices
      const query = "SELECT * FROM Invoice MAXRESULTS 100";
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
        throw new Error(invoicesData.Fault?.Error?.[0]?.Message || "Failed to fetch invoices");
      }

      const qbInvoices = invoicesData.QueryResponse?.Invoice || [];

      let syncedCount = 0;

      for (const qbInvoice of qbInvoices) {
        try {
          // Check if invoice already imported
          const { data: existingMapping } = await supabaseClient
            .from("quickbooks_invoice_mappings")
            .select("our_invoice_id")
            .eq("quickbooks_connection_id", connection.id)
            .eq("quickbooks_invoice_id", qbInvoice.Id)
            .single();

          if (existingMapping) {
            // Skip if already imported
            continue;
          }

          // Calculate total
          const total = qbInvoice.TotalAmt || 0;

          // Create invoice in our system
          const { data: newInvoice, error: invoiceError } = await supabaseClient
            .from("invoices")
            .insert({
              user_id: user.id,
              client: qbInvoice.CustomerRef?.name || "Unknown Customer",
              amount: total,
              status: qbInvoice.Balance === 0 ? "paid" : "unpaid",
              invoice_date: qbInvoice.TxnDate || new Date().toISOString().split('T')[0],
              due_date: qbInvoice.DueDate || null,
              notes: qbInvoice.CustomerMemo?.value || null,
            })
            .select()
            .single();

          if (invoiceError) {
            console.error("Error creating invoice:", invoiceError);
            continue;
          }

          // Create invoice items
          const lineItems = qbInvoice.Line?.filter((line: any) => 
            line.DetailType === "SalesItemLineDetail"
          ) || [];

          if (lineItems.length > 0) {
            const itemsToInsert = lineItems.map((line: any) => ({
              invoice_id: newInvoice.id,
              description: line.Description || line.SalesItemLineDetail?.ItemRef?.name || "Item",
              qty: line.SalesItemLineDetail?.Qty || 1,
              unit_price: line.SalesItemLineDetail?.UnitPrice || 0,
              total: line.Amount || 0,
            }));

            await supabaseClient
              .from("invoice_items")
              .insert(itemsToInsert);
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

        } catch (itemError) {
          console.error("Error processing invoice:", qbInvoice.Id, itemError);
        }
      }

      logEntry.items_synced = syncedCount;

      // Update connection last_sync
      await supabaseClient
        .from("quickbooks_connections")
        .update({ last_sync: new Date().toISOString() })
        .eq("id", connection.id);

      return new Response(
        JSON.stringify({
          success: true,
          invoices_synced: syncedCount,
          total_found: qbInvoices.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );

    } catch (syncError) {
      logEntry.status = "error";
      logEntry.error_message = syncError.message;
      throw syncError;
    } finally {
      // Save log
      logEntry.completed_at = new Date().toISOString();
      await supabaseClient
        .from("quickbooks_sync_logs")
        .insert(logEntry);
    }

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});