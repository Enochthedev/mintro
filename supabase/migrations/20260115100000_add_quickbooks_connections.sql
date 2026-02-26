-- Migration: Add quickbooks_connections table for QuickBooks OAuth tokens
-- This table stores QuickBooks connection information including OAuth tokens

CREATE TABLE IF NOT EXISTS quickbooks_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    realm_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    company_name TEXT,
    country TEXT DEFAULT 'US',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, realm_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_quickbooks_connections_user_id ON quickbooks_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_quickbooks_connections_status ON quickbooks_connections(user_id, status);

-- Enable RLS
ALTER TABLE quickbooks_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only see their own connections
CREATE POLICY "Users can view own quickbooks connections"
    ON quickbooks_connections FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quickbooks connections"
    ON quickbooks_connections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own quickbooks connections"
    ON quickbooks_connections FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own quickbooks connections"
    ON quickbooks_connections FOR DELETE
    USING (auth.uid() = user_id);
