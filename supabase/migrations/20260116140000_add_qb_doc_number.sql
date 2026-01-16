-- Add a column to store QuickBooks DocNumber since 'invoice' is a generated column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'qb_doc_number'
    ) THEN
        ALTER TABLE invoices ADD COLUMN qb_doc_number TEXT;
        COMMENT ON COLUMN invoices.qb_doc_number IS 'QuickBooks invoice DocNumber (e.g. 1001, 1002)';
    END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invoices_qb_doc_number ON invoices(qb_doc_number) WHERE qb_doc_number IS NOT NULL;
