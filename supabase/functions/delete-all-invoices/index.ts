import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization")
        }
      }
    });
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
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
    // Parse body - handle both JSON and empty requests
    let body = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (e) {
      console.log("Body parse error:", e);
    }
    const { delete_all_quickbooks = false, delete_all = false, confirm = false } = body;
    console.log("Request body:", JSON.stringify(body));
    console.log("delete_all_quickbooks:", delete_all_quickbooks);
    console.log("delete_all:", delete_all);
    console.log("confirm:", confirm);
    if (!confirm) {
      return new Response(JSON.stringify({
        error: "Must set confirm=true to delete invoices",
        warning: "This action cannot be undone!",
        received_body: body
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let deletedInvoices = 0;
    let deletedMappings = 0;
    let deletedItems = 0;
    if (delete_all) {
      // Delete ALL invoices for this user
      // First get all invoice IDs
      const { data: invoices } = await supabaseClient.from("invoices").select("id").eq("user_id", user.id);
      console.log("Found invoices to delete:", invoices?.length || 0);
      const invoiceIds = (invoices || []).map((i)=>i.id);
      if (invoiceIds.length > 0) {
        // Delete invoice items
        const { error: itemError, count: itemCount } = await supabaseClient.from("invoice_items").delete({
          count: 'exact'
        }).in("invoice_id", invoiceIds);
        if (itemError) console.log("Item delete error:", itemError);
        deletedItems = itemCount || 0;
        // Delete mappings
        const { error: mappingError, count: mappingCount } = await supabaseClient.from("quickbooks_invoice_mappings").delete({
          count: 'exact'
        }).in("our_invoice_id", invoiceIds);
        if (mappingError) console.log("Mapping delete error:", mappingError);
        deletedMappings = mappingCount || 0;

        // Unlink QB expenses connected to these invoices
        await supabaseClient
          .from("quickbooks_expenses")
          .update({
            is_linked_to_invoice: false,
            linked_invoice_id: null,
            updated_at: new Date().toISOString(),
          })
          .in("linked_invoice_id", invoiceIds)
          .eq("user_id", user.id);

        // Clear linked_invoice_id on Plaid transactions
        await supabaseClient
          .from("transactions")
          .update({ linked_invoice_id: null })
          .in("linked_invoice_id", invoiceIds)
          .eq("user_id", user.id);

        // Delete transaction_job_allocations
        await supabaseClient
          .from("transaction_job_allocations")
          .delete()
          .in("job_id", invoiceIds)
          .eq("user_id", user.id);

        // Delete invoices
        const { error: invoiceError, count: invoiceCount } = await supabaseClient.from("invoices").delete({
          count: 'exact'
        }).eq("user_id", user.id);
        if (invoiceError) console.log("Invoice delete error:", invoiceError);
        deletedInvoices = invoiceCount || 0;
      }
    } else if (delete_all_quickbooks) {
      // Delete only QuickBooks-synced invoices
      // Approach 1: Find by quickbooks_invoice_id on invoices table (most reliable)
      const { data: qbInvoices, error: qbError } = await supabaseClient.from("invoices").select("id").eq("user_id", user.id).not("quickbooks_invoice_id", "is", null);
      console.log("Found QB invoices by quickbooks_invoice_id:", qbInvoices?.length || 0);
      if (qbError) console.log("QB invoice query error:", qbError);
      // Approach 2: Also check mappings table
      const { data: mappings, error: mappingError } = await supabaseClient.from("quickbooks_invoice_mappings").select("our_invoice_id");
      console.log("Found mappings:", mappings?.length || 0);
      if (mappingError) console.log("Mapping query error:", mappingError);
      const qbInvoiceIds = (qbInvoices || []).map((i)=>i.id);
      const mappedIds = (mappings || []).map((m)=>m.our_invoice_id);
      // Combine unique IDs
      const allQbInvoiceIds = [
        ...new Set([
          ...qbInvoiceIds,
          ...mappedIds
        ])
      ];
      console.log("Total unique QB invoice IDs:", allQbInvoiceIds.length);
      if (allQbInvoiceIds.length > 0) {
        // Delete invoice items
        const { error: itemError, count: itemCount } = await supabaseClient.from("invoice_items").delete({
          count: 'exact'
        }).in("invoice_id", allQbInvoiceIds);
        if (itemError) console.log("Item delete error:", itemError);
        deletedItems = itemCount || 0;
        // Delete all mappings (regardless of invoice)
        const { error: delMappingError, count: mappingCount } = await supabaseClient.from("quickbooks_invoice_mappings").delete({
          count: 'exact'
        }).in("our_invoice_id", allQbInvoiceIds);
        if (delMappingError) console.log("Mapping delete error:", delMappingError);
        deletedMappings = mappingCount || 0;

        // Unlink QB expenses connected to these invoices
        await supabaseClient
          .from("quickbooks_expenses")
          .update({
            is_linked_to_invoice: false,
            linked_invoice_id: null,
            updated_at: new Date().toISOString(),
          })
          .in("linked_invoice_id", allQbInvoiceIds)
          .eq("user_id", user.id);

        // Clear linked_invoice_id on Plaid transactions
        await supabaseClient
          .from("transactions")
          .update({ linked_invoice_id: null })
          .in("linked_invoice_id", allQbInvoiceIds)
          .eq("user_id", user.id);

        // Delete transaction_job_allocations
        await supabaseClient
          .from("transaction_job_allocations")
          .delete()
          .in("job_id", allQbInvoiceIds)
          .eq("user_id", user.id);

        // Delete invoices
        const { error: invoiceError, count: invoiceCount } = await supabaseClient.from("invoices").delete({
          count: 'exact'
        }).in("id", allQbInvoiceIds);
        if (invoiceError) console.log("Invoice delete error:", invoiceError);
        deletedInvoices = invoiceCount || 0;
      }
    } else {
      return new Response(JSON.stringify({
        error: "Must specify delete_all_quickbooks=true or delete_all=true",
        received_body: body,
        options: {
          delete_all_quickbooks: "Deletes only invoices synced from QuickBooks",
          delete_all: "Deletes ALL invoices (use with caution)"
        }
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      message: `Deleted ${deletedInvoices} invoices, ${deletedItems} line items, and ${deletedMappings} QuickBooks mappings`,
      deleted: {
        invoices: deletedInvoices,
        invoice_items: deletedItems,
        quickbooks_mappings: deletedMappings
      }
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
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
