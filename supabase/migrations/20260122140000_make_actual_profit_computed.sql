-- Migration: Make actual_profit a computed column
-- This eliminates redundancy - profit is always calculated from amount - total_actual_cost

-- Step 1: Drop the existing actual_profit column if it exists
-- We need to drop it first because we can't convert a regular column to a generated column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'actual_profit'
    ) THEN
        ALTER TABLE invoices DROP COLUMN actual_profit;
    END IF;
END $$;

-- Step 2: Add actual_profit as a GENERATED ALWAYS column
-- Formula: amount - total_actual_cost (if total_actual_cost is not null)
ALTER TABLE invoices 
ADD COLUMN actual_profit NUMERIC GENERATED ALWAYS AS (
    CASE 
        WHEN total_actual_cost IS NOT NULL THEN amount - total_actual_cost
        ELSE NULL
    END
) STORED;

-- Add a comment explaining the column
COMMENT ON COLUMN invoices.actual_profit IS 'Computed column: amount - total_actual_cost. Do not attempt to write to this column directly.';

-- Step 3: Also make total_actual_cost a computed column from the breakdown fields (if they exist)
-- Check if we have the breakdown columns
DO $$
BEGIN
    -- If we have the breakdown columns, we could make total_actual_cost computed too
    -- But for now, let's keep it manual since costs come from multiple sources
    -- (transactions, blueprints, line items, QB expenses, etc.)
    
    -- Just add a helpful comment
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'total_actual_cost'
    ) THEN
        COMMENT ON COLUMN invoices.total_actual_cost IS 'Total cost from all sources (transactions, blueprints, line items). actual_profit is computed from this.';
    END IF;
END $$;
