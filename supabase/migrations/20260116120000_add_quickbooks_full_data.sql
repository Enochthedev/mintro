-- Add columns to store full QuickBooks data on invoices
DO $$
BEGIN
    -- Add quickbooks_raw_data JSONB column for complete QB invoice data
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'quickbooks_raw_data'
    ) THEN
        ALTER TABLE invoices ADD COLUMN quickbooks_raw_data JSONB;
    END IF;

    -- Add billing_address column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'billing_address'
    ) THEN
        ALTER TABLE invoices ADD COLUMN billing_address TEXT;
    END IF;
END $$;

-- Add columns to invoice_items for QuickBooks line item data
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoice_items' AND column_name = 'quickbooks_item_ref'
    ) THEN
        ALTER TABLE invoice_items ADD COLUMN quickbooks_item_ref TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoice_items' AND column_name = 'quickbooks_item_name'
    ) THEN
        ALTER TABLE invoice_items ADD COLUMN quickbooks_item_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoice_items' AND column_name = 'quickbooks_line_id'
    ) THEN
        ALTER TABLE invoice_items ADD COLUMN quickbooks_line_id TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoice_items' AND column_name = 'quickbooks_raw_data'
    ) THEN
        ALTER TABLE invoice_items ADD COLUMN quickbooks_raw_data JSONB;
    END IF;
END $$;

-- Create index for faster JSONB queries
CREATE INDEX IF NOT EXISTS idx_invoices_quickbooks_raw_data ON invoices USING GIN (quickbooks_raw_data);
