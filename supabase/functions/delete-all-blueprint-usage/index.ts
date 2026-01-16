import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * delete-all-blueprint-usage
 * 
 * Deletes all blueprint usage records for the authenticated user.
 * Can optionally filter by:
 *   - invoice_id: Delete only usages linked to a specific invoice
 *   - blueprint_id: Delete only usages of a specific blueprint
 * 
 * WARNING: This is a destructive operation. Use with caution.
 */

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

        const requestBody = await req.json().catch(() => ({}));
        const { invoice_id, blueprint_id, confirm_delete } = requestBody;

        // Safety check - require explicit confirmation for bulk delete
        if (confirm_delete !== true) {
            return new Response(
                JSON.stringify({
                    error: "Confirmation required",
                    message: "Set confirm_delete: true to proceed with deletion",
                    warning: "This will permanently delete blueprint usage records"
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Build the query
        let query = supabaseClient
            .from("blueprint_usage")
            .select("id, blueprint_id, invoice_id, actual_sale_price, actual_materials_cost, actual_labor_cost, actual_overhead_cost, completed_date")
            .eq("user_id", user.id);

        // Add optional filters
        if (invoice_id) {
            query = query.eq("invoice_id", invoice_id);
        }
        if (blueprint_id) {
            query = query.eq("blueprint_id", blueprint_id);
        }

        // First, get the records to be deleted (for reporting)
        const { data: usagesToDelete, error: selectError } = await query;

        if (selectError) {
            throw selectError;
        }

        const count = usagesToDelete?.length || 0;

        if (count === 0) {
            return new Response(
                JSON.stringify({
                    success: true,
                    message: "No blueprint usage records found to delete",
                    deleted_count: 0,
                    filters_applied: {
                        invoice_id: invoice_id || null,
                        blueprint_id: blueprint_id || null,
                    }
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Calculate totals before deletion
        const totalRevenue = usagesToDelete.reduce((sum, u) => sum + (u.actual_sale_price || 0), 0);
        const totalCost = usagesToDelete.reduce((sum, u) =>
            sum + (u.actual_materials_cost || 0) + (u.actual_labor_cost || 0) + (u.actual_overhead_cost || 0), 0);
        const totalProfit = totalRevenue - totalCost;

        // Get unique blueprint and invoice counts
        const uniqueBlueprints = new Set(usagesToDelete.map(u => u.blueprint_id)).size;
        const uniqueInvoices = new Set(usagesToDelete.filter(u => u.invoice_id).map(u => u.invoice_id)).size;

        // Now delete
        let deleteQuery = supabaseClient
            .from("blueprint_usage")
            .delete()
            .eq("user_id", user.id);

        if (invoice_id) {
            deleteQuery = deleteQuery.eq("invoice_id", invoice_id);
        }
        if (blueprint_id) {
            deleteQuery = deleteQuery.eq("blueprint_id", blueprint_id);
        }

        const { error: deleteError } = await deleteQuery;

        if (deleteError) {
            throw deleteError;
        }

        // Build response message
        let message = `Deleted ${count} blueprint usage record${count !== 1 ? 's' : ''}`;
        if (invoice_id) {
            message += ` for invoice ${invoice_id}`;
        }
        if (blueprint_id) {
            message += ` for blueprint ${blueprint_id}`;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message,
                deleted_count: count,
                deleted_summary: {
                    unique_blueprints: uniqueBlueprints,
                    unique_invoices: uniqueInvoices,
                    total_revenue: parseFloat(totalRevenue.toFixed(2)),
                    total_cost: parseFloat(totalCost.toFixed(2)),
                    total_profit: parseFloat(totalProfit.toFixed(2)),
                },
                filters_applied: {
                    invoice_id: invoice_id || null,
                    blueprint_id: blueprint_id || null,
                },
                warning: "These records have been permanently deleted and cannot be recovered"
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
