# Database Redundancy Removal - Computed Profit Column

## Date: 2026-01-22

## Problem: Data Redundancy

We had redundant data being stored in the `invoices` table:

```sql
-- BEFORE (Redundant):
invoices (
  amount NUMERIC,                    -- Revenue
  total_actual_cost NUMERIC,         -- Total costs
  actual_profit NUMERIC,             -- ← REDUNDANT: always = amount - total_actual_cost
  actual_materials_cost NUMERIC,
  actual_labor_cost NUMERIC,
  actual_overhead_cost NUMERIC
)
```

### Issues with this approach:

1. **Redundancy**: `actual_profit` is always computed as `amount - total_actual_cost`
2. **Data Sync Risk**: If `total_actual_cost` updates but `actual_profit` doesn't, data becomes stale
3. **Code Complexity**: Every function that updates costs must also recalculate profit
4. **Bug Surface**: More places to forget to update = more potential bugs

## Solution: Generated Column

We converted `actual_profit` to a **database-computed column**:

```sql
-- AFTER (Non-redundant):
ALTER TABLE invoices
ADD COLUMN actual_profit NUMERIC GENERATED ALWAYS AS (
    CASE
        WHEN total_actual_cost IS NOT NULL THEN amount - total_actual_cost
        ELSE NULL
    END
) STORED;
```

### Benefits:

✅ **Single Source of Truth**: The database automatically computes profit  
✅ **Always Accurate**: Profit updates instantly when `amount` or `total_actual_cost` changes  
✅ **Less Code**: Functions no longer need to calculate and update profit manually  
✅ **Fewer Bugs**: Can't forget to update profit - it's automatic

## Changes Made

### 1. Migration

Created: `/supabase/migrations/202601221400 00_make_actual_profit_computed.sql`

### 2. Updated Functions

Removed `actual_profit` writes from:

- ✅ `update-invoice/index.ts` (2 places)
- ✅ `create-invoice/index.ts`
- ✅ `link-transaction-to-job/index.ts` (2 places)
- ✅ `quickbooks-sync-all/index.ts` (2 places)
- ✅ `quickbooks-link-expenses-to-invoices/index.ts`

All functions now:

- ✅ **Write** only to `total_actual_cost`
- ✅ **Read** `actual_profit` from the database (already computed)

## The Pizza Shop Analogy 🍕

### Before (Redundant):

```
PIZZA SOLD: $20
├── Dough cost: $3
├── Cheese cost: $4
├── Toppings cost: $3
├── Total cost: $10          ← (3+4+3)
├── Profit: $10              ← (20 - 10) REDUNDANT!
```

### After (Computed):

```
PIZZA SOLD: $20
├── Dough cost: $3
├── Cheese cost: $4
├── Toppings cost: $3
└── Total cost: $10

Profit = $20 - $10 = $10  ← Calculated on-the-fly, not stored
```

## Testing

To verify the changes work:

```bash
# 1. Run migration
supabase db reset

# 2. Create or update an invoice with costs
# The profit should auto-calculate

# 3. Update the costs
# The profit should auto-update
```

## Code Examples

### Before (Manual Calculation):

```typescript
const totalCost = materialsC cost + laborCost + overheadCost;
const profit = amount - totalCost;

await supabase.from("invoices").update({
  total_actual_cost: totalCost,
  actual_profit: profit,  // ← Had to manually calculate and write
});
```

### After (Automatic):

```typescript
const totalCost = materialsCost + laborCost + overheadCost;

await supabase.from("invoices").update({
  total_actual_cost: totalCost,
  // actual_profit computed automatically by database
});
```

## Notes

- **All `SELECT` queries still work** - `actual_profit` is still a column, it's just computed
- **The value is STORED** - so reads are fast (not computed on every query)
- **Lint errors** about Deno modules are pre-existing, not related to these changes
- functions that only READ `actual_profit` (like `get-business-profitability`) need no changes

## Related Docs

- Migration: `/supabase/migrations/20260122140000_make_actual_profit_computed.sql`
- Data Flow: `/docs/DATA_FLOW_ANALYTICS.md`
- Profitability Engine: `/docs/PROFITABILITY_ENGINE_REFACTOR.md`
