// Analytics and Profitability endpoints
import { createRequest } from "./helpers.ts";

export function getAnalyticsSection() {
    return {
        name: "📊 Analytics & Profitability",
        description: "Business analytics, profitability tracking, and margin analysis. The profitability engine calculates profit using linked bank transactions as the primary cost source. Blueprints and manual overrides are optional enhancements.",
        item: [
            createRequest("Get Dashboard Summary", "GET", "/functions/v1/get-dashboard-summary", null,
                [],
                {
                    success: true,
                    kpis: {
                        current_month_revenue: 25000.00,
                        current_month_profit: 8500.00,
                        average_profit_margin: 34.0,
                        ytd_revenue: 150000.00,
                        revenue_change_mom: 15.5,
                        trend: "up"
                    },
                    recent_activity: {
                        recent_invoices: [{ id: "inv-1", invoice_number: "INV-001", client: "ABC Corp", amount: 5000 }]
                    },
                    alerts: {
                        low_margin_jobs: { count: 2 },
                        low_stock_items: { count: 3 },
                        overdue_invoices: { count: 1, amount: 2500 },
                        uncategorized_transactions: { count: 15 }
                    },
                    quick_stats: { active_blueprints: 8, inventory_items: 45, categorization_rules: 12 }
                },
                "Get comprehensive dashboard summary with KPIs, recent activity, and alerts."
            ),
            createRequest("Get Business Profitability", "GET", "/functions/v1/get-business-profitability", null,
                [
                    { key: "start_date", value: "2025-01-01", disabled: false, description: "Start date (YYYY-MM-DD)" },
                    { key: "end_date", value: "2025-12-31", disabled: false, description: "End date (YYYY-MM-DD)" }
                ],
                {
                    success: true,
                    period: { start_date: "2025-01-01", end_date: "2025-12-31" },
                    overview: {
                        total_revenue: 150000.00,
                        total_expenses: 90000.00,
                        net_profit: 60000.00,
                        profit_margin: 40.00
                    },
                    job_metrics: {
                        total_invoices: 45,
                        invoices_with_cost_data: 40,
                        invoices_with_transaction_costs: 35,
                        invoices_with_blueprint_estimates: 20,
                        total_job_costs: 78000.00,
                        total_job_profit: 47000.00,
                        average_job_profit: 1175.00,
                        average_job_margin: 37.60
                    },
                    service_type_breakdown: [
                        { service_type: "Kitchen Remodel", revenue: 50000, cost: 32000, profit: 18000, profit_margin: 36.00 }
                    ],
                    month_over_month: {
                        current_month_revenue: 15000.00,
                        last_month_revenue: 13500.00,
                        revenue_change_percent: 11.11,
                        trend: "up"
                    },
                    data_quality: {
                        message: "40 of 45 invoices have cost data.",
                        invoices_missing_cost_data: 5
                    }
                },
                "Get comprehensive profitability analysis. Calculates profit using linked bank transactions as primary cost source. Works for ALL invoices - blueprints are optional."
            ),
            createRequest("Get Estimated vs Actual Summary", "GET", "/functions/v1/get-estimated-vs-actual-summary", null,
                [
                    { key: "start_date", value: "2025-01-01", disabled: false, description: "Start date (YYYY-MM-DD)" },
                    { key: "end_date", value: "2025-12-31", disabled: false, description: "End date (YYYY-MM-DD)" }
                ],
                {
                    success: true,
                    period: { start_date: "2025-01-01", end_date: "2025-12-31" },
                    summary: {
                        total_invoices: 45,
                        total_revenue: 150000.00,
                        total_estimated_cost: 80000.00,
                        total_actual_cost: 82000.00,
                        net_cost_variance: 2000.00,
                        avg_variance_percent: 2.50,
                        jobs_with_estimates: 20,
                        jobs_under_budget: 12,
                        jobs_over_budget: 5,
                        jobs_on_budget: 3
                    },
                    performance_status: "over_budget",
                    message: "Tracking 2000.00 over budget across 20 estimated jobs."
                },
                "Get aggregate variance analysis comparing Blueprint Estimates vs Actual Costs across all jobs. Only includes jobs that have blueprint estimates attached."
            ),
            createRequest("Get Invoice Profit Breakdown", "GET", "/functions/v1/get-invoice-profit-breakdown", null,
                [
                    { key: "invoice_id", value: "UUID_HERE", disabled: false, description: "Invoice ID (required)" }
                ],
                {
                    success: true,
                    invoice: { id: "uuid", invoice_number: "INV-001", client: "ABC Corp", amount: 5000.00 },
                    blueprints: [{ id: "bp-1", name: "Kitchen Standard", type: "service" }],
                    costs: {
                        from_transactions: { total: 3200.00, transaction_count: 5 },
                        estimated: { materials: 1500, labor: 1200, overhead: 300, total: 3000.00 },
                        actual: { materials: 1600, labor: 1300, overhead: 300, total: 3200.00 },
                        effective: { amount: 3200.00, source: "linked_transactions" },
                        variance: { materials: 100, labor: 100, overhead: 0, total: 200.00 }
                    },
                    profit: {
                        calculated: 1800.00,
                        estimated: 2000.00,
                        variance: -200.00,
                        margin: 36.00
                    },
                    linked_expenses: [
                        { id: "exp-1", amount: 1600.00, date: "2025-11-10", vendor: "Home Depot", category: "Materials" }
                    ],
                    data_sources: {
                        has_linked_transactions: true,
                        has_blueprints: true,
                        has_manual_override: false,
                        cost_source: "linked_transactions"
                    },
                    data_quality: { message: "Costs calculated from linked transactions." }
                },
                "Get detailed profit breakdown for a specific invoice. Shows costs from linked transactions, blueprint estimates (if any), and variance analysis."
            ),
            createRequest("Get Profit Trends", "GET", "/functions/v1/get-profit-trends", null,
                [
                    { key: "period", value: "monthly", disabled: false, description: "Period type: monthly, quarterly, yearly" },
                    { key: "months", value: "12", disabled: false, description: "Number of months to analyze" }
                ],
                {
                    success: true,
                    period_type: "monthly",
                    months_analyzed: 12,
                    trends: [
                        {
                            period: "2025-01",
                            revenue: 15000.00,
                            expenses: 9000.00,
                            job_costs: 8500.00,
                            job_profit: 6500.00,
                            net_profit: 6000.00,
                            job_profit_margin: 43.33,
                            invoice_count: 5,
                            invoices_with_cost_data: 4
                        }
                    ],
                    growth_rates: [
                        { period: "2025-02", revenue_growth: 8.5, job_profit_growth: 12.0 }
                    ],
                    summary: {
                        total_revenue: 150000.00,
                        total_job_profit: 65000.00,
                        trend_direction: "growing",
                        total_invoices: 45,
                        invoices_with_cost_data: 40
                    },
                    data_quality: {
                        message: "40 of 45 invoices have cost data for accurate trend analysis.",
                        cost_data_coverage: 88.89
                    }
                },
                "Get profit trends over time. Calculates from linked transactions. Includes growth rates between periods."
            ),
            createRequest("Get Margin Analysis", "GET", "/functions/v1/get-margin-analysis", null,
                [
                    { key: "start_date", value: "2025-01-01", disabled: false, description: "Start date (YYYY-MM-DD)" },
                    { key: "end_date", value: "2025-12-31", disabled: false, description: "End date (YYYY-MM-DD)" },
                    { key: "min_margin", value: "20", disabled: false, description: "Minimum margin threshold for alerts" }
                ],
                {
                    success: true,
                    period: { start_date: "2025-01-01", end_date: "2025-12-31" },
                    by_service_type: [
                        { service_type: "Kitchen Remodel", job_count: 15, jobs_with_cost_data: 14, total_revenue: 75000, total_profit: 28000, average_margin: 37.33, median_margin: 38.00 }
                    ],
                    by_blueprint_type: [
                        { blueprint_type: "service", usage_count: 20, average_margin: 35.50 }
                    ],
                    low_margin_jobs: [
                        { invoice_id: "uuid", invoice_number: "INV-005", client: "XYZ Ltd", margin: 15.00, revenue: 5000, cost: 4250, has_cost_data: true }
                    ],
                    high_margin_jobs: [
                        { invoice_id: "uuid", invoice_number: "INV-012", client: "ABC Corp", margin: 55.00, revenue: 8000, cost: 3600, has_cost_data: true }
                    ],
                    summary: {
                        total_jobs_analyzed: 45,
                        jobs_with_cost_data: 40,
                        jobs_without_cost_data: 5,
                        average_margin: 38.50,
                        median_margin: 37.00,
                        jobs_below_threshold: 3,
                        jobs_below_threshold_percent: 7.50
                    },
                    data_quality: {
                        message: "40 of 45 invoices have cost data. Margins for invoices without cost data assume 100% margin."
                    }
                },
                "Analyze profit margins by service type, blueprint, and identify low/high margin jobs. Uses linked transactions for cost calculation."
            ),
            createRequest("Get Margin Alerts", "GET", "/functions/v1/get-margin-alerts", null,
                [
                    { key: "margin_threshold", value: "20", disabled: false, description: "Margin threshold for low-margin alerts (%)" },
                    { key: "cost_spike_threshold", value: "25", disabled: false, description: "Cost variance threshold for spike alerts (%)" },
                    { key: "days_back", value: "30", disabled: false, description: "Days to analyze" }
                ],
                {
                    success: true,
                    alert_settings: { margin_threshold: 20, cost_spike_threshold: 25, days_analyzed: 30 },
                    summary: {
                        total_alerts: 5,
                        low_margin_jobs_count: 2,
                        negative_jobs_count: 1,
                        cost_spikes_count: 2,
                        underperforming_blueprints_count: 0,
                        total_revenue_lost: 1500.00,
                        invoices_analyzed: 15,
                        invoices_with_cost_data: 12
                    },
                    alerts: {
                        low_margin_jobs: [{ invoice_id: "uuid", invoice_number: "INV-001", client: "ABC Corp", margin: 15.5, revenue: 5000, cost: 4225 }],
                        negative_profit_jobs: [{ invoice_id: "uuid", invoice_number: "INV-008", client: "XYZ Ltd", revenue: 3000, cost: 3500, loss: 500 }],
                        cost_spikes: [{ invoice_id: "uuid", invoice_number: "INV-003", estimated_cost: 2000, actual_cost: 2600, variance_percent: 30.0 }],
                        underperforming_blueprints: [],
                        declining_margin_trend: null,
                        missing_cost_data: [{ invoice_id: "uuid", invoice_number: "INV-010", client: "DEF Inc", revenue: 4000, message: "No cost data. Link transactions to track profit." }]
                    },
                    recommendations: [
                        "⚠️ You have jobs losing money. Review pricing strategy immediately.",
                        "📊 Multiple low-margin jobs detected. Consider raising prices or reducing costs."
                    ],
                    data_quality: {
                        message: "12 of 15 invoices have cost data. Alerts may be incomplete.",
                        cost_data_coverage: 80.00
                    }
                },
                "Get proactive alerts for low-margin jobs, negative profit, cost spikes vs estimates, and invoices missing cost data."
            ),
            createRequest("Get Blueprint Variance", "GET", "/functions/v1/get-blueprint-variance", null,
                [
                    { key: "blueprint_id", value: "UUID_HERE", disabled: true, description: "Optional: Filter by specific blueprint" },
                    { key: "start_date", value: "2025-01-01", disabled: true, description: "Start date filter" },
                    { key: "end_date", value: "2025-12-31", disabled: true, description: "End date filter" }
                ],
                {
                    success: true,
                    variances: [
                        {
                            usage_id: "uuid",
                            blueprint_id: "bp-uuid",
                            blueprint_name: "Kitchen Standard",
                            completed_date: "2025-11-15",
                            estimated: { materials: 2000, labor: 1500, total_cost: 3500, profit: 3500 },
                            actual: { materials: 2200, labor: 1600, total_cost: 3800, profit: 3200 },
                            variance: { materials: 200, labor: 100, total_cost: 300, profit: -300 },
                            variance_percentage: { total_cost: 8.57, profit: -8.57 },
                            performance: "over_budget"
                        }
                    ],
                    summary: {
                        total_jobs: 12,
                        avg_variances: { materials: 150, labor: 80, total: 230 },
                        performance: { over_budget: 5, under_budget: 4, on_budget: 3 }
                    }
                },
                "Analyze variance between blueprint estimates and actual costs. Shows per-job and aggregate variance."
            ),
            createRequest("Get Vendor Price Changes", "GET", "/functions/v1/get-vendor-price-changes", null,
                [
                    { key: "days", value: "90", disabled: false, description: "Days to analyze" }
                ],
                {
                    success: true,
                    changes: [
                        { vendor: "Home Depot", item: "2x4 Lumber", old_price: 5.99, new_price: 6.49, change_pct: 8.3, detected_date: "2025-11-01" }
                    ]
                },
                "Track vendor price changes over time to identify cost increases."
            )
        ]
    };
}
