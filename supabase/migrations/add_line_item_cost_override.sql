-- Migration: Add cost override columns to invoice_items
-- This allows tracking cost/profit breakdown for line items (similar to blueprints)

ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS override_income DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS override_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS is_override BOOLEAN DEFAULT FALSE;

-- Add comment to explain the feature
COMMENT ON COLUMN invoice_items.override_income IS 'Manual override: revenue/income portion of this line item';
COMMENT ON COLUMN invoice_items.override_cost IS 'Manual override: cost portion of this line item';
COMMENT ON COLUMN invoice_items.is_override IS 'Flag indicating if this item has a manual cost/profit split override';

-- Note: Validation that override_income = (qty * unit_price) is handled in the application layer
-- Note: The sum (override_income - override_cost) will contribute to invoice profit calculations
