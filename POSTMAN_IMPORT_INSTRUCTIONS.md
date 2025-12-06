# Mintro API Postman Collection

I've generated a complete Postman collection for the Mintro project, covering both Supabase Edge Functions and the standard REST API endpoints for your tables.

## 📂 Files
- **`mintro_postman_collection.json`**: The collection file to import into Postman.

## 🚀 How to Import

1. Open **Postman**.
2. Click **Import** (top left).
3. Drag and drop the `mintro_postman_collection.json` file (located in `/Users/user/Dev/mintro/`).
4. The collection **"Mintro API"** will appear in your workspace.

## 🔑 Configuration

After importing, you need to set the collection variables:

1. Click on the **"Mintro API"** collection name in the sidebar.
2. Go to the **Variables** tab.
3. Update the following values:
   - **`PROJECT_URL`**: `https://kquthqdlixwoxzpyijcp.supabase.co` (Already set)
   - **`ANON_KEY`**: Paste your Supabase Anon Key here.
   - **`ACCESS_TOKEN`**: Paste a valid User Access Token (JWT) here. This is required for the "Standard REST API" endpoints which use Row Level Security (RLS).

## 📚 What's Included?

### **1. Edge Functions**
Grouped by domain:
- **Invoices**: `list-invoices`, `create-invoice`, `get-invoice-details`, etc.
- **Transactions**: `get-transactions`, `link-transaction-to-job`, `unlink-transaction-from-job`, etc.
- **Blueprints**: `list-cost-blueprints`, `create-cost-blueprint`, etc.
- **Inventory**: `list-inventory-items`, `adjust-inventory`, etc.
- **Analytics**: `get-dashboard-summary`, `get-profit-trends`, etc.
- **Banking**: `create-link-token`, `sync-accounts`, etc.
- **QuickBooks**: `quickbooks-auth-url`, `quickbooks-sync-invoices`, etc.
- **Categorization**: `auto-categorize-transactions`, `suggest-category-ai`, etc.

### **2. Standard REST API (Tables)**
CRUD operations for your database tables:
- `invoices`
- `transactions`
- `cost_blueprints`
- `blueprint_usage`
- `transaction_job_allocations`
- `invoice_items`
- `categorization_rules`
- `inventory_items`

Each table has pre-configured requests for:
- **List** (GET)
- **Create** (POST)
- **Update** (PATCH)
- **Delete** (DELETE)

## 📝 Notes
- **Edge Functions** mostly use `POST` method with a JSON body.
- **Standard REST APIs** use `GET`, `POST`, `PATCH`, `DELETE` and require the `ACCESS_TOKEN` to be set for RLS policies to work correctly (unless you have public tables).
- The `ANON_KEY` is sufficient for public Edge Functions, but some might check for user authentication internally (using the `Authorization` header which is pre-configured to use `{{ANON_KEY}}` - **Note**: If your functions require a user token, you might need to change the Authorization header in the Edge Function requests to use `{{ACCESS_TOKEN}}` instead of `{{ANON_KEY}}`).

**Pro Tip:** If your Edge Functions verify the user (e.g., `supabaseClient.auth.getUser()`), you should change the `Authorization` header in the "Edge Functions" folder to use `Bearer {{ACCESS_TOKEN}}` instead of `Bearer {{ANON_KEY}}`.
