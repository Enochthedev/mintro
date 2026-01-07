// Main Postman Collection Generator
// Combines new modular sections with existing sections from the original generator

import { PROJECT_URL, createRequest } from "./helpers.ts";
import { getAuthenticationSection } from "./auth.ts";
import { getCategorizationSection } from "./categorization.ts";
import { getTransactionsSection } from "./transactions.ts";

// Build the collection
const collection = {
    info: {
        name: "Mintro API",
        description: "Complete Mintro API documentation covering all Edge Functions. Professional collection for frontend integration and testing.\n\n## Getting Started\n1. Set the ANON_KEY variable to your Supabase anon key\n2. Use the Authentication endpoints to get an ACCESS_TOKEN\n3. Set the ACCESS_TOKEN variable\n4. You're ready to use all other endpoints!",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    variable: [
        { key: "PROJECT_URL", value: PROJECT_URL, type: "string" },
        { key: "ANON_KEY", value: "YOUR_SUPABASE_ANON_KEY", type: "string" },
        { key: "ACCESS_TOKEN", value: "YOUR_USER_ACCESS_TOKEN", type: "string" }
    ],
    item: [] as any[]
};

// Add modular sections
collection.item.push(getAuthenticationSection());

// INVOICES (with comprehensive examples)
collection.item.push({
    name: "Invoices",
    description: "Invoice management, creation, and profit tracking",
    item: [
        createRequest("List Invoices", "GET", "/functions/v1/list-invoices", null,
            [
                { key: "status", value: "paid", disabled: true, description: "Filter by status (draft, sent, paid, overdue)" },
                { key: "client", value: "", disabled: true, description: "Filter by client name" },
                { key: "service_type", value: "", disabled: true, description: "Filter by service type" },
                { key: "start_date", value: "", disabled: true, description: "Start date (YYYY-MM-DD)" },
                { key: "end_date", value: "", disabled: true, description: "End date (YYYY-MM-DD)" },
                { key: "has_actual_costs", value: "true", disabled: true, description: "Filter by cost tracking" },
                { key: "limit", value: "50", disabled: false, description: "Results per page" },
                { key: "offset", value: "0", disabled: false, description: "Pagination offset" }
            ],
            {
                success: true,
                invoices: [{
                    id: "uuid", invoice: "INV-001", client: "John Smith Construction",
                    amount: 5000.00, status: "paid", total_actual_cost: 3200.00, actual_profit: 1800.00,
                    invoice_date: "2025-11-15", due_date: "2025-12-15", service_type: "Kitchen Remodel"
                }],
                pagination: { total: 45, limit: 50, offset: 0, has_more: false },
                summary: { total_invoices: 45, total_revenue: 125000.00, total_actual_cost: 78000.00, total_actual_profit: 47000.00, average_profit_margin: 37.60 }
            },
            "Retrieves a paginated list of invoices with optional filtering."
        ),
        createRequest("Get Invoice Details", "GET", "/functions/v1/get-invoice-details", null,
            [{ key: "invoice_id", value: "UUID_HERE", disabled: false, description: "Invoice ID (required)" }],
            {
                success: true,
                invoice: {
                    id: "uuid", invoice: "INV-001", client: "John Smith Construction", amount: 5000.00, status: "paid",
                    total_actual_cost: 3200.00, actual_profit: 1800.00, invoice_date: "2025-11-15", due_date: "2025-12-15",
                    invoice_items: [{ id: "item-1", description: "Labor - Kitchen Installation", qty: 40, unit_price: 75.00, total_price: 3000.00 }],
                    transaction_job_allocations: [{ id: "alloc-1", allocation_amount: 3200.00, transactions: { id: "tx-1", name: "Home Depot", amount: -3200.00 } }],
                    profit_summary: { revenue: 5000.00, actual_cost: 3200.00, actual_profit: 1800.00, profit_margin: 36.00 }
                }
            },
            "Retrieves complete details for a specific invoice."
        ),
        {
            name: "Create Invoice",
            description: "Multiple examples of creating invoices with different options",
            item: [
                createRequest("Basic with Transactions", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", amount: 5000.00, status: "draft", transaction_ids: ["TX_ID_1", "TX_ID_2"], due_date: "2025-12-15", service_type: "Kitchen Remodel" },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-001", client: "John Smith Construction", amount: 5000.00, status: "draft", total_actual_cost: 3200.00, actual_profit: 1800.00 }, transactions_linked: 2 },
                    "Create a basic invoice and link transactions immediately for automatic cost tracking."
                ),
                createRequest("Single Blueprint Auto-Calculate", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", status: "draft", due_date: "2025-12-15", service_type: "Kitchen Remodel", blueprint_ids: ["bp-kitchen-standard-123"], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-002", client: "John Smith Construction", amount: 7500.00, status: "draft" }, blueprints_linked: 1 },
                    "Create invoice with blueprint - amount auto-calculated from blueprint's target sale price."
                ),
                createRequest("Multiple Blueprints Auto-Calculate", "POST", "/functions/v1/create-invoice",
                    { client: "Sarah & Mike Wedding", status: "draft", due_date: "2025-12-20", service_type: "Wedding Catering", blueprint_ids: ["bp-wedding-dinner-123", "bp-dessert-table-456", "bp-bar-service-789"], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-003", client: "Sarah & Mike Wedding", amount: 12500.00, status: "draft" }, blueprints_linked: 3 },
                    "Create invoice with multiple blueprints - total amount is sum of all blueprint prices."
                ),
                createRequest("Manual Amount Override with Blueprint", "POST", "/functions/v1/create-invoice",
                    { client: "Custom Project Inc", amount: 7500.00, status: "draft", service_type: "Custom Package", blueprint_ids: ["bp-kitchen-standard-123"], auto_calculate_from_blueprints: false },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-004", client: "Custom Project Inc", amount: 7500.00, status: "draft" }, blueprints_linked: 1 },
                    "Create invoice with blueprint but override amount - useful for negotiated custom pricing."
                ),
                createRequest("Complete with Line Items", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", amount: 5000.00, status: "draft", due_date: "2025-12-15", invoice_date: "2025-11-15", service_type: "Kitchen Remodel", tags: ["urgent", "residential"], items: [{ description: "Labor - Kitchen Installation", category: "Labor", qty: 40, unit_price: 75.00 }, { description: "Materials - Cabinets", category: "Materials", qty: 1, unit_price: 2000.00 }] },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-005", client: "John Smith Construction", amount: 5000.00, tags: ["urgent", "residential"], invoice_items: [{ id: "item-1", description: "Labor - Kitchen Installation", qty: 40, unit_price: 75.00, total_price: 3000.00 }] } },
                    "Create detailed invoice with line items."
                ),
                createRequest("Invoice with Blueprint Variance (Overrides)", "POST", "/functions/v1/create-invoice",
                    { client: "Custom Project Client", status: "draft", due_date: "2025-12-25", service_type: "Custom Build", blueprint_usages: [{ blueprint_id: "bp-kitchen-standard-123", actual_sale_price: 15000, actual_materials_cost: 6000, actual_labor_cost: 4000 }], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-006", client: "Custom Project Client", amount: 15000.00, status: "draft" }, blueprints_linked: 1, blueprint_variance: { estimated_total: 12000, actual_total: 10000, variance: -2000 } },
                    "Create invoice with blueprint overrides (variance). Use 'blueprint_usages' to specify custom actual costs and prices for this specific invoice."
                ),
                createRequest("With Line Item Cost Override (NEW)", "POST", "/functions/v1/create-invoice",
                    { client: "ABC Corp", status: "draft", due_date: "2025-12-30", service_type: "Consulting", items: [{ description: "Website Development - Flat Fee", category: "Revenue", qty: 1, unit_price: 5000.00, override_split: { income: 5000, cost: 3200 } }, { description: "Hosting Setup", category: "Revenue", qty: 1, unit_price: 500.00, override_split: { income: 500, cost: 150 } }] },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-007", client: "ABC Corp", amount: 5500.00, status: "draft", total_actual_cost: 3350.00, actual_profit: 2150.00 } },
                    "Create invoice with line item cost overrides. Use 'override_split' to manually specify cost/profit breakdown for flat/bundled fee items."
                )
            ]
        },
        createRequest("Update Invoice", "POST", "/functions/v1/update-invoice",
            { invoice_id: "INVOICE_ID", status: "sent", notes: "Invoice sent to client", transaction_ids: ["TX_ID_1", "TX_ID_2"] },
            [],
            { success: true, message: "Invoice updated successfully", invoice: { id: "INVOICE_ID", invoice: "INV-001", status: "sent", updated_at: "2025-11-22T10:30:00Z" }, transactions_linked: 2 },
            "Update invoice fields including status, notes, and linked transactions."
        ),
        createRequest("Delete Invoice", "POST", "/functions/v1/delete-invoice",
            { invoice_id: "INVOICE_ID", force: false },
            [],
            { success: true, message: "Invoice deleted successfully", invoice_number: "INV-001", deleted_data: { blueprint_usages: 0, transaction_links: 0, invoice_items: 0 } },
            "Delete invoice. Set force=true to delete invoices with linked blueprints or transactions.",
            [
                {
                    name: "Has Linked Data (Error)",
                    status: 400,
                    body: { error: "Cannot delete invoice with linked data", linked_data: { blueprints: 2, transactions: 5 }, suggestion: "Use force=true to delete anyway" }
                }
            ]
        ),
        createRequest("Update Invoice Actuals", "POST", "/functions/v1/update-invoice-actuals",
            { invoice_id: "INVOICE_ID", total_actual_cost: 3200.00, actual_materials_cost: 2000.00, actual_labor_cost: 1200.00 },
            [],
            { success: true, message: "Invoice actuals updated", invoice: { id: "INVOICE_ID", total_actual_cost: 3200.00, actual_profit: 1800.00, actual_materials_cost: 2000.00, actual_labor_cost: 1200.00 } },
            "Manually update actual costs for an invoice. Automatically recalculates profit."
        ),
        createRequest("Suggest Invoice Costs", "POST", "/functions/v1/suggest-invoice-costs",
            { invoice_id: "INVOICE_ID" },
            [],
            { success: true, suggestions: { materials: 1500.00, labor: 1700.00, overhead: 300.00, total_suggested_cost: 3500.00, confidence: 0.85, based_on: "similar_jobs" } },
            "AI-powered cost suggestions based on similar jobs and historical data."
        ),
        createRequest("Get Invoice Profit Breakdown", "POST", "/functions/v1/get-invoice-profit-breakdown",
            { invoice_id: "INVOICE_ID" },
            [],
            { success: true, breakdown: { revenue: 5000.00, costs: { materials: 2000.00, labor: 1200.00, overhead: 0.00, total: 3200.00 }, profit: 1800.00, margin: 36.00, blueprint_comparison: { estimated_cost: 3000.00, actual_cost: 3200.00, variance: 200.00 } } },
            "Detailed profit breakdown showing revenue, costs by category, and comparison to blueprint estimates."
        ),
        createRequest("Get Invoice with Transactions", "POST", "/functions/v1/get-invoice-with-transactions",
            { invoice_id: "INVOICE_ID" },
            [],
            { success: true, invoice: { id: "INVOICE_ID", invoice: "INV-001", client: "John Smith Construction", amount: 5000.00 }, transactions: [{ id: "tx-1", name: "Home Depot", amount: -3200.00, date: "2025-11-10", allocation_amount: 3200.00 }] },
            "Get invoice with all linked transactions and their allocations."
        )
    ]
});

// Add transactions section
collection.item.push(getTransactionsSection());

// BLUEPRINTS
collection.item.push({
    name: "Blueprints",
    description: "Cost blueprints for estimating and tracking project costs",
    item: [
        createRequest("List Cost Blueprints", "POST", "/functions/v1/list-cost-blueprints",
            { blueprint_type: "service", is_active: true },
            [],
            { success: true, blueprints: [{ id: "bp-1", name: "Standard Kitchen Remodel", blueprint_type: "service", estimated_materials_cost: 2000.00, estimated_labor_cost: 1500.00, target_sale_price: 7500.00, target_profit_margin: 53.33, is_active: true }], total: 10 },
            "List all cost blueprints with optional filtering by type and active status."
        ),
        createRequest("Create Cost Blueprint", "POST", "/functions/v1/create-cost-blueprint",
            { name: "Standard Kitchen Remodel", description: "Full kitchen renovation package", blueprint_type: "service", estimated_materials_cost: 2000.00, estimated_labor_cost: 1500.00, estimated_overhead_cost: 500.00, target_sale_price: 7500.00, estimated_hours: 80 },
            [],
            { success: true, message: "Blueprint created successfully", blueprint: { id: "bp-new", name: "Standard Kitchen Remodel", target_sale_price: 7500.00, target_profit_margin: 53.33 } },
            "Create a new cost blueprint for estimating job costs."
        ),
        createRequest("Update Cost Blueprint", "POST", "/functions/v1/update-cost-blueprint",
            { blueprint_id: "BP_ID", target_sale_price: 8000.00, estimated_materials_cost: 2200.00 },
            [],
            { success: true, message: "Blueprint updated", blueprint: { id: "BP_ID", target_sale_price: 8000.00, target_profit_margin: 52.50 } },
            "Update blueprint estimates and pricing."
        ),
        createRequest("Delete Cost Blueprint", "POST", "/functions/v1/delete-cost-blueprint",
            { blueprint_id: "BP_ID", force: false },
            [],
            { success: true, message: "Blueprint deleted" },
            "Delete a cost blueprint."
        ),
        createRequest("Create Blueprint Usage", "POST", "/functions/v1/create-blueprint-usage",
            { invoice_id: "INV_ID", blueprint_id: "BP_ID", actual_materials_cost: 2200.00, actual_labor_cost: 1800.00, completed_date: "2025-12-01" },
            [],
            { success: true, usage: { id: "usage-new", blueprint_id: "BP_ID", invoice_id: "INV_ID", actual_profit: 1500.00, variance: { materials: 200.00, labor: 300.00 } } },
            "Record actual costs for a blueprint used on an invoice."
        ),
        createRequest("Get Blueprint Expenses", "POST", "/functions/v1/get-blueprint-expenses",
            { blueprint_id: "BP_ID" },
            [],
            { success: true, blueprint: { id: "BP_ID", name: "Standard Kitchen Remodel" }, expenses: [{ id: "tx-1", name: "Home Depot", amount: -2200.00, date: "2025-11-15" }], total_expenses: 5500.00 },
            "Get all expenses linked to a specific blueprint."
        ),
        createRequest("Get Blueprint Variance", "POST", "/functions/v1/get-blueprint-variance",
            { blueprint_id: "BP_ID", period: "month" },
            [],
            { success: true, blueprint: { id: "BP_ID", name: "Standard Kitchen Remodel" }, variance: { materials: { estimated: 2000, actual_avg: 2150, variance_pct: 7.5 }, labor: { estimated: 1500, actual_avg: 1650, variance_pct: 10.0 } }, usages_analyzed: 12 },
            "Analyze variance between estimated and actual costs over time."
        )
    ]
});

// INVENTORY
collection.item.push({
    name: "Inventory",
    description: "Inventory management and stock tracking",
    item: [
        createRequest("List Inventory Items", "POST", "/functions/v1/list-inventory-items",
            { is_active: true, low_stock_only: false },
            [],
            { success: true, items: [{ id: "item-1", name: "2x4 Lumber", sku: "LUM-2X4", current_quantity: 50, minimum_quantity: 10, unit_cost: 5.99 }], total: 25 },
            "List all inventory items."
        ),
        createRequest("Create Inventory Item", "POST", "/functions/v1/create-inventory-item",
            { name: "2x4 Lumber 8ft", sku: "LUM-2X4-8", current_quantity: 100, minimum_quantity: 20, reorder_point: 30, unit_cost: 5.99, supplier: "Home Depot", category: "Lumber" },
            [],
            { success: true, item: { id: "item-new", name: "2x4 Lumber 8ft", sku: "LUM-2X4-8", current_quantity: 100 } },
            "Create a new inventory item."
        ),
        createRequest("Update Inventory Item", "POST", "/functions/v1/update-inventory-item",
            { item_id: "ITEM_ID", unit_cost: 6.49, reorder_point: 25 },
            [],
            { success: true, item: { id: "ITEM_ID", unit_cost: 6.49, reorder_point: 25 } },
            "Update inventory item details."
        ),
        createRequest("Delete Inventory Item", "POST", "/functions/v1/delete-inventory-item",
            { item_id: "ITEM_ID" },
            [],
            { success: true, message: "Item deleted" },
            "Delete an inventory item (soft delete)."
        ),
        createRequest("Adjust Inventory", "POST", "/functions/v1/adjust-inventory",
            { item_id: "ITEM_ID", adjustment: -10, reason: "Used for job INV-001", reference_id: "INV-001" },
            [],
            { success: true, item: { id: "ITEM_ID", previous_quantity: 50, new_quantity: 40 }, adjustment: { id: "adj-new", amount: -10, reason: "Used for job INV-001" } },
            "Adjust inventory quantity (positive or negative)."
        ),
        createRequest("Get Inventory Alerts", "POST", "/functions/v1/get-inventory-alerts",
            {},
            [],
            { success: true, alerts: [{ item_id: "item-1", name: "2x4 Lumber", current_quantity: 8, minimum_quantity: 10, reorder_point: 20, alert_type: "below_minimum" }], total_alerts: 3 },
            "Get low stock and reorder alerts."
        ),
        createRequest("Reactivate Inventory Item", "POST", "/functions/v1/reactivate-inventory-item",
            { item_id: "ITEM_ID" },
            [],
            { success: true, item: { id: "ITEM_ID", is_active: true } },
            "Reactivate a previously deleted inventory item."
        )
    ]
});

// ANALYTICS
collection.item.push({
    name: "Analytics",
    description: "Business analytics and reporting",
    item: [
        createRequest("Get Dashboard Summary", "GET", "/functions/v1/get-dashboard-summary", null,
            [],
            {
                success: true,
                kpis: { current_month_revenue: 25000.00, current_month_profit: 8500.00, average_profit_margin: 34.0, ytd_revenue: 150000.00, revenue_change_mom: 15.5, trend: "up" },
                recent_activity: { recent_invoices: [{ id: "inv-1", invoice_number: "INV-001", client: "ABC Corp", amount: 5000 }] },
                alerts: { low_margin_jobs: { count: 2 }, low_stock_items: { count: 3 }, overdue_invoices: { count: 1, amount: 2500 }, uncategorized_transactions: { count: 15 } },
                quick_stats: { active_blueprints: 8, inventory_items: 45, categorization_rules: 12 }
            },
            "Get comprehensive dashboard summary with KPIs, recent activity, and alerts."
        ),
        createRequest("Get Business Profitability", "POST", "/functions/v1/get-business-profitability",
            { start_date: "2025-01-01", end_date: "2025-12-31", group_by: "month" },
            [],
            { success: true, profitability: [{ period: "2025-01", revenue: 15000, costs: 9000, profit: 6000, margin: 40.0 }], totals: { revenue: 150000, costs: 90000, profit: 60000, margin: 40.0 } },
            "Get detailed profitability analysis over time."
        ),
        createRequest("Get Profit Trends", "POST", "/functions/v1/get-profit-trends",
            { period: "month", months: 12 },
            [],
            { success: true, trends: [{ period: "2025-01", profit: 6000, margin: 40.0, change_pct: 5.5 }] },
            "Get profit trends over specified period."
        ),
        createRequest("Get Margin Analysis", "POST", "/functions/v1/get-margin-analysis",
            { group_by: "service_type" },
            [],
            { success: true, analysis: [{ service_type: "Kitchen Remodel", avg_margin: 42.5, job_count: 15, best_margin: 55.0, worst_margin: 25.0 }] },
            "Analyze margins by service type or other dimensions."
        ),
        createRequest("Get Margin Alerts", "POST", "/functions/v1/get-margin-alerts",
            { threshold: 20.0 },
            [],
            { success: true, alerts: [{ invoice_id: "inv-1", invoice_number: "INV-001", client: "ABC Corp", margin: 15.5, threshold: 20.0, shortfall: 4.5 }], total_alerts: 3 },
            "Get invoices with margins below threshold."
        ),
        createRequest("Get Vendor Price Changes", "POST", "/functions/v1/get-vendor-price-changes",
            { days: 90 },
            [],
            { success: true, changes: [{ vendor: "Home Depot", item: "2x4 Lumber", old_price: 5.99, new_price: 6.49, change_pct: 8.3, detected_date: "2025-11-01" }] },
            "Track vendor price changes over time."
        )
    ]
});

// PLAID INTEGRATION
collection.item.push({
    name: "Plaid Integration",
    description: "Bank account connection via Plaid",
    item: [
        createRequest("Create Link Token", "POST", "/functions/v1/create-link-token",
            {},
            [],
            { success: true, link_token: "link-sandbox-xxxxx" },
            "Create a Plaid Link token to start bank connection flow."
        ),
        createRequest("Exchange Public Token", "POST", "/functions/v1/exchange-public-token",
            { public_token: "public-sandbox-xxxxx" },
            [],
            { success: true, message: "Bank connected successfully", accounts: [{ id: "acc-1", name: "Checking", mask: "1234", type: "depository" }] },
            "Exchange Plaid public token after user connects bank."
        ),
        createRequest("Get Accounts", "POST", "/functions/v1/get-accounts",
            {},
            [],
            { success: true, accounts: [{ id: "acc-1", name: "Business Checking", mask: "1234", type: "depository", balance: 15000.00, institution: "Chase", last_synced: "2025-11-22T10:00:00Z" }] },
            "Get all connected bank accounts."
        ),
        createRequest("Get Connection Status", "POST", "/functions/v1/get-connection-status",
            {},
            [],
            { success: true, connections: [{ institution: "Chase", status: "active", accounts: 2, last_sync: "2025-11-22T10:00:00Z" }] },
            "Check status of all bank connections."
        ),
        createRequest("Disconnect Bank", "POST", "/functions/v1/disconnect-bank",
            { account_id: "ACCOUNT_ID" },
            [],
            { success: true, message: "Bank disconnected successfully" },
            "Disconnect a bank account."
        ),
        createRequest("Request Manual Sync", "POST", "/functions/v1/request-manual-sync",
            {},
            [],
            { success: true, message: "Sync requested", synced_accounts: 3, new_transactions: 25 },
            "Manually trigger transaction sync for all connected accounts."
        )
    ]
});

// QUICKBOOKS INTEGRATION
collection.item.push({
    name: "QuickBooks Integration",
    description: "QuickBooks Online integration for invoice syncing",
    item: [
        createRequest("Get QuickBooks Auth URL", "POST", "/functions/v1/quickbooks-auth-url",
            {},
            [],
            { success: true, auth_url: "https://appcenter.intuit.com/connect/oauth2?..." },
            "Get OAuth URL to connect QuickBooks."
        ),
        createRequest("QuickBooks Callback", "POST", "/functions/v1/quickbooks-callback",
            { code: "AUTH_CODE", state: "STATE_VALUE", realmId: "REALM_ID" },
            [],
            { success: true, message: "QuickBooks connected successfully", company_name: "My Business Inc" },
            "Handle OAuth callback from QuickBooks."
        ),
        createRequest("Get QuickBooks Status", "POST", "/functions/v1/quickbooks-get-status",
            {},
            [],
            { success: true, connected: true, company_name: "My Business Inc", last_sync: "2025-11-22T10:00:00Z" },
            "Check QuickBooks connection status."
        ),
        createRequest("Disconnect QuickBooks", "POST", "/functions/v1/quickbooks-disconnect",
            {},
            [],
            { success: true, message: "QuickBooks disconnected" },
            "Disconnect QuickBooks integration."
        ),
        createRequest("Sync Invoices to QuickBooks", "POST", "/functions/v1/quickbooks-sync-invoices",
            { invoice_ids: ["INV_ID_1", "INV_ID_2"], sync_all_unpaid: false },
            [],
            { success: true, synced: 2, errors: 0, synced_invoices: [{ id: "INV_ID_1", qb_invoice_id: "qb-123" }] },
            "Sync invoices to QuickBooks."
        )
    ]
});

// Add categorization section (the most comprehensive one)
collection.item.push(getCategorizationSection());

// Output
console.log(JSON.stringify(collection, null, 2));
