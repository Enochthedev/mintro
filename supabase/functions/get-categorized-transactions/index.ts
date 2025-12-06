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

        // Parse query params
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const category_id = url.searchParams.get("category_id");
        const method = url.searchParams.get("method"); // "manual", "rule", "ai"
        const start_date = url.searchParams.get("start_date");
        const end_date = url.searchParams.get("end_date");

        // Build query for categorized transactions
        let query = supabaseClient
            .from("transaction_categorizations")
            .select(`
        id,
        method,
        confidence,
        is_user_override,
        created_at,
        transactions!inner (
          id,
          transaction_id,
          date,
          amount,
          name,
          merchant_name,
          pending,
          bank_accounts (
            id,
            name,
            mask,
            type,
            plaid_items (
              institution_name
            )
          )
        ),
        expense_categories!inner (
          id,
          name,
          color,
          icon
        ),
        categorization_rules (
          id,
          match_value,
          rule_type
        )
      `, { count: "exact" })
            .eq("transactions.user_id", user.id);

        // Apply filters
        if (category_id) {
            query = query.eq("category_id", category_id);
        }

        if (method) {
            query = query.eq("method", method);
        }

        if (start_date) {
            query = query.gte("transactions.date", start_date);
        }

        if (end_date) {
            query = query.lte("transactions.date", end_date);
        }

        // Order and paginate
        query = query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        const { data: categorizations, error: queryError, count } = await query;

        if (queryError) {
            throw queryError;
        }

        // Format the response
        const formattedTransactions = categorizations?.map((cat: any) => ({
            categorization_id: cat.id,
            method: cat.method,
            confidence: cat.confidence,
            is_user_override: cat.is_user_override,
            categorized_at: cat.created_at,
            category: cat.expense_categories,
            rule: cat.categorization_rules,
            transaction: {
                id: cat.transactions?.id,
                transaction_id: cat.transactions?.transaction_id,
                date: cat.transactions?.date,
                amount: cat.transactions?.amount,
                name: cat.transactions?.name,
                merchant_name: cat.transactions?.merchant_name,
                pending: cat.transactions?.pending,
                account: cat.transactions?.bank_accounts ? {
                    id: cat.transactions.bank_accounts.id,
                    name: cat.transactions.bank_accounts.name,
                    mask: cat.transactions.bank_accounts.mask,
                    type: cat.transactions.bank_accounts.type,
                    institution: cat.transactions.bank_accounts.plaid_items?.institution_name,
                } : null,
            },
        })) || [];

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
