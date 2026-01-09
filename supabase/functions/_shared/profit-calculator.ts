/**
 * Shared Profit Calculator
 * 
 * This module provides functions to calculate profit from available data sources:
 * 1. Linked bank transactions (transaction_job_allocations)
 * 2. Blueprint estimates (blueprint_usage → cost_blueprints)
 * 3. Manual overrides (invoice_cost_overrides)
 * 
 * The engine ALWAYS calculates profit using whatever data exists,
 * and uses blueprints/overrides only to improve accuracy.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ProfitCalculation {
    revenue: number;
    costs: {
        from_transactions: number;      // Sum of linked transaction allocations
        from_blueprints: number | null; // Estimated costs from blueprints (if any)
        from_override: number | null;   // Manual override (if any)
        effective: number;              // The cost used for profit calculation
    };
    profit: {
        calculated: number;             // Revenue - effective costs
        estimated: number | null;       // Revenue - blueprint costs (if any)
        variance: number | null;        // Calculated - Estimated (if estimated exists)
    };
    margin: number;                   // (Profit / Revenue) * 100
    data_sources: {
        has_linked_transactions: boolean;
        has_blueprints: boolean;
        has_manual_override: boolean;
    };
}

export interface InvoiceForProfit {
    id: string;
    amount: number | string;
    total_actual_cost?: number | string | null;
    actual_profit?: number | string | null;
    cost_override_by_user?: boolean;
}

export interface BlueprintUsage {
    cost_blueprints?: {
        total_estimated_cost?: number | string;
        estimated_materials_cost?: number | string;
        estimated_labor_cost?: number | string;
        estimated_overhead_cost?: number | string;
    };
}

export interface TransactionAllocation {
    allocation_amount: number | string;
}

/**
 * Calculate profit for an invoice using all available data sources
 * 
 * Priority:
 * 1. If manual override exists → use override
 * 2. If linked transactions exist → use transaction costs
 * 3. If only blueprints exist → use estimated costs
 * 4. No data → profit = revenue (assuming $0 costs)
 */
export function calculateInvoiceProfit(
    invoice: InvoiceForProfit,
    linkedTransactions: TransactionAllocation[],
    blueprintUsage: BlueprintUsage[]
): ProfitCalculation {
    const revenue = parseFloat(String(invoice.amount || 0));

    // Calculate costs from linked transactions
    const transactionCosts = linkedTransactions.reduce(
        (sum, tx) => sum + Math.abs(parseFloat(String(tx.allocation_amount || 0))),
        0
    );

    // Calculate estimated costs from blueprints
    const blueprintCosts = blueprintUsage.length > 0
        ? blueprintUsage.reduce(
            (sum, usage) => sum + parseFloat(String(usage.cost_blueprints?.total_estimated_cost || 0)),
            0
        )
        : null;

    // Check for manual override
    const hasOverride = invoice.cost_override_by_user || false;
    const overrideCost = hasOverride && invoice.total_actual_cost !== null
        ? parseFloat(String(invoice.total_actual_cost || 0))
        : null;

    // Determine effective cost (priority: override > transactions > blueprints > 0)
    let effectiveCost: number;
    if (overrideCost !== null) {
        effectiveCost = overrideCost;
    } else if (transactionCosts > 0) {
        effectiveCost = transactionCosts;
    } else if (blueprintCosts !== null && blueprintCosts > 0) {
        effectiveCost = blueprintCosts;
    } else {
        effectiveCost = 0;
    }

    // Calculate profits
    const calculatedProfit = revenue - effectiveCost;
    const estimatedProfit = blueprintCosts !== null ? revenue - blueprintCosts : null;
    const variance = estimatedProfit !== null ? calculatedProfit - estimatedProfit : null;

    // Calculate margin
    const margin = revenue > 0 ? (calculatedProfit / revenue) * 100 : 0;

    return {
        revenue,
        costs: {
            from_transactions: transactionCosts,
            from_blueprints: blueprintCosts,
            from_override: overrideCost,
            effective: effectiveCost,
        },
        profit: {
            calculated: calculatedProfit,
            estimated: estimatedProfit,
            variance: variance,
        },
        margin,
        data_sources: {
            has_linked_transactions: transactionCosts > 0,
            has_blueprints: blueprintCosts !== null && blueprintCosts > 0,
            has_manual_override: hasOverride,
        },
    };
}

/**
 * Fetch linked transactions for an invoice
 */
export async function getLinkedTransactions(
    supabase: SupabaseClient,
    invoiceId: string
): Promise<TransactionAllocation[]> {
    const { data, error } = await supabase
        .from("transaction_job_allocations")
        .select("allocation_amount")
        .eq("job_id", invoiceId);

    if (error) {
        console.error("Error fetching linked transactions:", error);
        return [];
    }

    return data || [];
}

/**
 * Fetch linked transactions for multiple invoices in one query
 */
export async function getLinkedTransactionsForInvoices(
    supabase: SupabaseClient,
    invoiceIds: string[]
): Promise<Map<string, TransactionAllocation[]>> {
    if (invoiceIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from("transaction_job_allocations")
        .select("job_id, allocation_amount")
        .in("job_id", invoiceIds);

    if (error) {
        console.error("Error fetching linked transactions:", error);
        return new Map();
    }

    // Group by invoice ID
    const result = new Map<string, TransactionAllocation[]>();
    (data || []).forEach((row: { job_id: string; allocation_amount: number | string }) => {
        const existing = result.get(row.job_id) || [];
        existing.push({ allocation_amount: row.allocation_amount });
        result.set(row.job_id, existing);
    });

    return result;
}

/**
 * Calculate aggregate profit metrics for a list of invoices
 */
export function calculateAggregateProfitMetrics(
    calculations: ProfitCalculation[]
): {
    total_revenue: number;
    total_costs: number;
    total_profit: number;
    average_margin: number;
    invoices_with_transaction_costs: number;
    invoices_with_blueprint_estimates: number;
    invoices_with_overrides: number;
} {
    if (calculations.length === 0) {
        return {
            total_revenue: 0,
            total_costs: 0,
            total_profit: 0,
            average_margin: 0,
            invoices_with_transaction_costs: 0,
            invoices_with_blueprint_estimates: 0,
            invoices_with_overrides: 0,
        };
    }

    const totalRevenue = calculations.reduce((sum, c) => sum + c.revenue, 0);
    const totalCosts = calculations.reduce((sum, c) => sum + c.costs.effective, 0);
    const totalProfit = calculations.reduce((sum, c) => sum + c.profit.calculated, 0);
    const averageMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
        total_revenue: parseFloat(totalRevenue.toFixed(2)),
        total_costs: parseFloat(totalCosts.toFixed(2)),
        total_profit: parseFloat(totalProfit.toFixed(2)),
        average_margin: parseFloat(averageMargin.toFixed(2)),
        invoices_with_transaction_costs: calculations.filter(c => c.data_sources.has_linked_transactions).length,
        invoices_with_blueprint_estimates: calculations.filter(c => c.data_sources.has_blueprints).length,
        invoices_with_overrides: calculations.filter(c => c.data_sources.has_manual_override).length,
    };
}
