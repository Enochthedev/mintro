import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Default colors and icons for categories
const DEFAULT_COLORS = [
    "#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0",
    "#00BCD4", "#795548", "#607D8B", "#F44336", "#3F51B5"
];

const DEFAULT_ICONS = [
    "folder", "tag", "bookmark", "star", "flag",
    "circle", "square", "triangle", "diamond", "heart"
];

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

        const { name, description, color, icon, parent_category_id } = await req.json();

        // Validation
        if (!name || typeof name !== "string" || name.trim().length === 0) {
            return new Response(
                JSON.stringify({ error: "Category name is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const trimmedName = name.trim();

        if (trimmedName.length > 50) {
            return new Response(
                JSON.stringify({ error: "Category name must be 50 characters or less" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check for duplicate category name
        const { data: existing, error: checkError } = await supabaseClient
            .from("expense_categories")
            .select("id")
            .eq("user_id", user.id)
            .ilike("name", trimmedName)
            .single();

        if (existing) {
            return new Response(
                JSON.stringify({ error: "A category with this name already exists" }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Validate parent category if provided
        if (parent_category_id) {
            const { data: parentCategory, error: parentError } = await supabaseClient
                .from("expense_categories")
                .select("id")
                .eq("id", parent_category_id)
                .eq("user_id", user.id)
                .single();

            if (parentError || !parentCategory) {
                return new Response(
                    JSON.stringify({ error: "Parent category not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // Get count of existing categories for default color/icon selection
        const { count: categoryCount } = await supabaseClient
            .from("expense_categories")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id);

        const index = categoryCount || 0;

        // Create the category
        const { data: category, error: insertError } = await supabaseClient
            .from("expense_categories")
            .insert({
                user_id: user.id,
                name: trimmedName,
                description: description?.trim() || null,
                color: color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
                icon: icon || DEFAULT_ICONS[index % DEFAULT_ICONS.length],
                parent_category_id: parent_category_id || null,
            })
            .select()
            .single();

        if (insertError) {
            throw insertError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: "Category created successfully",
                category,
            }),
            {
                status: 201,
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
