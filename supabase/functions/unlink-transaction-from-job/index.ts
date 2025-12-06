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

        const {
            allocation_id,
            transaction_id,
            job_id,
        } = await req.json();

        // Support unlinking by allocation_id OR by combination of transaction_id + job_id
        if (!allocation_id && (!transaction_id || !job_id)) {
            return new Response(
                JSON.stringify({
                    error: "Either allocation_id OR both transaction_id and job_id are required"
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let query = supabaseClient
            .from("transaction_job_allocations")
            .select("*, invoices(id, amount)")
            .eq("user_id", user.id);

        if (allocation_id) {
            query = query.eq("id", allocation_id);
        } else {
            query = query.eq("transaction_id", transaction_id).eq("job_id", job_id);
        }

        const { data: allocation, error: fetchError } = await query.single();

        if (fetchError || !allocation) {
            return new Response(
                JSON.stringify({ error: "Transaction allocation not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const invoiceId = allocation.job_id;
        const invoiceAmount = allocation.invoices?.amount || 0;

        // Delete the allocation
        const { error: deleteError } = await supabaseClient
            .from("transaction_job_allocations")
            .delete()
            .eq("id", allocation.id);

        if (deleteError) {
            throw deleteError;
        }

        // Recalculate invoice totals after unlinking
        const { data: remainingAllocations } = await supabaseClient
            .from("transaction_job_allocations")
            .select("allocation_amount")
            .eq("job_id", invoiceId);

        const totalActualCost = remainingAllocations?.reduce(
            (sum, alloc) => sum + Math.abs(Number(alloc.allocation_amount) || 0),
            0
        ) || 0;

        const actualProfit = totalActualCost > 0
            ? (Number(invoiceAmount) || 0) - totalActualCost
            : null;

        // Update invoice totals (set to null if no more allocations)
        await supabaseClient
            .from("invoices")
            .update({
                total_actual_cost: totalActualCost > 0 ? totalActualCost : null,
                actual_profit: actualProfit,
            })
            .eq("id", invoiceId);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Transaction unlinked from job successfully",
                unlinked_allocation_id: allocation.id,
                invoice_totals_updated: {
                    total_actual_cost: totalActualCost > 0 ? totalActualCost : null,
                    actual_profit: actualProfit,
                    remaining_linked_transactions: remainingAllocations?.length || 0,
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
