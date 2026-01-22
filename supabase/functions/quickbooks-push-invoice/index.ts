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

        // Get request body
        const body = await req.json().catch(() => ({}));
        const { invoice_id, push_all_unsynced = false } = body;

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

        // Determine which invoices to push
        let invoicesToPush: any[] = [];

        if (invoice_id) {
            // Push a single invoice
            const { data: invoice, error: invoiceError } = await supabaseClient
                .from("invoices")
                .select("*, invoice_items(*)")
                .eq("id", invoice_id)
                .eq("user_id", user.id)
                .single();

            if (invoiceError || !invoice) {
                return new Response(
                    JSON.stringify({ error: "Invoice not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            invoicesToPush = [invoice];
        } else if (push_all_unsynced) {
            // Get all invoices that haven't been synced to QuickBooks
            const { data: syncedMappings } = await supabaseClient
                .from("quickbooks_invoice_mappings")
                .select("our_invoice_id")
                .eq("quickbooks_connection_id", connection.id);

            const syncedIds = (syncedMappings || []).map((m: any) => m.our_invoice_id);

            let query = supabaseClient
                .from("invoices")
                .select("*, invoice_items(*)")
                .eq("user_id", user.id);

            if (syncedIds.length > 0) {
                query = query.not("id", "in", `(${syncedIds.join(",")})`);
            }

            const { data: unsyncedInvoices } = await query;
            invoicesToPush = unsyncedInvoices || [];
        } else {
            return new Response(
                JSON.stringify({
                    error: "Please provide invoice_id for a single invoice, or set push_all_unsynced=true to push all unsent invoices"
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Start sync log
        const logEntry = {
            quickbooks_connection_id: connection.id,
            user_id: user.id,
            sync_type: "invoices_push",
            status: "success" as const,
            items_synced: 0,
            started_at: new Date().toISOString(),
        };

        const results: any[] = [];
        let pushedCount = 0;
        let errorCount = 0;

        try {
            for (const invoice of invoicesToPush) {
                try {
                    // Check if already synced
                    const { data: existingMapping } = await supabaseClient
                        .from("quickbooks_invoice_mappings")
                        .select("quickbooks_invoice_id")
                        .eq("quickbooks_connection_id", connection.id)
                        .eq("our_invoice_id", invoice.id)
                        .single();

                    // Build QuickBooks invoice payload
                    const qbInvoice: any = {
                        CustomerRef: {
                            name: invoice.client,
                        },
                        TxnDate: invoice.invoice_date || new Date().toISOString().split('T')[0],
                        DueDate: invoice.due_date || null,
                        CustomerMemo: invoice.notes ? { value: invoice.notes } : null,
                        Line: [],
                    };

                    // Add line items
                    if (invoice.invoice_items && invoice.invoice_items.length > 0) {
                        for (const item of invoice.invoice_items) {
                            qbInvoice.Line.push({
                                DetailType: "SalesItemLineDetail",
                                Amount: item.total || (item.qty * item.unit_price),
                                Description: item.description,
                                SalesItemLineDetail: {
                                    Qty: item.qty || 1,
                                    UnitPrice: item.unit_price || 0,
                                    ItemRef: {
                                        name: item.description || "Service",
                                    },
                                },
                            });
                        }
                    } else {
                        // If no line items, create a single line with the total amount
                        qbInvoice.Line.push({
                            DetailType: "SalesItemLineDetail",
                            Amount: invoice.amount,
                            Description: invoice.service_type || "Services",
                            SalesItemLineDetail: {
                                Qty: 1,
                                UnitPrice: invoice.amount,
                                ItemRef: {
                                    name: invoice.service_type || "Services",
                                },
                            },
                        });
                    }

                    let qbResponse: Response;
                    let qbResult: any;

                    if (existingMapping) {
                        // Update existing invoice in QuickBooks
                        // First, fetch the current SyncToken
                        const fetchResponse = await fetch(
                            `${QUICKBOOKS_API_BASE_URL}/v3/company/${connection.realm_id}/invoice/${existingMapping.quickbooks_invoice_id}`,
                            {
                                headers: {
                                    "Authorization": `Bearer ${connection.access_token}`,
                                    "Accept": "application/json",
                                },
                            }
                        );

                        const existingQbInvoice = await fetchResponse.json();

                        if (!fetchResponse.ok) {
                            throw new Error(`Failed to fetch existing QB invoice: ${existingQbInvoice.Fault?.Error?.[0]?.Message || 'Unknown error'}`);
                        }

                        // Update with SyncToken
                        qbInvoice.Id = existingMapping.quickbooks_invoice_id;
                        qbInvoice.SyncToken = existingQbInvoice.Invoice.SyncToken;

                        qbResponse = await fetch(
                            `${QUICKBOOKS_API_BASE_URL}/v3/company/${connection.realm_id}/invoice`,
                            {
                                method: "POST",
                                headers: {
                                    "Authorization": `Bearer ${connection.access_token}`,
                                    "Accept": "application/json",
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify(qbInvoice),
                            }
                        );

                        qbResult = await qbResponse.json();

                        if (!qbResponse.ok) {
                            throw new Error(qbResult.Fault?.Error?.[0]?.Message || "Failed to update invoice in QuickBooks");
                        }

                        results.push({
                            our_invoice_id: invoice.id,
                            quickbooks_invoice_id: existingMapping.quickbooks_invoice_id,
                            quickbooks_doc_number: qbResult.Invoice?.DocNumber,
                            status: "updated",
                        });

                    } else {
                        // Create new invoice in QuickBooks
                        qbResponse = await fetch(
                            `${QUICKBOOKS_API_BASE_URL}/v3/company/${connection.realm_id}/invoice`,
                            {
                                method: "POST",
                                headers: {
                                    "Authorization": `Bearer ${connection.access_token}`,
                                    "Accept": "application/json",
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify(qbInvoice),
                            }
                        );

                        qbResult = await qbResponse.json();

                        if (!qbResponse.ok) {
                            throw new Error(qbResult.Fault?.Error?.[0]?.Message || "Failed to create invoice in QuickBooks");
                        }

                        // Create mapping record
                        await supabaseClient
                            .from("quickbooks_invoice_mappings")
                            .insert({
                                quickbooks_connection_id: connection.id,
                                quickbooks_invoice_id: qbResult.Invoice.Id,
                                our_invoice_id: invoice.id,
                            });

                        // Update local invoice with QB data
                        await supabaseClient
                            .from("invoices")
                            .update({
                                quickbooks_invoice_id: qbResult.Invoice.Id,
                                qb_doc_number: qbResult.Invoice.DocNumber || null,
                                quickbooks_raw_data: qbResult.Invoice,
                            })
                            .eq("id", invoice.id);

                        results.push({
                            our_invoice_id: invoice.id,
                            quickbooks_invoice_id: qbResult.Invoice.Id,
                            quickbooks_doc_number: qbResult.Invoice?.DocNumber,
                            status: "created",
                        });
                    }

                    pushedCount++;

                } catch (itemError) {
                    console.error("Error pushing invoice:", invoice.id, itemError);
                    results.push({
                        our_invoice_id: invoice.id,
                        status: "error",
                        error: itemError.message,
                    });
                    errorCount++;
                }
            }

            logEntry.items_synced = pushedCount;

            // Update connection last_sync
            await supabaseClient
                .from("quickbooks_connections")
                .update({ last_sync: new Date().toISOString() })
                .eq("id", connection.id);

            // For single invoice push, return simpler response
            if (invoice_id) {
                const result = results[0];
                if (result.status === "error") {
                    return new Response(
                        JSON.stringify({ success: false, error: result.error }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                return new Response(
                    JSON.stringify({
                        success: true,
                        message: `Invoice ${result.status} in QuickBooks`,
                        our_invoice_id: result.our_invoice_id,
                        quickbooks_invoice_id: result.quickbooks_invoice_id,
                        quickbooks_doc_number: result.quickbooks_doc_number,
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // For bulk push, return detailed results
            return new Response(
                JSON.stringify({
                    success: true,
                    message: `Pushed ${pushedCount} invoices to QuickBooks`,
                    pushed: pushedCount,
                    errors: errorCount,
                    skipped: 0,
                    results,
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
