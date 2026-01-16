# How Estimates Work in Mintro

This document explains the complete estimation and profitability calculation system in Mintro.

## Overview

Mintro tracks profitability by comparing **revenue** (what you charge) against **costs** (what you spend). There are multiple ways costs can be determined, each with different levels of accuracy.

## Cost Data Sources

The `cost_data_source` field indicates WHERE the cost data came from:

| Source | Accuracy | Description |
|--------|----------|-------------|
| `null` | N/A | No cost data exists yet |
| `estimated` | ⚠️ Low | Auto-guessed from QuickBooks line items |
| `user_verified` | ✅ Good | User manually entered/verified costs |
| `blueprint_linked` | ✅ Good | Calculated from linked cost blueprints |
| `transaction_linked` | ⭐ Best | Actual bank transactions linked to invoice |

---

## 1. Blueprint-Based Estimates

### What are Blueprints?
Cost blueprints are reusable templates that define expected costs for common jobs/services.

### How They Work
```
Blueprint: "Standard Kitchen Remodel"
├── estimated_materials_cost: $2,000
├── estimated_labor_cost: $1,500
├── estimated_overhead_cost: $500
├── total_estimated_cost: $4,000
├── target_sale_price: $7,500
└── target_profit_margin: 46.7%
```

### When Used
- Creating invoices with `blueprint_ids` parameter
- Provides **estimated** costs based on your defined templates
- Can be overridden with `blueprint_usages` for specific variations

### Example API Call
```json
POST /functions/v1/create-invoice
{
  "client": "John Smith",
  "blueprint_ids": ["bp-kitchen-123"],
  "auto_calculate_from_blueprints": true
}
```

### Result
- `amount` = Sum of blueprint target_sale_prices
- `total_actual_cost` = Sum of blueprint total_estimated_costs
- `cost_data_source` = "blueprint_linked"

---

## 2. Transaction-Based Actuals

### What are Linked Transactions?
Real bank transactions (from Plaid) that represent actual money spent on a job.

### How They Work
```
Invoice: INV-001 (Kitchen Remodel - $7,500)
├── Linked Transaction: Home Depot → $-1,200 (cabinets)
├── Linked Transaction: Lowes → $-800 (materials)
└── Linked Transaction: Subcontractor → $-2,000 (labor)
Total Actual Cost: $4,000
Actual Profit: $3,500
```

### When Used
- When user manually links transactions to invoices
- Most accurate because it uses REAL bank data
- Can be partial allocations (e.g., 50% of a transaction)

### Example API Call
```json
POST /functions/v1/link-transaction-to-job
{
  "transaction_id": "tx-123",
  "invoice_id": "inv-456",
  "allocation_percentage": 100
}
```

### Result
- `total_actual_cost` = Sum of all allocated transaction amounts
- `cost_data_source` = "transaction_linked"

---

## 3. QuickBooks Cost Classification

### The Challenge
QuickBooks invoices contain **sale prices**, not actual costs. When you sync invoices, Mintro needs to estimate what your costs were.

### The Solution: Chart of Accounts Classification

QuickBooks has a **Chart of Accounts** where every line item references an account with an `AccountType`. We use this for proper classification:

| QB AccountType | Mintro Category | Maps To | In Cost Calc? |
|----------------|-----------------|---------|---------------|
| `Cost of Goods Sold` | `cogs` | `actual_materials_cost` | ✅ Yes (60% estimate) |
| `Expense` | `expense` | `actual_labor_cost` | ✅ Yes (40% estimate) |
| `Other Expense` | `expense` | `actual_overhead_cost` | ✅ Yes (40% estimate) |
| `Income` | `revenue` | `amount` (revenue) | ✅ Minimal (15%) |
| `Other Income` | `revenue` | `amount` | ✅ Minimal (15%) |
| `Bank` | `transfer` | — | ❌ **Excluded** |
| `Credit Card` | `transfer` | — | ❌ **Excluded** |
| `Loan` | `exclude` | — | ❌ **Excluded** |
| `Equity` | `exclude` | — | ❌ **Excluded** |

### The Workflow

**Step 1: Sync Chart of Accounts (do this first!)**
```json
POST /functions/v1/quickbooks-sync-chart-of-accounts

Response:
{
  "success": true,
  "synced": 45,
  "category_breakdown": {
    "expense": 12,    // Real P&L expenses → costs
    "cogs": 5,        // Cost of goods → materials
    "revenue": 8,     // Income → revenue
    "transfer": 4,    // Bank/CC → EXCLUDED
    "exclude": 10     // Loan/Equity → EXCLUDED
  }
}
```

**Step 2: Sync Invoices**
```json
POST /functions/v1/quickbooks-sync-invoices

// Now line items are classified using Chart of Accounts:
// - "Rock Fountain" (COGS account) → actual_materials_cost
// - "Design Fee" (Income account) → revenue
// - "CC Payment" (Credit Card account) → IGNORED
```

### Example Calculation

```
QuickBooks Invoice: $1,000
├── "Custom Rock Fountain" $600 (COGS account)
│   └── Materials cost: $600 × 0.60 = $360
├── "Design & Installation" $400 (Income account)
│   └── Labor cost: $400 × 0.15 = $60
└── Overhead: ($360 + $60) × 0.10 = $42

Mintro Invoice:
├── amount: $1,000 (revenue)
├── actual_materials_cost: $360
├── actual_labor_cost: $60
├── actual_overhead_cost: $42
├── total_actual_cost: $462
├── actual_profit: $538
└── cost_data_source: "estimated"
```

### Fallback: Keyword Matching

If an account mapping is not found (Chart of Accounts not synced), we fall back to keyword matching:

| Keywords | Type | Cost Estimate |
|----------|------|---------------|
| fountain, pump, soil, plants | Product | 55% of sale |
| design, installation, labor | Service | 35% of sale |
| Other | Generic | 40% of sale |

### Important Notes

- **Sync Chart of Accounts first** - Without it, you'll only get keyword fallback
- **Transfers are excluded** - Bank transfers, CC payments, loan payments don't count as costs
- **Estimates need verification** - `cost_data_source` = "estimated" until user confirms

---

## 4. User-Verified Costs

### When to Use
- After reviewing QuickBooks estimated costs
- When entering costs manually
- When you have receipts/records to confirm exact amounts

### How to Verify
```json
POST /functions/v1/update-invoice-actuals
{
  "invoice_id": "inv-123",
  "actual_materials_cost": 350,
  "actual_labor_cost": 150,
  "actual_overhead_cost": 50,
  "cost_override_reason": "Verified from receipts"
}
```

### Result
- Costs updated with user-provided values
- `cost_data_source` changes from `"estimated"` to `"user_verified"`
- Override history is recorded in `invoice_cost_overrides` table

---

## Frontend Implementation Guide

### Visual Indicators

```javascript
function getCostBadge(invoice) {
  switch (invoice.cost_data_source) {
    case null:
      return { 
        icon: "⚪", 
        text: "No cost data", 
        color: "gray",
        action: "Add costs to track profit"
      };
    case "estimated":
      return { 
        icon: "⚠️", 
        text: "Estimated", 
        color: "yellow",
        action: "Click to verify costs"
      };
    case "user_verified":
      return { 
        icon: "✓", 
        text: "Verified", 
        color: "green",
        action: null
      };
    case "blueprint_linked":
      return { 
        icon: "📋", 
        text: "From Blueprint", 
        color: "blue",
        action: null
      };
    case "transaction_linked":
      return { 
        icon: "🏦", 
        text: "Actual Expenses", 
        color: "green",
        action: null
      };
  }
}
```

### Profit Display Logic

```javascript
function formatProfit(invoice) {
  if (!invoice.actual_profit) {
    return "—"; // No profit data
  }
  
  if (invoice.cost_data_source === "estimated") {
    return `~$${invoice.actual_profit.toFixed(2)}`; // Tilde for estimates
  }
  
  return `$${invoice.actual_profit.toFixed(2)}`; // Exact for verified
}
```

### Dashboard Filtering

```javascript
// Show invoices that need attention
const needsVerification = invoices.filter(inv => 
  inv.cost_data_source === "estimated" ||
  inv.cost_data_source === null
);

// Show reliable profit data only
const verifiedProfits = invoices.filter(inv =>
  ["user_verified", "blueprint_linked", "transaction_linked"]
    .includes(inv.cost_data_source)
);
```

---

## Accuracy Hierarchy

When calculating business-wide profitability, weight data by source:

```
Most Accurate ──────────────────────────────► Least Accurate

transaction_linked > blueprint_linked > user_verified > estimated
      ⭐⭐⭐⭐              ⭐⭐⭐             ⭐⭐⭐           ⭐
```

### Recommendations

1. **For financial reports**: Only include `transaction_linked` and `user_verified` data
2. **For forecasting**: Include `blueprint_linked` estimates
3. **For dashboards**: Show all, but clearly mark `estimated` data
4. **For profitability alerts**: Ignore `estimated` data to avoid false positives

---

## Service Type Auto-Detection

When syncing from QuickBooks, Mintro also attempts to detect the `service_type`:

| Detected Keywords | Service Type |
|-------------------|--------------|
| design, custom design | Design |
| installation, install | Installation |
| landscaping, gardening, garden | Landscaping |
| pest control, pest | Pest Control |
| maintenance, trimming, mowing | Maintenance |
| fountain, pump, rocks, sod, plants | Products |
| services, labor, hours | Services |

This is determined by analyzing line item names, descriptions, and account references.

---

## Summary

| Need | Use This |
|------|----------|
| Quick estimate for new job | Create with blueprints |
| Accurate profit tracking | Link bank transactions |
| Import from QuickBooks | Sync, then verify estimates |
| Manual cost entry | update-invoice-actuals |
| View reliability | Check cost_data_source field |
