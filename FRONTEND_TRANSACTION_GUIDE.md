# Frontend Guide: Linking/Unlinking Transactions

## Quick Answer

**When editing an invoice**, use the `transaction_ids` parameter in `update-invoice`:

```javascript
POST /functions/v1/update-invoice
{
  "invoice_id": "INVOICE_ID",
  "transaction_ids": ["tx-1", "tx-2", "tx-3"]  // Replaces ALL existing links
}
```

This **automatically**:
- ✅ Removes all previously linked transactions
- ✅ Links the new transactions (100% each)
- ✅ Recalculates `total_actual_cost` and `actual_profit`

---

## Complete Examples

### Example 1: Add Transactions to Existing Invoice

```javascript
// Current state: Invoice has NO transactions linked
// Want to: Add 2 transactions

await fetch('/functions/v1/update-invoice', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    invoice_id: "550e8400-e29b-41d4-a716-446655440000",
    transaction_ids: ["tx-abc-123", "tx-def-456"]
  })
});

// Response:
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "client": "ABC Corp",
    "amount": 5000.00,
    "total_actual_cost": 3200.00,      // Auto-calculated
    "actual_profit": 1800.00,          // Auto-calculated
    "updated_at": "2025-11-22T15:00:00Z"
  },
  "transactions_linked": 2,
  "transactions_unlinked": 0
}
```

### Example 2: Replace Existing Transactions

```javascript
// Current state: Invoice has tx-1, tx-2
// Want to: Replace with tx-3, tx-4, tx-5

await fetch('/functions/v1/update-invoice', {
  method: 'POST',
  body: JSON.stringify({
    invoice_id: "550e8400-e29b-41d4-a716-446655440000",
    transaction_ids: ["tx-ghi-789", "tx-jkl-012", "tx-mno-345"]
  })
});

// Response:
{
  "success": true,
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "total_actual_cost": 4500.00,      // Recalculated
    "actual_profit": 500.00            // Recalculated
  },
  "transactions_linked": 3,            // New transactions added
  "transactions_unlinked": 2           // Old transactions removed
}
```

### Example 3: Remove All Transactions

```javascript
// Current state: Invoice has tx-1, tx-2, tx-3
// Want to: Remove all transactions

await fetch('/functions/v1/update-invoice', {
  method: 'POST',
  body: JSON.stringify({
    invoice_id: "550e8400-e29b-41d4-a716-446655440000",
    transaction_ids: []  // Empty array = remove all
  })
});

// Response:
{
  "success": true,
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "total_actual_cost": null,         // Cleared
    "actual_profit": null              // Cleared
  },
  "transactions_linked": 0,
  "transactions_unlinked": 3
}
```

### Example 4: Update Invoice + Change Transactions (One Call)

```javascript
// Update invoice details AND change linked transactions

await fetch('/functions/v1/update-invoice', {
  method: 'POST',
  body: JSON.stringify({
    invoice_id: "550e8400-e29b-41d4-a716-446655440000",
    status: "sent",
    notes: "Invoice sent to client",
    transaction_ids: ["tx-abc-123", "tx-def-456"]  // Also update transactions
  })
});

// Response:
{
  "success": true,
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "sent",                  // Updated
    "notes": "Invoice sent to client", // Updated
    "total_actual_cost": 3200.00,      // Recalculated
    "actual_profit": 1800.00           // Recalculated
  },
  "transactions_linked": 2,
  "transactions_unlinked": 1
}
```

---

## UI Implementation Patterns

### Pattern 1: Multi-Select Dropdown

```typescript
// Component state
const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
const [allTransactions, setAllTransactions] = useState([]);

// Load current linked transactions when editing
useEffect(() => {
  if (invoice) {
    const linkedIds = invoice.transaction_job_allocations?.map(
      (alloc) => alloc.transaction_id
    ) || [];
    setSelectedTransactions(linkedIds);
  }
}, [invoice]);

// Save changes
const handleSave = async () => {
  await fetch('/functions/v1/update-invoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice_id: invoice.id,
      transaction_ids: selectedTransactions  // Send current selection
    })
  });
};

// UI
<MultiSelect
  options={allTransactions}
  value={selectedTransactions}
  onChange={setSelectedTransactions}
  label="Link Transactions"
/>
```

### Pattern 2: Searchable List with Add/Remove

```typescript
const InvoiceTransactionEditor = ({ invoice }) => {
  const [linkedTransactions, setLinkedTransactions] = useState([]);
  
  // Load currently linked
  useEffect(() => {
    setLinkedTransactions(
      invoice.transaction_job_allocations?.map(a => a.transactions) || []
    );
  }, [invoice]);

  const addTransaction = (transaction) => {
    setLinkedTransactions([...linkedTransactions, transaction]);
  };

  const removeTransaction = (transactionId) => {
    setLinkedTransactions(
      linkedTransactions.filter(t => t.id !== transactionId)
    );
  };

  const save = async () => {
    const ids = linkedTransactions.map(t => t.id);
    await updateInvoice(invoice.id, { transaction_ids: ids });
  };

  return (
    <div>
      <TransactionSearch onSelect={addTransaction} />
      <LinkedTransactionsList 
        transactions={linkedTransactions}
        onRemove={removeTransaction}
      />
      <Button onClick={save}>Save Changes</Button>
    </div>
  );
};
```

### Pattern 3: Drag & Drop

```typescript
const TransactionDragDrop = ({ invoice }) => {
  const [unlinkedTransactions, setUnlinkedTransactions] = useState([]);
  const [linkedTransactions, setLinkedTransactions] = useState([]);

  const handleDrop = (transaction, zone) => {
    if (zone === 'linked') {
      // Add to linked
      setLinkedTransactions([...linkedTransactions, transaction]);
      setUnlinkedTransactions(unlinkedTransactions.filter(t => t.id !== transaction.id));
    } else {
      // Remove from linked
      setUnlinkedTransactions([...unlinkedTransactions, transaction]);
      setLinkedTransactions(linkedTransactions.filter(t => t.id !== transaction.id));
    }
  };

  const save = async () => {
    const ids = linkedTransactions.map(t => t.id);
    await updateInvoice(invoice.id, { transaction_ids: ids });
  };

  return (
    <DragDropContext>
      <DropZone name="unlinked" transactions={unlinkedTransactions} onDrop={handleDrop} />
      <DropZone name="linked" transactions={linkedTransactions} onDrop={handleDrop} />
      <Button onClick={save}>Update Invoice</Button>
    </DragDropContext>
  );
};
```

---

## Important Notes

### ⚠️ Behavior

1. **Replacement, not Addition**: `transaction_ids` REPLACES all existing links
   - If you pass `["tx-1"]`, any previously linked transactions are removed
   - To add a transaction: Include both existing AND new transaction IDs

2. **Empty Array Clears All**: `transaction_ids: []` removes all links
   - `total_actual_cost` becomes `null`
   - `actual_profit` becomes `null`

3. **Omit to Keep Existing**: Don't include `transaction_ids` to keep current links
   ```javascript
   // This only updates status, keeps existing transactions
   { invoice_id: "...", status: "sent" }
   ```

4. **100% Allocation**: Each transaction is always 100% allocated
   - No partial allocations
   - A transaction can only be linked to ONE invoice at a time

### ✅ Best Practices

1. **Load current state first**:
   ```javascript
   const currentIds = invoice.transaction_job_allocations?.map(a => a.transaction_id) || [];
   ```

2. **Show user what will change**:
   - "2 transactions will be added"
   - "1 transaction will be removed"
   - "Invoice totals will update"

3. **Confirm before removing all**:
   ```javascript
   if (transaction_ids.length === 0 && currentIds.length > 0) {
     if (!confirm('Remove all linked transactions?')) return;
   }
   ```

4. **Refresh invoice after update** to get updated totals:
   ```javascript
   const result = await updateInvoice({ invoice_id, transaction_ids });
   setInvoice(result.invoice); // Use returned invoice with updated totals
   ```

---

## Common Workflows

### Add One Transaction

```javascript
// Get current transactions
const current = invoice.transaction_job_allocations.map(a => a.transaction_id);

// Add new one
const updated = [...current, newTransactionId];

// Save
await updateInvoice({ invoice_id, transaction_ids: updated });
```

### Remove One Transaction

```javascript
// Get current transactions
const current = invoice.transaction_job_allocations.map(a => a.transaction_id);

// Remove specific one
const updated = current.filter(id => id !== transactionIdToRemove);

// Save
await updateInvoice({ invoice_id, transaction_ids: updated });
```

### Swap Transactions

```javascript
// Replace all at once
await updateInvoice({ 
  invoice_id, 
  transaction_ids: [newTx1, newTx2, newTx3] 
});
```

---

## API Reference

### Request

```typescript
interface UpdateInvoiceRequest {
  invoice_id: string;               // Required
  
  // Optional invoice fields
  client?: string;
  amount?: number;
  status?: string;
  due_date?: string;
  invoice_date?: string;
  service_type?: string;
  notes?: string;
  tags?: string[];
  
  // Optional transaction management
  transaction_ids?: string[];       // Replaces all existing links
}
```

### Response

```typescript
interface UpdateInvoiceResponse {
  success: true;
  message: string;
  invoice: {
    id: string;
    invoice: string;
    client: string;
    amount: number;
    status: string;
    total_actual_cost: number | null;  // Auto-calculated
    actual_profit: number | null;      // Auto-calculated
    updated_at: string;
    // ... other invoice fields
  };
  transactions_linked?: number;        // Only if transaction_ids provided
  transactions_unlinked?: number;      // Only if transaction_ids provided
}
```

---

## Testing

Use Postman collection `mintro_postman_collection.json`:

1. **Create Invoice** → Note the `id`
2. **Update Invoice** → Add `transaction_ids` array
3. **Get Invoice Details** → Verify `transaction_job_allocations` and totals

Example test sequence:
```bash
# 1. Create invoice
POST /create-invoice {"client": "Test", "amount": 5000}
# Response: {"invoice": {"id": "abc-123"}}

# 2. Link transactions
POST /update-invoice {"invoice_id": "abc-123", "transaction_ids": ["tx-1", "tx-2"]}
# Response: {"transactions_linked": 2, "invoice": {"total_actual_cost": 3200}}

# 3. Replace transactions
POST /update-invoice {"invoice_id": "abc-123", "transaction_ids": ["tx-3"]}
# Response: {"transactions_linked": 1, "transactions_unlinked": 2}

# 4. Remove all
POST /update-invoice {"invoice_id": "abc-123", "transaction_ids": []}
# Response: {"transactions_linked": 0, "transactions_unlinked": 1}
```

---

## Summary

**To link/unlink transactions while editing an invoice**:

✅ **Use**: `update-invoice` with `transaction_ids` parameter  
✅ **Behavior**: Replaces ALL existing transaction links  
✅ **Add**: Include existing + new transaction IDs  
✅ **Remove**: Exclude from array  
✅ **Clear All**: Pass empty array `[]`  
✅ **Keep Existing**: Omit parameter entirely

**Totals auto-update** - you don't need to manually calculate!
