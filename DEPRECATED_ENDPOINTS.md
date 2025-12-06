# DEPRECATION NOTICE

## Deprecated Endpoints

The following endpoints are **DEPRECATED** and should not be used:

### ❌ `/functions/v1/link-transaction-to-job`
### ❌ `/functions/v1/unlink-transaction-from-job`

**Reason**: Business requirement confirmed that transactions are always 100% allocated to a single invoice. Splitting transactions across multiple jobs is not needed.

---

## Use Instead

### ✅ Create Invoice with Transactions
```javascript
POST /functions/v1/create-invoice
{
  "client": "ABC Corp",
  "amount": 5000.00,
  "transaction_ids": ["tx-1", "tx-2", "tx-3"]  // Each gets 100% allocated
}
```

### ✅ Update Invoice Transactions
```javascript
POST /functions/v1/update-invoice
{
  "invoice_id": "INVOICE_ID",
  "transaction_ids": ["tx-1", "tx-4"]  // Replaces previous allocations
}
```

**How it works**:
- Each transaction is automatically 100% allocated to the invoice
- If a transaction was previously linked to another invoice, it gets unlinked
- Invoice totals (`total_actual_cost`, `actual_profit`) automatically recalculate

---

## Migration Guide

If you were using `link-transaction-to-job`:

### Before (DEPRECATED):
```javascript
// Step 1: Create invoice
const invoice = await createInvoice({ client: "ABC Corp", amount: 5000 });

// Step 2: Link transactions separately
await linkTransactionToJob({ transaction_id: "tx-1", job_id: invoice.id });
await linkTransactionToJob({ transaction_id: "tx-2", job_id: invoice.id });
```

### After (RECOMMENDED):
```javascript
// One step - create with transactions
const invoice = await createInvoice({ 
  client: "ABC Corp", 
  amount: 5000,
  transaction_ids: ["tx-1", "tx-2"]
});
```

---

## Benefits of Simplified Approach

✅ **Simpler API** - One call instead of N+1 calls  
✅ **Atomic operation** - All transactions linked in one transaction  
✅ **Automatic validation** - Can't over-allocate (each transaction 100% to one invoice)  
✅ **Clearer intent** - Transaction relationships defined at invoice creation  
✅ **Better UX** - Frontend doesn't need complex allocation logic  

---

## Timeline

- **Now**: Endpoints marked as deprecated but still functional
- **Future**: Endpoints may be removed in a future version
- **Action Required**: Update your code to use `transaction_ids` parameter

---

## Questions?

See `TRANSACTION_ALLOCATION_DESIGN.md` for the full rationale and design discussion.
