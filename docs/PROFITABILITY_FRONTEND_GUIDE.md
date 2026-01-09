# Profitability Engine - Frontend Integration Guide

**Last Updated**: January 9, 2026  
**Status**: ✅ All endpoints deployed and ready

---

## Overview

The profitability engine has been refactored to **always calculate profit** using available data. You no longer need blueprints or manual cost entries to see profit calculations.

### Key Changes

| Before | After |
|--------|-------|
| Required blueprints to show profit | Works for ALL invoices |
| Empty results if no cost data | Shows revenue with $0 cost (100% margin) |
| No visibility into data gaps | Clear `data_quality` messages |

---

## Quick Start

### 1. Import Updated Postman Collection

1. Open Postman
2. Click **Import** → Select `mintro_postman_collection.json`
3. Look for the **📊 Analytics & Profitability** folder
4. Set your `ACCESS_TOKEN` variable

### 2. Test the Endpoints

Start with these two to see overall profitability:

```
GET /functions/v1/get-business-profitability?start_date=2025-01-01&end_date=2025-12-31
GET /functions/v1/get-estimated-vs-actual-summary?start_date=2025-01-01&end_date=2025-12-31
```

---

## Endpoints Reference

### 1. Get Business Profitability

**The main profitability dashboard endpoint.**

```
GET /functions/v1/get-business-profitability
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `start_date` | string | No | Start date (YYYY-MM-DD), defaults to Jan 1 of current year |
| `end_date` | string | No | End date (YYYY-MM-DD), defaults to today |

**Response:**
```json
{
  "success": true,
  "period": { "start_date": "2025-01-01", "end_date": "2025-12-31" },
  "overview": {
    "total_revenue": 150000.00,
    "total_expenses": 90000.00,
    "net_profit": 60000.00,
    "profit_margin": 40.00
  },
  "job_metrics": {
    "total_invoices": 45,
    "invoices_with_cost_data": 40,
    "invoices_with_transaction_costs": 35,
    "invoices_with_blueprint_estimates": 20,
    "total_job_costs": 78000.00,
    "total_job_profit": 47000.00,
    "average_job_profit": 1175.00,
    "average_job_margin": 37.60
  },
  "service_type_breakdown": [
    { "service_type": "Kitchen Remodel", "revenue": 50000, "cost": 32000, "profit": 18000, "profit_margin": 36.00 }
  ],
  "month_over_month": {
    "current_month_revenue": 15000.00,
    "last_month_revenue": 13500.00,
    "revenue_change_percent": 11.11,
    "trend": "up"
  },
  "data_quality": {
    "message": "40 of 45 invoices have cost data.",
    "invoices_missing_cost_data": 5
  }
}
```

**Frontend Usage:**
- `overview` → Dashboard KPIs cards
- `job_metrics` → Job performance section
- `service_type_breakdown` → Pie/bar chart by service
- `month_over_month` → Trend indicator with arrow up/down
- `data_quality.message` → Show as info banner if `invoices_missing_cost_data > 0`

---

### 2. Get Estimated vs Actual Summary (NEW)

**Compare blueprint estimates to actual costs across all jobs.**

```
GET /functions/v1/get-estimated-vs-actual-summary
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `start_date` | string | No | Start date (YYYY-MM-DD) |
| `end_date` | string | No | End date (YYYY-MM-DD) |

**Response:**
```json
{
  "success": true,
  "period": { "start_date": "2025-01-01", "end_date": "2025-12-31" },
  "summary": {
    "total_invoices": 45,
    "total_revenue": 150000.00,
    "total_estimated_cost": 80000.00,
    "total_actual_cost": 82000.00,
    "net_cost_variance": 2000.00,
    "avg_variance_percent": 2.50,
    "jobs_with_estimates": 20,
    "jobs_under_budget": 12,
    "jobs_over_budget": 5,
    "jobs_on_budget": 3
  },
  "performance_status": "over_budget",
  "message": "Tracking 2000.00 over budget across 20 estimated jobs."
}
```

**Frontend Usage:**
- `summary.net_cost_variance` → Main variance display (negative = good, positive = bad)
- `performance_status` → Color indicator (green for "under_budget", red for "over_budget")
- `jobs_under_budget` / `jobs_over_budget` → Pie chart or stats
- `message` → Summary text display

**Note:** This only includes jobs that have blueprint estimates attached. Jobs without blueprints are not included in variance calculation.

---

### 3. Get Invoice Profit Breakdown

**Detailed breakdown for a single invoice.**

```
GET /functions/v1/get-invoice-profit-breakdown?invoice_id={uuid}
```

**Response:**
```json
{
  "success": true,
  "invoice": { "id": "uuid", "invoice_number": "INV-001", "client": "ABC Corp", "amount": 5000.00 },
  "blueprints": [{ "id": "bp-1", "name": "Kitchen Standard", "type": "service" }],
  "costs": {
    "from_transactions": { "total": 3200.00, "transaction_count": 5 },
    "estimated": { "materials": 1500, "labor": 1200, "overhead": 300, "total": 3000.00 },
    "actual": { "materials": 1600, "labor": 1300, "overhead": 300, "total": 3200.00 },
    "effective": { "amount": 3200.00, "source": "linked_transactions" },
    "variance": { "materials": 100, "labor": 100, "overhead": 0, "total": 200.00 }
  },
  "profit": {
    "calculated": 1800.00,
    "estimated": 2000.00,
    "variance": -200.00,
    "margin": 36.00
  },
  "linked_expenses": [
    { "id": "exp-1", "amount": 1600.00, "date": "2025-11-10", "vendor": "Home Depot", "category": "Materials" }
  ],
  "data_sources": {
    "has_linked_transactions": true,
    "has_blueprints": true,
    "has_manual_override": false,
    "cost_source": "linked_transactions"
  },
  "data_quality": { "message": "Costs calculated from linked transactions." }
}
```

**Frontend Usage:**
- `costs.effective` → The cost actually used for profit calculation
- `costs.effective.source` → Show badge: "From Transactions" / "From Blueprint" / "Manual Override"
- `costs.variance` → Show variance per category (red if positive, green if negative)
- `linked_expenses` → Table of linked bank transactions
- `profit.margin` → Display as percentage

---

### 4. Get Profit Trends

**Historical profit over time.**

```
GET /functions/v1/get-profit-trends?period=monthly&months=12
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `period` | string | No | `monthly`, `quarterly`, or `yearly` |
| `months` | number | No | Number of months to analyze (default: 12) |

**Response:**
```json
{
  "success": true,
  "period_type": "monthly",
  "months_analyzed": 12,
  "trends": [
    {
      "period": "2025-01",
      "revenue": 15000.00,
      "expenses": 9000.00,
      "job_costs": 8500.00,
      "job_profit": 6500.00,
      "net_profit": 6000.00,
      "job_profit_margin": 43.33,
      "invoice_count": 5,
      "invoices_with_cost_data": 4
    }
  ],
  "growth_rates": [
    { "period": "2025-02", "revenue_growth": 8.5, "job_profit_growth": 12.0 }
  ],
  "summary": {
    "total_revenue": 150000.00,
    "total_job_profit": 65000.00,
    "trend_direction": "growing",
    "total_invoices": 45,
    "invoices_with_cost_data": 40
  },
  "data_quality": {
    "message": "40 of 45 invoices have cost data for accurate trend analysis.",
    "cost_data_coverage": 88.89
  }
}
```

**Frontend Usage:**
- `trends` → Line chart with revenue/profit over time
- `growth_rates` → Show growth % badges
- `summary.trend_direction` → Show "📈 Growing" / "📉 Declining" / "➡️ Stable"

---

### 5. Get Margin Analysis

**Analyze margins by service type, blueprint, find low/high margin jobs.**

```
GET /functions/v1/get-margin-analysis?start_date=2025-01-01&end_date=2025-12-31&min_margin=20
```

**Response includes:**
- `by_service_type` → Margin breakdown per service type
- `by_blueprint_type` → Margin breakdown per blueprint type
- `low_margin_jobs` → List of jobs below threshold (for alerts)
- `high_margin_jobs` → Best performing jobs
- `summary` → Aggregate stats

**Frontend Usage:**
- Build a table/chart showing which service types are most profitable
- Highlight low-margin jobs in red
- Use for "Profitability by Service" report

---

### 6. Get Margin Alerts

**Proactive alerts for margin issues.**

```
GET /functions/v1/get-margin-alerts?margin_threshold=20&cost_spike_threshold=25&days_back=30
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_alerts": 5,
    "low_margin_jobs_count": 2,
    "negative_jobs_count": 1,
    "cost_spikes_count": 2,
    "total_revenue_lost": 1500.00
  },
  "alerts": {
    "low_margin_jobs": [{ "invoice_id": "...", "margin": 15.5 }],
    "negative_profit_jobs": [{ "invoice_id": "...", "loss": 500 }],
    "cost_spikes": [{ "invoice_id": "...", "variance_percent": 30.0 }],
    "missing_cost_data": [{ "invoice_id": "...", "message": "No cost data" }]
  },
  "recommendations": [
    "⚠️ You have jobs losing money. Review pricing strategy immediately."
  ]
}
```

**Frontend Usage:**
- `summary.total_alerts` → Badge count on dashboard
- `alerts.*` → Expandable alert lists
- `recommendations` → Show as action items
- `missing_cost_data` → Prompt user to link transactions

---

## How Cost Calculation Works

The engine uses this priority to determine costs:

```
1. Manual Override    → If user manually set costs, use those
       ↓
2. Linked Transactions → Sum of bank transactions linked to invoice
       ↓
3. Stored Actual Cost  → If total_actual_cost exists in DB
       ↓
4. Zero               → No cost data, profit = revenue (100% margin)
```

Every response includes `data_sources` showing what was used:

```json
"data_sources": {
  "has_linked_transactions": true,
  "has_blueprints": true,
  "has_manual_override": false,
  "cost_source": "linked_transactions"
}
```

---

## UI Recommendations

### Show Data Quality

When `invoices_missing_cost_data > 0`, show an info banner:

```
ℹ️ 5 invoices don't have cost data. Link bank transactions for accurate profit tracking.
[Link Transactions →]
```

### Indicate Cost Source

Show a small badge or tooltip indicating where costs came from:

| Source | Badge |
|--------|-------|
| `linked_transactions` | 🏦 From Transactions |
| `blueprint_estimate` | 📐 Estimated |
| `manual_override` | ✏️ Manual Entry |
| `none` | ⚠️ No Cost Data |

### Handle Empty States

If no invoices exist yet:
```
No profitability data yet. Create invoices and link bank transactions to start tracking profit.
```

---

## Testing Flow

1. **Create an invoice** via `create-invoice`
2. **Connect bank** via Plaid flow
3. **Link transactions** to invoice via `link-transaction-to-job` or during invoice creation
4. **View profit** via `get-business-profitability` or `get-invoice-profit-breakdown`
5. **Compare to estimates** via `get-estimated-vs-actual-summary` (if using blueprints)

---

## Questions?

Check the Postman collection `mintro_postman_collection.json` for full request/response examples including error cases.
