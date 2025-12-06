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

        const { category_id, force = false, merge_into_category_id } = await req.json();

        // Validation
        if (!category_id) {
            return new Response(
                JSON.stringify({ error: "category_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Validate merge target if provided
        if (merge_into_category_id) {
            if (merge_into_category_id === category_id) {
                return new Response(
                    JSON.stringify({ error: "Cannot merge category into itself" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const { data: mergeTarget, error: mergeError } = await supabaseClient
                .from("expense_categories")
                .select("id, name")
                .eq("id", merge_into_category_id)
                .eq("user_id", user.id)
                .single();

            if (mergeError || !mergeTarget) {
                return new Response(
                    JSON.stringify({ error: "Merge target category not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // Verify category belongs to user
        const { data: existingCategory, error: fetchError } = await supabaseClient
            .from("expense_categories")
            .select("*")
            .eq("id", category_id)
            .eq("user_id", user.id)
            .single();

        if (fetchError || !existingCategory) {
            return new Response(
                JSON.stringify({ error: "Category not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check for linked data
        const { count: categorizationCount } = await supabaseClient
            .from("transaction_categorizations")
            .select("*", { count: "exact", head: true })
            .eq("category_id", category_id);

        const { count: ruleCount } = await supabaseClient
            .from("categorization_rules")
            .select("*", { count: "exact", head: true })
            .eq("category_id", category_id);

        const hasLinkedData = (categorizationCount || 0) > 0 || (ruleCount || 0) > 0;

        if (hasLinkedData && !force && !merge_into_category_id) {
            return new Response(
                JSON.stringify({
                    error: "Category has linked data",
                    message: "This category has linked transactions or rules. Set force=true to delete, or provide merge_into_category_id to reassign.",
                    linked_data: {
                        transaction_categorizations: categorizationCount || 0,
                        categorization_rules: ruleCount || 0,
                    }
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Handle linked data
        let deletedRules = 0;
        let deletedCategorizations = 0;
        let mergedRules = 0;
        let mergedCategorizations = 0;

        if (hasLinkedData) {
            if (merge_into_category_id) {
                // Merge: Update rules and categorizations to point to new category
                const { data: updatedRules } = await supabaseClient
                    .from("categorization_rules")
                    .update({ category_id: merge_into_category_id })
                    .eq("category_id", category_id)
                    .eq("user_id", user.id)
                    .select();

                mergedRules = updatedRules?.length || 0;

                const { data: updatedCategorizations } = await supabaseClient
                    .from("transaction_categorizations")
                    .update({ 
                        category_id: merge_into_category_id,
                        previous_category_id: category_id 
                    })
                    .eq("category_id", category_id)
                    .select();

                mergedCategorizations = updatedCategorizations?.length || 0;

                // Update child categories to point to merge target
                await supabaseClient
                    .from("expense_categories")
                    .update({ parent_category_id: merge_into_category_id })
                    .eq("parent_category_id", category_id)
                    .eq("user_id", user.id);

            } else if (force) {
                // Force delete: Remove all linked data
                const { data: deletedRuleData } = await supabaseClient
                    .from("categorization_rules")
                    .delete()
                    .eq("category_id", category_id)
                    .eq("user_id", user.id)
                    .select();

                deletedRules = deletedRuleData?.length || 0;

                const { data: deletedCategorizationData } = await supabaseClient
                    .from("transaction_categorizations")
                    .delete()
                    .eq("category_id", category_id)
                    .select();

                deletedCategorizations = deletedCategorizationData?.length || 0;

                // Orphan child categories (set parent to null)
                await supabaseClient
                    .from("expense_categories")
                    .update({ parent_category_id: null })
                    .eq("parent_category_id", category_id)
                    .eq("user_id", user.id);
            }
        }

        // Delete the category
        const { error: deleteError } = await supabaseClient
            .from("expense_categories")
            .delete()
            .eq("id", category_id)
            .eq("user_id", user.id);

        if (deleteError) {
            throw deleteError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: merge_into_category_id 
                    ? "Category merged and deleted successfully" 
                    : "Category deleted successfully",
                deleted_category: {
                    id: existingCategory.id,
                    name: existingCategory.name,
                },
                merged_into: merge_into_category_id || null,
                merged_data: merge_into_category_id ? {
                    categorization_rules: mergedRules,
                    transaction_categorizations: mergedCategorizations,
                } : null,
                deleted_data: force && !merge_into_category_id ? {
                    categorization_rules: deletedRules,
                    transaction_categorizations: deletedCategorizations,
                } : null,
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
