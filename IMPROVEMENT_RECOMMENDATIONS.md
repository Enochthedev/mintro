# Mintro API Improvement Recommendations

Generated: 2026-01-07

## 📋 Summary

After reviewing the codebase, I've identified improvements in three areas:
1. **Postman Collection Updates** - Outdated request bodies and missing endpoints
2. **Function Improvements** - Performance and feature enhancements
3. **New Helpful Endpoints** - Missing functionality that would help frontend

---

## 🔧 1. POSTMAN COLLECTION UPDATES NEEDED

### A. Fix Outdated Request Bodies

| Endpoint | Current Problem | Fix |
|----------|-----------------|-----|
| `Auto Categorize Transactions` | Body: `{"apply_rules": true, "use_ai": true}` (unused) | Body: `{}` or `{"transaction_ids": [...]}` |
| `Get Uncategorized Transactions` | Body: `{"limit": 50}` as POST | Should be GET with query params |
| `Categorize Transaction` | Body has `category`, `subcategory` | Should use `category_id` |

### B. Missing Endpoints in Postman

| Endpoint | Purpose |
|----------|---------|
| `bulk-categorize-transactions` | Categorize multiple at once |
| `test-categorization-rule` | Preview rule matches |
| `analyze-suggest-categories` | AI category suggestions |
| `get-category-breakdown` | Spending analytics |

### C. Incorrect HTTP Methods

| Endpoint | Current | Should Be |
|----------|---------|-----------|
| `get-uncategorized-transactions` | POST | GET |
| `get-categorized-transactions` | GET ✅ | Correct |
| `list-expense-categories` | GET ✅ | Correct |

---

## 🚀 2. FUNCTION IMPROVEMENTS

### A. `get-uncategorized-transactions` - Performance Issue ⚠️

**Problem:** Makes 2 DB queries (one to get categorized IDs, another to filter).

**Current approach:**
```typescript
// Query 1: Get all categorized transaction IDs
const { data: categorizedIds } = await supabaseClient
  .from("transaction_categorizations")
  .select("transaction_id");

// Query 2: Get transactions NOT in that list
query = query.not("id", "in", `(${categorizedTransactionIds.join(",")})`);
```

**Better approach:** Use a LEFT JOIN with NULL check or NOT EXISTS subquery.

### B. `get-dashboard-summary` - Missing Categorization Stats

**Improvement:** Add categorization stats to dashboard:
```javascript
categorization_stats: {
  total_transactions: 500,
  categorized: 450,
  uncategorized: 50,
  categorization_rate: 90.0,
  rule_categorized: 300,
  ai_categorized: 100,
  manual_categorized: 50
}
```

### C. `categorize-transaction` - Missing Category Name in Response

**Problem:** Returns only `category_id`, frontend has to look up name.

**Fix:** Include category details in response:
```javascript
categorization: {
  id: "...",
  category: {
    id: "...",
    name: "Materials",
    color: "#4CAF50",
    icon: "package"
  }
}
```

### D. `auto-categorize-transactions` - Missing Progress for Large Batches

**Improvement:** For large categorization jobs, return progress info:
```javascript
{
  success: true,
  categorized: 85,
  total_processed: 100,
  skipped: 15,
  processing_time_ms: 3500,
  breakdown: { ... }
}
```

---

## ✨ 3. NEW HELPFUL ENDPOINTS FOR FRONTEND

### A. `get-categorization-summary` (NEW)

Quick stats for categorization UI:
```javascript
// GET /functions/v1/get-categorization-summary
{
  total_transactions: 500,
  categorized: 450,
  uncategorized: 50,
  categories_used: 8,
  top_categories: [
    { name: "Materials", count: 150, total_amount: 45000 },
    { name: "Labor", count: 100, total_amount: 32000 }
  ],
  rules_count: 12,
  rules_effectiveness: 0.65  // 65% of categorizations via rules
}
```

### B. `get-recent-categorizations` (NEW)

For showing recent activity:
```javascript
// GET /functions/v1/get-recent-categorizations?limit=10
{
  categorizations: [
    {
      transaction: { name: "Home Depot", amount: -250 },
      category: { name: "Materials", color: "#4CAF50" },
      method: "ai",
      confidence: 0.92,
      categorized_at: "2026-01-07T10:00:00Z"
    }
  ]
}
```

### C. `suggest-rules-from-patterns` (NEW)

AI suggests rules based on user's categorization patterns:
```javascript
// POST /functions/v1/suggest-rules-from-patterns
{
  suggestions: [
    {
      pattern: "home depot",
      suggested_category: "Materials",
      confidence: 0.95,
      matching_transactions: 15,
      reason: "You've categorized 15 Home Depot transactions as Materials"
    }
  ]
}
```

### D. `batch-operations` Status Endpoint (NEW)

For tracking long-running operations:
```javascript
// GET /functions/v1/batch-status?operation_id=xxx
{
  operation_id: "xxx",
  type: "auto_categorize",
  status: "in_progress",
  progress: { processed: 45, total: 100, percentage: 45 },
  started_at: "...",
  estimated_completion: "..."
}
```

---

## 📊 4. PRIORITY RANKING

### High Priority (Do First)
1. ✅ Fix `expense_categories` ambiguous relationships (DONE)
2. ⬜ Update Postman collection with correct request bodies
3. ⬜ Add `get-categorization-summary` endpoint
4. ⬜ Improve `categorize-transaction` response with category details

### Medium Priority
5. ⬜ Add `bulk-categorize-transactions` to Postman
6. ⬜ Add categorization stats to dashboard
7. ⬜ Optimize `get-uncategorized-transactions` query
8. ⬜ Add `get-recent-categorizations` endpoint

### Lower Priority (Nice to Have)
9. ⬜ Add `suggest-rules-from-patterns` AI endpoint
10. ⬜ Add batch operation status tracking
11. ⬜ Add processing time metrics to responses

---

## 🛠️ IMPLEMENTATION ORDER

Would you like me to proceed with implementing these improvements? I recommend starting with:

1. **Update Postman collection** - Quick wins, better developer experience
2. **Add `get-categorization-summary`** - Very helpful for frontend dashboard
3. **Improve existing endpoint responses** - Better data for frontend

Let me know which ones you'd like me to tackle!
