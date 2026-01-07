# 📂 Mintro Categorization API - Complete Documentation

Complete API documentation for the transaction categorization system. This system allows users to categorize bank transactions into expense categories using manual assignment, rule-based automation, and AI-powered suggestions.

---

## 🏗️ System Architecture

The categorization system uses the following database tables:

| Table | Purpose |
|-------|---------|
| `expense_categories` | User-defined expense categories (Materials, Labor, etc.) |
| `transactions` | Bank transactions imported via Plaid |
| `transaction_categorizations` | Links between transactions and categories |
| `categorization_rules` | User-defined rules for automatic matching |

---

## 🔐 Authentication

All endpoints require the `Authorization` header:

```
Authorization: Bearer <ACCESS_TOKEN>
```

---

## 📋 Endpoint Summary (16 Total)

### Category Management (6 endpoints)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `setup-default-categories` | POST | Initialize default categories (with force/add_missing options) |
| `list-expense-categories` | GET | List all categories |
| `create-expense-category` | POST | Create custom category (with parent support) |
| `update-expense-category` | POST | Update category (with parent support) |
| `delete-expense-category` | POST | Delete category (with merge option) |
| `analyze-suggest-categories` | POST | **NEW** AI-powered category suggestions |

### Rule Management (6 endpoints)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `create-categorization-rule` | POST | Create auto-match rule (with duplicate detection) |
| `list-categorization-rules` | GET | View all rules (with pagination & filters) |
| `update-categorization-rule` | POST | Update a rule |
| `delete-categorization-rule` | POST | Delete a rule |
| `apply-categorization-rules` | POST | Run rules on transactions |
| `test-categorization-rule` | POST | **NEW** Preview rule matches before creating |

### Transaction Categorization (5 endpoints)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `get-uncategorized-transactions` | GET | List pending transactions |
| `get-categorized-transactions` | GET | List categorized transactions |
| `categorize-transaction` | POST | Manually categorize one |
| `uncategorize-transaction` | POST | Remove categorization |
| `bulk-categorize-transactions` | POST | Categorize many at once |

### AI & Analytics (4 endpoints)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `suggest-category-ai` | POST | Get AI suggestions for single transaction |
| `auto-categorize-transactions` | POST | Batch auto-categorize (rules + AI) |
| `analyze-suggest-categories` | POST | **NEW** AI-powered category suggestions based on transaction patterns |
| `test-categorization-rule` | POST | **NEW** Preview which transactions a rule would match |
| `get-category-breakdown` | GET | Spending analytics |

---

## 🗂️ Category Management Endpoints

### 1. Setup Default Categories

**POST** `/functions/v1/setup-default-categories`

Initialize default expense categories for new users. Safe to call multiple times - won't duplicate categories.

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Default categories created",
  "categories_count": 12,
  "categories": [
    {
      "id": "uuid",
      "name": "Materials",
      "description": "Building materials and supplies",
      "color": "#4CAF50",
      "icon": "package"
    }
  ]
}
```

**Response (Already Exists):**
```json
{
  "success": true,
  "message": "Categories already exist",
  "setup_needed": false,
  "categories_count": 12,
  "categories": [...]
}
```

---

### 2. List Expense Categories

**GET** `/functions/v1/list-expense-categories`

List all expense categories for the user.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_stats` | boolean | false | Include transaction/rule counts |

**Example:**
```
GET /functions/v1/list-expense-categories?include_stats=true
```

**Response (200 OK):**
```json
{
  "success": true,
  "categories": [
    {
      "id": "cat-uuid-1",
      "name": "Materials",
      "description": "Building materials and supplies",
      "color": "#4CAF50",
      "icon": "package",
      "created_at": "2025-12-01T10:00:00Z",
      "transaction_count": 42,
      "rule_count": 3
    },
    {
      "id": "cat-uuid-2",
      "name": "Labor",
      "description": "Labor costs and wages",
      "color": "#2196F3",
      "icon": "users",
      "transaction_count": 15,
      "rule_count": 1
    }
  ],
  "total": 12
}
```

---

### 3. Create Expense Category

**POST** `/functions/v1/create-expense-category`

Create a new custom expense category.

**Request Body:**
```json
{
  "name": "Equipment Rental",
  "description": "Rented equipment and tools",
  "color": "#FF9800",
  "icon": "tool"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Category name (max 50 chars) |
| `description` | string | No | Category description |
| `color` | string | No | Hex color (e.g., `#FF9800`) |
| `icon` | string | No | Icon name |

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Category created successfully",
  "category": {
    "id": "new-cat-uuid",
    "user_id": "user-uuid",
    "name": "Equipment Rental",
    "description": "Rented equipment and tools",
    "color": "#FF9800",
    "icon": "tool",
    "created_at": "2025-12-06T08:20:00Z"
  }
}
```

**Error (409 Conflict):**
```json
{
  "error": "A category with this name already exists"
}
```

---

### 4. Update Expense Category

**POST** `/functions/v1/update-expense-category`

Update an existing category's properties. Only include fields you want to change.

**Request Body:**
```json
{
  "category_id": "cat-uuid",
  "name": "Heavy Equipment",
  "description": "Heavy equipment rentals",
  "color": "#E65100",
  "icon": "truck"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category_id` | UUID | **Yes** | Category to update |
| `name` | string | No | New name |
| `description` | string | No | New description |
| `color` | string | No | New color (hex format) |
| `icon` | string | No | New icon |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Category updated successfully",
  "category": {
    "id": "cat-uuid",
    "name": "Heavy Equipment",
    "description": "Heavy equipment rentals",
    "color": "#E65100",
    "icon": "truck"
  },
  "updated_fields": ["name", "description", "color", "icon"]
}
```

---

### 5. Delete Expense Category

**POST** `/functions/v1/delete-expense-category`

Delete an expense category.

**Request Body:**
```json
{
  "category_id": "cat-uuid",
  "force": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category_id` | UUID | **Yes** | Category to delete |
| `force` | boolean | No | Force delete linked data |

**Response - Has Linked Data (400):**
```json
{
  "error": "Category has linked data",
  "message": "This category has linked transactions or rules. Set force=true to delete anyway.",
  "linked_data": {
    "transaction_categorizations": 42,
    "categorization_rules": 3
  }
}
```

**Response - Success (200 OK):**
```json
{
  "success": true,
  "message": "Category deleted successfully",
  "deleted_category": {
    "id": "cat-uuid",
    "name": "Equipment Rental"
  },
  "deleted_data": {
    "categorization_rules": 3,
    "transaction_categorizations": 42
  }
}
```

---

## 📋 Rule Management Endpoints

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| `vendor_exact` | Exact vendor match | `"home depot"` matches only `"home depot"` |
| `vendor_contains` | Partial vendor match | `"depot"` matches `"Home Depot #123"` |
| `description_contains` | Partial description match | `"lumber"` in name/description |
| `amount_range` | Amount within range | Transactions $50-$200 |

---

### 1. Create Categorization Rule

**POST** `/functions/v1/create-categorization-rule`

Create a rule for automatic categorization.

**Request Body:**
```json
{
  "category_id": "cat-uuid",
  "rule_type": "vendor_contains",
  "match_value": "home depot",
  "priority": 10,
  "confidence_score": 0.95,
  "min_amount": null,
  "max_amount": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category_id` | UUID | **Yes** | Target category |
| `rule_type` | string | **Yes** | Rule type (see above) |
| `match_value` | string | **Yes** | Value to match |
| `priority` | number | No | Higher = checked first (default: 0) |
| `confidence_score` | number | No | 0.0-1.0 (default: 0.95) |
| `min_amount` | number | No | For amount_range rules |
| `max_amount` | number | No | For amount_range rules |

**Response (200 OK):**
```json
{
  "success": true,
  "rule": {
    "id": "rule-uuid",
    "user_id": "user-uuid",
    "category_id": "cat-uuid",
    "rule_type": "vendor_contains",
    "match_value": "home depot",
    "priority": 10,
    "confidence_score": 0.95,
    "is_active": true,
    "times_applied": 0,
    "created_at": "2025-12-06T08:25:00Z"
  }
}
```

---

### 2. List Categorization Rules

**GET** `/functions/v1/list-categorization-rules`

Get all categorization rules with their linked categories.

**Response (200 OK):**
```json
{
  "success": true,
  "rules": [
    {
      "id": "rule-uuid",
      "rule_type": "vendor_contains",
      "match_value": "home depot",
      "priority": 10,
      "confidence_score": 0.95,
      "is_active": true,
      "times_applied": 42,
      "last_applied_at": "2025-12-05T10:30:00Z",
      "expense_categories": {
        "id": "cat-uuid",
        "name": "Materials",
        "color": "#4CAF50",
        "icon": "package"
      }
    }
  ],
  "total_rules": 5
}
```

---

### 3. Update Categorization Rule

**POST** `/functions/v1/update-categorization-rule`

Update an existing rule's properties.

**Request Body:**
```json
{
  "rule_id": "rule-uuid",
  "category_id": "new-cat-uuid",
  "match_value": "home depot",
  "priority": 20,
  "confidence_score": 0.98,
  "is_active": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rule_id` | UUID | **Yes** | Rule to update |
| `category_id` | UUID | No | New target category |
| `rule_type` | string | No | New rule type |
| `match_value` | string | No | New match value |
| `priority` | number | No | New priority |
| `confidence_score` | number | No | New confidence (0-1) |
| `is_active` | boolean | No | Enable/disable rule |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Rule updated successfully",
  "rule": {
    "id": "rule-uuid",
    "rule_type": "vendor_contains",
    "match_value": "home depot",
    "priority": 20,
    "is_active": true,
    "expense_categories": {
      "id": "cat-uuid",
      "name": "Materials"
    }
  },
  "updated_fields": ["priority", "match_value"]
}
```

---

### 4. Delete Categorization Rule

**POST** `/functions/v1/delete-categorization-rule`

Delete a categorization rule.

**Request Body:**
```json
{
  "rule_id": "rule-uuid"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Rule deleted successfully"
}
```

---

### 5. Apply Categorization Rules

**POST** `/functions/v1/apply-categorization-rules`

Run all active rules against uncategorized transactions.

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "categorized": 23,
  "total_processed": 45
}
```

---

## 💳 Transaction Categorization Endpoints

### 1. Get Uncategorized Transactions

**GET** `/functions/v1/get-uncategorized-transactions`

List transactions that haven't been categorized yet.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page |
| `offset` | number | 0 | Pagination offset |

**Response (200 OK):**
```json
{
  "success": true,
  "transactions": [
    {
      "id": "tx-uuid",
      "transaction_id": "plaid_tx_123",
      "date": "2025-12-01",
      "amount": -125.50,
      "name": "HOME DEPOT #1234",
      "merchant_name": "Home Depot",
      "pending": false,
      "account": {
        "id": "acc-uuid",
        "name": "Business Checking",
        "mask": "1234",
        "type": "checking",
        "institution": "Chase"
      }
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

---

### 2. Get Categorized Transactions

**GET** `/functions/v1/get-categorized-transactions`

List transactions that have been categorized.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page |
| `offset` | number | 0 | Pagination offset |
| `category_id` | UUID | - | Filter by category |
| `method` | string | - | Filter by method (`manual`, `rule`, `ai`) |
| `start_date` | string | - | Start date (YYYY-MM-DD) |
| `end_date` | string | - | End date (YYYY-MM-DD) |

**Example:**
```
GET /functions/v1/get-categorized-transactions?method=manual&limit=20
```

**Response (200 OK):**
```json
{
  "success": true,
  "transactions": [
    {
      "categorization_id": "cat-link-uuid",
      "method": "manual",
      "confidence": 1.0,
      "is_user_override": true,
      "categorized_at": "2025-12-05T10:00:00Z",
      "category": {
        "id": "cat-uuid",
        "name": "Materials",
        "color": "#4CAF50",
        "icon": "package"
      },
      "rule": null,
      "transaction": {
        "id": "tx-uuid",
        "transaction_id": "plaid_tx_123",
        "date": "2025-12-01",
        "amount": -150.00,
        "name": "Home Depot",
        "merchant_name": "Home Depot",
        "pending": false,
        "account": {
          "id": "acc-uuid",
          "name": "Business Checking",
          "institution": "Chase"
        }
      }
    }
  ],
  "pagination": {
    "total": 120,
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}
```

---

### 3. Categorize Transaction

**POST** `/functions/v1/categorize-transaction`

Manually assign a category to a single transaction.

**Request Body:**
```json
{
  "transaction_id": "tx-uuid",
  "category_id": "cat-uuid",
  "create_rule": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transaction_id` | UUID | **Yes** | Transaction to categorize |
| `category_id` | UUID | **Yes** | Target category |
| `create_rule` | boolean | No | Auto-create rule from this |

**Response (200 OK):**
```json
{
  "success": true,
  "categorization": {
    "id": "cat-link-uuid",
    "transaction_id": "tx-uuid",
    "category_id": "cat-uuid",
    "method": "manual",
    "is_user_override": true,
    "confidence": 1.0
  },
  "rule_created": true,
  "rule": {
    "id": "rule-uuid",
    "rule_type": "vendor_contains",
    "match_value": "home depot",
    "category_id": "cat-uuid"
  }
}
```

---

### 4. Uncategorize Transaction

**POST** `/functions/v1/uncategorize-transaction`

Remove categorization from a transaction.

**Request Body:**
```json
{
  "transaction_id": "tx-uuid"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Transaction uncategorized successfully",
  "removed_categorization": {
    "transaction_id": "tx-uuid",
    "transaction_name": "Home Depot",
    "previous_category": "Materials",
    "previous_method": "manual"
  }
}
```

---

### 5. Bulk Categorize Transactions

**POST** `/functions/v1/bulk-categorize-transactions`

Categorize multiple transactions at once. Maximum 100 per request.

**Request Body:**
```json
{
  "categorizations": [
    {
      "transaction_id": "tx-uuid-1",
      "category_id": "cat-materials"
    },
    {
      "transaction_id": "tx-uuid-2",
      "category_id": "cat-labor"
    },
    {
      "transaction_id": "tx-uuid-3",
      "category_id": "cat-materials"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Bulk categorization complete",
  "results": {
    "total_requested": 3,
    "inserted": 2,
    "updated": 1,
    "skipped": 0
  }
}
```

---

## 🤖 AI & Automation Endpoints

### 1. Auto-Categorize Transactions

**POST** `/functions/v1/auto-categorize-transactions`

Smart auto-categorization using rules first, then AI fallback.

**Request Body (All Options):**
```json
{
  "transaction_ids": ["tx-uuid-1", "tx-uuid-2", "tx-uuid-3"],  // Optional - specific transactions
  "limit": 500  // Optional - max transactions when processing all (default: 500)
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transaction_ids` | array | No | Specific transaction IDs to categorize. If omitted, processes ALL uncategorized transactions. |
| `limit` | number | No | Maximum transactions to process when `transaction_ids` is omitted (default: 500) |

**Example 1: Categorize All Uncategorized Transactions**
```json
{}
```

**Example 2: Categorize Specific Transactions**
```json
{
  "transaction_ids": ["tx-uuid-1", "tx-uuid-2"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Successfully categorized 8 of 10 transactions",
  "categorized": 8,
  "skipped": 2,
  "breakdown": {
    "rule_matched": 5,
    "ai_categorized": 3,
    "needs_review": 2
  }
}
```

**Processing Order:**
1. **Rule Matching** (checked by priority, highest first):
   - `vendor_exact`
   - `vendor_contains`
   - `description_contains`
   - `amount_range`

2. **AI Fallback** (if no rule matches and `OPENAI_API_KEY` is set):
   - Sends to GPT-4o-mini
   - Only applies if confidence > threshold

---

### 2. Suggest Category (AI)

**POST** `/functions/v1/suggest-category-ai`

Get AI-powered category suggestions without applying them.

**Request Body (Single):**
```json
{
  "transaction_id": "tx-uuid",
  "merchant_name": "Home Depot",
  "description": "Building materials",
  "amount": 150.00
}
```

**Request Body (Batch):**
```json
{
  "batch_mode": true,
  "transactions": [
    { "merchant_name": "Home Depot", "amount": 150.00 },
    { "merchant_name": "Shell Gas Station", "amount": 45.00 }
  ]
}
```

**Response (Single):**
```json
{
  "success": true,
  "transaction_id": "tx-uuid",
  "suggestions": [
    {
      "category_id": "cat-uuid",
      "category_name": "Materials",
      "confidence": 0.95,
      "reason": "Home improvement store commonly sells building materials"
    },
    {
      "category_id": "cat-uuid-2",
      "category_name": "Tools",
      "confidence": 0.75,
      "reason": "Could be tools purchase"
    }
  ]
}
```

---

## 📊 Analytics Endpoints

### Get Category Breakdown

**GET** `/functions/v1/get-category-breakdown`

Get spending breakdown by category for pie charts and reports.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start_date` | string | - | Filter start date (YYYY-MM-DD) |
| `end_date` | string | - | Filter end date (YYYY-MM-DD) |
| `include_uncategorized` | boolean | false | Include uncategorized |

**Example:**
```
GET /functions/v1/get-category-breakdown?start_date=2025-01-01&include_uncategorized=true
```

**Response (200 OK):**
```json
{
  "success": true,
  "period": {
    "start_date": "2025-01-01",
    "end_date": "present"
  },
  "summary": {
    "total_expenses": 15000.00,
    "categorized_total": 12500.00,
    "uncategorized_total": 2500.00,
    "categorization_rate": 83.3
  },
  "breakdown": [
    {
      "category_id": "cat-uuid-1",
      "category_name": "Materials",
      "color": "#4CAF50",
      "icon": "package",
      "total_amount": 5000.00,
      "percentage": 33.3,
      "transaction_count": 25
    },
    {
      "category_id": "cat-uuid-2",
      "category_name": "Labor",
      "color": "#2196F3",
      "icon": "users",
      "total_amount": 4000.00,
      "percentage": 26.7,
      "transaction_count": 10
    },
    {
      "category_id": null,
      "category_name": "Uncategorized",
      "color": "#9E9E9E",
      "icon": "help-circle",
      "total_amount": 2500.00,
      "percentage": 16.7,
      "transaction_count": 15
    }
  ]
}
```

---

## 🔄 Typical Frontend Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER ONBOARDING                              │
├─────────────────────────────────────────────────────────────────┤
│  1. POST setup-default-categories                               │
│  2. User connects bank via Plaid                                 │
│  3. Transactions sync automatically                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CATEGORIZATION DASHBOARD                       │
├─────────────────────────────────────────────────────────────────┤
│  4. GET get-uncategorized-transactions                          │
│  5. Show list with "Needs Review" badge                          │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   MANUAL    │      │   RULES     │      │    AUTO     │
├─────────────┤      ├─────────────┤      ├─────────────┤
│ Click tx    │      │ create-     │      │ auto-       │
│ categorize- │      │ categoriz-  │      │ categorize- │
│ transaction │      │ ation-rule  │      │ transactions│
└─────────────┘      └─────────────┘      └─────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ANALYTICS & REPORTS                           │
├─────────────────────────────────────────────────────────────────┤
│  GET get-category-breakdown → Pie Charts                         │
│  GET get-categorized-transactions → Transaction List             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Error Handling

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "error": "validation error message"
}
```

**401 Unauthorized:**
```json
{
  "error": "Unauthorized"
}
```

**404 Not Found:**
```json
{
  "error": "Resource not found"
}
```

**409 Conflict:**
```json
{
  "error": "A category with this name already exists"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error message"
}
```

---

## 📅 Last Updated

December 6, 2025
