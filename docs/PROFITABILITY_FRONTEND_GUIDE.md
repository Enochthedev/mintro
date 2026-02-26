# Profitability Endpoints - Frontend Guide

## Quick Reference: Which Endpoint to Use?

| Use Case | Endpoint | When to Use |
|----------|----------|-------------|
| **Official Numbers** | `get-quickbooks-profitability` | Displaying "official" P&L to users, reports |
| **Complete Picture** | `get-combined-profitability` | Dashboard, main profitability view (RECOMMENDED) |
| **Debugging/Comparison** | `get-merged-profitability` | Admin view, understanding discrepancies |
| **Per-Job Analysis** | `get-accurate-profitability` | Invoice list with profit per job |
| **Sync QB Data** | `quickbooks-sync-pnl` | Before displaying QB numbers, refresh button |

---

## 1. 🔵 Get QuickBooks P&L (Pure)

**Endpoint:** `GET /functions/v1/get-quickbooks-profitability`

**What it returns:** Official QuickBooks Profit & Loss report numbers - exactly what the accountant sees.

```typescript
// Response structure
{
  success: true,
  source: "quickbooks_pnl",
  period: { start_date: "2026-01-01", end_date: "2026-12-31" },
  pnl: {
    total_income: 45000.00,      // All revenue from QB
    total_cogs: 18000.00,        // Cost of Goods Sold
    gross_profit: 27000.00,      // income - cogs
    total_expenses: 12000.00,    // Operating expenses
    net_operating_income: 15000.00,
    other_income: 500.00,
    other_expenses: 200.00,
    net_income: 15300.00         // Bottom line profit
  },
  metrics: {
    gross_margin: 60.00,         // (gross_profit / income) * 100
    net_margin: 34.00,           // (net_income / income) * 100
    expense_ratio: 26.67         // (expenses / income) * 100
  },
  last_synced: "2026-01-22T10:30:00Z"
}
```

**Frontend Usage:**
- Display on "Official Reports" page
- Show `last_synced` so users know data freshness
- Add "Refresh" button that calls `quickbooks-sync-pnl`

---

## 2. 🟢 Get Combined Profitability (RECOMMENDED)

**Endpoint:** `GET /functions/v1/get-combined-profitability`

**What it returns:** QB P&L as source of truth + Mintro-only invoices added on top. No double-counting.

```typescript
// Response structure
{
  success: true,
  source: "combined",
  period: { start_date: "2026-01-01", end_date: "2026-12-31" },
  
  // Official QB numbers
  quickbooks_pnl: {
    total_income: 45000.00,
    total_cogs: 18000.00,
    gross_profit: 27000.00,
    total_expenses: 12000.00,
    net_income: 15300.00
  },
  
  // Invoices created in Mintro but NOT synced to QB
  mintro_only_invoices: {
    count: 5,
    total_revenue: 8500.00,
    total_cost: 4200.00,
    total_profit: 4300.00,
    invoices: [
      { id: "uuid", invoice_number: "MINTRO-001", client: "Local Client", amount: 2500.00, cost: 1200.00, profit: 1300.00 }
    ]
  },
  
  // The combined totals (what to display)
  combined_totals: {
    total_revenue: 53500.00,    // QB income + Mintro-only revenue
    total_cost: 34200.00,       // QB cogs+expenses + Mintro-only costs
    total_profit: 19600.00,     // Combined profit
    gross_margin: 36.64
  },
  
  data_sources: {
    qb_pnl_synced: "2026-01-22T10:30:00Z",
    mintro_invoices_included: 5,
    note: "QB P&L is source of truth. Mintro-only invoices added on top."
  }
}
```

**Frontend Usage:**
- Main dashboard profitability widget
- Show `combined_totals` as the primary numbers
- Optionally show breakdown: "QB: $45k + Mintro: $8.5k = $53.5k"

---

## 3. 🟡 Get Merged Profitability (Comparison)

**Endpoint:** `GET /functions/v1/get-merged-profitability`

**What it returns:** Side-by-side comparison of QB official vs Mintro calculated numbers.

```typescript
// Response structure
{
  success: true,
  source: "merged_comparison",
  period: { start_date: "2026-01-01", end_date: "2026-12-31" },
  
  // Official QB P&L
  quickbooks_official: {
    source: "QB P&L Report",
    total_income: 45000.00,
    total_cogs: 18000.00,
    gross_profit: 27000.00,
    total_expenses: 12000.00,
    net_income: 15300.00,
    gross_margin: 60.00
  },
  
  // Mintro's calculation from Item.PurchaseCost
  mintro_calculated: {
    source: "Item.PurchaseCost × Qty",
    total_revenue: 45000.00,
    total_cost: 22500.00,
    total_profit: 22500.00,
    profit_margin: 50.00,
    invoices_with_real_cost: 18,
    total_invoices: 25
  },
  
  // Why they differ
  comparison: {
    revenue_match: true,
    cost_difference: 4500.00,
    profit_difference: -7200.00,
    explanation: "QB COGS only includes items posted to COGS accounts. Mintro calculates from Item.PurchaseCost which may include items not yet in COGS."
  },
  
  recommendation: "Use QB P&L for official reporting. Use Mintro calculated for per-job profitability analysis."
}
```

**Frontend Usage:**
- Admin/debug view
- Help users understand why numbers differ
- Show comparison table with both columns

---

## 4. ⭐ Get Accurate Profitability (Per-Job)

**Endpoint:** `GET /functions/v1/get-accurate-profitability`

**What it returns:** Per-invoice profitability using Item.PurchaseCost × Quantity.

```typescript
// Response structure
{
  success: true,
  period: { start_date: "2026-01-01", end_date: "2026-12-31" },
  
  summary: {
    total_revenue: 45000.00,
    total_cost: 22500.00,
    total_profit: 22500.00,
    profit_margin: 50.00,
    invoice_count: 25
  },
  
  data_quality: {
    level: "good",
    message: "18 of 25 invoices have real cost data from QuickBooks.",
    real_cost_percentage: 72.0,
    by_cost_source: { qb_item_cost: 18, estimated: 5, none: 2 }
  },
  
  // Individual invoice breakdown
  invoices: [
    {
      invoice_id: "uuid",
      invoice_number: "INV-0001",
      client: "Cool Cars",
      financials: { revenue: 2194, cost: 1239.37, profit: 954.63, margin: 43.51 },
      data_quality: { cost_source: "qb_item_cost", quality_level: "excellent", is_real_cost: true }
    }
  ]
}
```

**Frontend Usage:**
- Invoice list with profit column
- Job profitability analysis
- Show `data_quality.cost_source` badge per invoice

---

## 5. 🔄 Sync QuickBooks P&L

**Endpoint:** `POST /functions/v1/quickbooks-sync-pnl`

**What it does:** Fetches latest P&L report from QuickBooks and stores it.

```typescript
// Response structure
{
  success: true,
  message: "P&L report synced successfully",
  period: { start_date: "2026-01-01", end_date: "2026-01-22" },
  pnl_summary: {
    total_income: 45000.00,
    total_cogs: 18000.00,
    gross_profit: 27000.00,
    total_expenses: 12000.00,
    net_income: 15300.00
  }
}
```

**Frontend Usage:**
- "Refresh" button on profitability pages
- Call before displaying QB numbers if `last_synced` is old
- Show loading state during sync

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        QuickBooks                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Invoices   │  │    Items     │  │   P&L Report │          │
│  │  (Revenue)   │  │ (PurchaseCost)│  │  (Official)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼──────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Mintro                                   │
│                                                                  │
│  quickbooks-full-sync          quickbooks-sync-pnl              │
│         │                              │                         │
│         ▼                              ▼                         │
│  ┌──────────────┐              ┌──────────────┐                 │
│  │   invoices   │              │  qb_pnl_data │                 │
│  │ (with costs) │              │  (official)  │                 │
│  └──────┬───────┘              └──────┬───────┘                 │
│         │                              │                         │
│         ▼                              ▼                         │
│  get-accurate-profitability    get-quickbooks-profitability     │
│  (per-job analysis)            (official numbers)               │
│                                        │                         │
│                    ┌───────────────────┴───────────────────┐    │
│                    ▼                                       ▼    │
│           get-combined-profitability          get-merged-profitability
│           (QB + Mintro-only)                  (side-by-side)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recommended Frontend Implementation

### Dashboard Widget
```typescript
// Use get-combined-profitability for main dashboard
const { combined_totals, data_sources } = await fetch('/functions/v1/get-combined-profitability?start_date=2026-01-01&end_date=2026-12-31');

// Display
<Card>
  <h3>Profitability</h3>
  <Stat label="Revenue" value={combined_totals.total_revenue} />
  <Stat label="Costs" value={combined_totals.total_cost} />
  <Stat label="Profit" value={combined_totals.total_profit} />
  <Stat label="Margin" value={`${combined_totals.gross_margin}%`} />
  <small>Last synced: {data_sources.qb_pnl_synced}</small>
</Card>
```

### Invoice List with Profit
```typescript
// Use get-accurate-profitability for invoice list
const { invoices, data_quality } = await fetch('/functions/v1/get-accurate-profitability?start_date=2026-01-01&end_date=2026-12-31');

// Display
<Table>
  {invoices.map(inv => (
    <Row>
      <Cell>{inv.invoice_number}</Cell>
      <Cell>{inv.client}</Cell>
      <Cell>${inv.financials.revenue}</Cell>
      <Cell>${inv.financials.cost}</Cell>
      <Cell>${inv.financials.profit}</Cell>
      <Cell>{inv.financials.margin}%</Cell>
      <Badge variant={inv.data_quality.is_real_cost ? 'success' : 'warning'}>
        {inv.data_quality.cost_source}
      </Badge>
    </Row>
  ))}
</Table>
```

---

## Questions?

The key insight is:
- **QB P&L** = What your accountant sees (official)
- **Mintro calculated** = Per-job profitability using Item.PurchaseCost
- **Combined** = Best of both worlds (QB official + Mintro-only invoices)

Use `get-combined-profitability` for most use cases!
