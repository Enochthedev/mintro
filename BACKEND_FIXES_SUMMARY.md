# Backend Fixes for Mintro

## 1. Transaction Allocation Validation ✅
I have implemented strict validation to ensure that transaction allocations never exceed 100% of the transaction amount. This prevents the "139% case" and ensures data integrity.

### Changes Made
1.  **`supabase/functions/update-invoice/index.ts`**:
    *   Added a validation loop before linking transactions.
    *   It now checks existing allocations for each transaction (excluding the current invoice if applicable, though `update-invoice` clears current links first).
    *   If `existing_allocations_to_other_jobs + new_allocation > transaction_amount`, it throws a 400 error with a detailed message.

2.  **`supabase/functions/create-invoice/index.ts`**:
    *   Added the same validation loop before linking transactions.
    *   Ensures that even when creating a new invoice, we don't over-allocate transactions that are already linked to other jobs.

## 2. Line Item Cost Override Feature ✅
Implemented support for manual cost/profit breakdown on line items (similar to blueprints).

### Changes Made
1. **Database Migration** (`supabase/migrations/add_line_item_cost_override.sql`):
   - Added `override_income`, `override_cost`, `is_override` columns to `invoice_items`

2. **`supabase/functions/create-invoice/index.ts`**:
   - Accepts `override_split` in line items
   - Validates that `override_split.income` equals line item total
   - Stores override data and updates cost calculations

3. **`supabase/functions/update-invoice/index.ts`**:
   - Same validation and storage as create-invoice
   - Recalculates costs using override data

4. **`get-invoice-details` & `list-invoices`**:
   - Already return all invoice_items columns (no changes needed)

### Usage Example
```json
{
  "description": "Flat project fee",
  "qty": 1,
  "unit_price": 1000,
  "override_split": {
    "income": 1000,  // Revenue (must equal total)
    "cost": 700      // Your cost to deliver
  }
}
```
**Result:** $1000 revenue, $700 cost, $300 profit

See `LINE_ITEM_OVERRIDE_IMPLEMENTATION.md` for full details.

## Other Requests Analysis
*   **Client-Facing Invoice Cleanup**: This is primarily a **Frontend** task. The backend `get-invoice-details` sends all data (including internal costs), so the frontend must filter this for the client view.
*   **Blueprint Section Adjustments**:
    *   "Only sale price should populate client invoice": `create-invoice` already calculates the invoice total based on `target_sale_price`. The display of line items vs blueprint details is a **Frontend** responsibility.
    *   "Auto-fill invoice": **Frontend** feature.

## Deployment Steps

### Required Before Deployment
1. **Run database migration:**
   ```bash
   # Navigate to mintro directory and run:
   supabase migration up
   ```

2. **Deploy updated functions:**
   ```bash
   supabase functions deploy create-invoice
   supabase functions deploy update-invoice
   ```

## Verification
The validation logic uses a small epsilon (`0.01`) to handle floating-point arithmetic safe-guards.
