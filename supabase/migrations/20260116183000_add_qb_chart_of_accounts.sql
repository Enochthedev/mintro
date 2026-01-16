-- Migration: Add quickbooks_chart_of_accounts table for account classification
-- This enables proper expense/revenue/transfer classification from QB data

-- Chart of Accounts cache from QuickBooks
CREATE TABLE IF NOT EXISTS quickbooks_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- QuickBooks account data
  quickbooks_account_id TEXT NOT NULL,           -- QB's account Id
  name TEXT NOT NULL,                             -- Account name
  account_type TEXT NOT NULL,                     -- AccountType (Expense, COGS, Bank, Income, etc.)
  account_sub_type TEXT,                          -- AccountSubType for more detail
  classification TEXT,                            -- Classification from QB (Asset, Liability, Equity, Revenue, Expense)
  
  -- Our classification
  mintro_category TEXT NOT NULL DEFAULT 'other', -- expense, revenue, cogs, transfer, exclude
  is_expense BOOLEAN GENERATED ALWAYS AS (
    account_type IN ('Expense', 'Cost of Goods Sold', 'Other Expense')
  ) STORED,
  is_revenue BOOLEAN GENERATED ALWAYS AS (
    account_type IN ('Income', 'Other Income')
  ) STORED,
  is_non_pnl BOOLEAN GENERATED ALWAYS AS (
    account_type IN ('Bank', 'Credit Card', 'Loan', 'Equity', 'Accounts Receivable', 'Accounts Payable', 'Other Current Asset', 'Other Current Liability', 'Fixed Asset', 'Long Term Liability', 'Other Asset')
  ) STORED,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique per user + QB account
  UNIQUE(user_id, quickbooks_account_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_qb_accounts_user ON quickbooks_chart_of_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_qb_accounts_type ON quickbooks_chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_qb_accounts_lookup ON quickbooks_chart_of_accounts(user_id, quickbooks_account_id);

-- Add RLS
ALTER TABLE quickbooks_chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chart of accounts" ON quickbooks_chart_of_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chart of accounts" ON quickbooks_chart_of_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chart of accounts" ON quickbooks_chart_of_accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chart of accounts" ON quickbooks_chart_of_accounts
  FOR DELETE USING (auth.uid() = user_id);

-- Comment for documentation
COMMENT ON TABLE quickbooks_chart_of_accounts IS 'Cached Chart of Accounts from QuickBooks for proper expense classification';
COMMENT ON COLUMN quickbooks_chart_of_accounts.mintro_category IS 'Mintro classification: expense (real costs), revenue (income), cogs (cost of goods), transfer (internal moves), exclude (non-P&L)';
