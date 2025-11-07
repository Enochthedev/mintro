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

    const url = new URL(req.url);
    const job_id = url.searchParams.get("job_id");

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "job_id query parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify job belongs to user - FIXED COLUMNS
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select("id, invoice, client, amount, invoice_date")
      .eq("id", job_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Job/Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all expense allocations for this job
    const { data: allocations, error: allocError } = await supabaseClient
      .from("transaction_job_allocations")
      .select(`
        *,
        transactions (
          id,
          transaction_id,
          date,
          amount,
          name,
          merchant_name,
          pending
        )
      `)
      .eq("job_id", job_id)
      .order("created_at", { ascending: false });

    if (allocError) {
      throw allocError;
    }

    // Calculate totals
    const totalAllocated = allocations?.reduce(
      (sum, alloc) => sum + parseFloat(alloc.allocation_amount),
      0
    ) || 0;

    const profit = parseFloat(invoice.amount) - totalAllocated;
    const profitMargin = invoice.amount > 0 
      ? (profit / parseFloat(invoice.amount)) * 100 
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        job: {
          id: invoice.id,
          invoice_number: invoice.invoice,
          client_name: invoice.client,
          total_amount: invoice.amount,
          invoice_date: invoice.invoice_date,
        },
        expenses: allocations || [],
        summary: {
          total_expenses: totalAllocated,
          revenue: parseFloat(invoice.amount),
          profit,
          profit_margin: profitMargin,
        },
        expense_count: allocations?.length || 0,
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