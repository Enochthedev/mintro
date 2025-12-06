# Frontend Integration Guide - Line Item Cost Override

## Quick Summary
You can now add `override_split` to line items to manually specify their cost/profit breakdown, just like blueprints have.

## API Changes

### 1. Creating Invoices with Override

**Endpoint:** `POST /create-invoice`

```json
{
  "client": "ABC Corp",
  "items": [
    {
      "description": "Website Development - Flat Fee",
      "category": "Revenue",
      "qty": 1,
      "unit_price": 8200,
      "override_split": {
        "income": 5000,
        "cost": 3200
      }
    },
    {
      "description": "Regular expense",
      "category": "Expense",
      "qty": 2,
      "unit_price": 50
    }
  ]
}
```

**Result:**
- Invoice amount: $8300
- Total cost: $3300 ($3200 override + $100 expense)
- Profit: $5000

### 2. Updating Invoices with Override

**Endpoint:** `POST /update-invoice`

```json
{
  "invoice_id": "uuid-here",
  "items": [
    {
      "description": "Updated website development",
      "qty": 1,
      "unit_price": 9500,
      "override_split": {
        "income": 6000,
        "cost": 3500
      }
    }
  ]
}
```

### 3. Reading Invoice Data

**Endpoint:** `GET /get-invoice-details?invoice_id=xxx`

**Response includes:**
```json
{
  "invoice": {
    "invoice_items": [
      {
        "description": "Website Development - Flat Fee",
        "qty": 1,
        "unit_price": 8200,
        "is_override": true,
        "override_income": 5000,
        "override_cost": 3200
      }
    ]
  }
}
```

## UI Implementation

### 1. Add Override Button/Checkbox
```jsx
// On each line item, add:
{!item.category || item.category === 'Revenue' ? (
  <Checkbox
    label="Manual cost breakdown"
    checked={item.hasOverride}
    onChange={() => openOverrideModal(item)}
  />
) : null}
```

### 2. Override Modal
```jsx
function OverrideModal({ item, onSave }) {
  const [cost, setCost] = useState(item.override_cost || 0);
  const total = item.qty * item.unit_price;
  const profit = total - cost;

  return (
    <Modal>
      <h3>Cost Breakdown for: {item.description}</h3>
      
      <FormField label="Revenue (what client pays)" disabled>
        ${total.toFixed(2)}
      </FormField>
      
      <FormField label="Cost (what you paid)" required>
        <Input
          type="number"
          value={cost}
          onChange={(e) => setCost(parseFloat(e.target.value))}
          max={total}
        />
      </FormField>
      
      <FormField label="Profit" disabled>
        ${profit.toFixed(2)}
        {profit < 0 && <Warning>Negative profit!</Warning>}
      </FormField>
      
      <Button onClick={() => onSave({
        ...item,
        override_split: {
          income: total,
          cost: cost
        }
      })}>
        Save Breakdown
      </Button>
    </Modal>
  );
}
```

### 3. Display Override Indicator
```jsx
function LineItemRow({ item }) {
  const total = item.qty * item.unit_price;
  const profit = item.is_override 
    ? item.override_income - item.override_cost 
    : null;

  return (
    <tr>
      <td>{item.description}</td>
      <td>{item.qty}</td>
      <td>${item.unit_price}</td>
      <td>${total.toFixed(2)}</td>
      <td>
        {item.is_override && (
          <Badge color="blue">
            Override: ${item.override_cost} cost, ${profit?.toFixed(2)} profit
          </Badge>
        )}
      </td>
    </tr>
  );
}
```

### 4. Invoice Summary Calculation
```jsx
function InvoiceSummary({ invoice }) {
  // Calculate totals
  const lineItemRevenue = invoice.invoice_items?.reduce((sum, item) => 
    sum + (item.qty * item.unit_price), 0
  ) || 0;

  const lineItemCosts = invoice.invoice_items?.reduce((sum, item) => {
    if (item.is_override) {
      return sum + item.override_cost;
    } else if (!item.category || item.category !== 'Revenue') {
      return sum + (item.qty * item.unit_price);
    }
    return sum;
  }, 0) || 0;

  const blueprintRevenue = invoice.blueprint_usage?.reduce((sum, bp) => 
    sum + bp.actual_sale_price, 0
  ) || 0;

  const blueprintCosts = invoice.blueprint_usage?.reduce((sum, bp) => 
    sum + bp.total_actual_cost, 0
  ) || 0;

  const transactionCosts = invoice.transaction_job_allocations?.reduce((sum, alloc) => 
    sum + Math.abs(alloc.allocation_amount), 0
  ) || 0;

  const totalRevenue = blueprintRevenue + lineItemRevenue;
  const totalCost = blueprintCosts + lineItemCosts + transactionCosts;
  const totalProfit = totalRevenue - totalCost;

  return (
    <div>
      <h3>Invoice Summary</h3>
      
      <Section title="Revenue Breakdown">
        <Row label="Blueprints" value={blueprintRevenue} />
        <Row label="Line Items" value={lineItemRevenue} />
        <Row label="Total Revenue" value={totalRevenue} bold />
      </Section>

      <Section title="Cost Breakdown">
        <Row label="Blueprint Costs" value={blueprintCosts} />
        <Row label="Line Item Costs" value={lineItemCosts} />
        <Row label="Linked Transactions" value={transactionCosts} />
        <Row label="Total Cost" value={totalCost} bold />
      </Section>

      <Section title="Profit">
        <Row 
          label="Net Profit" 
          value={totalProfit} 
          color={totalProfit >= 0 ? 'green' : 'red'}
          bold 
        />
        <Row 
          label="Profit Margin" 
          value={`${((totalProfit / totalRevenue) * 100).toFixed(1)}%`}
        />
      </Section>
    </div>
  );
}
```

## Validation

### Client-Side Validation
```javascript
function validateOverrideSplit(item) {
  const total = item.qty * item.unit_price;
  const { income, cost } = item.override_split;

  // Income + cost must equal total
  if (Math.abs((income + cost) - total) > 0.01) {
    return {
      valid: false,
      error: `Income + cost (${income + cost}) must equal item total (${total})`
    };
  }

  // Cost should be non-negative
  if (cost < 0) {
    return {
      valid: false,
      error: 'Cost cannot be negative'
    };
  }

  // Warn if cost exceeds income (negative profit)
  if (cost > income) {
    return {
      valid: true,
      warning: `This item has negative profit: $${(income - cost).toFixed(2)}`
    };
  }

  return { valid: true };
}
```

## Error Handling

### Backend Error Response
```json
{
  "error": "Invalid override_split for \"Website Development\": income + cost (8500) must equal item total (8200)",
  "details": {
    "item_description": "Website Development",
    "item_total": 8200,
    "override_income": 5000,
    "override_cost": 3500
  }
}
```

### Handle in Frontend
```javascript
try {
  const response = await createInvoice(data);
  // Success
} catch (error) {
  if (error.response?.data?.details?.item_description) {
    // Show specific item error
    showError(`Error in "${error.response.data.details.item_description}": ${error.response.data.error}`);
  } else {
    showError(error.message);
  }
}
```

## Client View (PDF/Web)

For client-facing invoices, **hide** the override details:

```jsx
function ClientInvoiceView({ invoice }) {
  // Client sees ONLY:
  return (
    <InvoiceDocument>
      <LineItems>
        {invoice.invoice_items.map(item => (
          <LineItem key={item.id}>
            <Description>{item.description}</Description>
            <Qty>{item.qty}</Qty>
            <Price>${item.unit_price}</Price>
            <Total>${(item.qty * item.unit_price).toFixed(2)}</Total>
            {/* NO COST BREAKDOWN SHOWN */}
          </LineItem>
        ))}
      </LineItems>
      
      <Total>
        Total: ${invoice.amount.toFixed(2)}
      </Total>
      
      {/* NO PROFIT/COST INFO */}
    </InvoiceDocument>
  );
}
```

## Internal View (Dashboard)

For business owner, **show** full breakdown:

```jsx
function InternalInvoiceView({ invoice }) {
  return (
    <div>
      <h2>Invoice Details (Internal)</h2>
      
      {/* Show full cost breakdown */}
      <LineItemsTable>
        {invoice.invoice_items.map(item => (
          <LineItemRow
            key={item.id}
            item={item}
            showCostBreakdown={true} // Show override info
          />
        ))}
      </LineItemsTable>
      
      {/* Show profit analysis */}
      <ProfitAnalysis invoice={invoice} />
    </div>
  );
}
```

## Best Practices

1. **Auto-fill Income**: When user opens override modal, automatically set `income = qty * unit_price` (read-only)
2. **Clear Indicators**: Always show a visual indicator when an item has an override
3. **Validation**: Validate on blur, not just on submit
4. **Confirmation**: Ask for confirmation if profit is negative
5. **Preserve Data**: If user toggles override off, preserve the values in case they toggle back on
6. **Bulk Edit**: Consider allowing bulk override for multiple similar items

## Testing Checklist

- [ ] Can add override to new line item
- [ ] Can edit existing override
- [ ] Can remove override from line item
- [ ] Validation errors display correctly
- [ ] Invoice totals update automatically
- [ ] Override data persists after save
- [ ] Client view hides override data
- [ ] Internal view shows override data
- [ ] Works with mixed items (some with override, some without)
- [ ] Works with blueprints + line items
