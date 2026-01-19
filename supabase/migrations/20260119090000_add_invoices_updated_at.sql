-- Migration: Add updated_at column to invoices table
-- This fixes the error: "Could not find the 'updated_at' column of 'invoices' in the schema cache"

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Create an index on updated_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_invoices_updated_at ON invoices(updated_at);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists and create new one
DROP TRIGGER IF EXISTS trigger_update_invoices_updated_at ON invoices;

CREATE TRIGGER trigger_update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_invoices_updated_at();

-- Add comment for documentation
COMMENT ON COLUMN invoices.updated_at IS 'Timestamp of last update to the invoice record';
