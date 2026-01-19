-- Migration: Add QuickBooks Expenses and Items tables
-- These tables store ACTUAL COSTS from QuickBooks (Purchase, Bill, Item entities)

-- QuickBooks Expenses (from Purchase and Bill entities)
CREATE TABLE IF NOT EXISTS quickbooks_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- QuickBooks identifiers
  quickbooks_expense_id TEXT NOT NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('purchase', 'bill')),
  
  -- Vendor/Entity info
  vendor_name TEXT,
  vendor_id TEXT,
  
  -- Core financials
  total_amount NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Payment details (for Purchase type)
  payment_type TEXT, -- 'Cash', 'Check', 'CreditCard'
  payment_method_ref TEXT,
  
  -- Account classification
  account_ref_id TEXT,
  account_ref_name TEXT,
  
  -- Customer/Job linking (KEY for matching to invoices!)
  customer_ref_id TEXT,
  customer_ref_name TEXT,
  
  -- Class tracking (alternative linking method)
  class_ref_id TEXT,
  class_ref_name TEXT,
  
  -- Dates
  transaction_date DATE NOT NULL,
  due_date DATE, -- For bills only
  
  -- Line items stored as JSONB for flexibility
  line_items JSONB,
  
  -- Memo/description
  memo TEXT,
  
  -- Status flags
  is_paid BOOLEAN DEFAULT false,
  is_linked_to_invoice BOOLEAN DEFAULT false,
  linked_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  
  -- Timestamps
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(user_id, quickbooks_expense_id)
);

-- QuickBooks Items (Products/Services with PurchaseCost)
CREATE TABLE IF NOT EXISTS quickbooks_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- QuickBooks identifiers
  quickbooks_item_id TEXT NOT NULL,
  
  -- Item details
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  item_type TEXT, -- 'Inventory', 'Service', 'NonInventory'
  
  -- Pricing - THE KEY FIELDS!
  unit_price NUMERIC(12, 2), -- Sale price (what customer pays)
  purchase_cost NUMERIC(12, 2), -- ACTUAL COST (what you pay!)
  
  -- Calculated margin
  profit_margin NUMERIC(5, 2) GENERATED ALWAYS AS (
    CASE 
      WHEN unit_price > 0 AND purchase_cost IS NOT NULL 
      THEN ((unit_price - purchase_cost) / unit_price * 100)
      ELSE NULL 
    END
  ) STORED,
  
  -- Inventory tracking
  qty_on_hand INTEGER DEFAULT 0,
  
  -- Account references
  income_account_ref TEXT,
  expense_account_ref TEXT,
  asset_account_ref TEXT,
  
  -- Category
  category_ref_id TEXT,
  category_ref_name TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, quickbooks_item_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_qb_expenses_user_id ON quickbooks_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_qb_expenses_customer_ref ON quickbooks_expenses(user_id, customer_ref_id);
CREATE INDEX IF NOT EXISTS idx_qb_expenses_transaction_date ON quickbooks_expenses(user_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_qb_expenses_not_linked ON quickbooks_expenses(user_id, is_linked_to_invoice) WHERE is_linked_to_invoice = false;

CREATE INDEX IF NOT EXISTS idx_qb_items_user_id ON quickbooks_items(user_id);
CREATE INDEX IF NOT EXISTS idx_qb_items_type ON quickbooks_items(user_id, item_type);

-- RLS Policies
ALTER TABLE quickbooks_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE quickbooks_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own QB expenses"
  ON quickbooks_expenses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own QB expenses"
  ON quickbooks_expenses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own QB expenses"
  ON quickbooks_expenses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own QB expenses"
  ON quickbooks_expenses FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own QB items"
  ON quickbooks_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own QB items"
  ON quickbooks_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own QB items"
  ON quickbooks_items FOR UPDATE
  USING (auth.uid() = user_id);
