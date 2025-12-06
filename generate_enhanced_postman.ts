const PROJECT_URL = "https://kquthqdlixwoxzpyijcp.supabase.co";

// Helper to create example bodies for invoice endpoints
const getInvoiceExamples = () => ({
    "create-invoice": [
        {
            name: "Basic Invoice with Transactions",
            body: {
                client: "John Smith Construction",
                amount: 5000.00,
                status: "draft",
                transaction_ids: ["TRANSACTION_ID_1", "TRANSACTION_ID_2"],
                due_date: "2025-12-15",
                service_type: "Kitchen Remodel",
                notes: "50% deposit required"
            }
        },
        {
            name: "Single Blueprint (Auto-Calculate)",
            body: {
                client: "John Smith Construction",
                status: "draft",
                due_date: "2025-12-15",
                service_type: "Kitchen Remodel",
                notes: "Kitchen remodel using standard blueprint",
                blueprint_ids: ["bp-kitchen-standard-123"],
                auto_calculate_from_blueprints: true
            }
        },
        {
            name: "Multiple Blueprints (Auto-Calculate)",
            body: {
                client: "Sarah & Mike Wedding",
                status: "draft",
                due_date: "2025-12-20",
                service_type: "Wedding Catering",
                notes: "Full wedding package - 150 guests",
                blueprint_ids: [
                    "bp-wedding-dinner-123",
                    "bp-dessert-table-456",
                    "bp-bar-service-789"
                ],
                auto_calculate_from_blueprints: true
            }
        },
        {
            name: "Manual Amount Override",
            body: {
                client: "Custom Project Inc",
                amount: 7500.00,
                status: "draft",
                service_type: "Custom Package",
                notes: "Negotiated custom price",
                blueprint_ids: ["bp-kitchen-standard-123"],
                auto_calculate_from_blueprints: false
            }
        },
        {
            name: "Complete with Line Items",
            body: {
                client: "John Smith Construction",
                amount: 5000.00,
                status: "draft",
                due_date: "2025-12-15",
                invoice_date: "2025-11-15",
                service_type: "Kitchen Remodel",
                notes: "50% deposit required upfront",
                tags: ["urgent", "residential"],
                items: [
                    {
                        description: "Labor - Kitchen Installation",
                        category: "Labor",
                        qty: 40,
                        unit_price: 75.00
                    },
                    {
                        description: "Materials - Cabinets",
                        category: "Materials",
                        qty: 1,
                        unit_price: 2000.00
                    }
                ]
            }
        }
    ],
    "link-transaction-to-job": [
        {
            name: "Full Allocation",
            body: {
                transaction_id: "TRANSACTION_ID",
                job_id: "INVOICE_ID"
            }
        },
        {
            name: "Partial Allocation (50%)",
            body: {
                transaction_id: "TRANSACTION_ID",
                job_id: "INVOICE_ID",
                allocation_percentage: 50,
                notes: "Split cost across two projects"
            }
        },
        {
            name: "Manual Amount",
            body: {
                transaction_id: "TRANSACTION_ID",
                job_id: "INVOICE_ID",
                allocation_amount: 1500.00,
                notes: "Custom allocation amount"
            }
        }
    ],
    "unlink-transaction-from-job": [
        {
            name: "By Allocation ID",
            body: {
                allocation_id: "ALLOCATION_ID"
            }
        },
        {
            name: "By Transaction + Job",
            body: {
                transaction_id: "TRANSACTION_ID",
                job_id: "INVOICE_ID"
            }
        }
    ],
    "update-invoice": [
        {
            name: "Update Status",
            body: {
                invoice_id: "INVOICE_ID",
                status: "sent",
                notes: "Invoice sent to client via email"
            }
        }
    ],
    "delete-invoice": [
        {
            name: "Normal Delete",
            body: {
                invoice_id: "INVOICE_ID"
            }
        },
        {
            name: "Force Delete",
            body: {
                invoice_id: "INVOICE_ID",
                force: true
            }
        }
    ]
});

const collection = {
    info: {
        name: "Mintro API - Complete",
        description: "Complete API documentation for Mintro with detailed examples for all endpoints.",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    variable: [
        { key: "PROJECT_URL", value: PROJECT_URL, type: "string" },
        { key: "ANON_KEY", value: "YOUR_SUPABASE_ANON_KEY", type: "string" },
        { key: "ACCESS_TOKEN", value: "YOUR_USER_ACCESS_TOKEN", type: "string" }
    ],
    item: []
};

// Invoice endpoints with examples
const invoiceEndpoints = [
    {
        name: "List Invoices",
        method: "GET",
        url: "{{PROJECT_URL}}/functions/v1/list-invoices?status=paid&limit=10&offset=0",
        description: "Retrieves a paginated list of invoices with filtering options.",
        queryParams: [
            { key: "status", value: "paid", disabled: true },
            { key: "client", value: "John Smith", disabled: true },
            { key: "limit", value: "10", disabled: false },
            { key: "offset", value: "0", disabled: false }
        ]
    },
    {
        name: "Get Invoice Details",
        method: "GET",
        url: "{{PROJECT_URL}}/functions/v1/get-invoice-details?invoice_id=550e8400-e29b-41d4-a716-446655440000",
        description: "Retrieves complete details for a specific invoice.",
        queryParams: [
            { key: "invoice_id", value: "550e8400-e29b-41d4-a716-446655440000", disabled: false }
        ]
    }
];

// Create Invoice folder with examples
const invoicesFolder = {
    name: "Invoices",
    item: []
};

// Add GET requests
invoiceEndpoints.forEach(endpoint => {
    const request = {
        name: endpoint.name,
        request: {
            method: endpoint.method,
            header: [
                { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                { key: "Content-Type", value: "application/json" }
            ],
            url: {
                raw: endpoint.url,
                host: ["{{PROJECT_URL}}"],
                path: endpoint.url.split('/').filter(p => p && !p.includes('{{'))
            },
            description: endpoint.description
        }
    };

    if (endpoint.queryParams) {
        request.request.url.query = endpoint.queryParams;
    }

    invoicesFolder.item.push(request);
});

// Add POST requests with examples
const exampleBodies = getInvoiceExamples();

Object.entries(exampleBodies).forEach(([funcName, examples]) => {
    const folder = {
        name: funcName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        item: examples.map(ex => ({
            name: ex.name,
            request: {
                method: "POST",
                header: [
                    { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                    { key: "Content-Type", value: "application/json" }
                ],
                url: {
                    raw: `{{PROJECT_URL}}/functions/v1/${funcName}`,
                    host: ["{{PROJECT_URL}}"],
                    path: ["functions", "v1", funcName]
                },
                body: {
                    mode: "raw",
                    raw: JSON.stringify(ex.body, null, 2),
                    options: { raw: { language: "json" } }
                }
            }
        }))
    };
    invoicesFolder.item.push(folder);
});

collection.item.push(invoicesFolder);

// Transaction endpoints
const transactionsFolder = {
    name: "Transactions",
    item: [
        {
            name: "Link Transaction to Job",
            item: exampleBodies["link-transaction-to-job"].map(ex => ({
                name: ex.name,
                request: {
                    method: "POST",
                    header: [
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                        { key: "Content-Type", value: "application/json" }
                    ],
                    url: {
                        raw: "{{PROJECT_URL}}/functions/v1/link-transaction-to-job",
                        host: ["{{PROJECT_URL}}"],
                        path: ["functions", "v1", "link-transaction-to-job"]
                    },
                    body: {
                        mode: "raw",
                        raw: JSON.stringify(ex.body, null, 2),
                        options: { raw: { language: "json" } }
                    }
                }
            }))
        },
        {
            name: "Unlink Transaction from Job",
            item: exampleBodies["unlink-transaction-from-job"].map(ex => ({
                name: ex.name,
                request: {
                    method: "POST",
                    header: [
                        { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                        { key: "Content-Type", value: "application/json" }
                    ],
                    url: {
                        raw: "{{PROJECT_URL}}/functions/v1/unlink-transaction-from-job",
                        host: ["{{PROJECT_URL}}"],
                        path: ["functions", "v1", "unlink-transaction-from-job"]
                    },
                    body: {
                        mode: "raw",
                        raw: JSON.stringify(ex.body, null, 2),
                        options: { raw: { language: "json" } }
                    }
                }
            }))
        }
    ]
};

collection.item.push(transactionsFolder);

console.log(JSON.stringify(collection, null, 2));
