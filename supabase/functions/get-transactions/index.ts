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
    const bankAccountId = url.searchParams.get("bank_account_id");
    const category = url.searchParams.get("category");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const search = url.searchParams.get("search");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    let query = supabaseClient
      .from("transactions")
      .select(`
        *,
        bank_accounts!inner (
          id,
          name,
          mask,
          type,
          plaid_items!inner (
            institution_name
          )
        )
      `, { count: "exact" })
      .eq("user_id", user.id);

    if (bankAccountId) {
      query = query.eq("bank_account_id", bankAccountId);
    }

    if (category) {
      query = query.eq("category", category);
    }

    if (startDate) {
      query = query.gte("date", startDate);
    }

    if (endDate) {
      query = query.lte("date", endDate);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,merchant_name.ilike.%${search}%`);
    }

    query = query
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: transactions, error: txError, count } = await query;

    if (txError) {
      throw txError;
    }

    const formattedTransactions = transactions?.map(tx => ({
      id: tx.id,
      transaction_id: tx.transaction_id,
      date: tx.date,
      amount: tx.amount,
      name: tx.name,
      merchant_name: tx.merchant_name,
      category: tx.category,
      category_confidence: tx.category_confidence,
      pending: tx.pending,
      payment_channel: tx.payment_channel,
      account: {
        id: tx.bank_accounts.id,
        name: tx.bank_accounts.name,
        mask: tx.bank_accounts.mask,
        type: tx.bank_accounts.type,
        institution: tx.bank_accounts.plaid_items.institution_name,
      },
      linked_invoice_id: tx.linked_invoice_id,
    })) || [];

    const totalIncome = formattedTransactions
      .filter(tx => parseFloat(tx.amount) < 0)
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    const totalExpenses = formattedTransactions
      .filter(tx => parseFloat(tx.amount) > 0)
      .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    return new Response(
      JSON.stringify({
        success: true,
        transactions: formattedTransactions,
        pagination: {
          total: count,
          limit,
          offset,
          has_more: count ? offset + limit < count : false,
        },
        summary: {
          total_income: totalIncome.toFixed(2),
          total_expenses: totalExpenses.toFixed(2),
          net: (totalIncome - totalExpenses).toFixed(2),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});