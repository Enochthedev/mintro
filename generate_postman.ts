
const PROJECT_URL = "https://kquthqdlixwoxzpyijcp.supabase.co";

const domains = {
    "Invoices": [
        { name: "list-invoices", method: "GET" },
        { name: "get-invoice-details", method: "GET" },
        { name: "create-invoice", method: "POST" },
        { name: "update-invoice", method: "POST" },
        { name: "delete-invoice", method: "POST" },
        { name: "update-invoice-actuals", method: "POST" },
        { name: "suggest-invoice-costs", method: "POST" },
        { name: "get-invoice-profit-breakdown", method: "POST" },
        { name: "get-invoice-with-transactions", method: "POST" },
        { name: "quickbooks-sync-invoices", method: "POST" }
    ],
    "Transactions": [
        { name: "get-transactions", method: "POST" },
        { name: "sync-transactions", method: "POST" },
        { name: "categorize-transaction", method: "POST" },
        { name: "auto-categorize-transactions", method: "POST" },
        { name: "get-uncategorized-transactions", method: "POST" },
        { name: "link-transaction-to-job", method: "POST" },
        { name: "unlink-transaction-from-job", method: "POST" },
        { name: "get-transaction-allocations", method: "POST" },
        { name: "link-transaction-to-blueprint", method: "POST" },
        { name: "match-transactions-to-blueprints", method: "POST" },
        { name: "sync-plaid-transactions", method: "POST" }
    ],
    "Blueprints": [
        { name: "list-cost-blueprints", method: "POST" },
        { name: "create-cost-blueprint", method: "POST" },
        { name: "update-cost-blueprint", method: "POST" },
        { name: "delete-cost-blueprint", method: "POST" },
        { name: "create-blueprint-usage", method: "POST" },
        { name: "get-blueprint-expenses", method: "POST" },
        { name: "get-blueprint-variance", method: "POST" }
    ],
    "Inventory": [
        { name: "list-inventory-items", method: "POST" },
        { name: "create-inventory-item", method: "POST" },
        { name: "update-inventory-item", method: "POST" },
        { name: "delete-inventory-item", method: "POST" },
        { name: "adjust-inventory", method: "POST" },
        { name: "get-inventory-alerts", method: "POST" },
        { name: "reactivate-inventory-item", method: "POST" }
    ],
    "Analytics": [
        { name: "get-dashboard-summary", method: "POST" },
        { name: "get-business-profitability", method: "POST" },
        { name: "get-profit-trends", method: "POST" },
        { name: "get-margin-analysis", method: "POST" },
        { name: "get-margin-alerts", method: "POST" },
        { name: "get-vendor-price-changes", method: "POST" }
    ],
    "Banking": [
        { name: "create-link-token", method: "POST" },
        { name: "exchange-public-token", method: "POST" },
        { name: "get-accounts", method: "POST" },
        { name: "sync-accounts", method: "POST" },
        { name: "disconnect-bank", method: "POST" },
        { name: "get-connection-status", method: "POST" }
    ],
    "QuickBooks": [
        { name: "quickbooks-auth-url", method: "POST" },
        { name: "quickbooks-callback", method: "POST" },
        { name: "quickbooks-disconnect", method: "POST" },
        { name: "quickbooks-get-status", method: "POST" }
    ],
    "Categorization": [
        { name: "list-categorization-rules", method: "POST" },
        { name: "create-categorization-rule", method: "POST" },
        { name: "delete-categorization-rule", method: "POST" },
        { name: "apply-categorization-rules", method: "POST" },
        { name: "suggest-category-ai", method: "POST" },
        { name: "setup-default-categories", method: "POST" }
    ]
};

const tables = [
    "invoices",
    "transactions",
    "cost_blueprints",
    "blueprint_usage",
    "transaction_job_allocations",
    "invoice_items",
    "categorization_rules",
    "inventory_items"
];

const collection = {
    info: {
        name: "Mintro API",
        description: "Complete API documentation for Mintro, including Supabase Edge Functions and Standard REST Endpoints.",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    variable: [
        { key: "PROJECT_URL", value: PROJECT_URL, type: "string" },
        { key: "ANON_KEY", value: "YOUR_SUPABASE_ANON_KEY", type: "string" },
        { key: "ACCESS_TOKEN", value: "YOUR_USER_ACCESS_TOKEN", type: "string" }
    ],
    item: []
};

// Add Edge Functions
for (const [domain, functions] of Object.entries(domains)) {
    const folder = {
        name: domain,
        item: []
    };

    // Add Edge Functions to folder
    const edgeFunctionsFolder = {
        name: "Edge Functions",
        item: functions.map(func => ({
            name: func.name,
            request: {
                method: func.method,
                header: [
                    { key: "Authorization", value: "Bearer {{ANON_KEY}}" },
                    { key: "Content-Type", value: "application/json" }
                ],
                url: {
                    raw: `{{PROJECT_URL}}/functions/v1/${func.name}`,
                    host: ["{{PROJECT_URL}}"],
                    path: ["functions", "v1", func.name]
                },
                body: func.method === "POST" ? {
                    mode: "raw",
                    raw: "{\n  \n}",
                    options: { raw: { language: "json" } }
                } : undefined
            }
        }))
    };
    folder.item.push(edgeFunctionsFolder);

    collection.item.push(folder);
}

// Add Standard REST API Folder
const restFolder = {
    name: "Standard REST API (Tables)",
    item: tables.map(table => ({
        name: table,
        item: [
            {
                name: `List ${table}`,
                request: {
                    method: "GET",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" }
                    ],
                    url: {
                        raw: `{{PROJECT_URL}}/rest/v1/${table}?select=*`,
                        host: ["{{PROJECT_URL}}"],
                        path: ["rest", "v1", table],
                        query: [{ key: "select", value: "*" }]
                    }
                }
            },
            {
                name: `Create ${table}`,
                request: {
                    method: "POST",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                        { key: "Content-Type", value: "application/json" },
                        { key: "Prefer", value: "return=representation" }
                    ],
                    url: {
                        raw: `{{PROJECT_URL}}/rest/v1/${table}`,
                        host: ["{{PROJECT_URL}}"],
                        path: ["rest", "v1", table]
                    },
                    body: {
                        mode: "raw",
                        raw: "{\n  \n}",
                        options: { raw: { language: "json" } }
                    }
                }
            },
            {
                name: `Update ${table}`,
                request: {
                    method: "PATCH",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                        { key: "Content-Type", value: "application/json" },
                        { key: "Prefer", value: "return=representation" }
                    ],
                    url: {
                        raw: `{{PROJECT_URL}}/rest/v1/${table}?id=eq.1`,
                        host: ["{{PROJECT_URL}}"],
                        path: ["rest", "v1", table],
                        query: [{ key: "id", value: "eq.1" }]
                    },
                    body: {
                        mode: "raw",
                        raw: "{\n  \n}",
                        options: { raw: { language: "json" } }
                    }
                }
            },
            {
                name: `Delete ${table}`,
                request: {
                    method: "DELETE",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" }
                    ],
                    url: {
                        raw: `{{PROJECT_URL}}/rest/v1/${table}?id=eq.1`,
                        host: ["{{PROJECT_URL}}"],
                        path: ["rest", "v1", table],
                        query: [{ key: "id", value: "eq.1" }]
                    }
                }
            }
        ]
    }))
};

collection.item.push(restFolder);

console.log(JSON.stringify(collection, null, 2));
