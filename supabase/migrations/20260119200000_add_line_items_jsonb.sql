-- Migration: Add line_items JSONB column to invoices table
-- This provides quick access to line items without joining invoice_items table

-- Add line_items JSONB column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name = 'line_items'
    ) THEN
        ALTER TABLE invoices ADD COLUMN line_items JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- Add index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_invoices_line_items ON invoices USING GIN (line_items);

-- Add comment for documentation
COMMENT ON COLUMN invoices.line_items IS 'JSONB array of line items for quick access. Format: [{description, category, qty, unit_price, total}]';

-- Backfill existing invoices with their line items from invoice_items table
UPDATE invoices i
SET line_items = COALESCE(
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', ii.id,
                'description', ii.description,
                'category', ii.category,
                'qty', ii.qty,
                'unit_price', ii.unit_price,
                'total', (ii.qty * ii.unit_price),
                'is_override', COALESCE(ii.is_override, false),
                'override_income', ii.override_income,
                'override_cost', ii.override_cost
            )
        )
        FROM invoice_items ii
        WHERE ii.invoice_id = i.id
    ),
    '[]'::jsonb
)
WHERE line_items IS NULL OR line_items = '[]'::jsonb;
