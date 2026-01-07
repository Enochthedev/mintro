const PROJECT_URL = "https://kquthqdlixwoxzpyijcp.supabase.co";

function createRequest(name, method, endpoint, body = null, queryParams = [], exampleResponse = null, description = "") {
    const request = {
        name,
        request: {
            method,
            header: [
                { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                { key: "Content-Type", value: "application/json" }
            ],
            url: {
                raw: `{{PROJECT_URL}}${endpoint}`,
                host: ["{{PROJECT_URL}}"],
                path: endpoint.split('/').filter(p => p),
            },
            description
        }
    };

    if (queryParams.length > 0) {
        request.request.url.query = queryParams;
        const queryString = queryParams.map(p => `${p.key}=${p.value}`).join('&');
        request.request.url.raw += `?${queryString}`;
    }

    if (body && method === "POST") {
        request.request.body = {
            mode: "raw",
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: "json" } }
        };
    }

    if (exampleResponse) {
        request.response = [{
            name: "Success Response",
            originalRequest: request.request,
            status: "OK",
            code: 200,
            header: [{ key: "Content-Type", value: "application/json" }],
            body: JSON.stringify(exampleResponse, null, 2)
        }];
    }

    return request;
}

const collection = {
    info: {
        name: "Mintro API",
        description: "Complete Mintro API documentation covering all Edge Functions. Professional collection for frontend integration and testing.",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    variable: [
        { key: "PROJECT_URL", value: PROJECT_URL, type: "string" },
        { key: "ANON_KEY", value: "YOUR_SUPABASE_ANON_KEY", type: "string" },
        { key: "ACCESS_TOKEN", value: "YOUR_USER_ACCESS_TOKEN", type: "string" }
    ],
    item: []
};

// AUTHENTICATION
collection.item.push({
    name: "🔐 Authentication",
    description: "Supabase authentication endpoints. Use these to obtain ACCESS_TOKEN for other API requests.",
    item: [
        {
            name: "Sign In with Password",
            request: {
                method: "POST",
                header: [
                    { key: "apikey", value: "{{ANON_KEY}}" },
                    { key: "Content-Type", value: "application/json" }
                ],
                url: {
                    raw: "{{PROJECT_URL}}/auth/v1/token?grant_type=password",
                    host: ["{{PROJECT_URL}}"],
                    path: ["auth", "v1", "token"],
                    query: [{ key: "grant_type", value: "password", disabled: false }]
                },
                description: "Sign in with email and password to obtain an access token. Copy the access_token from the response and paste it into the ACCESS_TOKEN collection variable.",
                body: {
                    mode: "raw",
                    raw: JSON.stringify({ email: "your-email@example.com", password: "your-password" }, null, 2),
                    options: { raw: { language: "json" } }
                }
            },
            response: [{
                name: "Success Response",
                status: "OK",
                code: 200,
                header: [{ key: "Content-Type", value: "application/json" }],
                body: JSON.stringify({
                    access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    token_type: "bearer",
                    expires_in: 3600,
                    refresh_token: "refresh_token_here",
                    user: { id: "user-uuid", email: "your-email@example.com", created_at: "2025-11-25T10:00:00Z", role: "authenticated" }
                }, null, 2)
            }]
        },
        {
            name: "Sign Up",
            request: {
                method: "POST",
                header: [
                    { key: "apikey", value: "{{ANON_KEY}}" },
                    { key: "Content-Type", value: "application/json" }
                ],
                url: {
                    raw: "{{PROJECT_URL}}/auth/v1/signup",
                    host: ["{{PROJECT_URL}}"],
                    path: ["auth", "v1", "signup"]
                },
                description: "Create a new user account. If email confirmation is disabled, you'll receive an access token immediately. Otherwise, check your email for a confirmation link first.",
                body: {
                    mode: "raw",
                    raw: JSON.stringify({ email: "new-user@example.com", password: "your-secure-password" }, null, 2),
                    options: { raw: { language: "json" } }
                }
            },
            response: [{
                name: "Success Response",
                status: "OK",
                code: 200,
                header: [{ key: "Content-Type", value: "application/json" }],
                body: JSON.stringify({
                    access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    token_type: "bearer",
                    expires_in: 3600,
                    refresh_token: "refresh_token_here",
                    user: { id: "new-user-uuid", email: "new-user@example.com", created_at: "2025-11-25T10:00:00Z", role: "authenticated", email_confirmed_at: "2025-11-25T10:00:00Z" }
                }, null, 2)
            }]
        },
        {
            name: "Refresh Token",
            request: {
                method: "POST",
                header: [
                    { key: "apikey", value: "{{ANON_KEY}}" },
                    { key: "Content-Type", value: "application/json" }
                ],
                url: {
                    raw: "{{PROJECT_URL}}/auth/v1/token?grant_type=refresh_token",
                    host: ["{{PROJECT_URL}}"],
                    path: ["auth", "v1", "token"],
                    query: [{ key: "grant_type", value: "refresh_token", disabled: false }]
                },
                description: "Use your refresh_token to obtain a new access_token when the current one expires.",
                body: {
                    mode: "raw",
                    raw: JSON.stringify({ refresh_token: "your-refresh-token-here" }, null, 2),
                    options: { raw: { language: "json" } }
                }
            },
            response: [{
                name: "Success Response",
                status: "OK",
                code: 200,
                header: [{ key: "Content-Type", value: "application/json" }],
                body: JSON.stringify({
                    access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    token_type: "bearer",
                    expires_in: 3600,
                    refresh_token: "new_refresh_token_here",
                    user: { id: "user-uuid", email: "your-email@example.com" }
                }, null, 2)
            }]
        }
    ]
});

// INVOICES
collection.item.push({
    name: "Invoices",
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
                    invoice_date: "2025-11-15", due_date: "2025-12-15", service_type: "Kitchen Remodel",
                    transaction_job_allocations: [{ id: "alloc-1", allocation_amount: 3200.00 }]
                }],
                pagination: { total: 45, limit: 50, offset: 0, has_more: false },
                summary: { total_invoices: 45, total_revenue: 125000.00, total_actual_cost: 78000.00, total_actual_profit: 47000.00, average_profit_margin: 37.60 }
            },
            "Retrieves a paginated list of invoices with optional filtering by status, client, date range, and cost tracking status."
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
                    profit_summary: { revenue: 5000.00, actual_cost: 3200.00, actual_profit: 1800.00, profit_margin: 36.00, linked_expenses_total: 3200.00 }
                }
            },
            "Retrieves complete details for a specific invoice including line items, linked transactions, blueprint usage, and profit analysis."
        ),
        {
            name: "Create Invoice",
            item: [
                createRequest("Basic with Transactions", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", amount: 5000.00, status: "draft", transaction_ids: ["TX_ID_1", "TX_ID_2"], due_date: "2025-12-15", service_type: "Kitchen Remodel", notes: "50% deposit required" },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-001", client: "John Smith Construction", amount: 5000.00, status: "draft", total_actual_cost: 3200.00, actual_profit: 1800.00 }, transactions_linked: 2, blueprints_linked: 0 },
                    "Create a basic invoice and link transactions immediately for automatic cost tracking."
                ),
                createRequest("Single Blueprint Auto-Calculate", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", status: "draft", due_date: "2025-12-15", service_type: "Kitchen Remodel", notes: "Kitchen remodel using standard blueprint", blueprint_ids: ["bp-kitchen-standard-123"], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-002", client: "John Smith Construction", amount: 7500.00, status: "draft" }, blueprints_linked: 1, transactions_linked: 0 },
                    "Create invoice with single blueprint - amount auto-calculated from blueprint's target sale price."
                ),
                createRequest("Multiple Blueprints Auto-Calculate", "POST", "/functions/v1/create-invoice",
                    { client: "Sarah & Mike Wedding", status: "draft", due_date: "2025-12-20", service_type: "Wedding Catering", notes: "Full wedding package - 150 guests", blueprint_ids: ["bp-wedding-dinner-123", "bp-dessert-table-456", "bp-bar-service-789"], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-003", client: "Sarah & Mike Wedding", amount: 12500.00, status: "draft" }, blueprints_linked: 3, transactions_linked: 0 },
                    "Create invoice with multiple blueprints - total amount is sum of all blueprint prices."
                ),
                createRequest("Manual Amount Override with Blueprint", "POST", "/functions/v1/create-invoice",
                    { client: "Custom Project Inc", amount: 7500.00, status: "draft", service_type: "Custom Package", notes: "Negotiated custom price", blueprint_ids: ["bp-kitchen-standard-123"], auto_calculate_from_blueprints: false },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-004", client: "Custom Project Inc", amount: 7500.00, status: "draft" }, blueprints_linked: 1, transactions_linked: 0 },
                    "Create invoice with blueprint but override amount - useful for negotiated custom pricing."
                ),
                createRequest("Complete with Line Items", "POST", "/functions/v1/create-invoice",
                    { client: "John Smith Construction", amount: 5000.00, status: "draft", due_date: "2025-12-15", invoice_date: "2025-11-15", service_type: "Kitchen Remodel", notes: "50% deposit required upfront", tags: ["urgent", "residential"], items: [{ description: "Labor - Kitchen Installation", category: "Labor", qty: 40, unit_price: 75.00 }, { description: "Materials - Cabinets", category: "Materials", qty: 1, unit_price: 2000.00 }] },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-005", client: "John Smith Construction", amount: 5000.00, tags: ["urgent", "residential"], invoice_items: [{ id: "item-1", description: "Labor - Kitchen Installation", qty: 40, unit_price: 75.00, total_price: 3000.00 }, { id: "item-2", description: "Materials - Cabinets", qty: 1, unit_price: 2000.00, total_price: 2000.00 }] } },
                    "Create detailed invoice with line items, tags, and custom dates for itemized billing."
                ),
                createRequest("Invoice with Blueprint Variance (Overrides)", "POST", "/functions/v1/create-invoice",
                    { client: "Custom Project Client", status: "draft", due_date: "2025-12-25", service_type: "Custom Build", notes: "Customized version of standard blueprint", blueprint_usages: [{ blueprint_id: "bp-kitchen-standard-123", actual_sale_price: 15000, actual_materials_cost: 6000, actual_labor_cost: 4000 }], auto_calculate_from_blueprints: true },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-006", client: "Custom Project Client", amount: 15000.00, status: "draft" }, blueprints_linked: 1, blueprint_variance: { estimated_total: 12000, actual_total: 10000, variance: -2000 } },
                    "Create invoice with blueprint overrides (variance). Use 'blueprint_usages' to specify custom actual costs and prices for this specific invoice."
                ),
                createRequest("With Line Item Cost Override (NEW)", "POST", "/functions/v1/create-invoice",
                    { client: "ABC Corp", status: "draft", due_date: "2025-12-30", service_type: "Consulting", notes: "Flat fee project with manual cost tracking", items: [{ description: "Website Development - Flat Fee", category: "Revenue", qty: 1, unit_price: 5000.00, override_split: { income: 5000, cost: 3200 } }, { description: "Hosting Setup", category: "Revenue", qty: 1, unit_price: 500.00, override_split: { income: 500, cost: 150 } }] },
                    [],
                    { success: true, message: "Invoice created successfully", invoice: { id: "new-uuid", invoice: "INV-007", client: "ABC Corp", amount: 5500.00, status: "draft", total_actual_cost: 3350.00, actual_profit: 2150.00 } },
                    "Create invoice with line item cost overrides. Use 'override_split' to manually specify cost/profit breakdown for flat/bundled fee items."
                )
            ]
        },
        createRequest("Update Invoice", "POST", "/functions/v1/update-invoice",
            { invoice_id: "INVOICE_ID", status: "sent", notes: "Invoice sent to client via email on 2025-11-22", transaction_ids: ["TX_ID_1", "TX_ID_2"] },
            [],
            { success: true, message: "Invoice updated successfully", invoice: { id: "INVOICE_ID", invoice: "INV-001", status: "sent", notes: "Invoice sent to client via email on 2025-11-22", total_actual_cost: 3200.00, actual_profit: 1800.00, updated_at: "2025-11-22T10:30:00Z" }, transactions_linked: 2, transactions_unlinked: 0 },
            "Update invoice fields including status, notes, and linked transactions. transaction_ids replaces ALL existing transaction links."
        ),
        createRequest("Delete Invoice", "POST", "/functions/v1/delete-invoice",
            { invoice_id: "INVOICE_ID", force: false },
            [],
            { success: true, message: "Invoice deleted successfully", invoice_number: "INV-001", deleted_data: { blueprint_usages: 0, transaction_links: 0, invoice_items: 0 } },
            "Delete invoice. Set force=true to delete invoices with linked blueprints or transactions."
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
            "Get invoice with all linked transactions in a single response."
        )
    ]
});

// TRANSACTIONS
collection.item.push({
    name: "Transactions",
    item: [
        createRequest("Get Transactions", "POST", "/functions/v1/get-transactions",
            { limit: 50, offset: 0, start_date: "2025-01-01", end_date: "2025-12-31", category: "Materials" },
            [],
            { success: true, transactions: [{ id: "tx-1", transaction_id: "plaid_tx_123", date: "2025-11-10", name: "Home Depot Purchase", merchant_name: "Home Depot", amount: -3200.00, category: "Materials", pending: false }], total: 150, limit: 50, offset: 0 },
            "Get transactions with optional filtering by date range, category, and account."
        ),
        createRequest("Get Transaction by ID", "GET", "/functions/v1/get-transactions", null,
            [{ key: "transaction_id", value: "TX_UUID", disabled: false, description: "Transaction ID (required)" }],
            { success: true, transaction: { id: "TX_UUID", transaction_id: "plaid_tx_123", date: "2025-11-10", name: "Home Depot Purchase", merchant_name: "Home Depot", amount: -3200.00, category: "Materials", pending: false, bank_account: { id: "acc-1", name: "Business Checking", mask: "1234" } } },
            "Get a specific transaction by ID with full details."
        ),
        createRequest("Sync Transactions", "POST", "/functions/v1/sync-transactions",
            { account_id: "ACCOUNT_ID" },
            [],
            { success: true, synced: 25, new_transactions: 10, updated_transactions: 5, existing_transactions: 10, sync_date: "2025-11-22T10:00:00Z" },
            "Sync transactions from connected bank accounts via Plaid."
        ),
        createRequest("Categorize Transaction", "POST", "/functions/v1/categorize-transaction",
            { transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", create_rule: false },
            [],
            { success: true, categorization: { id: "cat-link-uuid", transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", method: "manual", confidence: 1.0 }, rule_created: false, rule: null },
            "Manually categorize a transaction. Set create_rule=true to auto-create a rule based on merchant."
        ),
        createRequest("Auto Categorize All Uncategorized", "POST", "/functions/v1/auto-categorize-transactions",
            {},
            [],
            { success: true, message: "Successfully categorized 35 of 40 transactions", categorized: 35, skipped: 5, breakdown: { rule_matched: 20, ai_categorized: 15, needs_review: 5 } },
            "Auto-categorize ALL uncategorized transactions using rules first, then AI fallback. No parameters needed - just call with empty body."
        ),
        createRequest("Auto Categorize Specific Transactions", "POST", "/functions/v1/auto-categorize-transactions",
            { transaction_ids: ["TX_UUID_1", "TX_UUID_2", "TX_UUID_3"] },
            [],
            { success: true, message: "Successfully categorized 3 of 3 transactions", categorized: 3, skipped: 0, breakdown: { rule_matched: 2, ai_categorized: 1, needs_review: 0 } },
            "Auto-categorize specific transactions by ID. Use when you only want to process certain transactions."
        ),
        createRequest("Get Uncategorized Transactions", "POST", "/functions/v1/get-uncategorized-transactions",
            { limit: 50 },
            [],
            { success: true, transactions: [{ id: "tx-1", name: "XYZ Vendor", amount: -150.00, date: "2025-11-20", merchant_name: "XYZ Vendor" }], total: 25 },
            "Get all transactions without a category. Used for categorization workflows."
        ),
        createRequest("Get Transaction Allocations", "POST", "/functions/v1/get-transaction-allocations",
            { transaction_id: "TX_ID" },
            [],
            { success: true, transaction: { id: "TX_ID", name: "Home Depot", amount: -3200.00 }, allocations: [{ id: "alloc-1", job_id: "INV-1", allocation_amount: 1600.00, allocation_percentage: 50 }, { id: "alloc-2", job_id: "INV-2", allocation_amount: 1600.00, allocation_percentage: 50 }], total_allocated: 3200.00, unallocated: 0.00 },
            "Get all job allocations for a specific transaction. Shows how transaction amount is split across jobs."
        ),
        createRequest("Link Transaction to Blueprint", "POST", "/functions/v1/link-transaction-to-blueprint",
            { transaction_id: "TX_ID", blueprint_id: "BP_ID", allocation_percentage: 100 },
            [],
            { success: true, message: "Transaction linked to blueprint", link: { id: "link-123", transaction_id: "TX_ID", blueprint_id: "BP_ID" } },
            "Link a transaction to a cost blueprint for variance tracking."
        ),
        createRequest("Match Transactions to Blueprints", "POST", "/functions/v1/match-transactions-to-blueprints",
            {},
            [],
            { success: true, matches: [{ transaction_id: "tx-1", blueprint_id: "bp-1", confidence: 0.92, reason: "merchant_match" }], total_matches: 15 },
            "AI-powered matching of transactions to blueprints based on merchant, amount, and historical patterns."
        ),
        createRequest("Sync Plaid Transactions", "POST", "/functions/v1/sync-plaid-transactions",
            { account_id: "ACCOUNT_ID", force_sync: false },
            [],
            { success: true, synced: 50, new: 25, updated: 15, unchanged: 10, cursor: "cursor_string_here" },
            "Sync transactions from Plaid for a specific account."
        )
    ]
});

// BLUEPRINTS
collection.item.push({
    name: "Blueprints",
    item: [
        createRequest("List Cost Blueprints", "POST", "/functions/v1/list-cost-blueprints",
            { blueprint_type: "service", is_active: true },
            [],
            { success: true, blueprints: [{ id: "bp-1", name: "Standard Kitchen Remodel", blueprint_type: "service", estimated_materials_cost: 2000.00, estimated_labor_cost: 1500.00, target_sale_price: 7500.00, target_profit_margin: 53.33, is_active: true }], total: 10 },
            "List all cost blueprints with optional filtering by type and active status."
        ),
        createRequest("Create Cost Blueprint", "POST", "/functions/v1/create-cost-blueprint",
            { name: "Standard Kitchen Remodel", description: "Full kitchen renovation package", blueprint_type: "service", estimated_materials_cost: 2000.00, estimated_labor_cost: 1500.00, estimated_overhead_cost: 500.00, target_sale_price: 7500.00, estimated_hours: 80, inventory_items: [{ inventory_item_id: "item-1", quantity_required: 5, cost_per_unit: 100.00 }] },
            [],
            { success: true, blueprint: { id: "bp-new", name: "Standard Kitchen Remodel", blueprint_type: "service", estimated_materials_cost: 2000.00, estimated_labor_cost: 1500.00, estimated_overhead_cost: 500.00, total_estimated_cost: 4000.00, target_sale_price: 7500.00, target_profit_amount: 3500.00, target_profit_margin: 46.67, blueprint_inventory_items: [{ inventory_item_id: "item-1", quantity_required: 5 }] } },
            "Create a new cost blueprint. Link inventory items to track material requirements."
        ),
        createRequest("Update Cost Blueprint", "POST", "/functions/v1/update-cost-blueprint",
            { blueprint_id: "BP_ID", target_sale_price: 8000.00, estimated_materials_cost: 2200.00 },
            [],
            { success: true, message: "Blueprint updated", blueprint: { id: "BP_ID", target_sale_price: 8000.00, estimated_materials_cost: 2200.00, updated_at: "2025-11-22T10:00:00Z" } },
            "Update blueprint fields. Only provided fields are updated."
        ),
        createRequest("Delete Cost Blueprint", "POST", "/functions/v1/delete-cost-blueprint",
            { blueprint_id: "BP_ID", force: false },
            [],
            { success: true, message: "Blueprint deleted", blueprint_id: "BP_ID" },
            "Delete blueprint. Set force=true to delete blueprints with existing usages."
        ),
        createRequest("Create Blueprint Usage", "POST", "/functions/v1/create-blueprint-usage",
            { invoice_id: "INVOICE_ID", blueprint_id: "BP_ID", actual_materials_cost: 2100.00, actual_labor_cost: 1600.00, completed_date: "2025-11-22" },
            [],
            { success: true, usage: { id: "usage-123", invoice_id: "INVOICE_ID", blueprint_id: "BP_ID", actual_materials_cost: 2100.00, actual_labor_cost: 1600.00, total_actual_cost: 3700.00, cost_variance: -300.00 } },
            "Track actual costs against blueprint estimates for variance analysis."
        ),
        createRequest("Get Blueprint Expenses", "POST", "/functions/v1/get-blueprint-expenses",
            { blueprint_id: "BP_ID" },
            [],
            { success: true, expenses: [{ id: "tx-1", name: "Materials Purchase", amount: -2100.00, date: "2025-11-10", category: "Materials" }], total_expenses: 3700.00, blueprint_id: "BP_ID" },
            "Get all transactions/expenses linked to a blueprint."
        ),
        createRequest("Get Blueprint Variance", "POST", "/functions/v1/get-blueprint-variance",
            { blueprint_id: "BP_ID", period: "ytd" },
            [],
            { success: true, variance: { blueprint_name: "Standard Kitchen Remodel", total_usages: 15, average_estimated_cost: 4000.00, average_actual_cost: 3850.00, average_variance: -150.00, variance_percentage: -3.75, best_performance: { usage_id: "us-1", variance: -500.00 }, worst_performance: { usage_id: "us-2", variance: 300.00 } } },
            "Analyze cost variance between estimated and actual costs across all blueprint usages."
        )
    ]
});

// INVENTORY
collection.item.push({
    name: "Inventory",
    item: [
        createRequest("List Inventory Items", "POST", "/functions/v1/list-inventory-items",
            { is_active: true, low_stock_only: false },
            [],
            { success: true, items: [{ id: "item-1", name: "Premium Cabinets", sku: "CAB-PREM-001", current_quantity: 15, minimum_quantity: 5, reorder_point: 10, unit_cost: 500.00, total_value: 7500.00, is_active: true }], total: 50 },
            "List all inventory items with optional filtering."
        ),
        createRequest("Create Inventory Item", "POST", "/functions/v1/create-inventory-item",
            { name: "Premium Cabinets", sku: "CAB-PREM-001", description: "High-end kitchen cabinets", current_quantity: 10, minimum_quantity: 5, reorder_point: 8, unit_cost: 500.00, supplier: "Cabinet Supply Co", category: "Materials" },
            [],
            { success: true, item: { id: "item-new", name: "Premium Cabinets", sku: "CAB-PREM-001", current_quantity: 10, unit_cost: 500.00, total_value: 5000.00, is_active: true } },
            "Create new inventory item for tracking stock and materials."
        ),
        createRequest("Update Inventory Item", "POST", "/functions/v1/update-inventory-item",
            { item_id: "ITEM_ID", unit_cost: 550.00, reorder_point: 10 },
            [],
            { success: true, message: "Inventory item updated", item: { id: "ITEM_ID", unit_cost: 550.00, reorder_point: 10, updated_at: "2025-11-22T10:00:00Z" } },
            "Update inventory item details. Only provided fields are updated."
        ),
        createRequest("Delete Inventory Item", "POST", "/functions/v1/delete-inventory-item",
            { item_id: "ITEM_ID" },
            [],
            { success: true, message: "Inventory item deleted", item_id: "ITEM_ID" },
            "Delete inventory item. Item is marked as inactive rather than deleted."
        ),
        createRequest("Adjust Inventory", "POST", "/functions/v1/adjust-inventory",
            { item_id: "ITEM_ID", adjustment: -5, reason: "Used in Kitchen Remodel Job", reference_id: "INVOICE_ID" },
            [],
            { success: true, message: "Inventory adjusted", item: { id: "ITEM_ID", name: "Premium Cabinets", previous_quantity: 15, new_quantity: 10, adjustment: -5 }, adjustment_record: { id: "adj-123", adjustment: -5, reason: "Used in Kitchen Remodel Job" } },
            "Adjust inventory quantity. Creates audit trail for tracking usage."
        ),
        createRequest("Get Inventory Alerts", "POST", "/functions/v1/get-inventory-alerts",
            {},
            [],
            { success: true, alerts: [{ item_id: "item-1", name: "Premium Cabinets", current_quantity: 4, minimum_quantity: 5, reorder_point: 10, alert_type: "below_minimum", severity: "high" }, { item_id: "item-2", name: "Paint Supplies", current_quantity: 8, reorder_point: 10, alert_type: "low_stock", severity: "medium" }], total_alerts: 5 },
            "Get inventory alerts for low stock and items below reorder point."
        ),
        createRequest("Reactivate Inventory Item", "POST", "/functions/v1/reactivate-inventory-item",
            { item_id: "ITEM_ID" },
            [],
            { success: true, message: "Inventory item reactivated", item: { id: "ITEM_ID", is_active: true } },
            "Reactivate a previously deleted/deactivated inventory item."
        )
    ]
});

// ANALYTICS
collection.item.push({
    name: "Analytics",
    item: [
        createRequest("Get Dashboard Summary", "GET", "/functions/v1/get-dashboard-summary",
            {},
            [],
            {
                success: true,
                generated_at: "2025-11-22T10:00:00Z",
                kpis: { current_month_revenue: 15000.00, current_month_profit: 5500.00, average_profit_margin: 36.67, ytd_revenue: 125000.00, ytd_profit: 45000.00, revenue_change_mom: 12.5, trend: "up" },
                recent_activity: { recent_invoices: [{ id: "inv-1", invoice_number: "INV-001", client: "ABC Corp", amount: 5000.00, status: "paid" }], recent_transactions: [{ id: "tx-1", date: "2025-11-20", name: "Home Depot", amount: -500.00 }] },
                alerts: { low_margin_jobs: { count: 2, jobs: [{ invoice_id: "inv-2", margin: 15.0 }] }, low_stock_items: { count: 3 }, overdue_invoices: { count: 5, amount: 12000.00 }, uncategorized_transactions: { count: 15 } },
                invoice_status: { draft: 5, sent: 10, paid: 30, overdue: 5 },
                top_clients: [{ client: "ABC Corp", revenue: 25000.00 }, { client: "XYZ Inc", revenue: 18000.00 }],
                quick_stats: { active_blueprints: 12, inventory_items: 45, categorization_rules: 8, total_invoices_this_month: 15 }
            },
            "Comprehensive dashboard summary with KPIs, recent activity, alerts, and quick stats."
        ),
        createRequest("Get Business Profitability", "POST", "/functions/v1/get-business-profitability",
            { start_date: "2025-01-01", end_date: "2025-12-31", group_by: "month" },
            [],
            { success: true, period: { start: "2025-01-01", end: "2025-12-31" }, profitability: { total_revenue: 150000.00, total_costs: 95000.00, total_profit: 55000.00, profit_margin: 36.67, monthly_breakdown: [{ month: "2025-01", revenue: 12000.00, costs: 7500.00, profit: 4500.00, margin: 37.5 }] } },
            "Detailed profitability analysis with optional grouping by month, quarter, or year."
        ),
        createRequest("Get Profit Trends", "POST", "/functions/v1/get-profit-trends",
            { period: "monthly", months: 12 },
            [],
            { success: true, trends: [{ period: "2025-01", revenue: 12000.00, costs: 7500.00, profit: 4500.00, margin: 37.5, trend: "up" }, { period: "2025-02", revenue: 13500.00, costs: 8200.00, profit: 5300.00, margin: 39.26, trend: "up" }] },
            "Profit trends over time showing revenue, costs, profit, and margin evolution."
        ),
        createRequest("Get Margin Analysis", "POST", "/functions/v1/get-margin-analysis",
            { group_by: "service_type" },
            [],
            { success: true, analysis: { overall_margin: 36.67, by_service_type: [{ service_type: "Kitchen Remodel", average_margin: 38.5, invoice_count: 15 }, { service_type: "Bathroom Renovation", average_margin: 42.0, invoice_count: 10 }], by_client: [{ client: "ABC Corp", average_margin: 35.0, total_revenue: 25000.00 }] } },
            "Margin analysis grouped by service type, client, or time period."
        ),
        createRequest("Get Margin Alerts", "POST", "/functions/v1/get-margin-alerts",
            { threshold: 20.0 },
            [],
            { success: true, alerts: [{ invoice_id: "inv-1", invoice_number: "INV-001", client: "Client A", revenue: 5000.00, profit: 800.00, margin: 16.0, threshold: 20.0, status: "below_threshold" }], total_alerts: 8 },
            "Get alerts for invoices with margins below threshold."
        ),
        createRequest("Get Vendor Price Changes", "POST", "/functions/v1/get-vendor-price-changes",
            { days: 90 },
            [],
            { success: true, changes: [{ vendor: "Home Depot", item: "Premium Cabinets", old_price: 500.00, new_price: 550.00, change_percentage: 10.0, first_seen: "2025-09-01", last_seen: "2025-11-15" }], total_changes: 15 },
            "Track vendor price changes over time from transaction data."
        )
    ]
});

// BANKING & PLAID
collection.item.push({
    name: "Banking and Plaid",
    item: [
        createRequest("Create Link Token", "POST", "/functions/v1/create-link-token",
            {},
            [],
            { success: true, link_token: "link-sandbox-abc123-xyz789", expiration: "2025-11-22T14:00:00Z" },
            "Create Plaid Link token to initialize bank connection flow."
        ),
        createRequest("Exchange Public Token", "POST", "/functions/v1/exchange-public-token",
            { public_token: "public-sandbox-abc123-xyz789" },
            [],
            { success: true, access_token: "access-sandbox-abc123-xyz789", item_id: "item_id_here", message: "Bank connected successfully" },
            "Exchange public token for access token after user completes Plaid Link flow."
        ),
        createRequest("Get Accounts", "POST", "/functions/v1/get-accounts",
            {},
            [],
            { success: true, accounts: [{ id: "acc-1", account_id: "plaid_account_id", name: "Business Checking", mask: "1234", type: "depository", subtype: "checking", current_balance: 15000.00, available_balance: 14500.00 }], total: 3 },
            "Get all connected bank accounts with current balances."
        ),
        createRequest("Sync Accounts", "POST", "/functions/v1/sync-accounts",
            {},
            [],
            { success: true, synced: 3, accounts: [{ id: "acc-1", name: "Business Checking", updated_balance: 15200.00 }] },
            "Sync account balances from Plaid."
        ),
        createRequest("Disconnect Bank", "POST", "/functions/v1/disconnect-bank",
            { account_id: "ACCOUNT_ID" },
            [],
            { success: true, message: "Bank account disconnected", account_id: "ACCOUNT_ID" },
            "Disconnect a bank account and invalidate Plaid access token."
        ),
        createRequest("Get Connection Status", "POST", "/functions/v1/get-connection-status",
            {},
            [],
            { success: true, connected: true, accounts_count: 3, last_sync: "2025-11-22T09:00:00Z", status: "healthy", accounts: [{ id: "acc-1", name: "Business Checking", status: "active", last_sync: "2025-11-22T09:00:00Z" }] },
            "Get connection status for all linked bank accounts."
        )
    ]
});

// QUICKBOOKS
collection.item.push({
    name: "QuickBooks Integration",
    item: [
        createRequest("Get QuickBooks Auth URL", "POST", "/functions/v1/quickbooks-auth-url",
            {},
            [],
            { success: true, auth_url: "https://appcenter.intuit.com/connect/oauth2?client_id=...", state: "random_state_string" },
            "Get OAuth URL to initiate QuickBooks connection."
        ),
        createRequest("Handle QuickBooks Callback", "POST", "/functions/v1/quickbooks-callback",
            { code: "AUTH_CODE_FROM_QUICKBOOKS", state: "STATE_STRING", realmId: "COMPANY_ID" },
            [],
            { success: true, message: "QuickBooks connected successfully", company_id: "COMPANY_ID", connected_at: "2025-11-22T10:00:00Z" },
            "Handle OAuth callback after user authorizes QuickBooks connection."
        ),
        createRequest("Disconnect QuickBooks", "POST", "/functions/v1/quickbooks-disconnect",
            {},
            [],
            { success: true, message: "Disconnected from QuickBooks", disconnected_at: "2025-11-22T10:00:00Z" },
            "Disconnect QuickBooks integration and revoke tokens."
        ),
        createRequest("Get QuickBooks Status", "POST", "/functions/v1/quickbooks-get-status",
            {},
            [],
            { success: true, connected: true, company_name: "ABC Construction LLC", company_id: "COMPANY_ID", last_sync: "2025-11-22T08:00:00Z", token_expires_at: "2025-12-22T10:00:00Z" },
            "Get current QuickBooks connection status and company info."
        ),
        createRequest("Sync Invoices to QuickBooks", "POST", "/functions/v1/quickbooks-sync-invoices",
            { invoice_ids: ["INV_ID_1", "INV_ID_2"], sync_all_unpaid: false },
            [],
            { success: true, synced: 2, results: [{ invoice_id: "INV_ID_1", quickbooks_id: "QB-123", status: "synced" }, { invoice_id: "INV_ID_2", quickbooks_id: "QB-124", status: "synced" }] },
            "Sync invoices to QuickBooks Online. Creates new invoices or updates existing ones."
        )
    ]
});

// CATEGORIZATION
collection.item.push({
    name: "Categorization",
    item: [
        // === CATEGORY MANAGEMENT ===
        createRequest("Setup Default Categories", "POST", "/functions/v1/setup-default-categories",
            {},
            [],
            { success: true, message: "Default categories created", categories_count: 12, categories: [{ id: "uuid", name: "Materials", description: "Building materials and supplies", color: "#4CAF50", icon: "package" }] },
            "Initialize default expense categories for new users. Safe to call multiple times."
        ),
        createRequest("List Expense Categories", "GET", "/functions/v1/list-expense-categories", null,
            [{ key: "include_stats", value: "true", disabled: true, description: "Include transaction/rule counts" }],
            { success: true, categories: [{ id: "cat-1", name: "Materials", description: "Building materials", color: "#4CAF50", icon: "package", transaction_count: 42, rule_count: 3 }], total: 12 },
            "List all expense categories with optional stats."
        ),
        createRequest("Create Expense Category", "POST", "/functions/v1/create-expense-category",
            { name: "Equipment Rental", description: "Rented equipment and tools", color: "#FF9800", icon: "tool" },
            [],
            { success: true, message: "Category created successfully", category: { id: "new-cat-uuid", name: "Equipment Rental", color: "#FF9800" } },
            "Create a custom expense category."
        ),
        createRequest("Update Expense Category", "POST", "/functions/v1/update-expense-category",
            { category_id: "CATEGORY_ID", name: "Heavy Equipment", color: "#E65100" },
            [],
            { success: true, message: "Category updated successfully", category: { id: "CATEGORY_ID", name: "Heavy Equipment" }, updated_fields: ["name", "color"] },
            "Update an existing category."
        ),
        createRequest("Delete Expense Category", "POST", "/functions/v1/delete-expense-category",
            { category_id: "CATEGORY_ID", force: false },
            [],
            { success: true, message: "Category deleted successfully", deleted_category: { id: "CATEGORY_ID", name: "Equipment Rental" } },
            "Delete category. Set force=true to delete with linked data."
        ),

        // === RULE MANAGEMENT ===
        createRequest("List Categorization Rules", "GET", "/functions/v1/list-categorization-rules", null,
            [
                { key: "category_id", value: "", disabled: true, description: "Filter by category" },
                { key: "rule_type", value: "", disabled: true, description: "Filter by type (vendor_exact, vendor_contains, etc)" },
                { key: "is_active", value: "true", disabled: true, description: "Filter by active status" }
            ],
            { success: true, rules: [{ id: "rule-1", rule_type: "vendor_contains", match_value: "home depot", priority: 10, confidence_score: 0.95, is_active: true, times_applied: 42, expense_categories: { id: "cat-1", name: "Materials", color: "#4CAF50" } }], pagination: { total: 15, limit: 50, offset: 0, has_more: false } },
            "List all categorization rules with their linked categories."
        ),
        createRequest("Create Categorization Rule", "POST", "/functions/v1/create-categorization-rule",
            { category_id: "CATEGORY_ID", rule_type: "vendor_contains", match_value: "home depot", priority: 10, confidence_score: 0.95 },
            [],
            { success: true, rule: { id: "rule-new", category_id: "CATEGORY_ID", rule_type: "vendor_contains", match_value: "home depot", priority: 10, is_active: true } },
            "Create rule for automatic categorization. Types: vendor_exact, vendor_contains, description_contains, amount_range"
        ),
        createRequest("Update Categorization Rule", "POST", "/functions/v1/update-categorization-rule",
            { rule_id: "RULE_ID", priority: 20, is_active: true },
            [],
            { success: true, message: "Rule updated successfully", rule: { id: "RULE_ID", priority: 20, is_active: true }, updated_fields: ["priority", "is_active"] },
            "Update an existing rule."
        ),
        createRequest("Delete Categorization Rule", "POST", "/functions/v1/delete-categorization-rule",
            { rule_id: "RULE_ID" },
            [],
            { success: true, message: "Rule deleted successfully" },
            "Delete a categorization rule."
        ),
        createRequest("Test Categorization Rule", "POST", "/functions/v1/test-categorization-rule",
            { rule_type: "vendor_contains", match_value: "depot" },
            [],
            { success: true, matches: [{ id: "tx-1", name: "Home Depot #123", amount: -250.00 }], total_matches: 15 },
            "Preview which transactions a rule would match before creating it."
        ),
        createRequest("Apply Categorization Rules", "POST", "/functions/v1/apply-categorization-rules",
            {},
            [],
            { success: true, categorized: 23, total_processed: 45 },
            "Run all active rules against uncategorized transactions."
        ),

        // === TRANSACTION CATEGORIZATION ===
        createRequest("Get Uncategorized Transactions", "GET", "/functions/v1/get-uncategorized-transactions", null,
            [
                { key: "limit", value: "50", disabled: false, description: "Results per page" },
                { key: "offset", value: "0", disabled: false, description: "Pagination offset" }
            ],
            { success: true, transactions: [{ id: "tx-uuid", transaction_id: "plaid_tx_123", date: "2025-12-01", amount: -125.50, name: "HOME DEPOT #1234", merchant_name: "Home Depot", pending: false, account: { id: "acc-uuid", name: "Business Checking", mask: "1234" } }], pagination: { total: 45, limit: 50, offset: 0, has_more: false } },
            "List transactions pending categorization."
        ),
        createRequest("Get Categorized Transactions", "GET", "/functions/v1/get-categorized-transactions", null,
            [
                { key: "limit", value: "50", disabled: false, description: "Results per page" },
                { key: "offset", value: "0", disabled: false, description: "Pagination offset" },
                { key: "category_id", value: "", disabled: true, description: "Filter by category" },
                { key: "method", value: "", disabled: true, description: "Filter by method (manual, rule, ai)" },
                { key: "start_date", value: "", disabled: true, description: "Start date (YYYY-MM-DD)" },
                { key: "end_date", value: "", disabled: true, description: "End date (YYYY-MM-DD)" }
            ],
            { success: true, transactions: [{ categorization_id: "cat-link-uuid", method: "manual", confidence: 1.0, is_user_override: true, categorized_at: "2025-12-05T10:00:00Z", category: { id: "cat-uuid", name: "Materials", color: "#4CAF50" }, transaction: { id: "tx-uuid", date: "2025-12-01", amount: -150.00, name: "Home Depot" } }], pagination: { total: 120, limit: 50, offset: 0, has_more: true } },
            "List categorized transactions with filters."
        ),
        createRequest("Categorize Transaction", "POST", "/functions/v1/categorize-transaction",
            { transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", create_rule: false },
            [],
            { success: true, categorization: { id: "cat-link-uuid", transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", method: "manual", confidence: 1.0 }, rule_created: false, rule: null },
            "Manually assign category to a transaction. Set create_rule=true to auto-create a rule."
        ),
        createRequest("Uncategorize Transaction", "POST", "/functions/v1/uncategorize-transaction",
            { transaction_id: "TX_UUID" },
            [],
            { success: true, message: "Transaction uncategorized successfully", removed_categorization: { transaction_id: "TX_UUID", previous_category: "Materials", previous_method: "manual" } },
            "Remove categorization from a transaction."
        ),
        createRequest("Bulk Categorize Transactions", "POST", "/functions/v1/bulk-categorize-transactions",
            { categorizations: [{ transaction_id: "TX_UUID_1", category_id: "CAT_UUID_MATERIALS" }, { transaction_id: "TX_UUID_2", category_id: "CAT_UUID_LABOR" }] },
            [],
            { success: true, message: "Bulk categorization complete", results: { total_requested: 2, inserted: 1, updated: 1, skipped: 0 } },
            "Categorize multiple transactions at once. Max 100 per request."
        ),

        // === AI & AUTOMATION ===
        createRequest("Auto-Categorize All", "POST", "/functions/v1/auto-categorize-transactions",
            {},
            [],
            { success: true, message: "Successfully categorized 35 of 40 transactions", categorized: 35, skipped: 5, breakdown: { rule_matched: 20, ai_categorized: 15, needs_review: 5 } },
            "Auto-categorize ALL uncategorized transactions using rules first, then AI. Just send empty body."
        ),
        createRequest("Auto-Categorize Specific", "POST", "/functions/v1/auto-categorize-transactions",
            { transaction_ids: ["TX_UUID_1", "TX_UUID_2", "TX_UUID_3"] },
            [],
            { success: true, message: "Successfully categorized 3 of 3 transactions", categorized: 3, skipped: 0, breakdown: { rule_matched: 2, ai_categorized: 1, needs_review: 0 } },
            "Auto-categorize specific transactions by ID."
        ),
        createRequest("Suggest Category (AI)", "POST", "/functions/v1/suggest-category-ai",
            { transaction_id: "TX_UUID" },
            [],
            { success: true, suggestions: [{ category_id: "cat-1", category_name: "Materials", confidence: 0.95, reasoning: "Merchant known for building supplies" }] },
            "Get AI-powered category suggestions without applying them."
        ),
        createRequest("Analyze & Suggest Categories", "POST", "/functions/v1/analyze-suggest-categories",
            {},
            [],
            { success: true, suggested_categories: [{ name: "Fuel", description: "Gas and fuel expenses", confidence: 0.88, based_on_transactions: 15 }], existing_coverage: 0.75 },
            "AI analyzes transaction patterns and suggests new categories to create."
        ),

        // === ANALYTICS ===
        createRequest("Get Category Breakdown", "GET", "/functions/v1/get-category-breakdown", null,
            [
                { key: "start_date", value: "", disabled: true, description: "Start date (YYYY-MM-DD)" },
                { key: "end_date", value: "", disabled: true, description: "End date (YYYY-MM-DD)" }
            ],
            { success: true, breakdown: [{ category_id: "cat-1", category_name: "Materials", color: "#4CAF50", transaction_count: 42, total_amount: 15000.00, percentage: 35.5 }], totals: { total_transactions: 120, total_amount: 42000.00, categorized_count: 100, uncategorized_count: 20 } },
            "Get spending breakdown by category for analytics."
        )
    ]
});

console.log(JSON.stringify(collection, null, 2));
