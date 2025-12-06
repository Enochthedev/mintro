# Mintro API Documentation - Complete Reference

Complete API documentation for frontend integration with meticulous examples and mock responses.

---

## 🔐 Authentication

All Edge Function requests require:
```
Authorization: Bearer <ACCESS_TOKEN>
```

Replace `<ACCESS_TOKEN>` with a valid user JWT token obtained from Supabase Auth.

---

## 🧾 Invoice Endpoints

### 1. List Invoices
**Method**: `GET`  
**Endpoint**: `/functions/v1/list-invoices`

**Query Parameters**:
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `status` | string | No | Filter by status | `draft`, `paid`, `sent` |
| `client` | string | No | Filter by client name | `John Smith` |
| `service_type` | string | No | Filter by service type | `Kitchen Remodel` |
| `start_date` | string | No | Start date (ISO 8601) | `2025-01-01` |
| `end_date` | string | No | End date (ISO 8601) | `2025-12-31` |
| `has_actual_costs` | boolean | No | Filter by cost tracking | `true`, `false` |
| `limit` | number | No | Results per page | `10` (default: 50) |
| `offset` | number | No | Pagination offset | `0` (default: 0) |

**Example Request**:
```
GET {{SupabaseUrl}}/functions/v1/list-invoices?status=paid&limit=10&offset=0
```

**Example Response** (200 OK):
```json
{
  "success": true,
  "invoices": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "invoice": "INV-001",
      "client": "John Smith Construction",
      "amount": 5000.00,
      "status": "paid",
      "total_actual_cost": 3200.00,
      "actual_profit": 1800.00,
      "invoice_date": "2025-11-15",
      "due_date": "2025-12-15",
      "service_type": "Kitchen Remodel",
      "notes": "50% deposit required upfront",
      "tags": ["urgent", "residential"],
      "created_at": "2025-11-15T10:00:00Z",
      "transaction_job_allocations": [
        {
          "id": "alloc-123",
          "allocation_amount": 3200.00,
          "allocation_percentage": 100,
          "notes": null,
          "created_at": "2025-11-15T10:30:00Z",
          "transactions": {
            "id": "tx-456",
            "transaction_id": "plaid_tx_789",
            "date": "2025-11-10",
            "name": "Home Depot - Materials",
            "merchant_name": "Home Depot",
            "amount": -3200.00,
            "category": "Materials"
          }
        }
      ]
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 10,
    "offset": 0,
    "has_more": true
  },
  "summary": {
    "total_invoices": 45,
    "total_revenue": 125000.00,
    "total_actual_cost": 78000.00,
    "total_actual_profit": 47000.00,
    "average_profit_margin": 37.60,
    "invoices_with_costs": 32
  }
}
```

---

### 2. Get Invoice Details
**Method**: `GET`  
**Endpoint**: `/functions/v1/get-invoice-details`

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `invoice_id` | UUID | **Yes** | Invoice ID |

**Example Request**:
```
GET {{SupabaseUrl}}/functions/v1/get-invoice-details?invoice_id=550e8400-e29b-41d4-a716-446655440000
```

**Example Response** (200 OK):
```json
{
  "success": true,
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "client": "John Smith Construction",
    "amount": 5000.00,
    "status": "paid",
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00,
    "cost_override_by_user": false,
    "invoice_date": "2025-11-15",
    "due_date": "2025-12-15",
    "service_type": "Kitchen Remodel",
    "notes": "50% deposit required upfront",
    "tags": ["urgent", "residential"],
    "created_at": "2025-11-15T10:00:00Z",
    "updated_at": "2025-11-15T10:00:00Z",
    "invoice_items": [
      {
        "id": "item-1",
        "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
        "description": "Labor - Kitchen Installation",
        "category": "Labor",
        "qty": 40,
        "unit_price": 75.00,
        "total_price": 3000.00
      },
      {
        "id": "item-2",
        "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
        "description": "Materials - Cabinets",
        "category": "Materials",
        "qty": 1,
        "unit_price": 2000.00,
        "total_price": 2000.00
      }
    ],
    "transaction_job_allocations": [
      {
        "id": "alloc-123",
        "allocation_amount": 3200.00,
        "allocation_percentage": 100,
        "notes": null,
        "created_at": "2025-11-15T10:30:00Z",
        "transactions": {
          "id": "tx-456",
          "transaction_id": "plaid_tx_789",
          "date": "2025-11-10",
          "name": "Home Depot - Materials",
          "merchant_name": "Home Depot",
          "amount": -3200.00,
          "category": "Materials"
        }
      }
    ],
    "blueprint_usage": [],
    "invoice_cost_overrides": [],
    "profit_summary": {
      "revenue": 5000.00,
      "actual_cost": 3200.00,
      "actual_profit": 1800.00,
      "profit_margin": 36.00,
      "has_cost_override": false,
      "linked_expenses_total": 3200.00
    },
    "blueprint_comparison": null
  }
}
```

**Error Response** (404):
```json
{
  "error": "Invoice not found"
}
```

---

### 3. Create Invoice
**Method**: `POST`  
**Endpoint**: `/functions/v1/create-invoice`

**Request Body Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `client` | string | **Yes** | Client name |
| `amount` | number | Conditional* | Invoice amount |
| `status` | string | No | Status (default: "draft") |
| `due_date` | string | No | Due date (ISO 8601) |
| `invoice_date` | string | No | Invoice date (ISO 8601, default: today) |
| `service_type` | string | No | Service type |
| `notes` | string | No | Notes |
| `tags` | string[] | No | Tags array |
| `items` | object[] | No | Invoice line items |
| `transaction_ids` | UUID[] | No | Transaction IDs to link |
| `blueprint_ids` | UUID[] | No | Blueprint IDs to use |
| `auto_calculate_from_blueprints` | boolean | No | Auto-calculate from blueprints |

*`amount` is **required** unless `auto_calculate_from_blueprints` is `true` with `blueprint_ids`.

#### Example 1: Basic Invoice with Transactions (No Blueprint)

**Request**:
```json
{
  "client": "John Smith Construction",
  "amount": 5000.00,
  "status": "draft",
  "transaction_ids": ["TRANSACTION_ID_1", "TRANSACTION_ID_2"],
  "due_date": "2025-12-15",
  "service_type": "Kitchen Remodel",
  "notes": "50% deposit required"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "user_id": "user-123",
    "client": "John Smith Construction",
    "amount": 5000.00,
    "status": "draft",
    "due_date": "2025-12-15",
    "service_type": "Kitchen Remodel",
    "notes": "50% deposit required",
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00,
    "created_at": "2025-11-22T10:00:00Z",
    "transaction_job_allocations": [
      {
        "id": "alloc-1",
        "allocation_amount": 1600.00,
        "transactions": {
          "id": "TRANSACTION_ID_1",
          "name": "Home Depot",
          "amount": -1600.00
        }
      },
      {
        "id": "alloc-2",
        "allocation_amount": 1600.00,
        "transactions": {
          "id": "TRANSACTION_ID_2",
          "name": "Lowe's",
          "amount": -1600.00
        }
      }
    ]
  },
  "blueprints_linked": 0,
  "transactions_linked": 2,
  "total_actual_cost": 3200.00
}
```

#### Example 2: Single Blueprint (Auto-Calculate)

**Request**:
```json
{
  "client": "John Smith Construction",
  "status": "draft",
  "due_date": "2025-12-15",
  "service_type": "Kitchen Remodel",
  "notes": "Kitchen remodel using standard blueprint",
  "blueprint_ids": ["bp-kitchen-standard-123"],
  "auto_calculate_from_blueprints": true
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "invoice": "INV-002",
    "client": "John Smith Construction",
    "amount": 7500.00,
    "status": "draft",
    "due_date": "2025-12-15",
    "service_type": "Kitchen Remodel",
    "notes": "Kitchen remodel using standard blueprint",
    "created_at": "2025-11-22T10:05:00Z",
    "blueprint_usage": [
      {
        "id": "usage-1",
        "blueprint_id": "bp-kitchen-standard-123",
        "cost_blueprints": {
          "id": "bp-kitchen-standard-123",
          "name": "Standard Kitchen Remodel",
          "total_estimated_cost": 5000.00,
          "target_sale_price": 7500.00
        }
      }
    ]
  },
  "blueprints_linked": 1,
  "transactions_linked": 0,
  "total_actual_cost": null
}
```

#### Example 3: Multiple Blueprints (Auto-Calculate)

**Request**:
```json
{
  "client": "Sarah & Mike Wedding",
  "status": "draft",
  "due_date": "2025-12-20",
  "service_type": "Wedding Catering",
  "notes": "Full wedding package - 150 guests",
  "blueprint_ids": [
    "bp-wedding-dinner-123",
    "bp-dessert-table-456",
    "bp-bar-service-789"
  ],
  "auto_calculate_from_blueprints": true
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "invoice": "INV-003",
    "client": "Sarah & Mike Wedding",
    "amount": 12500.00,
    "status": "draft",
    "due_date": "2025-12-20",
    "service_type": "Wedding Catering",
    "notes": "Full wedding package - 150 guests",
    "created_at": "2025-11-22T10:10:00Z",
    "blueprint_usage": [
      {
        "id": "usage-2",
        "blueprint_id": "bp-wedding-dinner-123",
        "cost_blueprints": {
          "name": "Wedding Dinner Package",
          "target_sale_price": 8000.00
        }
      },
      {
        "id": "usage-3",
        "blueprint_id": "bp-dessert-table-456",
        "cost_blueprints": {
          "name": "Dessert Table",
          "target_sale_price": 2500.00
        }
      },
      {
        "id": "usage-4",
        "blueprint_id": "bp-bar-service-789",
        "cost_blueprints": {
          "name": "Bar Service",
          "target_sale_price": 2000.00
        }
      }
    ]
  },
  "blueprints_linked": 3,
  "transactions_linked": 0,
  "total_actual_cost": null
}
```

#### Example 4: Manual Amount Override with Blueprint

**Request**:
```json
{
  "client": "Custom Project Inc",
  "amount": 7500.00,
  "status": "draft",
  "service_type": "Custom Package",
  "notes": "Negotiated custom price",
  "blueprint_ids": ["bp-kitchen-standard-123"],
  "auto_calculate_from_blueprints": false
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "invoice": "INV-004",
    "client": "Custom Project Inc",
    "amount": 7500.00,
    "status": "draft",
    "service_type": "Custom Package",
    "notes": "Negotiated custom price",
    "created_at": "2025-11-22T10:15:00Z",
    "blueprint_usage": [
      {
        "id": "usage-5",
        "blueprint_id": "bp-kitchen-standard-123",
        "cost_blueprints": {
          "name": "Standard Kitchen Remodel",
          "target_sale_price": 7500.00
        }
      }
    ]
  },
  "blueprints_linked": 1,
  "transactions_linked": 0,
  "total_actual_cost": null
}
```

#### Example 5: Complete Invoice with Line Items

**Request**:
```json
{
  "client": "John Smith Construction",
  "amount": 5000.00,
  "status": "draft",
  "due_date": "2025-12-15",
  "invoice_date": "2025-11-15",
  "service_type": "Kitchen Remodel",
  "notes": "50% deposit required upfront",
  "tags": ["urgent", "residential"],
  "items": [
    {
      "description": "Labor - Kitchen Installation",
      "category": "Labor",
      "qty": 40,
      "unit_price": 75.00
    },
    {
      "description": "Materials - Cabinets",
      "category": "Materials",
      "qty": 1,
      "unit_price": 2000.00
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "invoice": "INV-005",
    "client": "John Smith Construction",
    "amount": 5000.00,
    "status": "draft",
    "due_date": "2025-12-15",
    "invoice_date": "2025-11-15",
    "service_type": "Kitchen Remodel",
    "notes": "50% deposit required upfront",
    "tags": ["urgent", "residential"],
    "created_at": "2025-11-22T10:20:00Z",
    "invoice_items": [
      {
        "id": "item-1",
        "description": "Labor - Kitchen Installation",
        "category": "Labor",
        "qty": 40,
        "unit_price": 75.00,
        "total_price": 3000.00
      },
      {
        "id": "item-2",
        "description": "Materials - Cabinets",
        "category": "Materials",
        "qty": 1,
        "unit_price": 2000.00,
        "total_price": 2000.00
      }
    ]
  },
  "blueprints_linked": 0,
  "transactions_linked": 0,
  "total_actual_cost": null
}
```

---

### 4. Update Invoice
**Method**: `POST`  
**Endpoint**: `/functions/v1/update-invoice`

**Request Body Parameters**:
| `invoice_id` | UUID | **Yes** | Invoice ID to update |
| `client` | string | No | Updated client name |
| `amount` | number | No | Updated amount |
| `status` | string | No | Updated status |
| `due_date` | string | No | Updated due date |
| `invoice_date` | string | No | Updated invoice date |
| `service_type` | string | No | Updated service type |
| `notes` | string | No | Updated notes |
| `tags` | string[] | No | Updated tags |
| `transaction_ids` | UUID[] | No | Transaction IDs to link (replaces ALL existing) |

**Important**: Only include the fields you want to update. Omitted fields remain unchanged.

**Transaction Linking Behavior**:
- If `transaction_ids` is **included**: Replaces ALL existing transaction links
- If `transaction_ids` is **omitted**: Existing transaction links remain unchanged
- Invoice totals (`total_actual_cost`, `actual_profit`) automatically recalculate when transactions change

#### Example 1: Update Invoice Fields Only (Keep Existing Transactions)

**Request**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "sent",
  "notes": "Invoice sent to client via email on 2025-11-22"
}
```
**Note**: `transaction_ids` is **not included**, so existing transaction links remain unchanged.

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "client": "John Smith Construction",
    "amount": 5000.00,
    "status": "sent",
    "notes": "Invoice sent to client via email on 2025-11-22",
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00,
    "updated_at": "2025-11-22T10:30:00Z"
  }
}
```

#### Example 2: Add Transactions (Link for First Time)

**Current State**: Invoice has NO transactions linked  
**Want**: Add 2 transactions

**Request**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_ids": ["tx-abc-123", "tx-def-456"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "client": "John Smith Construction",
    "amount": 5000.00,
    "status": "draft",
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00,
    "updated_at": "2025-11-22T10:35:00Z"
  },
  "transactions_linked": 2,
  "transactions_unlinked": 0
}
```

#### Example 3: Replace Transactions (Change Linked Transactions)

**Current State**: Invoice has `tx-1` and `tx-2` linked  
**Want**: Replace with `tx-3`, `tx-4`, `tx-5`

**Request**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_ids": ["tx-ghi-789", "tx-jkl-012", "tx-mno-345"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "total_actual_cost": 4500.00,
    "actual_profit": 500.00,
    "updated_at": "2025-11-22T10:40:00Z"
  },
  "transactions_linked": 3,
  "transactions_unlinked": 2
}
```

#### Example 4: Remove All Transactions (Clear Links)

**Current State**: Invoice has `tx-1`, `tx-2`, `tx-3` linked  
**Want**: Remove all transactions

**Request**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_ids": []
}
```
**Note**: Empty array `[]` removes all transaction links.

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "total_actual_cost": null,
    "actual_profit": null,
    "updated_at": "2025-11-22T10:45:00Z"
  },
  "transactions_linked": 0,
  "transactions_unlinked": 3
}
```

#### Example 5: Update Invoice + Change Transactions (Combined)

**Request**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "sent",
  "notes": "Invoice sent to client",
  "transaction_ids": ["tx-abc-123", "tx-def-456"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Invoice updated successfully",
  "invoice": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice": "INV-001",
    "status": "sent",
    "notes": "Invoice sent to client",
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00,
    "updated_at": "2025-11-22T10:50:00Z"
  },
  "transactions_linked": 2,
  "transactions_unlinked": 1
}
```

---

## 📊 Transaction Linking Summary

| Scenario | `transaction_ids` Value | Behavior | Response Includes |
|----------|------------------------|----------|-------------------|
| **KEEP** | Omit parameter | Keep existing links unchanged | No transaction counts |
| **ADD** | `["tx-1", "tx-2"]` (first time) | Link new transactions | `transactions_linked: 2, transactions_unlinked: 0` |
| **REPLACE** | `["tx-3", "tx-4"]` (already has links) | Remove old, link new | Both counts shown |
| **REMOVE** | `[]` (empty array) | Remove all links, clear totals | `transactions_linked: 0, transactions_unlinked: N` |

**Key Points**:
- ✅ Transactions always 100% allocated to invoice
- ✅ Replaces ALL existing links (not additive)
- ✅ Totals auto-calculate (`total_actual_cost`, `actual_profit`)
- ✅ Empty array clears all links
- ✅ Omit parameter to keep existing links

---

### 5. Delete Invoice
**Method**: `POST`  
**Endpoint**: `/functions/v1/delete-invoice`

**Request Body Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `invoice_id` | UUID | **Yes** | Invoice ID to delete |
| `force` | boolean | No | Force delete with linked data (default: false) |

**Example Request (Normal)**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example Request (Force Delete)**:
```json
{
  "invoice_id": "550e8400-e29b-41d4-a716-446655440000",
  "force": true
}
```

**Example Response - Has Linked Data** (400):
```json
{
  "error": "Invoice has linked data",
  "message": "This invoice has linked blueprint usages or transactions. Set force=true to delete anyway.",
  "linked_data": {
    "blueprint_usages": 2,
    "transaction_links": 3,
    "invoice_items": 5
  }
}
```

**Example Response - Success** (200 OK):
```json
{
  "success": true,
  "message": "Invoice deleted successfully",
  "invoice_number": "INV-001",
  "deleted_data": {
    "blueprint_usages": 2,
    "transaction_links": 3,
    "invoice_items": 5,
    "cost_overrides": 1
  }
}
```

---

## 💸 Transaction Endpoints

### 1. Link Transaction to Job
**Method**: `POST`  
**Endpoint**: `/functions/v1/link-transaction-to-job`

**Request Body Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transaction_id` | UUID | **Yes** | Transaction ID |
| `job_id` | UUID | **Yes** | Invoice ID (job) |
| `allocation_percentage` | number | No | Percentage (1-100, default: 100) |
| `allocation_amount` | number | No | Manual amount override |
| `notes` | string | No | Allocation notes |

#### Example 1: Full Allocation (100%)

**Request**:
```json
{
  "transaction_id": "tx-12345",
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction linked to job successfully",
  "link": {
    "id": "alloc-789",
    "user_id": "user-123",
    "transaction_id": "tx-12345",
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "allocation_amount": 3200.00,
    "allocation_percentage": 100,
    "notes": null,
    "created_at": "2025-11-22T11:00:00Z",
    "transactions": {
      "id": "tx-12345",
      "name": "Home Depot - Materials",
      "merchant_name": "Home Depot",
      "amount": -3200.00,
      "date": "2025-11-20"
    },
    "invoices": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "invoice": "INV-001",
      "client": "John Smith Construction"
    }
  },
  "transaction": {
    "id": "tx-12345",
    "name": "Home Depot - Materials",
    "amount": -3200.00
  },
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "invoice_number": "INV-001",
    "client_name": "John Smith Construction",
    "total_amount": 5000.00
  },
  "invoice_totals_updated": {
    "total_actual_cost": 3200.00,
    "actual_profit": 1800.00
  }
}
```

#### Example 2: Partial Allocation (50%)

**Request**:
```json
{
  "transaction_id": "tx-12345",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "allocation_percentage": 50,
  "notes": "Split cost across two projects"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction linked to job successfully",
  "link": {
    "id": "alloc-790",
    "transaction_id": "tx-12345",
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "allocation_amount": 1600.00,
    "allocation_percentage": 50,
    "notes": "Split cost across two projects",
    "created_at": "2025-11-22T11:05:00Z"
  },
  "invoice_totals_updated": {
    "total_actual_cost": 1600.00,
    "actual_profit": 3400.00
  }
}
```

#### Example 3: Manual Amount Override

**Request**:
```json
{
  "transaction_id": "tx-12345",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "allocation_amount": 1500.00,
  "notes": "Custom allocation amount"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction linked to job successfully",
  "link": {
    "id": "alloc-791",
    "transaction_id": "tx-12345",
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "allocation_amount": 1500.00,
    "allocation_percentage": null,
    "notes": "Custom allocation amount",
    "created_at": "2025-11-22T11:10:00Z"
  },
  "invoice_totals_updated": {
    "total_actual_cost": 1500.00,
    "actual_profit": 3500.00
  }
}
```

---

### 2. Unlink Transaction from Job
**Method**: `POST`  
**Endpoint**: `/functions/v1/unlink-transaction-from-job`

**Request Body Parameters (Option A - Recommended)**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `allocation_id` | UUID | **Yes*** | Allocation ID |

**Request Body Parameters (Option B - Alternative)**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transaction_id` | UUID | **Yes*** | Transaction ID |
| `job_id` | UUID | **Yes*** | Invoice ID |

*Either `allocation_id` OR both `transaction_id` + `job_id` required.

#### Example 1: Unlink by Allocation ID (Recommended)

**Request**:
```json
{
  "allocation_id": "alloc-789"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction unlinked from job successfully",
  "unlinked_allocation_id": "alloc-789",
  "invoice_totals_updated": {
    "total_actual_cost": null,
    "actual_profit": null,
    "remaining_linked_transactions": 0
  }
}
```

#### Example 2: Unlink by Transaction + Job

**Request**:
```json
{
  "transaction_id": "tx-12345",
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction unlinked from job successfully",
  "unlinked_allocation_id": "alloc-789",
  "invoice_totals_updated": {
    "total_actual_cost": 1600.00,
    "actual_profit": 3400.00,
    "remaining_linked_transactions": 1
  }
}
```

**Error Response - Not Found** (404):
```json
{
  "error": "Allocation not found"
}
```

---

## 🔍 Common Use Cases & Workflows

### Workflow 1: Create Invoice with Immediate Transaction Links
```javascript
// Step 1: Create invoice with transaction_ids
POST /functions/v1/create-invoice
{
  "client": "ABC Construction",
  "amount": 5000.00,
  "transaction_ids": ["tx-1", "tx-2"]
}

// Result: Invoice created with totals auto-calculated
```

### Workflow 2: Link Transactions After Invoice Creation
```javascript
// Step 1: Create invoice
POST /functions/v1/create-invoice
{
  "client": "ABC Construction",
  "amount": 5000.00
}
// Returns: { invoice: { id: "inv-123" } }

// Step 2: Link transaction later
POST /functions/v1/link-transaction-to-job
{
  "transaction_id": "tx-1",
  "job_id": "inv-123"
}
```

### Workflow 3: Split Transaction Across Multiple Jobs
```javascript
// Link 50% to Job A
POST /functions/v1/link-transaction-to-job
{
  "transaction_id": "tx-1",
  "job_id": "job-a",
  "allocation_percentage": 50
}

// Link 50% to Job B
POST /functions/v1/link-transaction-to-job
{
  "transaction_id": "tx-1",
  "job_id": "job-b",
  "allocation_percentage": 50
}
```

### Workflow 4: Correct a Mistake
```javascript
// Step 1: Unlink wrong transaction
POST /functions/v1/unlink-transaction-from-job
{
  "allocation_id": "alloc-wrong"
}

// Step 2: Link correct transaction
POST /functions/v1/link-transaction-to-job
{
  "transaction_id": "tx-correct",
  "job_id": "inv-123"
}
```

---

## ⚠️ Error Handling

### Standard Error Response Format
```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes
| Code | Meaning | When It Occurs |
|------|---------|----------------|
| `200` | Success | Request completed successfully |
| `400` | Bad Request | Missing/invalid parameters |
| `401` | Unauthorized | Missing/invalid auth token |
| `404` | Not Found | Resource doesn't exist |
| `500` | Internal Server Error | Server-side error |

### Common Errors

#### Missing Required Field
```json
{
  "error": "client is required"
}
```

#### Invalid UUID
```json
{
  "error": "Invalid invoice_id format"
}
```

#### Unauthorized
```json
{
  "error": "Unauthorized"
}
```

#### Invoice Not Found
```json
{
  "error": "Invoice not found"
}
```

---

## 📌 Best Practices

1. **Always check `success` field** in responses before processing data
2. **Use `allocation_id` for unlinking** - it's more reliable than transaction_id + job_id
3. **Verify `invoice_totals_updated`** after linking/unlinking to confirm calculations
4. **Use `auto_calculate_from_blueprints`** when working with standard packages
5. **Paginate large lists** using `limit` and `offset` parameters
6. **Handle errors gracefully** - check HTTP status codes and error messages
7. **Store `allocation_id`** when linking transactions for easy unlinking later
8. **Use query parameters for GET requests** (list-invoices, get-invoice-details)
9. **Use request body for POST requests** (create, update, delete, link, unlink)
10. **Test with valid UUIDs** - use the format `550e8400-e29b-41d4-a716-446655440000`

---

## 🧪 Testing Tips

### Using Postman
1. Import the `mintro_postman_enhanced.json` collection
2. Set collection variables:
   - `PROJECT_URL`: Your Supabase project URL
   - `ACCESS_TOKEN`: Valid user JWT token
3. Use the pre-filled examples as templates
4. Check the "Example Responses" tab to see expected results

### Getting an ACCESS_TOKEN
```javascript
// In your frontend or test script
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});
const accessToken = data.session.access_token;
```

### Test Sequence
1. **Create** an invoice
2. **Get** the invoice details to verify
3. **Link** a transaction to see totals update
4. **Unlink** the transaction
5. **Update** the invoice status
6. **Delete** the invoice (test both normal and force)

---

## 📖 TypeScript Types (Reference)

```typescript
interface Invoice {
  id: string;
  invoice: string;
  client: string;
  amount: number;
  status: string;
  total_actual_cost?: number;
  actual_profit?: number;
  invoice_date?: string;
  due_date?: string;
  service_type?: string;
  notes?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

interface TransactionJobAllocation {
  id: string;
  transaction_id: string;
  job_id: string;
  allocation_amount: number;
  allocation_percentage?: number;
  notes?: string;
  created_at: string;
}

interface CreateInvoiceRequest {
  client: string;
  amount?: number;
  status?: string;
  due_date?: string;
  invoice_date?: string;
  service_type?: string;
  notes?: string;
  tags?: string[];
  items?: InvoiceItem[];
  transaction_ids?: string[];
  blueprint_ids?: string[];
  auto_calculate_from_blueprints?: boolean;
}

interface LinkTransactionRequest {
  transaction_id: string;
  job_id: string;
  allocation_percentage?: number;
  allocation_amount?: number;
  notes?: string;
}
```
