# Transaction Allocation Design

## ✅ DECISION: NO PARTIAL ALLOCATIONS NEEDED

**Date**: 2025-11-22  
**Decision**: Transactions are always 100% allocated to a single invoice  
**Impact**: `link-transaction-to-job` and `unlink-transaction-from-job` endpoints are **DEPRECATED**

See `DEPRECATED_ENDPOINTS.md` for migration guide.

---

## Original Frontend Question
*"Any point for link-transaction-to-job when you can just edit transactions in invoice? Only thing you need to handle is how 2 invoices cannot use the same transaction."*

## Short Answer
You're partially right! Here's what we need:

1. **Validation**: Prevent allocating >100% of a transaction total
2. **Use case clarity**: When to use `create-invoice` with `transaction_ids` vs `link-transaction-to-job`

---

## Current Design Issues

### ❌ Missing Validation
The `link-transaction-to-job` function **does not validate** total allocations. This means:
```javascript
// ❌ CURRENTLY POSSIBLE (BAD):
// Transaction amount: -$1000
link-transaction-to-job({ transaction_id: "tx-1", job_id: "inv-1", allocation_percentage: 100 }) // -$1000
link-transaction-to-job({ transaction_id: "tx-1", job_id: "inv-2", allocation_percentage: 100 }) // -$1000
// Total allocated: -$2000 (200%!) ❌
```

### ✅ Should Be
```javascript
// ✅ SHOULD WORK:
link-transaction-to-job({ transaction_id: "tx-1", job_id: "inv-1", allocation_percentage: 50 })  // -$500
link-transaction-to-job({ transaction_id: "tx-1", job_id: "inv-2", allocation_percentage: 50 })  // -$500
// Total allocated: -$1000 (100%) ✅

// ❌ SHOULD REJECT:
link-transaction-to-job({ transaction_id: "tx-1", job_id: "inv-3", allocation_percentage: 10 })
// Error: "Transaction already 100% allocated. Unlink from other jobs first."
```

---

## When to Use Each Approach

### Option 1: `create-invoice` / `update-invoice` with `transaction_ids`
**Use when**: You know the transactions upfront and want 100% allocation

```javascript
// Creating invoice - link immediately
POST /create-invoice
{
  "client": "ABC Corp",
  "amount": 5000.00,
  "transaction_ids": ["tx-1", "tx-2"] // Each automatically gets 100% allocated
}

// Updating invoice - change linked transactions
POST /update-invoice
{
  "invoice_id": "inv-123",
  "transaction_ids": ["tx-1", "tx-3"] // Replaces previous links
}
```

**Pros**:
- Simple for frontend
- One API call
- Transactions always 100% allocated

**Cons**:
- Can't do partial allocations
- Can't split a transaction across jobs
- Must know all transactions at invoice creation time

### Option 2: `link-transaction-to-job`
**Use when**: You need partial allocations or linking after invoice creation

```javascript
// Partial allocation - split transaction 50/50
POST /link-transaction-to-job
{
  "transaction_id": "tx-1",
  "job_id": "inv-1",
  "allocation_percentage": 50 // $500 of $1000
}

POST /link-transaction-to-job
{
  "transaction_id": "tx-1",
  "job_id": "inv-2",
  "allocation_percentage": 50 // Other $500
}
```

**Pros**:
- Supports partial allocations
- Can link transactions later
- More flexible for complex scenarios

**Cons**:
- Two API calls per split
- Requires validation logic
- More complex for frontend

---

## Recommended Solution

### 1. Add Validation to `link-transaction-to-job`

Add this check before creating/updating allocations:

```typescript
// Get all existing allocations for this transaction
const { data: existingAllocations } = await supabaseClient
  .from("transaction_job_allocations")
  .select("allocation_amount, job_id")
  .eq("transaction_id", transaction_id)
  .neq("job_id", job_id); // Exclude current job if updating

const totalAllocated = existingAllocations?.reduce(
  (sum, alloc) => sum + Math.abs(Number(alloc.allocation_amount) || 0),
  0
) || 0;

const transactionAmount = Math.abs(parseFloat(transaction.amount));
const newAllocation = finalAllocationAmount;
const totalAfterNew = totalAllocated + newAllocation;

if (totalAfterNew > transactionAmount) {
  return new Response(
    JSON.stringify({
      error: "Transaction over-allocated",
      message: `This transaction ($${transactionAmount}) is already ${(totalAllocated/transactionAmount*100).toFixed(1)}% allocated. Adding $${newAllocation} would exceed 100%.`,
      current_allocations: {
        amount: totalAllocated,
        percentage: (totalAllocated/transactionAmount*100).toFixed(2),
        remaining: transactionAmount - totalAllocated
      },
      existing_jobs: existingAllocations?.map(a => ({ job_id: a.job_id, amount: a.allocation_amount }))
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

### 2. Simplify Frontend UX

**Recommended approach for frontend**:

```typescript
// Method 1: Simple case - full allocation at creation
async function createInvoiceWithTransactions(invoice, transactionIds) {
  return await fetch('/create-invoice', {
    method: 'POST',
    body: JSON.stringify({
      ...invoice,
      transaction_ids: transactionIds // Auto-allocates 100% each
    })
  });
}

// Method 2: Complex case - partial allocations
async function splitTransactionAcrossJobs(transactionId, allocations) {
  // allocations = [{ job_id: "inv-1", percentage: 50 }, { job_id: "inv-2", percentage: 50 }]
  const results = [];
  
  for (const alloc of allocations) {
    const result = await fetch('/link-transaction-to-job', {
      method: 'POST',
      body: JSON.stringify({
        transaction_id: transactionId,
        job_id: alloc.job_id,
        allocation_percentage: alloc.percentage
      })
    });
    
    if (!result.ok) {
      const error = await result.json();
      // Show error: "Transaction over-allocated - already 80% allocated..."
      throw new Error(error.message);
    }
    
    results.push(await result.json());
  }
  
  return results;
}
```

### 3. Add Helper Endpoint (Optional)

Create `/get-transaction-allocation-status` to help frontend:

```typescript
POST /get-transaction-allocation-status
{
  "transaction_id": "tx-1"
}

Response:
{
  "success": true,
  "transaction": {
    "id": "tx-1",
    "amount": -1000.00
  },
  "allocation_status": {
    "total_amount": 1000.00,
    "allocated_amount": 750.00,
    "allocated_percentage": 75.00,
    "remaining_amount": 250.00,
    "remaining_percentage": 25.00,
    "fully_allocated": false
  },
  "allocations": [
    { "job_id": "inv-1", "invoice_number": "INV-001", "amount": 500.00, "percentage": 50.00 },
    { "job_id": "inv-2", "invoice_number": "INV-002", "amount": 250.00, "percentage": 25.00 }
  ]
}
```

---

## Implementation Priority

1. **HIGH**: Add validation to `link-transaction-to-job` to prevent over-allocation
2. **MEDIUM**: Add `get-transaction-allocation-status` helper endpoint
3. **LOW**: Consider simplifying by removing `link-transaction-to-job` if you don't need partial allocations

---

## Decision: Do You Need Partial Allocations?

### If NO (transactions always 100% to one job):
- **Remove** `link-transaction-to-job` endpoint
- **Use** `create-invoice` and `update-invoice` with `transaction_ids` array only
- **Simpler** for both frontend and backend

### If YES (need to split transactions):
- **Keep** `link-transaction-to-job` with validation
- **Use** `create-invoice` for simple cases
- **Use** `link-transaction-to-job` for splits

**Ask the product team**: "Do we ever need to split a $1000 transaction 50% to Job A and 50% to Job B?"

---

## Recommended Next Steps

1. **Add validation** to `link-transaction-to-job` (30 min fix)
2. **Update tests** in `TESTING_GUIDE.md` to verify validation works
3. **Update API docs** to explain the error response
4. **Frontend decision**: Simple (transaction_ids only) or Complex (with splits)?
