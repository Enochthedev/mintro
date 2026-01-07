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

        const { transaction_id } = await req.json();

        // Validation
        if (!transaction_id) {
            return new Response(
                JSON.stringify({ error: "transaction_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify transaction belongs to user
        const { data: transaction, error: txError } = await supabaseClient
            .from("transactions")
            .select("id, name")
            .eq("id", transaction_id)
            .eq("user_id", user.id)
            .single();

        if (txError || !transaction) {
            return new Response(
                JSON.stringify({ error: "Transaction not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Find and delete the categorization
        const { data: categorization, error: catError } = await supabaseClient
            .from("transaction_categorizations")
            .select(`
        id,
        category_id,
        method,
        expense_categories!category_id (
          name
        )
      `)
            .eq("transaction_id", transaction_id)
            .single();

        if (catError || !categorization) {
            return new Response(
                JSON.stringify({ error: "Transaction is not categorized" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Delete the categorization
        const { error: deleteError } = await supabaseClient
            .from("transaction_categorizations")
            .delete()
            .eq("id", categorization.id);

        if (deleteError) {
            throw deleteError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: "Transaction uncategorized successfully",
                removed_categorization: {
                    transaction_id,
                    transaction_name: transaction.name,
                    previous_category: (categorization as any).expense_categories?.name,
                    previous_method: categorization.method,
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
