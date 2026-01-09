# Profitability Engine Refactor

## Date: 2026-01-09

## Problem Statement

The current profitability engine requires blueprints or manual profit edits to run. This means:
- Invoices without blueprints don't show in profit analysis
- `get-margin-analysis` filters out invoices without `total_actual_cost`
- Users must set up blueprints before seeing any profitability data

## New Behavior

The profitability engine should **always calculate profit** using available data:

### Tier 1: Basic Profit (Always Available)
- **Revenue**: Invoice total (`invoices.amount`)
- **Costs**: Sum of linked bank transactions (`transaction_job_allocations.allocation_amount`)
- **Profit**: Revenue - Costs
- **Margin**: (Profit / Revenue) * 100

### Tier 2: Enhanced Profit (When Estimates Exist)
- **Estimated Costs**: From blueprints (`blueprint_usage` → `cost_blueprints`)
- **Variance**: Actual Costs - Estimated Costs
- **Estimated Profit**: Revenue - Estimated Costs
- **Profit Variance**: Actual Profit - Estimated Profit

### Tier 3: Override Profit (When Manual Overrides Exist)
- Manual overrides take precedence over calculated values
- Override history is tracked

## Data Sources for Profit Calculation

```
╭─────────────────────────────────────────────────────────────────────────────╮
│                           PROFIT CALCULATION                                 │
╰─────────────────────────────────────────────────────────────────────────────╯
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
        │    REVENUE    │   │    COSTS      │   │   ESTIMATES   │
        │   (Required)  │   │  (Optional)   │   │  (Optional)   │
        └───────────────┘   └───────────────┘   └───────────────┘
                │                   │                   │
                ▼                   ▼                   ▼
        ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
        │invoices.amount│   │ transaction_  │   │ blueprint_    │
        │               │   │ job_allocations│  │ usage →       │
        │               │   │ .allocation_  │   │ cost_blueprints│
        │               │   │ amount        │   │               │
        └───────────────┘   └───────────────┘   └───────────────┘
```

## Affected Functions

### 1. `get-business-profitability`
**Current**: Only calculates `totalActualProfit` from invoices with `total_actual_cost !== null`
**New**: Calculate profit for ALL invoices using linked transactions

### 2. `get-margin-analysis`
**Current**: Filters `.not("total_actual_cost", "is", null)` - excludes invoices without tracked costs
**New**: Include ALL invoices, calculate costs from linked transactions

### 3. `get-invoice-profit-breakdown`
**Current**: Shows estimated vs actual only when blueprints exist
**New**: Always show actual (from transactions), optionally show estimated (from blueprints)

### 4. `get-profit-trends`
**Current**: Uses `inv.actual_profit` which may be null
**New**: Calculate profit from transactions if `actual_profit` is null

### 5. `get-margin-alerts`
**Current**: Filters `.not("total_actual_cost", "is", null)`
**New**: Include all invoices, use transaction-based costs

## Implementation Steps

1. [x] Create helper function to calculate costs from linked transactions
2. [x] Update `get-business-profitability` to always run
3. [x] Update `get-margin-analysis` to include all invoices
4. [x] Update `get-invoice-profit-breakdown` to prioritize transaction data
5. [x] Update `get-profit-trends` to use calculated profit
6. [x] Update `get-margin-alerts` to include all invoices
7. [ ] Add tests for new behavior (optional)
8. [ ] Deploy updated functions

## Response Format Changes

### Before (requires blueprints)
```json
{
  "profit": {
    "estimated": 1500,
    "actual": 1200,
    "variance": -300
  }
}
```

### After (always works)
```json
{
  "profit": {
    "calculated": 1200,               // Always present: Revenue - Linked Transaction Costs
    "estimated": 1500,                // Optional: From blueprints if available
    "variance": -300,                 // Optional: Only if estimated exists
    "data_sources": {
      "has_linked_transactions": true,
      "has_blueprints": true,
      "has_manual_override": false
    }
  }
}
```
