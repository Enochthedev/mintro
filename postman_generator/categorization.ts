// Categorization endpoints with comprehensive examples
import { createRequest } from "./helpers.ts";

export function getCategorizationSection() {
    return {
        name: "Categorization",
        description: "Expense categorization, rules, and AI-powered auto-categorization",
        item: [
            // === CATEGORY MANAGEMENT ===
            {
                name: "Setup Default Categories",
                item: [
                    createRequest("First Time Setup", "POST", "/functions/v1/setup-default-categories",
                        {},
                        [],
                        {
                            success: true,
                            message: "Default categories created",
                            categories_added: 16,
                            categories_count: 16,
                            categories: [
                                { id: "uuid", name: "Materials", color: "#4CAF50" },
                                { id: "uuid", name: "Labor", color: "#2196F3" },
                                { id: "uuid", name: "Equipment", color: "#FF9800" }
                            ]
                        },
                        "Initialize default expense categories for new users. Safe to call multiple times.",
                        [
                            {
                                name: "Categories Already Exist",
                                status: 200,
                                body: {
                                    success: true,
                                    message: "Categories already exist",
                                    categories_added: 0,
                                    categories_count: 16,
                                    categories: []
                                }
                            },
                            {
                                name: "Add Missing Defaults",
                                status: 200,
                                body: {
                                    success: true,
                                    message: "Added missing default categories",
                                    categories_added: 3,
                                    categories_count: 16,
                                    categories: [
                                        { id: "uuid", name: "Fuel", color: "#795548" }
                                    ]
                                }
                            }
                        ]
                    )
                ]
            },
            createRequest("List Expense Categories", "GET", "/functions/v1/list-expense-categories", null,
                [{ key: "include_stats", value: "true", disabled: true, description: "Include transaction/rule counts" }],
                {
                    success: true,
                    categories: [
                        { id: "cat-1", name: "Materials", description: "Building materials", color: "#4CAF50", icon: "package", transaction_count: 42, rule_count: 3 },
                        { id: "cat-2", name: "Labor", description: "Labor and contractor costs", color: "#2196F3", icon: "users", transaction_count: 25, rule_count: 2 }
                    ],
                    total: 12
                },
                "List all expense categories with optional stats."
            ),
            createRequest("Create Expense Category", "POST", "/functions/v1/create-expense-category",
                { name: "Equipment Rental", description: "Rented equipment and tools", color: "#FF9800", icon: "tool" },
                [],
                { success: true, message: "Category created successfully", category: { id: "new-cat-uuid", name: "Equipment Rental", description: "Rented equipment and tools", color: "#FF9800", icon: "tool" } },
                "Create a custom expense category.",
                [
                    {
                        name: "Duplicate Name Error",
                        status: 400,
                        body: { error: "Category with this name already exists" }
                    }
                ]
            ),
            createRequest("Update Expense Category", "POST", "/functions/v1/update-expense-category",
                { category_id: "CATEGORY_UUID", name: "Heavy Equipment", color: "#E65100", icon: "truck" },
                [],
                { success: true, message: "Category updated successfully", category: { id: "cat-uuid", name: "Heavy Equipment", color: "#E65100", icon: "truck" }, updated_fields: ["name", "color", "icon"] },
                "Update an existing category."
            ),
            {
                name: "Delete Expense Category",
                item: [
                    createRequest("Simple Delete", "POST", "/functions/v1/delete-expense-category",
                        { category_id: "CATEGORY_UUID" },
                        [],
                        { success: true, message: "Category deleted successfully", deleted_category: { id: "cat-uuid", name: "Equipment Rental" } },
                        "Delete a category with no linked data."
                    ),
                    createRequest("Has Linked Data (Error)", "POST", "/functions/v1/delete-expense-category",
                        { category_id: "CATEGORY_UUID" },
                        [],
                        null,
                        "Attempt to delete category with linked transactions/rules.",
                        [
                            {
                                name: "Has Linked Data",
                                status: 400,
                                body: {
                                    error: "Cannot delete category with linked data",
                                    linked_data: {
                                        transactions: 42,
                                        rules: 3
                                    },
                                    suggestion: "Use force=true to delete anyway, or merge_into_category_id to move data"
                                }
                            }
                        ]
                    ),
                    createRequest("Force Delete", "POST", "/functions/v1/delete-expense-category",
                        { category_id: "CATEGORY_UUID", force: true },
                        [],
                        { success: true, message: "Category force deleted", deleted_category: { id: "cat-uuid", name: "Equipment Rental" }, orphaned_transactions: 42, deleted_rules: 3 },
                        "Force delete category and unlink all transactions."
                    ),
                    createRequest("Merge Into Another", "POST", "/functions/v1/delete-expense-category",
                        { category_id: "CATEGORY_UUID", merge_into_category_id: "OTHER_CATEGORY_UUID" },
                        [],
                        { success: true, message: "Category deleted and data merged", deleted_category: { id: "cat-uuid", name: "Equipment Rental" }, merged_transactions: 42, merged_rules: 3, target_category: { id: "other-uuid", name: "Equipment" } },
                        "Delete category and merge all transactions/rules into another category."
                    )
                ]
            },

            // === RULE MANAGEMENT ===
            createRequest("List Categorization Rules", "GET", "/functions/v1/list-categorization-rules", null,
                [
                    { key: "category_id", value: "", disabled: true, description: "Filter by category" },
                    { key: "rule_type", value: "", disabled: true, description: "Filter by type (vendor_exact, vendor_contains, description_contains, amount_range)" },
                    { key: "is_active", value: "true", disabled: true, description: "Filter by active status" },
                    { key: "limit", value: "50", disabled: false, description: "Results per page" },
                    { key: "offset", value: "0", disabled: false, description: "Pagination offset" }
                ],
                {
                    success: true,
                    rules: [
                        { id: "rule-1", rule_type: "vendor_contains", match_value: "home depot", priority: 10, confidence_score: 0.95, is_active: true, times_applied: 42, last_applied_at: "2025-12-01T10:00:00Z", expense_categories: { id: "cat-1", name: "Materials", color: "#4CAF50" } },
                        { id: "rule-2", rule_type: "vendor_exact", match_value: "starbucks", priority: 5, confidence_score: 0.99, is_active: true, times_applied: 15, expense_categories: { id: "cat-2", name: "Business Meals", color: "#FF5722" } }
                    ],
                    pagination: { total: 15, limit: 50, offset: 0, has_more: false }
                },
                "List all categorization rules with their linked categories."
            ),
            createRequest("Create Categorization Rule", "POST", "/functions/v1/create-categorization-rule",
                { category_id: "CATEGORY_UUID", rule_type: "vendor_contains", match_value: "home depot", priority: 10, confidence_score: 0.95 },
                [],
                { success: true, rule: { id: "rule-new", category_id: "CATEGORY_UUID", rule_type: "vendor_contains", match_value: "home depot", priority: 10, is_active: true, confidence_score: 0.95 } },
                "Create rule for automatic categorization. Types: vendor_exact, vendor_contains, description_contains, amount_range",
                [
                    {
                        name: "Amount Range Rule",
                        status: 200,
                        body: {
                            success: true,
                            rule: { id: "rule-new", category_id: "CATEGORY_UUID", rule_type: "amount_range", min_amount: 100, max_amount: 500, priority: 5, is_active: true }
                        }
                    }
                ]
            ),
            createRequest("Update Categorization Rule", "POST", "/functions/v1/update-categorization-rule",
                { rule_id: "RULE_UUID", priority: 20, is_active: true },
                [],
                { success: true, message: "Rule updated successfully", rule: { id: "RULE_UUID", priority: 20, is_active: true }, updated_fields: ["priority", "is_active"] },
                "Update an existing rule."
            ),
            createRequest("Delete Categorization Rule", "POST", "/functions/v1/delete-categorization-rule",
                { rule_id: "RULE_UUID" },
                [],
                { success: true, message: "Rule deleted successfully" },
                "Delete a categorization rule."
            ),
            createRequest("Test Categorization Rule (Preview)", "POST", "/functions/v1/test-categorization-rule",
                { rule_type: "vendor_contains", match_value: "depot" },
                [],
                {
                    success: true,
                    rule_preview: { rule_type: "vendor_contains", match_value: "depot" },
                    matches: [
                        { id: "tx-uuid-1", name: "HOME DEPOT #1234", merchant_name: "Home Depot", amount: -125.50, date: "2025-01-15" },
                        { id: "tx-uuid-2", name: "HOME DEPOT #5678", merchant_name: "Home Depot", amount: -89.99, date: "2025-01-10" }
                    ],
                    match_count: 12,
                    showing: 10,
                    transactions_checked: 234
                },
                "Preview which transactions a rule would match before creating it."
            ),
            createRequest("Apply Categorization Rules", "POST", "/functions/v1/apply-categorization-rules",
                {},
                [],
                { success: true, categorized: 23, total_processed: 45, rules_applied: [{ rule_id: "rule-1", transactions_matched: 15 }, { rule_id: "rule-2", transactions_matched: 8 }] },
                "Run all active rules against uncategorized transactions."
            ),

            // === TRANSACTION CATEGORIZATION ===
            createRequest("Get Uncategorized Transactions", "GET", "/functions/v1/get-uncategorized-transactions", null,
                [
                    { key: "limit", value: "50", disabled: false, description: "Results per page" },
                    { key: "offset", value: "0", disabled: false, description: "Pagination offset" }
                ],
                {
                    success: true,
                    transactions: [
                        { id: "tx-uuid", transaction_id: "plaid_tx_123", date: "2025-12-01", amount: -125.50, name: "HOME DEPOT #1234", merchant_name: "Home Depot", pending: false, account: { id: "acc-uuid", name: "Business Checking", mask: "1234", institution: "Chase" } }
                    ],
                    pagination: { total: 45, limit: 50, offset: 0, has_more: false }
                },
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
                {
                    success: true,
                    transactions: [
                        {
                            categorization_id: "cat-link-uuid",
                            method: "rule",
                            confidence: 0.95,
                            is_user_override: false,
                            categorized_at: "2025-12-05T10:00:00Z",
                            category: { id: "cat-uuid", name: "Materials", color: "#4CAF50", icon: "package" },
                            rule: { id: "rule-uuid", match_value: "home depot", rule_type: "vendor_contains" },
                            transaction: { id: "tx-uuid", date: "2025-12-01", amount: -150.00, name: "Home Depot", merchant_name: "Home Depot", pending: false }
                        }
                    ],
                    pagination: { total: 120, limit: 50, offset: 0, has_more: true }
                },
                "List categorized transactions with filters."
            ),
            createRequest("Categorize Transaction", "POST", "/functions/v1/categorize-transaction",
                { transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", create_rule: false },
                [],
                { success: true, categorization: { id: "cat-link-uuid", transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", method: "manual", confidence: 1.0, is_user_override: false }, rule_created: false, rule: null },
                "Manually assign category to a transaction. Set create_rule=true to auto-create a rule based on merchant.",
                [
                    {
                        name: "With Rule Creation",
                        status: 200,
                        body: {
                            success: true,
                            categorization: { id: "cat-link-uuid", transaction_id: "TX_UUID", category_id: "CATEGORY_UUID", method: "manual", confidence: 1.0 },
                            rule_created: true,
                            rule: { id: "new-rule-uuid", rule_type: "vendor_contains", match_value: "home depot", category_id: "CATEGORY_UUID" }
                        }
                    },
                    {
                        name: "Override Previous Category",
                        status: 200,
                        body: {
                            success: true,
                            categorization: { id: "cat-link-uuid", transaction_id: "TX_UUID", category_id: "NEW_CATEGORY_UUID", method: "manual", confidence: 1.0, is_user_override: true, previous_category_id: "OLD_CATEGORY_UUID" },
                            rule_created: false
                        }
                    }
                ]
            ),
            createRequest("Uncategorize Transaction", "POST", "/functions/v1/uncategorize-transaction",
                { transaction_id: "TX_UUID" },
                [],
                { success: true, message: "Transaction uncategorized successfully", removed_categorization: { transaction_id: "TX_UUID", transaction_name: "Home Depot", previous_category: "Materials", previous_method: "manual" } },
                "Remove categorization from a transaction."
            ),
            createRequest("Bulk Categorize Transactions", "POST", "/functions/v1/bulk-categorize-transactions",
                { categorizations: [{ transaction_id: "TX_UUID_1", category_id: "CAT_UUID_MATERIALS" }, { transaction_id: "TX_UUID_2", category_id: "CAT_UUID_LABOR" }, { transaction_id: "TX_UUID_3", category_id: "CAT_UUID_MATERIALS" }] },
                [],
                { success: true, message: "Bulk categorization complete", results: { total_requested: 3, inserted: 2, updated: 1, skipped: 0 } },
                "Categorize multiple transactions at once. Max 100 per request.",
                [
                    {
                        name: "Partial Success",
                        status: 200,
                        body: {
                            success: true,
                            message: "Bulk categorization complete with errors",
                            results: { total_requested: 5, inserted: 2, updated: 1, skipped: 2 },
                            errors: ["Transaction TX_UUID_4 not found", "Invalid category ID for TX_UUID_5"]
                        }
                    }
                ]
            ),

            // === AI & AUTOMATION ===
            {
                name: "Auto-Categorize Transactions",
                item: [
                    createRequest("Auto-Categorize All", "POST", "/functions/v1/auto-categorize-transactions",
                        {},
                        [],
                        { success: true, message: "Successfully categorized 35 of 40 transactions", categorized: 35, skipped: 5, breakdown: { rule_matched: 20, ai_categorized: 15, needs_review: 5 } },
                        "Auto-categorize ALL uncategorized transactions using rules first, then AI fallback. Just send empty body."
                    ),
                    createRequest("Auto-Categorize Specific", "POST", "/functions/v1/auto-categorize-transactions",
                        { transaction_ids: ["TX_UUID_1", "TX_UUID_2", "TX_UUID_3"] },
                        [],
                        { success: true, message: "Successfully categorized 3 of 3 transactions", categorized: 3, skipped: 0, breakdown: { rule_matched: 2, ai_categorized: 1, needs_review: 0 } },
                        "Auto-categorize specific transactions by ID."
                    ),
                    createRequest("With Limit", "POST", "/functions/v1/auto-categorize-transactions",
                        { limit: 100 },
                        [],
                        { success: true, message: "Successfully categorized 85 of 100 transactions", categorized: 85, skipped: 15, breakdown: { rule_matched: 60, ai_categorized: 25, needs_review: 15 }, remaining_uncategorized: 150 },
                        "Limit the number of transactions to process."
                    )
                ]
            },
            createRequest("Suggest Category (AI)", "POST", "/functions/v1/suggest-category-ai",
                { transaction_id: "TX_UUID" },
                [],
                { success: true, suggestions: [{ category_id: "cat-1", category_name: "Materials", confidence: 0.95, reasoning: "Merchant 'Home Depot' is commonly associated with building materials" }, { category_id: "cat-2", category_name: "Equipment", confidence: 0.15, reasoning: "Alternative - could be equipment purchase" }] },
                "Get AI-powered category suggestions without applying them."
            ),
            {
                name: "Analyze & Suggest Categories (AI)",
                item: [
                    createRequest("Analyze Only", "POST", "/functions/v1/analyze-suggest-categories",
                        {},
                        [],
                        {
                            success: true,
                            analysis: {
                                transaction_count: 234,
                                unique_merchants: 45,
                                top_merchants: [
                                    { merchant: "home depot", count: 12 },
                                    { merchant: "amazon", count: 8 },
                                    { merchant: "lowes", count: 6 }
                                ],
                                plaid_categories: [
                                    { category: "Shops", count: 50 },
                                    { category: "Food and Drink", count: 30 }
                                ],
                                amount_distribution: { small: 100, medium: 80, large: 54 }
                            },
                            suggested_categories: [
                                { name: "Building Supplies", description: "Hardware store purchases", color: "#FF9800", icon: "package", reason: "12 transactions from Home Depot, 6 from Lowes" }
                            ],
                            new_categories: [],
                            suggested_rules: [
                                { merchant: "home depot", transaction_count: 12, suggested_rule_type: "vendor_contains", suggested_match_value: "home depot" }
                            ]
                        },
                        "AI analyzes transaction patterns and suggests new categories to create."
                    ),
                    createRequest("Auto-Create Categories", "POST", "/functions/v1/analyze-suggest-categories",
                        { auto_create: true },
                        [],
                        {
                            success: true,
                            analysis: { transaction_count: 234, unique_merchants: 45 },
                            suggested_categories: [],
                            new_categories: [
                                { id: "new-cat-uuid", name: "Building Supplies", description: "Hardware store purchases" }
                            ],
                            suggested_rules: []
                        },
                        "Automatically create suggested categories."
                    )
                ]
            },

            // === ANALYTICS ===
            createRequest("Get Category Breakdown", "GET", "/functions/v1/get-category-breakdown", null,
                [
                    { key: "start_date", value: "", disabled: true, description: "Start date (YYYY-MM-DD)" },
                    { key: "end_date", value: "", disabled: true, description: "End date (YYYY-MM-DD)" }
                ],
                {
                    success: true,
                    period: { start_date: "all time", end_date: "present" },
                    summary: {
                        total_expenses: 15000.00,
                        categorized_total: 12500.00,
                        uncategorized_total: 2500.00,
                        categorization_rate: 83.3
                    },
                    breakdown: [
                        { category_id: "cat-1", category_name: "Materials", color: "#4CAF50", total_amount: 5000.00, percentage: 33.3, transaction_count: 25 },
                        { category_id: "cat-2", category_name: "Labor", color: "#2196F3", total_amount: 4000.00, percentage: 26.7, transaction_count: 10 }
                    ]
                },
                "Get spending breakdown by category for analytics."
            )
        ]
    };
}
