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
      job_id,
      allocation_percentage = 100,
      allocation_amount,
      notes,
    } = await req.json();

    if (!transaction_id || !job_id) {
      return new Response(
        JSON.stringify({ error: "transaction_id and job_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify transaction belongs to user
    const { data: transaction, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, amount, name, merchant_name")
      .eq("id", transaction_id)
      .eq("user_id", user.id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify job/invoice belongs to user - FIXED COLUMNS
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select("id, invoice, client, amount")
      .eq("id", job_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Job/Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate allocation amount if not provided
    const finalAllocationAmount = allocation_amount || 
      (Math.abs(parseFloat(transaction.amount)) * allocation_percentage / 100);

    // Check if link already exists
    const { data: existingLink, error: checkError } = await supabaseClient
      .from("transaction_job_allocations")
      .select("id")
      .eq("transaction_id", transaction_id)
      .eq("job_id", job_id)
      .maybeSingle();

    if (existingLink) {
      // Update existing link
      const { data: updated, error: updateError } = await supabaseClient
        .from("transaction_job_allocations")
        .update({
          allocation_amount: finalAllocationAmount,
          allocation_percentage,
          notes,
        })
        .eq("id", existingLink.id)
        .select(`
          *,
          transactions (id, name, merchant_name, amount, date),
          invoices (id, invoice, client)
        `)
        .single();

      if (updateError) throw updateError;

      return new Response(
        JSON.stringify({
          success: true,
          message: "Transaction link updated",
          link: updated,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create new link
    const { data: link, error: linkError } = await supabaseClient
      .from("transaction_job_allocations")
      .insert({
        user_id: user.id,
        transaction_id,
        job_id,
        allocation_amount: finalAllocationAmount,
        allocation_percentage,
        notes,
      })
      .select(`
        *,
        transactions (id, name, merchant_name, amount, date),
        invoices (id, invoice, client)
      `)
      .single();

    if (linkError) {
      throw linkError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Transaction linked to job successfully",
        link,
        transaction: {
          id: transaction.id,
          name: transaction.name,
          merchant_name: transaction.merchant_name,
          amount: transaction.amount,
        },
        job: {
          id: invoice.id,
          invoice_number: invoice.invoice,
          client_name: invoice.client,
          total_amount: invoice.amount,
        },
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