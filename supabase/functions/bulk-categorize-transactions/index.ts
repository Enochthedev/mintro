import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

        const { categorizations } = await req.json();

        // Validation
        if (!categorizations || !Array.isArray(categorizations) || categorizations.length === 0) {
            return new Response(
                JSON.stringify({ error: "categorizations array is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (categorizations.length > 100) {
            return new Response(
                JSON.stringify({ error: "Maximum 100 categorizations per request" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Validate structure
        for (const item of categorizations) {
            if (!item.transaction_id || !item.category_id) {
                return new Response(
                    JSON.stringify({ error: "Each item must have transaction_id and category_id" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // Get all transaction IDs and category IDs
        const transactionIds = categorizations.map(c => c.transaction_id);
        const categoryIds = [...new Set(categorizations.map(c => c.category_id))];

        // Verify transactions belong to user
        const { data: transactions, error: txError } = await supabaseClient
            .from("transactions")
            .select("id")
            .eq("user_id", user.id)
            .in("id", transactionIds);

        if (txError) throw txError;

        const validTransactionIds = new Set(transactions?.map(t => t.id) || []);

        // Verify categories belong to user
        const { data: categories, error: catError } = await supabaseClient
            .from("expense_categories")
            .select("id")
            .eq("user_id", user.id)
            .in("id", categoryIds);

        if (catError) throw catError;

        const validCategoryIds = new Set(categories?.map(c => c.id) || []);

        // Filter to valid categorizations
        const validCategorizations = categorizations.filter(c =>
            validTransactionIds.has(c.transaction_id) && validCategoryIds.has(c.category_id)
        );

        if (validCategorizations.length === 0) {
            return new Response(
                JSON.stringify({ error: "No valid transaction/category pairs found" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check which transactions are already categorized
        const { data: existingCategorizations } = await supabaseClient
            .from("transaction_categorizations")
            .select("transaction_id")
            .in("transaction_id", transactionIds);

        const alreadyCategorized = new Set(existingCategorizations?.map(c => c.transaction_id) || []);

        // Separate into updates and inserts
        const toUpdate = validCategorizations.filter(c => alreadyCategorized.has(c.transaction_id));
        const toInsert = validCategorizations.filter(c => !alreadyCategorized.has(c.transaction_id));

        let insertedCount = 0;
        let updatedCount = 0;
        const errors: string[] = [];

        // Insert new categorizations
        if (toInsert.length > 0) {
            const insertData = toInsert.map(c => ({
                transaction_id: c.transaction_id,
                category_id: c.category_id,
                method: "manual",
                is_user_override: true,
                confidence: 1.0,
            }));

            const { data: inserted, error: insertError } = await supabaseClient
                .from("transaction_categorizations")
                .insert(insertData)
                .select();

            if (insertError) {
                errors.push(`Insert error: ${insertError.message}`);
            } else {
                insertedCount = inserted?.length || 0;
            }
        }

        // Update existing categorizations
        for (const item of toUpdate) {
            const { error: updateError } = await supabaseClient
                .from("transaction_categorizations")
                .update({
                    category_id: item.category_id,
                    method: "manual",
                    is_user_override: true,
                    confidence: 1.0,
                })
                .eq("transaction_id", item.transaction_id);

            if (updateError) {
                errors.push(`Update error for ${item.transaction_id}: ${updateError.message}`);
            } else {
                updatedCount++;
            }
        }

        // Also update the legacy 'category' column on transactions table for backward compatibility
        // Build a map of category_id to category_name
        const allCategoryIds = [...new Set(validCategorizations.map(c => c.category_id))];
        const { data: categoryNames } = await supabaseClient
            .from("expense_categories")
            .select("id, name")
            .in("id", allCategoryIds);

        const categoryNameMap = new Map(categoryNames?.map(c => [c.id, c.name]) || []);

        // Update each transaction's category column
        for (const item of validCategorizations) {
            const categoryName = categoryNameMap.get(item.category_id);
            if (categoryName) {
                await supabaseClient
                    .from("transactions")
                    .update({ category: categoryName })
                    .eq("id", item.transaction_id);
            }
        }

        const skippedCount = categorizations.length - validCategorizations.length;

        return new Response(
            JSON.stringify({
                success: true,
                message: "Bulk categorization complete",
                results: {
                    total_requested: categorizations.length,
                    inserted: insertedCount,
                    updated: updatedCount,
                    skipped: skippedCount,
                },
                errors: errors.length > 0 ? errors : undefined,
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
