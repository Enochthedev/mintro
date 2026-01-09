import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * get-estimated-vs-actual-summary
 * 
 * Provides an aggregate view of Estimated vs Actual performance across all invoices.
 * Helps answer: "Are we generally under or over budget?"
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

        const url = new URL(req.url);
        const start_date = url.searchParams.get("start_date");
        const end_date = url.searchParams.get("end_date");

        const startDate = start_date || `${new Date().getFullYear()}-01-01`;
        const endDate = end_date || new Date().toISOString().split('T')[0];

        // ============================================
        // GET INVOICES WITH COST DATA & BLUEPRINTS
        // ============================================
        // We fetch all invoices to correctly calculate totals, even those without blueprints
        const { data: invoices, error: invoicesError } = await supabaseClient
            .from("invoices")
            .select(`
        id,
        invoice,
        client,
        amount,
        invoice_date,
        total_actual_cost,
        cost_override_by_user,
        blueprint_usage (
          id,
          cost_blueprints (
            id,
            name,
            total_estimated_cost
          )
        )
      `)
            .eq("user_id", user.id)
            .gte("invoice_date", startDate)
            .lte("invoice_date", endDate);

        if (invoicesError) throw invoicesError;

        // ============================================
        // GET LINKED TRANSACTIONS
        // ============================================
        const invoiceIds = invoices?.map(inv => inv.id) || [];

        const { data: allocations, error: allocError } = await supabaseClient
            .from("transaction_job_allocations")
            .select("job_id, allocation_amount")
            .in("job_id", invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

        const allocationsByInvoice = new Map<string, number>();
        (allocations || []).forEach((alloc: { job_id: string; allocation_amount: number | string }) => {
            const current = allocationsByInvoice.get(alloc.job_id) || 0;
            allocationsByInvoice.set(alloc.job_id, current + Math.abs(parseFloat(String(alloc.allocation_amount || 0))));
        });

        // ============================================
        // CALCULATE METRICS
        // ============================================
        const summary = {
            total_invoices: invoices?.length || 0,
            total_revenue: 0,

            // Totals
            total_estimated_cost: 0,
            total_actual_cost: 0,
            net_cost_variance: 0,

            // Counts
            jobs_with_estimates: 0,
            jobs_under_budget: 0,
            jobs_over_budget: 0,
            jobs_on_budget: 0,

            // Averages
            avg_variance_percent: 0
        };

        const variancePercentages: number[] = [];

        (invoices || []).forEach(inv => {
            summary.total_revenue += parseFloat(inv.amount || 0);

            // Estimated Cost (from Blueprints)
            const estimatedCost = (inv.blueprint_usage || []).reduce(
                (sum: number, usage: any) => sum + parseFloat(usage.cost_blueprints?.total_estimated_cost || 0),
                0
            );

            // Actual Cost
            let actualCost = 0;
            const transactionCost = allocationsByInvoice.get(inv.id) || 0;

            if (inv.cost_override_by_user && inv.total_actual_cost !== null) {
                actualCost = parseFloat(inv.total_actual_cost || 0);
            } else if (transactionCost > 0) {
                actualCost = transactionCost;
            } else if (inv.total_actual_cost !== null) {
                actualCost = parseFloat(inv.total_actual_cost || 0);
            }

            // Only aggregate estimates if they exist
            if (estimatedCost > 0) {
                summary.jobs_with_estimates++;
                summary.total_estimated_cost += estimatedCost;
                summary.total_actual_cost += actualCost; // Only count actuals against estimates for estimated jobs

                const variance = actualCost - estimatedCost;
                summary.net_cost_variance += variance;

                const variancePct = (variance / estimatedCost) * 100;
                variancePercentages.push(variancePct);

                if (variance > 1) summary.jobs_over_budget++;
                else if (variance < -1) summary.jobs_under_budget++;
                else summary.jobs_on_budget++;
            }
        });

        // Format totals
        summary.total_revenue = parseFloat(summary.total_revenue.toFixed(2));
        summary.total_estimated_cost = parseFloat(summary.total_estimated_cost.toFixed(2));
        summary.total_actual_cost = parseFloat(summary.total_actual_cost.toFixed(2));
        summary.net_cost_variance = parseFloat(summary.net_cost_variance.toFixed(2));

        // Average variance pct
        if (variancePercentages.length > 0) {
            const totalPct = variancePercentages.reduce((a, b) => a + b, 0);
            summary.avg_variance_percent = parseFloat((totalPct / variancePercentages.length).toFixed(2));
        }

        return new Response(
            JSON.stringify({
                success: true,
                period: { start_date: startDate, end_date: endDate },
                summary: summary,
                performance_status: summary.net_cost_variance <= 0
                    ? "under_budget" // Good (Under budget)
                    : "over_budget",  // Bad (Over budget)
                message: summary.jobs_with_estimates === 0
                    ? "No jobs with estimates found in this period."
                    : `Tracking ${Math.abs(summary.net_cost_variance).toFixed(2)} ${summary.net_cost_variance <= 0 ? 'under' : 'over'} budget across ${summary.jobs_with_estimates} estimated jobs.`
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
