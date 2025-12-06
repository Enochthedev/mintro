# Mintro API Reference (Frontend)

## 🧾 Invoices & Transactions

### 1. List Invoices
**GET** `/functions/v1/list-invoices`

Returns a paginated list of invoices, including their linked transactions.

**Parameters:**
- `status` (optional): Filter by status (e.g., 'draft', 'paid')
- `client` (optional): Filter by client name
- `limit` (optional): Number of items (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```typescript
interface ListInvoicesResponse {
  success: boolean;
  invoices: Invoice[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  summary: {
    total_revenue: number;
    total_actual_cost: number;
    total_actual_profit: number;
    average_profit_margin: number;
  };
}

interface Invoice {
  id: string;
  invoice: string; // Invoice number
  client: string;
  amount: number;
  status: string;
  total_actual_cost: number | null;
  actual_profit: number | null;
  // ... other invoice fields
  transaction_job_allocations: Array<{
    id: string;
    allocation_amount: number;
    transactions: {
      id: string;
      name: string;
      amount: number;
      date: string;
      merchant_name: string;
      category: string;
    };
  }>;
}
```

---

### 2. Link Transaction to Job (Invoice)
**POST** `/functions/v1/link-transaction-to-job`

Links a transaction to an invoice (job) and updates the invoice's cost/profit totals.

**Request Body:**
```typescript
{
  transaction_id: string;
  job_id: string; // The Invoice ID
  allocation_percentage?: number; // Default: 100
  allocation_amount?: number; // Optional: Override calculated amount
  notes?: string;
}
```

**Response:**
```typescript
{
  success: true,
  message: "Transaction linked to job successfully",
  link: {
    id: string;
    // ... allocation details
  },
  invoice_totals_updated: {
    total_actual_cost: number;
    actual_profit: number;
  }
}
```

---

### 3. Unlink Transaction from Job
**POST** `/functions/v1/unlink-transaction-from-job`

Removes a link between a transaction and an invoice, automatically recalculating totals.

**Request Body (Option A - Recommended):**
```typescript
{
  allocation_id: string; // The ID of the link itself
}
```

**Request Body (Option B):**
```typescript
{
  transaction_id: string;
  job_id: string;
}
```

**Response:**
```typescript
{
  success: true,
  message: "Transaction unlinked from job successfully",
  unlinked_allocation_id: string,
  invoice_totals_updated: {
    total_actual_cost: number | null;
    actual_profit: number | null;
    remaining_linked_transactions: number;
  }
}
```

---

### 4. Create Invoice
**POST** `/functions/v1/create-invoice`

Creates a new invoice. You can optionally link transactions immediately.

**Request Body:**
```typescript
{
  client: string;
  amount: number;
  invoice_date?: string;
  due_date?: string;
  items?: Array<{ description: string; qty: number; unit_price: number }>;
  transaction_ids?: string[]; // Array of transaction IDs to link immediately
  // ... other fields
}
```
