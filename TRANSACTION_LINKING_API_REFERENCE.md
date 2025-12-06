# Transaction-Job Linking Quick Reference

## API Endpoints

### 1. Create Invoice with Transactions
**File:** `create-invoice`  
**Method:** POST  
**Use Case:** Link transactions when creating an invoice

**Request:**
```json
{
  "client": "ABC Corp",
  "amount": 1000,
  "transaction_ids": ["tx-1", "tx-2"],
  "status": "paid",
  "invoice_date": "2025-01-15"
}
```

---

### 2. Link Transaction to Job (After Creation)
**File:** `link-transaction-to-job`  
**Method:** POST  
**Use Case:** Link a transaction to an existing invoice

**Request:**
```json
{
  "transaction_id": "tx-123",
  "job_id": "invoice-456",
  "allocation_percentage": 100,
  "notes": "Materials cost"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction linked to job successfully",
  "invoice_totals_updated": {
    "total_actual_cost": 250,
    "actual_profit": 750
  }
}
```

---

### 3. Unlink Transaction from Job
**File:** `unlink-transaction-from-job`  
**Method:** POST  
**Use Case:** Remove a transaction link from an invoice

**Request Option 1 (by allocation_id):**
```json
{
  "allocation_id": "alloc-789"
}
```

**Request Option 2 (by transaction + job):**
```json
{
  "transaction_id": "tx-123",
  "job_id": "invoice-456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction unlinked from job successfully",
  "invoice_totals_updated": {
    "total_actual_cost": 100,
    "actual_profit": 900,
    "remaining_linked_transactions": 1
  }
}
```

---

### 4. List Invoices (with transactions)
**File:** `list-invoices`  
**Method:** GET  
**Use Case:** View all invoices with their linked transactions

**Response:**
```json
{
  "invoices": [
    {
      "id": "...",
      "client": "ABC Corp",
      "amount": 1000,
      "total_actual_cost": 250,
      "actual_profit": 750,
      "transaction_job_allocations": [
        {
          "id": "alloc-1",
          "allocation_amount": 250,
          "transactions": {
            "id": "tx-123",
            "name": "Home Depot",
            "amount": -250
          }
        }
      ]
    }
  ]
}
```

---

### 5. Get Invoice Details
**File:** `get-invoice-details`  
**Method:** GET  
**Query Params:** `?invoice_id=xxx`  
**Use Case:** View detailed invoice with all linked transactions

**Response:**
```json
{
  "invoice": {
    "id": "...",
    "transaction_job_allocations": [
      {
        "transactions": {
          "id": "tx-123",
          "name": "Home Depot",
          "merchant_name": "Home Depot",
          "amount": -250,
          "date": "2025-01-10"
        }
      }
    ],
    "profit_summary": {
      "revenue": 1000,
      "actual_cost": 250,
      "actual_profit": 750,
      "profit_margin": 75
    }
  }
}
```

---

## Common Workflows

### Workflow 1: Create Invoice with Known Expenses
1. Use `create-invoice` with `transaction_ids` array
2. Invoice automatically calculates totals
3. Done!

### Workflow 2: Add Expense to Existing Invoice
1. Find the transaction and invoice IDs
2. Call `link-transaction-to-job` with both IDs
3. Check response for updated invoice totals
4. Done!

### Workflow 3: Fix Incorrectly Linked Transaction
1. Call `unlink-transaction-from-job` with allocation_id
2. Check response for updated invoice totals
3. If needed, call `link-transaction-to-job` with correct job_id
4. Done!

### Workflow 4: Move Transaction to Different Invoice
1. Unlink from current invoice: `unlink-transaction-from-job`
2. Link to new invoice: `link-transaction-to-job`
3. Both invoices automatically update their totals
4. Done!

---

## Important Notes

✅ **Auto-calculated Fields:**
- `total_actual_cost` = sum of all linked transaction allocations
- `actual_profit` = invoice amount - total_actual_cost

✅ **Data Consistency:**
- All three operations (create with links, link, unlink) maintain invoice totals
- No manual recalculation needed

✅ **Flexibility:**
- Can link transactions during OR after invoice creation
- Can update existing links
- Can unlink by allocation_id OR transaction_id + job_id

⚠️ **TypeScript Lints:**
- Deno module import errors are expected (runtime handles them)
- Implicit `any` types are minor and don't affect functionality
