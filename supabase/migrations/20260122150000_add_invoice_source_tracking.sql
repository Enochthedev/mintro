-- Migration: Add invoice source tracking for merged P&L calculations
-- This allows us to:
-- 1. Know which invoices came from QuickBooks vs created in Mintro
-- 2. Track if a QB invoice has been edited locally
-- 3. Properly merge QB P&L with Mintro P&L without double-counting

DO $$
BEGIN
    -- Add source tracking to invoices
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'source'
    ) THEN
        ALTER TABLE invoices ADD COLUMN source TEXT DEFAULT 'mintro' 
            CHECK (source IN ('mintro', 'quickbooks', 'manual'));
        COMMENT ON COLUMN invoices.source IS 'Where the invoice originated: mintro (created in app), quickbooks (synced from QB), manual (manual entry)';
    END IF;

    -- Track if a QB invoice has been edited in Mintro
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'edited_after_sync'
    ) THEN
        ALTER TABLE invoices ADD COLUMN edited_after_sync BOOLEAN DEFAULT false;
        COMMENT ON COLUMN invoices.edited_after_sync IS 'True if a synced invoice (QB) has been manually edited in Mintro';
    END IF;

    -- Store the original QB amounts for comparison
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'original_qb_amount'
    ) THEN
        ALTER TABLE invoices ADD COLUMN original_qb_amount NUMERIC;
        COMMENT ON COLUMN invoices.original_qb_amount IS 'Original amount from QuickBooks before any Mintro edits';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'original_qb_cost'
    ) THEN
        ALTER TABLE invoices ADD COLUMN original_qb_cost NUMERIC;
        COMMENT ON COLUMN invoices.original_qb_cost IS 'Original cost from QuickBooks before any Mintro edits';
    END IF;

    -- Last synced timestamp for QB invoices
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'qb_last_synced_at'
    ) THEN
        ALTER TABLE invoices ADD COLUMN qb_last_synced_at TIMESTAMPTZ;
    END IF;
END $$;

-- Update existing QB invoices to set source = 'quickbooks'
UPDATE invoices 
SET source = 'quickbooks' 
WHERE quickbooks_invoice_id IS NOT NULL AND source IS NULL;

-- Update existing non-QB invoices to set source = 'mintro'
UPDATE invoices 
SET source = 'mintro' 
WHERE quickbooks_invoice_id IS NULL AND source IS NULL;

-- Create table to store QB P&L report data
CREATE TABLE IF NOT EXISTS quickbooks_pnl_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Report period
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    -- Summary figures from QB
    total_income NUMERIC NOT NULL DEFAULT 0,
    total_cost_of_goods_sold NUMERIC NOT NULL DEFAULT 0,
    gross_profit NUMERIC NOT NULL DEFAULT 0,
    total_expenses NUMERIC NOT NULL DEFAULT 0,
    net_operating_income NUMERIC NOT NULL DEFAULT 0,
    net_income NUMERIC NOT NULL DEFAULT 0,
    
    -- Detailed breakdown (stored as JSONB)
    income_breakdown JSONB,
    cogs_breakdown JSONB,
    expense_breakdown JSONB,
    
    -- Raw QB response for reference
    raw_report_data JSONB,
    
    -- Metadata
    report_basis TEXT CHECK (report_basis IN ('Accrual', 'Cash')),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate reports for same period
    UNIQUE(user_id, start_date, end_date, report_basis)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_qb_pnl_user_date ON quickbooks_pnl_reports(user_id, start_date, end_date);

-- RLS
ALTER TABLE quickbooks_pnl_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own QB P&L reports"
    ON quickbooks_pnl_reports FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own QB P&L reports"
    ON quickbooks_pnl_reports FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own QB P&L reports"
    ON quickbooks_pnl_reports FOR UPDATE
    USING (auth.uid() = user_id);
