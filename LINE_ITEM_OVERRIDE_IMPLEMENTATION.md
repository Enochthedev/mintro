# Line Item Cost Override Feature - Implementation Summary

## Overview
This feature adds cost/profit tracking to invoice line items, matching the functionality that blueprints already have. Now users can manually specify the cost breakdown for flat/bundled fees.

## Problem Solved
**Before:** 
- Blueprints had full cost breakdown (materials, labor, overhead, profit) ✅
- Line items only had `qty × unit_price = total` with no cost tracking ❌

**After:**
- Line items can now have manual `override_split` to track cost vs. profit ✅

## Example Use Case
```json
{
  "description": "Website Development - Flat Fee",
  "category": "Revenue",
  "qty": 1,
  "unit_price": 8200,
  "total": 8200,
  "override_split": {
    "income": 5000,  // Profit portion
    "cost": 3200     // Cost portion
  }
}
```

**Result:** 
- Invoice shows $8200 charge to client
- Backend tracks $3200 as cost
- Profit = $5000 automatically calculated

## Database Changes

### Migration Required
Run this SQL migration first:
```sql
-- File: supabase/migrations/add_line_item_cost_override.sql
ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS override_income DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS override_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS is_override BOOLEAN DEFAULT FALSE;
```

### New Columns
- `override_income`: Profit/revenue portion
- `override_cost`: Cost portion 
- `is_override`: Boolean flag indicating manual override exists

**Note:** `override_income + override_cost = qty × unit_price`

## Backend Changes

### 1. **create-invoice** (`supabase/functions/create-invoice/index.ts`)
**Changes:**
- Accepts `override_split` object in line items
- Validates that `override_split.income + override_split.cost` equals the line item total
- Stores `override_income`, `override_cost`, and `is_override` in database
- Updates cost calculation logic to use `override_cost` when present

**Payload Example:**
```json
{
  "client": "ABC Corp",
  "amount": 1500,
  "items": [
    {
      "description": "Website Development - Flat Fee",
      "qty": 1,
      "unit_price": 8200,
      "override_split": {
        "income": 5000,
        "cost": 3200
      }
    },
    {
      "description": "Equipment rental",
      "category": "Expense",
      "qty": 1,
      "unit_price": 500
    }
  ]
}
```

**Response:**
- Invoice amount: $8700
- Total actual cost: $3700 ($3200 from override + $500 from expense item)
- Actual profit: $5000

### 2. **update-invoice** (`supabase/functions/update-invoice/index.ts`)
**Changes:**
- Same validation and storage logic as create-invoice
- Recalculates invoice costs including line item overrides
- Fetches line items and uses `override_cost` when `is_override = true`

### 3. **get-invoice-details** (`supabase/functions/get-invoice-details/index.ts`)
**Changes:**
- Already returns all `invoice_items (*)` columns
- No code changes needed - automatically returns new override columns

### 4. **list-invoices** (`supabase/functions/list-invoices/index.ts`)
**Changes:**
- Already returns all `invoice_items (*)` columns  
- No code changes needed - automatically returns new override columns

## Validation Rules

### Backend Validation
1. **Income + Cost validation**: `override_split.income + override_split.cost` must equal `qty × unit_price` (±0.01 for floating point)
2. **Both fields required**: If `override_split` is provided, both `income` and `cost` must be present
3. **Non-negative**: Both values should be >= 0

### Example Error Response
```json
{
  "error": "Invalid override_split for \"Website Development\": income + cost (8500) must equal item total (8200)",
  "details": {
    "item_description": "Website Development",
    "item_total": 8200,
    "override_income": 5000,
    "override_cost": 3500
  }
}
```

## Cost Calculation Logic

### Without Override
```
Line Item Category = "Revenue" → Adds to revenue, excludes from cost
Line Item Category = "Expense" → Adds to revenue AND cost
```

### With Override
```
override_income → Adds to revenue
override_cost → Adds to cost
Profit = override_income - override_cost
```

### Total Invoice Cost
```
total_actual_cost = 
  blueprint_costs + 
  transaction_costs + 
  line_item_override_costs + 
  expense_line_items (without override)
```

## Frontend Implementation Needed

### 1. UI Modal for Override Split
Create a modal to capture cost breakdown:
- Display: Total price (qty × unit_price, read-only)
- Input: Income/Profit (user enters)
- Input: Cost (user enters)
- Validation: Income + Cost must equal total price

### 2. Line Item Display
Show override indicator on line items with manual splits:
```
✓ Website Development - $8200 [Override: $3200 cost, $5000 profit]
```

### 3. Invoice Summary
Display breakdown:
```
Revenue from Blueprints: $5000
Revenue from Line Items: $1500
  - With Override: $1000 (cost: $700)
  - Expenses: $500
Total Revenue: $6500
Total Cost: $6200
Profit: $300
```

## API Usage Examples

### Create Invoice with Override
```bash
POST /create-invoice
{
  "client": "Tech Startup Inc",
  "items": [
    {
      "description": "Website Development - Flat Fee",
      "qty": 1,
      "unit_price": 8200,
      "override_split": {
        "income": 5000,
        "cost": 3200
      }
    }
  ]
}
```

### Update Invoice with Override
```bash
POST /update-invoice
{
  "invoice_id": "uuid-here",
  "items": [
    {
      "description": "Updated website development",
      "qty": 1,
      "unit_price": 9500,
      "override_split": {
        "income": 6000,
        "cost": 3500
      }
    }
  ]
}
```

## Deployment Checklist

- [x] Create migration file
- [ ] Run migration on database: `supabase migration up`
- [x] Update `create-invoice` function
- [x] Update `update-invoice` function
- [x] Verify `get-invoice-details` returns override data
- [x] Verify `list-invoices` returns override data
- [ ] Deploy functions to Supabase
- [ ] Update Postman collection with examples
- [ ] Frontend: Create override modal UI
- [ ] Frontend: Update line item display
- [ ] Frontend: Update invoice summary calculations

## Testing

### Test Case 1: Simple Override
```json
{
  "client": "Test Client",
  "items": [{
    "description": "Test Item",
    "qty": 1,
    "unit_price": 160,
    "override_split": { "income": 100, "cost": 60 }
  }]
}
```
**Expected:** Invoice amount = $160, Cost = $60, Profit = $100

### Test Case 2: Mixed Items
```json
{
  "client": "Test Client",
  "items": [
    {
      "description": "Website Development",
      "qty": 1,
      "unit_price": 8200,
      "override_split": { "income": 5000, "cost": 3200 }
    },
    {
      "description": "Materials",
      "category": "Expense",
      "qty": 1,
      "unit_price": 200
    }
  ]
}
```
**Expected:** Invoice amount = $8400, Cost = $3400, Profit = $5000

### Test Case 3: Validation Error
```json
{
  "items": [{
    "qty": 1,
    "unit_price": 100,
    "override_split": { "income": 90, "cost": 60 }
  }]
}
```
**Expected:** 400 error - income + cost (150) doesn't match total (100)

## Notes
- The Deno/TypeScript lint errors are normal for Supabase Edge Functions - they run in Deno runtime, not Node.js
- Override data is optional - existing line items without overrides continue to work as before
- The semantics: `unit_price` is what client pays (total), which splits into `income` (profit) + `cost` (expense)
- Formula: `unit_price = income + cost`
