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

        const { category_id, name, description, color, icon } = await req.json();

        // Validation
        if (!category_id) {
            return new Response(
                JSON.stringify({ error: "category_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
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

        // Build update object with only provided fields
        const updates: Record<string, any> = {};

        if (name !== undefined) {
            const trimmedName = name.trim();
            if (trimmedName.length === 0) {
                return new Response(
                    JSON.stringify({ error: "Category name cannot be empty" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            if (trimmedName.length > 50) {
                return new Response(
                    JSON.stringify({ error: "Category name must be 50 characters or less" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // Check for duplicate name (excluding current category)
            const { data: duplicate } = await supabaseClient
                .from("expense_categories")
                .select("id")
                .eq("user_id", user.id)
                .ilike("name", trimmedName)
                .neq("id", category_id)
                .single();

            if (duplicate) {
                return new Response(
                    JSON.stringify({ error: "A category with this name already exists" }),
                    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            updates.name = trimmedName;
        }

        if (description !== undefined) {
            updates.description = description?.trim() || null;
        }

        if (color !== undefined) {
            // Basic hex color validation
            if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
                return new Response(
                    JSON.stringify({ error: "Invalid color format. Use hex format like #FF5733" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            updates.color = color;
        }

        if (icon !== undefined) {
            updates.icon = icon;
        }

        // Handle parent_category_id update
        const body = await req.clone().json();
        if (body.parent_category_id !== undefined) {
            if (body.parent_category_id === null) {
                updates.parent_category_id = null;
            } else {
                // Validate parent category exists and belongs to user
                const { data: parentCategory, error: parentError } = await supabaseClient
                    .from("expense_categories")
                    .select("id")
                    .eq("id", body.parent_category_id)
                    .eq("user_id", user.id)
                    .single();

                if (parentError || !parentCategory) {
                    return new Response(
                        JSON.stringify({ error: "Parent category not found" }),
                        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                // Prevent circular reference
                if (body.parent_category_id === category_id) {
                    return new Response(
                        JSON.stringify({ error: "Category cannot be its own parent" }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                updates.parent_category_id = body.parent_category_id;
            }
        }

        if (Object.keys(updates).length === 0) {
            return new Response(
                JSON.stringify({ error: "No fields to update" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Perform update
        const { data: category, error: updateError } = await supabaseClient
            .from("expense_categories")
            .update(updates)
            .eq("id", category_id)
            .eq("user_id", user.id)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: "Category updated successfully",
                category,
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
