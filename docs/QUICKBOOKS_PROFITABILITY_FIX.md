# QuickBooks Profitability Fix

## The Problem

The original implementation had several issues with profit calculation:

1. **Empty QB Data Tables**: `quickbooks_items`, `quickbooks_chart_of_accounts`, and `quickbooks_expenses` were all empty (0 rows)

2. **Cost Estimation Was Guesswork**: The sync functions used arbitrary percentages (60%, 40%, 15%) to estimate costs from revenue - this is fundamentally wrong

3. **P&L Approach Doesn't Work for Job Costing**: The P&L report gives aggregate numbers, not per-invoice costs. You can't use it to calculate profit per job.

4. **Missing Item.PurchaseCost**: QuickBooks Items have a `PurchaseCost` field that tells you the actual cost of each product/service - this was not being used

5. **Column Name Bug**: The old sync functions used `quickbooks_invoice_id` but the actual column is `quickbooks_id` - this caused silent failures

## The Solution

### New Function: `quickbooks-full-sync`

A comprehensive sync that properly calculates profit:

1. **Sync Items FIRST** - Gets actual `PurchaseCost` per item from QuickBooks
2. **Sync Chart of Accounts** - For expense classification
3. **Sync Invoices** - Revenue with line items
4. **Calculate REAL costs** using `Item.PurchaseCost × Quantity`
5. **Sync Purchases/Bills** - Direct expenses that can be linked to customers

### Key Insight

QuickBooks Items have two key fields:
- `UnitPrice` - What you charge customers
- `PurchaseCost` - What you pay (your cost)

Invoice line items reference these Items, so we can calculate ACTUAL cost per invoice:

```
Invoice Line Item → References Item ID → Look up PurchaseCost → Cost = PurchaseCost × Quantity
```

### Updated Functions

| Function | Purpose | Status |
|----------|---------|--------|
| `quickbooks-full-sync` | Comprehensive sync with real cost calculation | ✅ Deployed |
| `get-accurate-profitability` | Returns profit with data quality indicators | ✅ Deployed |
| `get-business-profitability` | Updated to use cost_data_source for quality | ✅ Deployed |
| `quickbooks-sync-invoices` | Fixed column name bug (quickbooks_id) | ✅ Deployed |

## How to Use

### 1. Run Full Sync

```bash
# Call the new full sync endpoint
POST /functions/v1/quickbooks-full-sync
Authorization: Bearer <user_token>
```

This will:
- Sync all Items with their PurchaseCost
- Sync Chart of Accounts
- Sync Invoices with calculated costs
- Sync Purchases and Bills

### 2. Check Profitability

```bash
# Get accurate profitability data
GET /functions/v1/get-accurate-profitability?start_date=2026-01-01&end_date=2026-12-31
Authorization: Bearer <user_token>

# Or use the updated business profitability endpoint
GET /functions/v1/get-business-profitability?start_date=2026-01-01&end_date=2026-12-31
Authorization: Bearer <user_token>
```

### 3. Improve Data Quality

If many items don't have `PurchaseCost` set in QuickBooks:

1. Go to QuickBooks → Products and Services
2. Edit each item and add the "Cost" field
3. Re-run `quickbooks-full-sync`

## Cost Data Sources (Priority Order)

| Source | Quality | Description |
|--------|---------|-------------|
| `qb_item_cost` | Excellent | Real cost from QuickBooks Item.PurchaseCost |
| `qb_expense_linked` | Excellent | Real cost from linked QuickBooks expenses |
| `user_verified` | Good | Manually verified by user |
| `transaction_linked` | Good | Cost from linked bank transactions |
| `blueprint_linked` | Fair | Estimated from cost blueprint |
| `chart_of_accounts` | Fair | Estimated from account type |
| `estimated` | Poor | Rough estimate based on industry averages |

## Database State

Current state (as of last check):
- `quickbooks_items`: 0 rows (needs `quickbooks-full-sync` to populate)
- `quickbooks_chart_of_accounts`: 0 rows (needs `quickbooks-full-sync` to populate)
- `quickbooks_expenses`: 0 rows (needs `quickbooks-full-sync` to populate)
- `invoices`: 69 rows, 31 with `quickbooks_id`, 0 with `cost_data_source = 'qb_item_cost'`

## Frontend Integration

The frontend should:

1. Call `quickbooks-full-sync` when user clicks "Sync QuickBooks"
2. Use `get-accurate-profitability` or `get-business-profitability` for dashboard metrics
3. Show data quality indicators to users (the `data_quality` object in responses)
4. Encourage users to add PurchaseCost in QuickBooks if coverage is low

## Files Modified

- `supabase/functions/quickbooks-full-sync/index.ts` - Comprehensive sync (NEW)
- `supabase/functions/get-accurate-profitability/index.ts` - Accurate profitability endpoint (NEW)
- `supabase/functions/get-business-profitability/index.ts` - Updated with data quality tracking
- `supabase/functions/quickbooks-sync-invoices/index.ts` - Fixed column name bug
- `docs/QUICKBOOKS_PROFITABILITY_FIX.md` - This documentation

## Next Steps

1. **User needs to re-authenticate with QuickBooks** - Both connections show expired tokens
2. **Run `quickbooks-full-sync`** - This will populate the empty tables
3. **Check data quality** - The response will show how many items have PurchaseCost
4. **Add PurchaseCost in QuickBooks** - For items missing cost data
5. **Update frontend** - To call the new endpoints and show data quality indicators
