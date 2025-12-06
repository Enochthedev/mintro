# Transaction Linking - Update Summary

## ✅ Deployed

**Function**: `update-invoice`  
**Deployed**: 2025-11-22 at 15:52  
**Status**: ✅ Live and ready to use

---

## 📝 What Was Added

### `update-invoice` Now Supports `transaction_ids`

The `update-invoice` function now accepts an optional `transaction_ids` parameter to manage transaction links during invoice editing.

**Parameter**: `transaction_ids` (UUID array, optional)

---

## 🎯 4 Scenarios Explained

### 1. **KEEP** - Don't Change Existing Links
```json
{
  "invoice_id": "INVOICE_ID",
  "status": "sent"
}
```
**Behavior**: `transaction_ids` is **omitted** → existing links remain unchanged

---

### 2. **ADD** - Link Transactions (First Time)
```json
{
  "invoice_id": "INVOICE_ID",
  "transaction_ids": ["tx-1", "tx-2"]
}
```
**Behavior**: Links 2 new transactions (100% each)  
**Response**: `transactions_linked: 2, transactions_unlinked: 0`

---

### 3. **REPLACE** - Change Linked Transactions
```json
{
  "invoice_id": "INVOICE_ID",
  "transaction_ids": ["tx-3", "tx-4", "tx-5"]
}
```
**Behavior**: Removes ALL existing links, adds new ones  
**Response**: `transactions_linked: 3, transactions_unlinked: 2`  
*(Example: had 2 old, now has 3 new)*

---

### 4. **REMOVE** - Clear All Transaction Links
```json
{
  "invoice_id": "INVOICE_ID",
  "transaction_ids": []
}
```
**Behavior**: Empty array removes **ALL** links  
**Response**: `transactions_linked: 0, transactions_unlinked: 3`  
**Invoice Totals**: Set to `null`

---

## 📊 Summary Table

| Scenario | `transaction_ids` | What Happens | Invoice Totals |
|----------|-------------------|--------------|----------------|
| **KEEP** | Omit parameter | No changes | Unchanged |
| **ADD** | `["tx-1", "tx-2"]` | Link new (100% each) | Auto-calculated |
| **REPLACE** | `["tx-3"]` | Remove old + Link new | Recalculated |
| **REMOVE** | `[]` | Remove all | Set to `null` |

---

## 📚 Documentation Updated

1. **API_DOCUMENTATION.md** - Added 5 detailed examples with all 4 scenarios
2. **FRONTEND_TRANSACTION_GUIDE.md** - Complete guide with UI patterns
3. **mintro_postman_collection.json** - Updated with `transaction_ids` example
4. **DEPRECATED_ENDPOINTS.md** - Migration guide from old endpoints

---

## 🔑 Key Technical Points

### Behavior
- **Replacement**: Always replaces **ALL** existing links (not additive)
- **100% Allocation**: Each transaction is 100% allocated to the invoice
- **Atomic**: All operations happen in a single database transaction
- **Auto-calculation**: `total_actual_cost` and `actual_profit` update automatically

### Response Format
```typescript
interface UpdateInvoiceResponse {
  success: true;
  message: string;
  invoice: {
    // ... updated invoice fields
    total_actual_cost: number | null;  // Auto-calculated
    actual_profit: number | null;      // Auto-calculated
  };
  // Only included if transaction_ids was provided:
  transactions_linked?: number;        // Number of new links created
  transactions_unlinked?: number;      // Number of old links removed
}
```

---

## 💡 Frontend Integration

### Get Current Links
```typescript
const currentTransactionIds = invoice.transaction_job_allocations
  ?.map(alloc => alloc.transaction_id) || [];
```

### Add One Transaction
```typescript
const updated = [...currentTransactionIds, newTransactionId];
await updateInvoice({ invoice_id, transaction_ids: updated });
```

### Remove One Transaction
```typescript
const updated = currentTransactionIds.filter(id => id !== transactionIdToRemove);
await updateInvoice({ invoice_id, transaction_ids: updated });
```

### Replace All
```typescript
await updateInvoice({ 
  invoice_id, 
  transaction_ids: [newTx1, newTx2] 
});
```

### Clear All
```typescript
await updateInvoice({ 
  invoice_id, 
  transaction_ids: [] 
});
```

---

## ✅ Ready to Use

- ✅ **Deployed**: Live at production endpoint
- ✅ **Documented**: Complete examples in API_DOCUMENTATION.md
- ✅ **Tested**: Postman collection updated
- ✅ **Frontend Ready**: UI patterns provided in FRONTEND_TRANSACTION_GUIDE.md

**Import Postman Collection**: `mintro_postman_collection.json`  
**Read Full Guide**: `FRONTEND_TRANSACTION_GUIDE.md`  
**API Reference**: `API_DOCUMENTATION.md` (Section: Update Invoice)
