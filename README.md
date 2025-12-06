# Mintro - Business Expense Tracking & Profitability Platform

Mintro is a comprehensive business expense tracking platform that helps contractors and small businesses track expenses, categorize transactions, and analyze profitability per job/invoice.

## Project Structure

```
mintro/
├── supabase/
│   ├── functions/          # Supabase Edge Functions (Deno)
│   ├── migrations/         # Database migrations
│   └── config.toml         # Supabase configuration
├── testFrontend/           # Frontend dashboard (separate repo)
└── docs/                   # API documentation
```

## Key Features

### 🏦 Bank Integration (Plaid)
- Connect bank accounts via Plaid Link
- Automatic transaction syncing
- Real-time webhook updates

### 📊 Transaction Categorization
- **Rule-based auto-categorization** - Create rules to automatically categorize transactions
- **AI-powered categorization** - GPT-4 fallback for unmatched transactions
- **Smart category suggestions** - AI analyzes your transactions and suggests relevant categories
- **16 default expense categories** - Pre-configured for contractors

### 💼 Invoice & Job Tracking
- Create invoices with line items
- Link transactions to jobs/invoices
- Track actual costs vs estimates
- Profit margin analysis

### 📈 Cost Blueprints
- Create reusable cost templates
- Track variance between estimated and actual costs
- Inventory management integration

## API Documentation

See the following guides for detailed API documentation:

- **[Frontend Categorization Guide](FRONTEND_CATEGORIZATION_GUIDE.md)** - Complete guide for integrating the categorization system
- **[API Reference](API_REFERENCE.md)** - Full API endpoint documentation
- **[Postman Collection](mintro_postman_collection.json)** - Import into Postman for testing

## Categorization System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW USER CONNECTS BANK                        │
├─────────────────────────────────────────────────────────────────┤
│  1. POST /create-link-token          → Get Plaid Link token     │
│  2. User completes Plaid Link UI                                │
│  3. POST /exchange-public-token      → Connects bank            │
│     ├── Auto-creates default categories (if none exist)        │
│     ├── Syncs transactions from bank                           │
│     └── Auto-categorizes transactions (rules + AI)             │
│  4. User sees categorized transactions immediately!             │
└─────────────────────────────────────────────────────────────────┘
```

### Categorization Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /setup-default-categories` | Create 16 default expense categories |
| `POST /analyze-suggest-categories` | AI analyzes transactions and suggests categories |
| `POST /test-categorization-rule` | Preview which transactions a rule would match |
| `POST /create-categorization-rule` | Create auto-categorization rule |
| `POST /auto-categorize-transactions` | Run rules + AI on transactions |
| `POST /categorize-transaction` | Manually categorize single transaction |
| `POST /bulk-categorize-transactions` | Categorize multiple transactions |

## Getting Started

### Prerequisites
- Supabase CLI
- Deno (for local function development)
- Node.js 18+ (for frontend)

### Environment Variables

Set these in your Supabase project:
```
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=sandbox|development|production
OPENAI_API_KEY=your_openai_key  # For AI categorization
```

### Deploy Functions

```bash
# Deploy all functions
supabase functions deploy --project-ref kquthqdlixwoxzpyijcp

# Deploy specific function
supabase functions deploy setup-default-categories --project-ref kquthqdlixwoxzpyijcp
```

### Run Frontend Locally

```bash
cd testFrontend/mintro-dashboard
npm install
npm run dev
```

## Edge Functions

### Categorization Functions
- `setup-default-categories` - Create default expense categories
- `analyze-suggest-categories` - AI-powered category suggestions
- `test-categorization-rule` - Preview rule matches
- `create-categorization-rule` - Create auto-categorization rule
- `list-categorization-rules` - List rules with pagination
- `auto-categorize-transactions` - Run rules + AI categorization
- `categorize-transaction` - Manual categorization
- `bulk-categorize-transactions` - Batch categorization

### Bank Integration Functions
- `create-link-token` - Generate Plaid Link token
- `exchange-public-token` - Complete bank connection
- `sync-transactions` - Sync transactions from Plaid
- `plaid-webhook` - Handle Plaid webhooks

### Invoice Functions
- `create-invoice` - Create new invoice
- `list-invoices` - List invoices with filters
- `get-invoice-details` - Get invoice with linked transactions
- `link-transaction-to-job` - Link expense to invoice

### Analytics Functions
- `get-dashboard-summary` - Overview metrics
- `get-category-breakdown` - Spending by category
- `get-profit-trends` - Profitability over time
- `get-margin-analysis` - Margin analysis by job type

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details
