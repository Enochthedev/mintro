# Blueprint Usage Bug Analysis - Create Invoice [FIXED]

## Problem Description

When creating an invoice with multiple blueprints and editing only some of them, only the edited blueprints show up in the invoice. The non-edited blueprints disappear.

### Example Scenario:
1. User adds **Blueprint A** and **Blueprint B** to an invoice
2. User edits **Blueprint B** (changes actual costs or sale price)
3. After creation, only **Blueprint B** shows up in the invoice
4. **Blueprint A** is missing ❌

## Root Cause - BACKEND BUG ✅ FIXED

The frontend was **correctly** sending both parameters:
- `blueprint_ids`: ALL blueprints → `["bp-1", "bp-2"]`
- `blueprint_usages`: ONLY edited blueprints → `[{ blueprint_id: "bp-2", actual_sale_price: 9999 }]`

However, the backend had an `else if` that **ignored `blueprint_ids` when `blueprint_usages` was present**.

### Original Buggy Code (`/supabase/functions/create-invoice/index.ts`)

Lines 54-59 (BEFORE FIX):
```typescript
let idsToFetch = [];
if (blueprint_usages && Array.isArray(blueprint_usages) && blueprint_usages.length > 0) {
  idsToFetch = blueprint_usages.map((b: any) => b.blueprint_id);
  // ❌ BUG: Only gets IDs from blueprint_usages, ignores blueprint_ids!
} else if (blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0) {
  idsToFetch = blueprint_ids;
  // ❌ This block never runs when blueprint_usages is present
}
```

### Fixed Code (AFTER FIX):
```typescript
// Merge and deduplicate IDs from both sources
const usageIds = blueprint_usages && Array.isArray(blueprint_usages) && blueprint_usages.length > 0
  ? blueprint_usages.map((b: any) => b.blueprint_id)
  : [];
const directIds = blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0
  ? blueprint_ids
  : [];

// ✅ Now fetches ALL unique IDs from both arrays
idsToFetch = Array.from(new Set([...usageIds, ...directIds]));
```

The override merging logic (lines 77-93) was already correct and didn't need changes.
```

## Expected Frontend Behavior

The frontend **MUST** send **ALL** blueprints in the `blueprint_usages` array, even if they're not being edited.

### ✅ Correct Request Format

If you have 2 blueprints and only edit the second one:

```json
{
  "client": "Test Client",
  "status": "draft",
  "blueprint_usages": [
    {
      "blueprint_id": "blueprint-1-id"
      // No overrides - will use DB values
    },
    {
      "blueprint_id": "blueprint-2-id",
      "actual_sale_price": 15000,
      "actual_materials_cost": 6000,
      "actual_labor_cost": 4000
      // Has overrides - will use these values
    }
  ],
  "auto_calculate_from_blueprints": true
}
```

### ❌ Incorrect Request Format (Current Bug)

```json
{
  "client": "Test Client",
  "status": "draft",
  "blueprint_usages": [
    {
      "blueprint_id": "blueprint-2-id",
      "actual_sale_price": 15000,
      "actual_materials_cost": 6000,
      "actual_labor_cost": 4000
    }
    // Missing blueprint-1-id ❌
  ],
  "auto_calculate_from_blueprints": true
}
```

In the incorrect format, only `blueprint-2-id` will be fetched and linked to the invoice. `blueprint-1-id` will be completely ignored.

## Solution Options

### Option 1: Fix Frontend (Recommended)
**Ensure the frontend sends ALL blueprints in the `blueprint_usages` array**, even non-edited ones.

**Pros:**
- Matches the existing API design
- No backend changes needed
- Consistent with Postman examples
- Gives frontend full control over which blueprints to include

**Cons:**
- Requires frontend code changes

### Option 2: Modify Backend to Merge with Existing Blueprints
Add logic to merge `blueprint_usages` with any existing `blueprint_ids` parameter.

**Code Change Required:**
```typescript
// After line 59, add:
if (blueprint_usages && blueprint_usages.length > 0 && blueprint_ids && blueprint_ids.length > 0) {
  // Merge: Include IDs from both sources
  const usageIds = blueprint_usages.map(b => b.blueprint_id);
  const additionalIds = blueprint_ids.filter(id => !usageIds.includes(id));
  idsToFetch = [...usageIds, ...additionalIds];
}
```

**Pros:**
- More flexible API
- Allows separate parameters for "all blueprints" vs "edited blueprints"

**Cons:**
- More complex logic
- Two sources of truth for blueprint IDs
- Could lead to confusion about which parameter to use

### Option 3: Backend Defensive Check + Clear Error Message
Add validation to warn when `blueprint_usages` is used incorrectly.

**Pros:**
- Helps debug frontend issues
- Provides clear error messages

**Cons:**
- Doesn't actually solve the problem
- Adds more code complexity

## Recommended Action

**Fix the frontend** to send all blueprints in the `blueprint_usages` array. This aligns with:
1. The existing API design
2. The Postman collection examples
3. The principle of explicit over implicit behavior

## Frontend Implementation Checklist

When building the invoice creation UI with blueprints:

- [ ] Maintain a list of ALL selected blueprints (not just edited ones)
- [ ] When a blueprint is edited, update its properties in the list
- [ ] When submitting, send the FULL list in `blueprint_usages`
- [ ] For non-edited blueprints, send only `{ "blueprint_id": "..." }`
- [ ] For edited blueprints, include override fields: `actual_sale_price`, `actual_materials_cost`, `actual_labor_cost`, `actual_overhead_cost`

## Testing

### Test Case 1: Multiple Blueprints, Edit One
```json
POST /functions/v1/create-invoice
{
  "client": "Test Client",
  "status": "draft",
  "blueprint_usages": [
    { "blueprint_id": "bp-1" },
    { "blueprint_id": "bp-2", "actual_sale_price": 9999 }
  ],
  "auto_calculate_from_blueprints": true
}
```

**Expected Result:**
- Invoice created with 2 blueprint_usage records
- BP-1 uses database values
- BP-2 uses override sale price of 9999

### Test Case 2: Multiple Blueprints, Edit All
```json
POST /functions/v1/create-invoice
{
  "client": "Test Client",
  "status": "draft",
  "blueprint_usages": [
    { "blueprint_id": "bp-1", "actual_sale_price": 5000 },
    { "blueprint_id": "bp-2", "actual_sale_price": 9999 }
  ],
  "auto_calculate_from_blueprints": true
}
```

**Expected Result:**
- Invoice created with 2 blueprint_usage records
- Both use override sale prices

### Test Case 3: Multiple Blueprints, Edit None
```json
POST /functions/v1/create-invoice
{
  "client": "Test Client",
  "status": "draft",
  "blueprint_usages": [
    { "blueprint_id": "bp-1" },
    { "blueprint_id": "bp-2" }
  ],
  "auto_calculate_from_blueprints": true
}
```

**Expected Result:**
- Invoice created with 2 blueprint_usage records
- Both use database values

## Related Files

- `/supabase/functions/create-invoice/index.ts` - Main invoice creation logic
- `mintro_postman_collection.json` - Line 1023 has example with blueprint overrides
- `API_DOCUMENTATION.md` - Should be updated with this clarification

## Status

- [x] Bug identified
- [ ] Frontend fix implemented
- [ ] Testing completed
- [ ] Documentation updated
