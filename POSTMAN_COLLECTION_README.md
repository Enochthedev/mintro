# Mintro API - Postman Collection

## Overview
Professional Postman collection for the Mintro API covering authentication plus all 57 Edge Functions with complete request/response examples.

**File**: `mintro_postman_collection.json`

---

## What's Included

### 🔐 Authentication (3 endpoints)
- Sign In with Password (Get ACCESS_TOKEN)
- Sign Up (Create new account)
- Refresh Token (Renew expired token)

### Invoices (10 endpoints)
- List Invoices (GET with 8 query parameters)
- Get Invoice Details (GET with invoice_id)
- Create Invoice (5 variations: basic, single blueprint, multiple blueprints, manual override, complete with line items)
- Update Invoice
- Delete Invoice
- Update Invoice Actuals
- Suggest Invoice Costs (AI-powered)
- Get Invoice Profit Breakdown
- Get Invoice with Transactions

### Transactions (9 endpoints)
- Get Transactions
- Sync Transactions
- Categorize Transaction
- Auto Categorize Transactions (rules + AI)
- Get Uncategorized Transactions
- Get Transaction Allocations
- Link Transaction to Blueprint
- Match Transactions to Blueprints (AI)
- Sync Plaid Transactions

**Note**: `link-transaction-to-job` and `unlink-transaction-from-job` have been **deprecated**. Use `transaction_ids` in `create-invoice` / `update-invoice` instead. See `DEPRECATED_ENDPOINTS.md`.

### Blueprints (7 endpoints)
- List Cost Blueprints
- Create Cost Blueprint (with inventory linking)
- Update Cost Blueprint
- Delete Cost Blueprint
- Create Blueprint Usage
- Get Blueprint Expenses
- Get Blueprint Variance

### Inventory (7 endpoints)
- List Inventory Items
- Create Inventory Item
- Update Inventory Item
- Delete Inventory Item
- Adjust Inventory (with audit trail)
- Get Inventory Alerts
- Reactivate Inventory Item

### Analytics (6 endpoints)
- Get Dashboard Summary (comprehensive KPIs)
- Get Business Profitability
- Get Profit Trends
- Get Margin Analysis
- Get Margin Alerts
- Get Vendor Price Changes

### Banking and Plaid (6 endpoints)
- Create Link Token
- Exchange Public Token
- Get Accounts
- Sync Accounts
- Disconnect Bank
- Get Connection Status

### QuickBooks Integration (5 endpoints)
- Get QuickBooks Auth URL
- Handle QuickBooks Callback
- Disconnect QuickBooks
- Get QuickBooks Status
- Sync Invoices to QuickBooks

### Categorization (6 endpoints)
- List Categorization Rules
- Create Categorization Rule
- Delete Categorization Rule
- Apply Categorization Rules
- Suggest Category (AI)
- Setup Default Categories

**Total**: 58 Edge Function endpoints (2 deprecated, 3 authentication)

---

## Key Features

✅ **Professional structure** - No emojis, clean folder organization  
✅ **Realistic examples** - All examples based on actual function code  
✅ **Complete request bodies** - Every POST request has detailed example  
✅ **Success responses** - Every endpoint shows expected response format  
✅ **Query parameters** - GET requests show all available filters  
✅ **Parameter descriptions** - Each query param includes usage description  
✅ **Multiple variations** - Invoice creation shows 5 different use cases  
✅ **Production-ready** - Ready for import and immediate use

---

## Quick Start

### 1. Import to Postman
1. Open Postman
2. Click **Import** → Select `mintro_postman_collection.json`
3. Collection **"Mintro API"** appears in your workspace

### 2. Configure Variables
Click on "Mintro API" collection → Variables tab:

| Variable | Value | Where to Get It |
|----------|-------|----------------|
| `PROJECT_URL` | `https://kquthqdlixwoxzpyijcp.supabase.co` | Already set |
| `ANON_KEY` | Your key | Supabase Dashboard → Settings → API → anon/public key |
| `ACCESS_TOKEN` | User JWT | **Use "🔐 Authentication" → "Sign In with Password" in Postman** (or via `supabase.auth.signInWithPassword()` in code) |

**To get your ACCESS_TOKEN in Postman:**
1. First, set your `ANON_KEY` (from Supabase Dashboard → Settings → API)
2. Go to **🔐 Authentication** → **Sign In with Password**
3. Update the request body with your credentials (e.g., `enochjesse884@gmail.com`)
4. Click **Send** - copy the `access_token` from the response
5. Paste it into the `ACCESS_TOKEN` collection variable
6. Now you can test all other endpoints!

### 3. Test Endpoints
- **GET requests**: Enable/disable query params as needed
- **POST requests**: Replace placeholder IDs with real values
- **View responses**: Click "Examples" tab to see expected output

---

## Documentation

- **API Reference**: `API_DOCUMENTATION.md` - Detailed specs for invoice/transaction endpoints
- **Transaction Linking**: `TRANSACTION_LINKING_API_REFERENCE.md` - Link/unlink workflows
- **Import Guide**: `POSTMAN_IMPORT_GUIDE.md` - Step-by-step setup instructions
- **Testing**: `TESTING_GUIDE.md` - Integration test guide

---

## Example Workflows

### Create Invoice and Link Transactions
```
1. POST /create-invoice (use "Basic with Transactions" example)
2. GET /get-invoice-details?invoice_id=<NEW_ID>
3. Verify totals updated automatically
```

### Categorize Transactions
```
1. POST /get-uncategorized-transactions
2. POST /auto-categorize-transactions (uses rules + AI)
3. POST /get-uncategorized-transactions (verify count reduced)
```

### Blueprint Variance Analysis
```
1. POST /create-cost-blueprint
2. POST /create-invoice (use "Single Blueprint" example)
3. POST /create-blueprint-usage (record actual costs)
4. POST /get-blueprint-variance (analyze performance)
```

---

## Professional Standards

This collection follows best practices:
- Clear, descriptive endpoint names
- Realistic example data
- Complete request/response cycles
- Proper HTTP methods (GET for reads, POST for writes)
- No decorative elements (emojis, etc.)
- Production-ready examples

---

## Support Resources

- **Frontend Team**: Use example responses to build TypeScript interfaces
- **QA Team**: Import and run through all endpoints for testing
- **Backend Team**: Reference for expected request/response formats
- **Documentation**: All examples match actual deployed functions

---

Ready to import `mintro_postman_collection.json` and start testing! 🚀
