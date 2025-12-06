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
        const start_date = url.searchParams.get("start_date");
        const end_date = url.searchParams.get("end_date");
        const include_uncategorized = url.searchParams.get("include_uncategorized") === "true";

        // Get user's categories
        const { data: categories, error: catError } = await supabaseClient
            .from("expense_categories")
            .select("id, name, color, icon")
            .eq("user_id", user.id);

        if (catError) {
            throw catError;
        }

        // Get categorized transactions with amounts
        let txQuery = supabaseClient
            .from("transactions")
            .select(`
        id,
        amount,
        date,
        transaction_categorizations (
          category_id
        )
      `)
            .eq("user_id", user.id)
            .lt("amount", 0); // Only expenses (negative amounts)

        if (start_date) {
            txQuery = txQuery.gte("date", start_date);
        }

        if (end_date) {
            txQuery = txQuery.lte("date", end_date);
        }

        const { data: transactions, error: txError } = await txQuery;

        if (txError) {
            throw txError;
        }

        // Calculate totals per category
        const categoryTotals = new Map<string, number>();
        let uncategorizedTotal = 0;
        let totalExpenses = 0;

        transactions?.forEach(tx => {
            const amount = Math.abs(tx.amount); // Convert to positive
            totalExpenses += amount;

            if (tx.transaction_categorizations && tx.transaction_categorizations.length > 0) {
                const categoryId = tx.transaction_categorizations[0].category_id;
                const current = categoryTotals.get(categoryId) || 0;
                categoryTotals.set(categoryId, current + amount);
            } else {
                uncategorizedTotal += amount;
            }
        });

        // Build breakdown with category details
        const breakdown = categories?.map(cat => {
            const total = categoryTotals.get(cat.id) || 0;
            return {
                category_id: cat.id,
                category_name: cat.name,
                color: cat.color,
                icon: cat.icon,
                total_amount: parseFloat(total.toFixed(2)),
                percentage: totalExpenses > 0 ? parseFloat(((total / totalExpenses) * 100).toFixed(1)) : 0,
                transaction_count: 0, // Will be calculated below
            };
        }).filter(cat => cat.total_amount > 0) || [];

        // Get transaction counts per category
        for (const cat of breakdown) {
            const { count } = await supabaseClient
                .from("transaction_categorizations")
                .select("*", { count: "exact", head: true })
                .eq("category_id", cat.category_id);
            cat.transaction_count = count || 0;
        }

        // Sort by total amount (highest first)
        breakdown.sort((a, b) => b.total_amount - a.total_amount);

        // Optionally include uncategorized
        const result: any = {
            success: true,
            period: {
                start_date: start_date || "all time",
                end_date: end_date || "present",
            },
            summary: {
                total_expenses: parseFloat(totalExpenses.toFixed(2)),
                categorized_total: parseFloat((totalExpenses - uncategorizedTotal).toFixed(2)),
                uncategorized_total: parseFloat(uncategorizedTotal.toFixed(2)),
                categorization_rate: totalExpenses > 0
                    ? parseFloat((((totalExpenses - uncategorizedTotal) / totalExpenses) * 100).toFixed(1))
                    : 0,
            },
            breakdown,
        };

        if (include_uncategorized && uncategorizedTotal > 0) {
            result.breakdown.push({
                category_id: null,
                category_name: "Uncategorized",
                color: "#9E9E9E",
                icon: "help-circle",
                total_amount: parseFloat(uncategorizedTotal.toFixed(2)),
                percentage: parseFloat(((uncategorizedTotal / totalExpenses) * 100).toFixed(1)),
                transaction_count: transactions?.filter(t =>
                    !t.transaction_categorizations || t.transaction_categorizations.length === 0
                ).length || 0,
            });
        }

        return new Response(
            JSON.stringify(result),
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
