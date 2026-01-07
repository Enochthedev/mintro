// Transactions endpoints with comprehensive examples
import { createRequest } from "./helpers.ts";

export function getTransactionsSection() {
    return {
        name: "Transactions",
        description: "Transaction management, syncing, and allocations",
        item: [
            createRequest("Get Transactions", "POST", "/functions/v1/get-transactions",
                { limit: 50, offset: 0, start_date: "2025-01-01", end_date: "2025-12-31" },
                [],
                {
                    success: true,
                    transactions: [
                        { id: "tx-1", transaction_id: "plaid_tx_123", date: "2025-11-10", name: "Home Depot Purchase", merchant_name: "Home Depot", amount: -3200.00, category: "Materials", pending: false, bank_account: { id: "acc-1", name: "Business Checking", mask: "1234" } }
                    ],
                    total: 150,
                    limit: 50,
                    offset: 0
                },
                "Get transactions with optional filtering by date range, category, and account.",
                [
                    {
                        name: "With Category Filter",
                        status: 200,
                        body: {
                            success: true,
                            transactions: [{ id: "tx-1", name: "Home Depot", amount: -3200.00, category: "Materials" }],
                            total: 25,
                            filters_applied: { category: "Materials" }
                        }
                    },
                    {
                        name: "Empty Results",
                        status: 200,
                        body: {
                            success: true,
                            transactions: [],
                            total: 0,
                            message: "No transactions found matching criteria"
                        }
                    }
                ]
            ),
            createRequest("Get Transaction by ID", "GET", "/functions/v1/get-transactions", null,
                [{ key: "transaction_id", value: "TX_UUID", disabled: false, description: "Transaction ID (required)" }],
                {
                    success: true,
                    transaction: {
                        id: "TX_UUID",
                        transaction_id: "plaid_tx_123",
                        date: "2025-11-10",
                        name: "Home Depot Purchase",
                        merchant_name: "Home Depot",
                        amount: -3200.00,
                        category: "Materials",
                        pending: false,
                        bank_account: { id: "acc-1", name: "Business Checking", mask: "1234", institution: "Chase" },
                        categorization: {
                            category_id: "cat-uuid",
                            category_name: "Materials",
                            method: "rule",
                            confidence: 0.95
                        },
                        allocations: [
                            { invoice_id: "inv-uuid", invoice_number: "INV-001", allocation_amount: 1600.00, allocation_percentage: 50 }
                        ]
                    }
                },
                "Get a specific transaction by ID with full details including categorization and allocations.",
                [
                    {
                        name: "Not Found",
                        status: 404,
                        body: { error: "Transaction not found" }
                    }
                ]
            ),
            createRequest("Sync Transactions", "POST", "/functions/v1/sync-transactions",
                { account_id: "ACCOUNT_ID" },
                [],
                { success: true, synced: 25, new_transactions: 10, updated_transactions: 5, existing_transactions: 10, sync_date: "2025-11-22T10:00:00Z" },
                "Sync transactions from connected bank accounts via Plaid."
            ),
            createRequest("Get Transaction Allocations", "POST", "/functions/v1/get-transaction-allocations",
                { transaction_id: "TX_UUID" },
                [],
                {
                    success: true,
                    transaction: { id: "TX_UUID", name: "Home Depot", amount: -3200.00 },
                    allocations: [
                        { id: "alloc-1", job_id: "INV-1", invoice_number: "INV-001", client: "John Smith", allocation_amount: 1600.00, allocation_percentage: 50 },
                        { id: "alloc-2", job_id: "INV-2", invoice_number: "INV-002", client: "ABC Corp", allocation_amount: 1600.00, allocation_percentage: 50 }
                    ],
                    total_allocated: 3200.00,
                    unallocated: 0.00
                },
                "Get all job allocations for a specific transaction. Shows how transaction amount is split across jobs."
            ),
            createRequest("Link Transaction to Job", "POST", "/functions/v1/link-transaction-to-job",
                { transaction_id: "TX_UUID", invoice_id: "INV_UUID", allocation_percentage: 100 },
                [],
                { success: true, message: "Transaction linked to job", allocation: { id: "alloc-new", transaction_id: "TX_UUID", invoice_id: "INV_UUID", allocation_amount: 3200.00, allocation_percentage: 100 } },
                "Link a transaction to a job/invoice for cost tracking.",
                [
                    {
                        name: "Partial Allocation",
                        status: 200,
                        body: {
                            success: true,
                            message: "Transaction partially allocated",
                            allocation: { id: "alloc-new", allocation_percentage: 50, allocation_amount: 1600.00 },
                            remaining_unallocated: 1600.00
                        }
                    }
                ]
            ),
            createRequest("Unlink Transaction from Job", "POST", "/functions/v1/unlink-transaction-from-job",
                { allocation_id: "ALLOCATION_UUID" },
                [],
                { success: true, message: "Transaction unlinked from job" },
                "Remove a transaction allocation from a job."
            ),
            createRequest("Link Transaction to Blueprint", "POST", "/functions/v1/link-transaction-to-blueprint",
                { transaction_id: "TX_UUID", blueprint_id: "BP_UUID", allocation_percentage: 100 },
                [],
                { success: true, message: "Transaction linked to blueprint", link: { id: "link-123", transaction_id: "TX_UUID", blueprint_id: "BP_UUID" } },
                "Link a transaction to a cost blueprint for variance tracking."
            ),
            createRequest("Match Transactions to Blueprints", "POST", "/functions/v1/match-transactions-to-blueprints",
                {},
                [],
                {
                    success: true,
                    matches: [
                        { transaction_id: "tx-1", transaction_name: "Home Depot #1234", blueprint_id: "bp-1", blueprint_name: "Kitchen Remodel", confidence: 0.92, reason: "Merchant commonly associated with this blueprint type" }
                    ],
                    total_matches: 15,
                    transactions_analyzed: 50
                },
                "AI-powered matching of transactions to blueprints based on merchant, amount, and historical patterns."
            ),
            createRequest("Sync Plaid Transactions", "POST", "/functions/v1/sync-plaid-transactions",
                { account_id: "ACCOUNT_ID", force_sync: false },
                [],
                { success: true, synced: 50, new: 25, updated: 15, unchanged: 10, cursor: "cursor_string_here", auto_categorized: 20 },
                "Sync transactions from Plaid for a specific account. New transactions are automatically categorized."
            )
        ]
    };
}
