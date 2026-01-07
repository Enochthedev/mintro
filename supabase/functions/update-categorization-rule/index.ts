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

        const {
            rule_id,
            category_id,
            rule_type,
            match_value,
            min_amount,
            max_amount,
            priority,
            confidence_score,
            is_active,
        } = await req.json();

        // Validation
        if (!rule_id) {
            return new Response(
                JSON.stringify({ error: "rule_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify rule belongs to user
        const { data: existingRule, error: fetchError } = await supabaseClient
            .from("categorization_rules")
            .select("*")
            .eq("id", rule_id)
            .eq("user_id", user.id)
            .single();

        if (fetchError || !existingRule) {
            return new Response(
                JSON.stringify({ error: "Rule not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Build update object with only provided fields
        const updates: Record<string, any> = {};

        // Validate and add category_id if provided
        if (category_id !== undefined) {
            const { data: category, error: catError } = await supabaseClient
                .from("expense_categories")
                .select("id")
                .eq("id", category_id)
                .eq("user_id", user.id)
                .single();

            if (catError || !category) {
                return new Response(
                    JSON.stringify({ error: "Category not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.category_id = category_id;
        }

        // Validate rule_type if provided
        if (rule_type !== undefined) {
            const validRuleTypes = ['vendor_exact', 'vendor_contains', 'description_contains', 'amount_range'];
            if (!validRuleTypes.includes(rule_type)) {
                return new Response(
                    JSON.stringify({ error: `rule_type must be one of: ${validRuleTypes.join(', ')}` }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.rule_type = rule_type;
        }

        if (match_value !== undefined) {
            if (typeof match_value !== 'string' || match_value.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: "match_value must be a non-empty string" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.match_value = match_value.toLowerCase().trim();
        }

        if (min_amount !== undefined) {
            updates.min_amount = min_amount;
        }

        if (max_amount !== undefined) {
            updates.max_amount = max_amount;
        }

        if (priority !== undefined) {
            if (typeof priority !== 'number' || priority < 0) {
                return new Response(
                    JSON.stringify({ error: "priority must be a non-negative number" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.priority = priority;
        }

        if (confidence_score !== undefined) {
            if (typeof confidence_score !== 'number' || confidence_score < 0 || confidence_score > 1) {
                return new Response(
                    JSON.stringify({ error: "confidence_score must be between 0 and 1" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.confidence_score = confidence_score;
        }

        if (is_active !== undefined) {
            updates.is_active = Boolean(is_active);
        }

        if (Object.keys(updates).length === 0) {
            return new Response(
                JSON.stringify({ error: "No fields to update" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Perform update
        const { data: rule, error: updateError } = await supabaseClient
            .from("categorization_rules")
            .update(updates)
            .eq("id", rule_id)
            .eq("user_id", user.id)
            .select(`
        *,
        expense_categories!category_id (
          id,
          name,
          color,
          icon
        )
      `)
            .single();

        if (updateError) {
            throw updateError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: "Rule updated successfully",
                rule,
                updated_fields: Object.keys(updates),
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
