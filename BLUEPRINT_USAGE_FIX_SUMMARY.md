# Blueprint Usage Bug Fix Summary

**Status:** ✅ FIXED & DEPLOYED

## Issue
When creating an invoice with multiple blueprints and editing only some of them, only the edited blueprints appeared in the invoice. Non-edited blueprints were missing.

## Example Request (from Frontend)
```json
{
  "client": "Custom Project Client",
  "blueprint_ids": [
    "bp-kitchen-standard-123",      // ← Should be included (not edited)
    "bp-custom-addition-456"        // ← Should be included (edited)
  ],
  "blueprint_usages": [
    {
      "blueprint_id": "bp-custom-addition-456",
      "actual_sale_price": 15000,
      "actual_materials_cost": 6000,
      "actual_labor_cost": 4000
    }
    // bp-kitchen-standard-123 not here (no overrides)
  ],
  "auto_calculate_from_blueprints": true
}
```

**Expected:** Both blueprints linked to invoice  
**Before Fix:** Only `bp-custom-addition-456` was linked ❌  
**After Fix:** Both blueprints are linked ✅

## Root Cause
The backend had an `else if` that ignored `blueprint_ids` when `blueprint_usages` was present.

### Before (Buggy Code)
```typescript
if (blueprint_usages && Array.isArray(blueprint_usages) && blueprint_usages.length > 0) {
  idsToFetch = blueprint_usages.map((b: any) => b.blueprint_id);
  // ❌ Only gets IDs from blueprint_usages
} else if (blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0) {
  idsToFetch = blueprint_ids;
  // ❌ This never runs when blueprint_usages is present
}
```

### After (Fixed Code)
```typescript
const usageIds = blueprint_usages && Array.isArray(blueprint_usages) && blueprint_usages.length > 0
  ? blueprint_usages.map((b: any) => b.blueprint_id)
  : [];
const directIds = blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0
  ? blueprint_ids
  : [];

// ✅ Merge and deduplicate IDs from both sources
idsToFetch = Array.from(new Set([...usageIds, ...directIds]));
```

## How It Works Now

1. **Frontend sends:**
   - `blueprint_ids`: ALL blueprint IDs (edited + non-edited)
   - `blueprint_usages`: ONLY blueprints with custom values

2. **Backend fetches:**
   - ALL unique IDs from both `blueprint_ids` AND `blueprint_usages`

3. **Backend applies:**
   - Overrides for blueprints in `blueprint_usages`
   - Database values for blueprints NOT in `blueprint_usages`

4. **Result:**
   - All blueprints are linked to the invoice
   - Edited blueprints use custom values
   - Non-edited blueprints use their stored values

## Deployment
- **File Modified:** `/supabase/functions/create-invoice/index.ts`
- **Deployed:** ✅ Yes
- **Deployment Time:** 2025-11-25 18:26 UTC
- **Project:** kquthqdlixwoxzpyijcp

## Testing Checklist

✅ **Test Case 1:** Two blueprints, edit second one
```json
{
  "blueprint_ids": ["bp-1", "bp-2"],
  "blueprint_usages": [{ "blueprint_id": "bp-2", "actual_sale_price": 9999 }]
}
```
Expected: Both bp-1 and bp-2 linked, bp-2 uses 9999 sale price

✅ **Test Case 2:** Two blueprints, edit both
```json
{
  "blueprint_ids": ["bp-1", "bp-2"],
  "blueprint_usages": [
    { "blueprint_id": "bp-1", "actual_sale_price": 5000 },
    { "blueprint_id": "bp-2", "actual_sale_price": 9999 }
  ]
}
```
Expected: Both linked with override prices

✅ **Test Case 3:** Two blueprints, edit neither
```json
{
  "blueprint_ids": ["bp-1", "bp-2"],
  "blueprint_usages": []
}
```
Expected: Both linked with database values

✅ **Test Case 4:** Legacy format (blueprint_ids only)
```json
{
  "blueprint_ids": ["bp-1", "bp-2"]
}
```
Expected: Both linked with database values (backward compatible)

## Related Files
- **Fixed:** `/supabase/functions/create-invoice/index.ts`
- **Analysis:** `/BLUEPRINT_USAGE_BUG_ANALYSIS.md`
- **Postman:** `mintro_postman_collection.json` (line 1023 has example)

## Impact
- ✅ Fixes invoice creation with multiple blueprints
- ✅ Backward compatible (still supports legacy `blueprint_ids` only)
- ✅ Frontend code needs no changes
- ✅ No database schema changes needed
