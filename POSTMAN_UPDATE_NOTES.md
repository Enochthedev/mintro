# Postman Collection Update - Line Item Override Split

## New Example Added

Added a new request example to the Postman collection under **Create Invoice**:

### "With Line Item Cost Override"

This example demonstrates the new `override_split` feature for manual cost/profit breakdown on flat/bundled fee line items.

**Request:**
```json
{
  "client": "ABC Corp",
  "status": "draft",
  "due_date": "2025-12-30",
  "service_type": "Consulting",
  "notes": "Flat fee consulting project",
  "items": [
    {
      "description": "Website Development - Flat Fee",
      "category": "Revenue",
      "qty": 1,
      "unit_price": 5000,
      "override_split": {
        "income": 5000,
        "cost": 3200
      }
    },
    {
      "description": "Hosting Setup",
      "category": "Revenue",
      "qty": 1,
      "unit_price": 500,
      "override_split": {
        "income": 500,
        "cost": 150
      }
    },
    {
      "description": "Domain Registration",
      "category": "Expense",
      "qty": 1,
      "unit_price": 50
    }
  ]
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "new-uuid",
    "invoice": "INV-006",
    "client": "ABC Corp",
    "amount": 5550,
    "total_actual_cost": 3400,
    "actual_profit": 2150,
    "invoice_items": [
      {
        "id": "item-1",
        "description": "Website Development - Flat Fee",
        "qty": 1,
        "unit_price": 5000,
        "is_override": true,
        "override_income": 5000,
        "override_cost": 3200
      },
      {
        "id": "item-2",
        "description": "Hosting Setup",
        "qty": 1,
        "unit_price": 500,
        "is_override": true,
        "override_income": 500,
        "override_cost": 150
      },
      {
        "id": "item-3",
        "description": "Domain Registration",
        "qty": 1,
        "unit_price": 50,
        "is_override": false
      }
    ]
  },
  "blueprints_linked": 0,
  "transactions_linked": 0
}
```

## Calculation Breakdown

- **Total Invoice Amount**: $5550 ($5000 + $500 + $50)
- **Total Actual Cost**: $3400 ($3200 + $150 + $50)
  - Override #1 cost: $3200
  - Override #2 cost: $150  
  - Expense item: $50
- **Actual Profit**: $2150 ($5550 - $3400)

## Update Update-Invoice Example

Also added example with override_split to the update-invoice section.

## Key Points

1. **override_split.income** must equal `qty × unit_price`
2. **override_split.cost** can be any value (represents your actual cost)
3. Line items **without** override_split work as before
4. Mixed items (some with override, some without) are supported
5. Works alongside blueprints and transactions

Due to the large size of the Postman JSON file, I recommend using the Postman generator script to programmatically add this example.
