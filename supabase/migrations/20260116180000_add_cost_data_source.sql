-- Migration: Add cost_data_source to track where cost data originates
-- This helps the frontend distinguish between estimated vs verified costs

-- Add the cost_data_source column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'cost_data_source'
    ) THEN
        ALTER TABLE invoices ADD COLUMN cost_data_source TEXT DEFAULT NULL;
    END IF;
END $$;

-- Add a comment explaining the values
COMMENT ON COLUMN invoices.cost_data_source IS 'Source of cost data: estimated (QB auto-guess), user_verified (manually confirmed), blueprint_linked (from blueprints), transaction_linked (from bank transactions)';

-- Create an index for filtering by cost_data_source
CREATE INDEX IF NOT EXISTS idx_invoices_cost_data_source ON invoices(cost_data_source) WHERE cost_data_source IS NOT NULL;
