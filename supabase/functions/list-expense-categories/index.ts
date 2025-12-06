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
        const includeStats = url.searchParams.get("include_stats") === "true";

        // Get all categories for the user
        const { data: categories, error: categoriesError } = await supabaseClient
            .from("expense_categories")
            .select("*")
            .eq("user_id", user.id)
            .order("name", { ascending: true });

        if (categoriesError) {
            throw categoriesError;
        }

        let categoriesWithStats = categories || [];

        // Optionally include usage stats
        if (includeStats && categories && categories.length > 0) {
            const categoryIds = categories.map(c => c.id);

            // Get categorization counts
            const { data: categorizationCounts, error: countError } = await supabaseClient
                .from("transaction_categorizations")
                .select("category_id")
                .in("category_id", categoryIds);

            if (!countError && categorizationCounts) {
                // Count occurrences per category
                const countMap = new Map<string, number>();
                categorizationCounts.forEach(c => {
                    const current = countMap.get(c.category_id) || 0;
                    countMap.set(c.category_id, current + 1);
                });

                // Get rule counts
                const { data: ruleCounts, error: ruleError } = await supabaseClient
                    .from("categorization_rules")
                    .select("category_id")
                    .in("category_id", categoryIds);

                const ruleCountMap = new Map<string, number>();
                if (!ruleError && ruleCounts) {
                    ruleCounts.forEach(r => {
                        const current = ruleCountMap.get(r.category_id) || 0;
                        ruleCountMap.set(r.category_id, current + 1);
                    });
                }

                categoriesWithStats = categories.map(cat => ({
                    ...cat,
                    transaction_count: countMap.get(cat.id) || 0,
                    rule_count: ruleCountMap.get(cat.id) || 0,
                }));
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                categories: categoriesWithStats,
                total: categoriesWithStats.length,
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
