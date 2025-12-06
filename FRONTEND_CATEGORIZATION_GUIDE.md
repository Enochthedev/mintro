# Mintro Categorization System - Frontend Integration Guide

## Overview

The categorization system automatically organizes bank transactions into expense categories using a three-tier approach:
1. **Rule-based matching** (fastest, most accurate)
2. **AI categorization** (fallback for unmatched transactions)
3. **Manual categorization** (user override)

---

## Complete API Flow

### 🚀 User Onboarding Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW USER CONNECTS BANK                        │
├─────────────────────────────────────────────────────────────────┤
│  1. POST /create-link-token          → Get Plaid Link token     │
│  2. User completes Plaid Link UI                                │
│  3. POST /exchange-public-token      → Connects bank            │
│     ├── Auto-creates default categories (if none exist)        │
│     ├── Syncs transactions from bank                           │
│     └── Auto-categorizes transactions (rules + AI)             │
│  4. User sees categorized transactions immediately!             │
└─────────────────────────────────────────────────────────────────┘
```

### 📊 Transaction Categorization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 TRANSACTION CATEGORIZATION                       │
├─────────────────────────────────────────────────────────────────┤
│  New Transaction Arrives                                         │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │ Check Rules     │ ──match──▶ Categorize (method: "rule")     │
│  └────────┬────────┘                                            │
│           │ no match                                             │
│           ▼                                                        │
│  ┌─────────────────┐                                            │
│  │ AI Categorize   │ ──confident──▶ Categorize (method: "ai")   │
│  └────────┬────────┘                                            │
│           │ low confidence                                       │
│           ▼                                                        │
│  ┌─────────────────┐                                            │
│  │ Needs Review    │ ◀── User manually categorizes              │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints Reference

### Category Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup-default-categories` | POST | Create default expense categories |
| `/list-expense-categories` | GET | List all user's categories |
| `/create-expense-category` | POST | Create custom category |
| `/update-expense-category` | POST | Update category details |
| `/delete-expense-category` | POST | Delete category (with merge option) |
| `/analyze-suggest-categories` | POST | **NEW** AI-powered category suggestions |

### Rule Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/list-categorization-rules` | GET | List all rules (with pagination) |
| `/create-categorization-rule` | POST | Create auto-categorization rule |
| `/update-categorization-rule` | POST | Update existing rule |
| `/delete-categorization-rule` | POST | Delete a rule |
| `/test-categorization-rule` | POST | **NEW** Preview rule matches |
| `/apply-categorization-rules` | POST | Apply rules to uncategorized transactions |

### Transaction Categorization

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/get-uncategorized-transactions` | GET | Get transactions needing review |
| `/get-categorized-transactions` | GET | Get categorized transactions |
| `/categorize-transaction` | POST | Manually categorize single transaction |
| `/bulk-categorize-transactions` | POST | Categorize multiple transactions |
| `/uncategorize-transaction` | POST | Remove categorization |
| `/auto-categorize-transactions` | POST | Run auto-categorization (rules + AI) |
| `/suggest-category-ai` | POST | Get AI suggestions for a transaction |

---

## Detailed API Usage

### 1. Setup Default Categories

Called automatically on first bank connection, but can be called manually.

```typescript
// First time setup
POST /functions/v1/setup-default-categories
{}

// Add any new defaults (for existing users when we add new categories)
POST /functions/v1/setup-default-categories
{ "add_missing": true }

// Reset to defaults (destructive - deletes existing)
POST /functions/v1/setup-default-categories
{ "force": true }
```

**Response:**
```json
{
  "success": true,
  "message": "Default categories created",
  "categories_count": 16,
  "categories": [...]
}
```

### 2. Analyze & Suggest Categories (AI-Powered)

Analyzes user's transactions and suggests relevant categories.

```typescript
POST /functions/v1/analyze-suggest-categories
{
  "auto_create": false,  // Set true to auto-create suggested categories
  "limit": 100           // Number of transactions to analyze
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "transaction_count": 234,
    "unique_merchants": 45,
    "top_merchants": [
      { "merchant": "home depot", "count": 12 },
      { "merchant": "amazon", "count": 8 }
    ],
    "plaid_categories": [
      { "category": "Shops", "count": 50 }
    ],
    "amount_distribution": {
      "small": 100,
      "medium": 80,
      "large": 54
    }
  },
  "suggested_categories": [...],
  "new_categories": [...],
  "suggested_rules": [
    {
      "merchant": "home depot",
      "transaction_count": 12,
      "suggested_rule_type": "vendor_contains",
      "suggested_match_value": "home depot"
    }
  ]
}
```

### 3. Create Expense Category

```typescript
POST /functions/v1/create-expense-category
{
  "name": "Subcontractors",
  "description": "Payments to subcontractors",
  "color": "#FF5722",
  "icon": "users",
  "parent_category_id": null  // Optional: for subcategories
}
```

### 4. Test Categorization Rule (Preview)

Preview which transactions a rule would match before creating it.

```typescript
POST /functions/v1/test-categorization-rule
{
  "rule_type": "vendor_contains",
  "match_value": "home depot",
  "limit": 20
}
```

**Response:**
```json
{
  "success": true,
  "rule_preview": {
    "rule_type": "vendor_contains",
    "match_value": "home depot"
  },
  "matches": [
    { "id": "...", "name": "HOME DEPOT #1234", "amount": -125.50, "date": "2025-01-15" }
  ],
  "match_count": 12,
  "showing": 12,
  "transactions_checked": 234
}
```

### 5. Create Categorization Rule

```typescript
POST /functions/v1/create-categorization-rule
{
  "category_id": "uuid-of-materials-category",
  "rule_type": "vendor_contains",  // vendor_exact, vendor_contains, description_contains, amount_range
  "match_value": "home depot",
  "priority": 10,                  // Higher = checked first
  "confidence_score": 0.95
}
```

### 6. List Categorization Rules (with Pagination)

```typescript
GET /functions/v1/list-categorization-rules?limit=20&offset=0&category_id=xxx&is_active=true
```

**Response:**
```json
{
  "success": true,
  "rules": [...],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

### 7. Get Uncategorized Transactions

```typescript
GET /functions/v1/get-uncategorized-transactions?limit=50&offset=0
```

### 8. Manually Categorize Transaction

```typescript
POST /functions/v1/categorize-transaction
{
  "transaction_id": "uuid",
  "category_id": "uuid",
  "create_rule": true  // Optional: auto-create rule from this categorization
}
```

### 9. Bulk Categorize Transactions

```typescript
POST /functions/v1/bulk-categorize-transactions
{
  "categorizations": [
    { "transaction_id": "uuid1", "category_id": "cat-uuid" },
    { "transaction_id": "uuid2", "category_id": "cat-uuid" }
  ]
}
```

### 10. Delete Category (with Merge)

```typescript
POST /functions/v1/delete-expense-category
{
  "category_id": "uuid-to-delete",
  "merge_into_category_id": "uuid-target"  // Reassign transactions/rules to this category
}

// Or force delete (removes all linked data)
{
  "category_id": "uuid-to-delete",
  "force": true
}
```

---

## Frontend Implementation Examples

### React: Category Management Page

```tsx
// Fetch categories with stats
const { data: categories } = await supabase.functions.invoke('list-expense-categories', {
  body: {},
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});

// Or with query params for stats
fetch(`${SUPABASE_URL}/functions/v1/list-expense-categories?include_stats=true`, {
  headers: { Authorization: `Bearer ${session.access_token}` }
});
```

### React: Transaction Review Page

```tsx
function TransactionReview() {
  const [uncategorized, setUncategorized] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    // Load uncategorized transactions
    loadUncategorized();
    loadCategories();
  }, []);

  const loadUncategorized = async () => {
    const { data } = await supabase.functions.invoke('get-uncategorized-transactions');
    setUncategorized(data.transactions);
  };

  const categorize = async (transactionId: string, categoryId: string, createRule: boolean) => {
    await supabase.functions.invoke('categorize-transaction', {
      body: { transaction_id: transactionId, category_id: categoryId, create_rule: createRule }
    });
    loadUncategorized(); // Refresh list
  };

  const getAISuggestion = async (transaction: Transaction) => {
    const { data } = await supabase.functions.invoke('suggest-category-ai', {
      body: {
        transaction_id: transaction.id,
        merchant_name: transaction.merchant_name,
        description: transaction.name,
        amount: transaction.amount
      }
    });
    return data.suggestions; // Returns top 3 suggestions with confidence
  };
}
```

### React: Rule Builder with Preview

```tsx
function RuleBuilder() {
  const [ruleType, setRuleType] = useState('vendor_contains');
  const [matchValue, setMatchValue] = useState('');
  const [preview, setPreview] = useState(null);

  const testRule = async () => {
    const { data } = await supabase.functions.invoke('test-categorization-rule', {
      body: { rule_type: ruleType, match_value: matchValue, limit: 10 }
    });
    setPreview(data);
  };

  const createRule = async (categoryId: string) => {
    await supabase.functions.invoke('create-categorization-rule', {
      body: {
        category_id: categoryId,
        rule_type: ruleType,
        match_value: matchValue,
        priority: 0,
        confidence_score: 0.95
      }
    });
  };

  return (
    <div>
      <select value={ruleType} onChange={e => setRuleType(e.target.value)}>
        <option value="vendor_exact">Vendor Exact Match</option>
        <option value="vendor_contains">Vendor Contains</option>
        <option value="description_contains">Description Contains</option>
        <option value="amount_range">Amount Range</option>
      </select>
      <input value={matchValue} onChange={e => setMatchValue(e.target.value)} />
      <button onClick={testRule}>Preview Matches</button>
      
      {preview && (
        <div>
          <p>Would match {preview.match_count} transactions</p>
          <ul>
            {preview.matches.map(tx => (
              <li key={tx.id}>{tx.name} - ${tx.amount}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

## Rule Types Explained

| Type | Description | Example |
|------|-------------|---------|
| `vendor_exact` | Exact match on merchant name | "HOME DEPOT" matches only "HOME DEPOT" |
| `vendor_contains` | Partial match on merchant/name | "depot" matches "HOME DEPOT #1234" |
| `description_contains` | Partial match on transaction name | "lumber" matches "LUMBER PURCHASE" |
| `amount_range` | Match by amount range | min: 100, max: 500 matches $250 |

---

## Best Practices

1. **Let auto-categorization run first** - Don't manually categorize until auto-categorization completes
2. **Create rules from manual categorizations** - Use `create_rule: true` when manually categorizing frequent merchants
3. **Use rule preview** - Always test rules before creating to see impact
4. **Higher priority = checked first** - Set priority > 0 for important rules
5. **Use AI suggestions** - Show AI suggestions to users for faster manual categorization
6. **Batch operations** - Use bulk endpoints for multiple transactions

---

## Error Handling

All endpoints return consistent error format:
```json
{
  "error": "Error message",
  "details": { ... }  // Optional additional info
}
```

Common HTTP status codes:
- `400` - Bad request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `404` - Resource not found
- `409` - Conflict (duplicate rule, category name exists)
- `500` - Server error
