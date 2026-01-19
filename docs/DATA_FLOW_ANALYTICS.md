# Mintro Data Flow & Analytics - Complete Guide

## Overview: The Full Picture

Mintro now syncs **ALL relevant data from QuickBooks** with a single endpoint, giving you **actual costs** for accurate profitability analytics.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        QUICKBOOKS-SYNC-ALL                                       │
│                     (One endpoint does everything!)                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  STEP 1: Chart of Accounts → Expense classification                            │
│  STEP 2: Items → PurchaseCost (actual product costs!)                          │
│  STEP 3: Invoices → Revenue data                                                │
│  STEP 4: Purchases → Actual expenses (checks, CC, cash)                         │
│  STEP 5: Bills → Vendor invoices (accounts payable)                             │
│  STEP 6: Auto-link expenses to invoices via CustomerRef                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          MINTRO DATABASE                                         │
├──────────────────────┬──────────────────────┬───────────────────────────────────┤
│  quickbooks_chart_   │  quickbooks_items    │  quickbooks_expenses              │
│  of_accounts         │                      │                                   │
├──────────────────────┼──────────────────────┼───────────────────────────────────┤
│  • Account types     │  • PurchaseCost ✓    │  • Purchase amounts               │
│  • Classifications   │  • UnitPrice         │  • Bill amounts                   │
│  • Mintro category   │  • Profit margin     │  • CustomerRef (for linking!)     │
└──────────────────────┴──────────────────────┴───────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            INVOICES TABLE                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  • amount (revenue from QB Invoice)                                             │
│  • actual_materials_cost (from QB Expenses OR Item.PurchaseCost)                │
│  • actual_labor_cost (from QB Expenses)                                         │
│  • actual_overhead_cost (from QB Expenses)                                      │
│  • actual_profit = amount - total_actual_cost                                   │
│  • cost_data_source = 'qb_expense_linked' | 'qb_item_cost' | 'chart_of_accounts'│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## How It All Works Together

### The Sync Flow

```
1. CALL: POST /functions/v1/quickbooks-sync-all
   │
   ├── Syncs Chart of Accounts
   │   └── Creates accountMap for expense classification
   │
   ├── Syncs Items
   │   └── Stores PurchaseCost for each product
   │   └── Creates itemCostMap for invoice cost calculation
   │
   ├── Syncs Invoices (REVENUE)
   │   └── For each invoice line item:
   │       ├── Check: Does item have PurchaseCost? → Use it! (BEST)
   │       ├── Check: Does account have classification? → Estimate from it
   │       └── Fallback: Use keywords to estimate
   │
   ├── Syncs Purchases + Bills (ACTUAL COSTS)
   │   └── Stores with CustomerRef for linking
   │
   └── Auto-Links Expenses to Invoices
       └── Matches via CustomerRef
       └── Updates invoice with REAL costs
```

### Cost Data Priority

When calculating costs for an invoice, we use this priority:

| Priority | Source                             | Field               | Accuracy      |
| -------- | ---------------------------------- | ------------------- | ------------- |
| 1        | QB Expenses linked via CustomerRef | `qb_expense_linked` | ⭐⭐⭐⭐ BEST |
| 2        | QB Item.PurchaseCost               | `qb_item_cost`      | ⭐⭐⭐⭐ BEST |
| 3        | Chart of Accounts classification   | `chart_of_accounts` | ⭐⭐⭐ GOOD   |
| 4        | Keyword matching                   | `keyword_fallback`  | ⭐⭐ FAIR     |

---

## Example: Full Data Flow

### Your QuickBooks Data

```
INVOICE #1001 to "John Smith":
├── Line: "Rock Fountain" x1 @ $600 (ItemRef: 42)
├── Line: "Installation Labor" @ $400
└── Total: $1,000

PURCHASE (Expense):
├── Vendor: "Home Depot"
├── Amount: $350
├── CustomerRef: "John Smith" (ID: 12)  ← Links to invoice!

ITEM #42 "Rock Fountain":
├── UnitPrice: $600 (what you charge)
├── PurchaseCost: $280 (what you pay!)  ← ACTUAL COST!

BILL from "Supplies Inc":
├── Amount: $75
├── CustomerRef: "John Smith" (ID: 12)  ← Links to invoice!
```

### After quickbooks-sync-all

```
Invoice #1001 in Mintro:
├── amount: $1,000 (revenue)
├── actual_materials_cost: $280 (from Item.PurchaseCost) + $350 (from Purchase)
├── actual_overhead_cost: $75 (from Bill)
├── total_actual_cost: $705
├── actual_profit: $295 ✅
├── cost_data_source: "qb_expense_linked"
```

---

## The `cost_data_source` Field Explained

Every invoice has a `cost_data_source` that tells you where costs came from:

| Value                | Meaning                                 | What It Means                                  |
| -------------------- | --------------------------------------- | ---------------------------------------------- |
| `qb_expense_linked`  | QB Purchase/Bill linked via CustomerRef | 🎯 BEST - Real costs from your actual expenses |
| `qb_item_cost`       | Item.PurchaseCost used                  | 🎯 BEST - Actual product costs from QB         |
| `chart_of_accounts`  | Estimated from QB account types         | ✅ Good - Based on account classification      |
| `keyword_fallback`   | Guessed from line item descriptions     | ⚠️ Fair - Based on keyword patterns            |
| `estimated`          | Generic estimation                      | ⚠️ Poor - Default percentages                  |
| `blueprint_linked`   | From user-created blueprint             | ✅ Good - Your cost template                   |
| `transaction_linked` | From Plaid bank transaction             | 🎯 BEST - Real bank data                       |

---

## API Endpoints Summary

### Primary: Sync Everything

```
POST /functions/v1/quickbooks-sync-all
```

One call syncs all QB data and links expenses to invoices!

### Individual Endpoints (if needed)

```
POST /functions/v1/quickbooks-sync-chart-of-accounts
POST /functions/v1/quickbooks-sync-invoices
POST /functions/v1/quickbooks-sync-expenses
POST /functions/v1/quickbooks-link-expenses-to-invoices
```

### Analytics

```
POST /functions/v1/get-business-profitability
```

Returns profit analytics using the real cost data!

---

## Database Tables

### quickbooks_expenses

Stores Purchase and Bill entities from QuickBooks.

```sql
id, user_id, quickbooks_expense_id, expense_type,
vendor_name, vendor_id, total_amount, payment_type,
customer_ref_id, customer_ref_name,  -- KEY: Links to invoices!
account_ref_id, account_ref_name,
transaction_date, due_date, line_items, memo,
is_linked_to_invoice, linked_invoice_id
```

### quickbooks_items

Stores Item entities with PurchaseCost.

```sql
id, user_id, quickbooks_item_id, name, sku, description,
item_type, unit_price, purchase_cost,  -- KEY: Actual costs!
profit_margin, qty_on_hand,
income_account_ref, expense_account_ref, asset_account_ref,
is_active
```

### quickbooks_chart_of_accounts

Stores account classifications for expense categorization.

```sql
id, user_id, quickbooks_account_id, name,
account_type, account_sub_type, classification,
mintro_category, is_active
```

---

## How Profit Is Calculated

```typescript
// For each invoice:
profit = invoice.amount - invoice.total_actual_cost

// Where total_actual_cost comes from (in priority order):
1. Linked QB expenses (Purchase + Bill via CustomerRef)
2. Item.PurchaseCost × quantity for line items
3. Chart of Accounts estimation
4. Keyword-based fallback
```

### Expense Logic (Analytics)

**Important:** When calculating total expenses for analytics:

- **Revenue category** = Income (NOT an expense)
- **Everything else** = Expense (including Miscellaneous)

This means:

- `Materials`, `Labor`, `Overhead` → **Expense**
- `Miscellaneous` → **Expense** (we look up the cost and count it)
- `Uncategorized` → **Expense** (counts as expense until categorized)
- Any custom expense category → **Expense**
- Only `Revenue` category → **Income**

The analytics endpoint returns:

- `total_expenses`: Sum of all non-revenue transactions (money out)
- `total_income`: Sum of all revenue transactions (money in)
- `expense_breakdown`: Expenses grouped by category
- `net_profit`: Revenue - Total Expenses

---

## Best Practices

### For Maximum Accuracy:

1. **Tag expenses in QuickBooks!**  
   When recording expenses in QB, assign them to a Customer/Job. This creates the `CustomerRef` that links them to invoices.

2. **Set PurchaseCost on Items!**  
   In QB, make sure your products have both UnitPrice (sale) and PurchaseCost (your cost).

3. **Run sync regularly!**  
   Call `quickbooks-sync-all` daily or after significant QB changes.

4. **Check cost_data_source!**  
   Invoices with `qb_expense_linked` or `qb_item_cost` have the most accurate data.

---

## Troubleshooting

### "Why are my costs still estimated?"

Check the `cost_data_source` field:

- If `keyword_fallback` → The invoice items don't have PurchaseCost AND no expenses are linked
- **Fix**: In QuickBooks, add PurchaseCost to items OR tag expenses with CustomerRef

### "How do I see which expenses are linked?"

```sql
SELECT * FROM quickbooks_expenses
WHERE is_linked_to_invoice = true;
```

### "How do I see items with actual costs?"

```sql
SELECT name, unit_price, purchase_cost, profit_margin
FROM quickbooks_items
WHERE purchase_cost IS NOT NULL;
```
