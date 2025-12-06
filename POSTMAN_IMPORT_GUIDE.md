# Mintro API - Postman Collection Import Guide

## 📦 What's Included

The **`mintro_api_collection.json`** file contains a complete, production-ready Postman collection with:

✅ **All Invoice endpoints** with query parameters and body examples  
✅ **Transaction linking/unlinking** with multiple use cases  
✅ **Example responses** for every request (viewable in Postman's "Examples" tab)  
✅ **5 different `create-invoice` scenarios** showing all variations  
✅ **Query parameter descriptions** for easy reference  
✅ **Organized folder structure** with emoji icons for visual clarity

---

## 🚀 How to Import

### Step 1: Open Postman
Download and open [Postman](https://www.postman.com/downloads/) on your machine.

### Step 2: Import the Collection
1. Click **"Import"** in the top-left corner
2. Drag and drop `mintro_api_collection.json` OR click "Choose Files" and select it
3. Postman will show a preview - click **"Import"**

### Step 3: Configure Variables
After importing, you'll see **"Mintro API - Complete"** in your Collections sidebar.

1. Click on the collection name
2. Go to the **Variables** tab
3. Update these values:

| Variable | Current Value | What to Enter |
|----------|--------------|---------------|
| `PROJECT_URL` | `https://kquthqdlixwoxzpyijcp.supabase.co` | ✅ Already set (or update if different) |
| `ANON_KEY` | `YOUR_SUPABASE_ANON_KEY` | Your Supabase Anonymous Key |
| `ACCESS_TOKEN` | `YOUR_USER_ACCESS_TOKEN` | A valid user JWT token |

4. Click **"Save"** (Ctrl+S / Cmd+S)

---

## 🔑 Getting Your Keys

### 1. Getting `ANON_KEY`
1. Go to your [Supabase Dashboard](https://app.supabase.com/)
2. Select your project: `kquthqdlixwoxzpyijcp`
3. Go to **Settings** → **API**
4. Copy the **`anon`** / **`public`** key under "Project API keys"

### 2. Getting `ACCESS_TOKEN`
Run this in your frontend app or a test script:

```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'your-email@example.com',
  password: 'your-password'
});

if (data.session) {
  console.log('ACCESS_TOKEN:', data.session.access_token);
  // Copy this token and paste it into Postman
}
```

**Note**: Access tokens expire after 1 hour by default. You'll need to refresh them periodically.

---

## 📚 Using the Collection

### Viewing Examples
Every request in the collection has an **"Example Response"**:

1. Click on any request (e.g., "Get Invoice Details")
2. Look for the **"Examples"** dropdown in the right panel
3. Click on "Example Response" to see what the API returns

### Testing GET Requests

**Example: List Invoices**
1. Navigate to **📋 Invoices** → **List Invoices**
2. Notice the **Query Params** tab shows:
   - `limit` = 10 (enabled)
   - `offset` = 0 (enabled)
   - `status` = paid (disabled - enable to filter by status)
   - `client` = John Smith (disabled - enable to filter by client)
3. Toggle checkboxes to enable/disable filters
4. Click **Send** to test

**Example: Get Invoice Details**
1. Navigate to **📋 Invoices** → **Get Invoice Details**
2. In **Query Params**, replace `550e8400-e29b-41d4-a716-446655440000` with a real invoice ID
3. Click **Send**
4. View the detailed response with invoice items, transactions, and profit summary

### Testing POST Requests

**Example: Create Invoice**
The "Create Invoice" folder has **5 different examples**:

1. **Basic with Transactions** - Link transactions immediately
2. **Single Blueprint (Auto-Calculate)** - Amount calculated from one blueprint
3. **Multiple Blueprints (Auto-Calculate)** - Sum of all blueprint prices
4. **Manual Amount Override** - Use blueprint but set custom price
5. **Complete with Line Items** - Full invoice with itemized billing

To test:
1. Navigate to **📋 Invoices** → **Create Invoice** → **1. Basic with Transactions**
2. Replace placeholder IDs (like `TRANSACTION_ID_1`) with real transaction IDs from your database
3. Click **Send**
4. Check the "Example Response" tab to see what a successful response looks like

---

## 💡 Tips & Best Practices

### Query Parameters (GET requests)
- **Enabled params** (checked) are sent with the request
- **Disabled params** (unchecked) are ignored
- Edit values directly in the Params tab
- Use the format `{{SupabaseUrl}}/functions/v1/get-invoice-details?invoice_id=<YOUR_ID>`

### Request Bodies (POST requests)
- The JSON is pre-filled with example values
- Replace placeholders like `INVOICE_ID`, `TRANSACTION_ID` with real UUIDs
- Check the "Example Response" to see expected output
- Use the "Beautify" button to format JSON

### Common Workflows

**1. Test the full invoice lifecycle:**
```
Create Invoice → Get Invoice Details → Update Invoice → Delete Invoice
```

**2. Test transaction linking:**
```
Create Invoice → Link Transaction → Get Invoice Details (verify totals) → Unlink Transaction
```

**3. Test blueprint-based invoices:**
```
Use "Create Invoice" → "2. Single Blueprint (Auto-Calculate)"
Then: Get Invoice Details → verify amount was auto-calculated
```

### Debugging
- If you get `401 Unauthorized`: Check your `ACCESS_TOKEN` - it may have expired
- If you get `404 Not Found`: Verify the UUID you're using exists in your database
- If you get `400 Bad Request`: Check the error message - usually a missing required field

---

## 📖 Full API Documentation

For complete API documentation with detailed descriptions, field explanations, and business logic, see:

**[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**

This file includes:
- Detailed parameter descriptions
- TypeScript type definitions
- Common use cases and workflows
- Error handling guide
- Best practices

---

## ✅ Quick Test Checklist

Use this checklist to verify everything works:

- [ ] Import collection successfully
- [ ] Set `ANON_KEY` variable
- [ ] Set `ACCESS_TOKEN` variable
- [ ] Test "List Invoices" (GET with query params)
- [ ] Test "Get Invoice Details" (GET with required param)
- [ ] Test "Create Invoice - Basic with Transactions" (POST)
- [ ] Test "Link Transaction to Job - Full Allocation" (POST)
- [ ] Test "Unlink Transaction from Job - By Allocation ID" (POST)
- [ ] View example responses for each request
- [ ] Verify query parameters are working (enable/disable filters)

---

## 🐛 Troubleshooting

### "Could not send request"
- Check your internet connection
- Verify `PROJECT_URL` is correct: `https://kquthqdlixwoxzpyijcp.supabase.co`

### "Unauthorized"  
- Your `ACCESS_TOKEN` may have expired (tokens expire after 1 hour)
- Re-authenticate and get a new token
- Make sure you're using `Bearer {{ACCESS_TOKEN}}` in the Authorization header

### "Invoice not found" / "Transaction not found"
- Replace placeholder UUIDs with real IDs from your database
- Use "List Invoices" to get valid invoice IDs first
- Query your `transactions` table to get valid transaction IDs

### Query params not working
- Make sure the checkbox next to the param is **checked** (enabled)
- Verify the param name matches exactly (case-sensitive)
- Check the URL preview at the top to see which params are included

---

## 🎯 Next Steps

1. **Import the collection** and configure your variables
2. **Review [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** for detailed specs
3. **Test each endpoint** using the examples provided
4. **Integrate into your frontend** using the request/response formats
5. **Run the tests** in [TESTING_GUIDE.md](./TESTING_GUIDE.md) for integration testing

---

## 📞 Support

For questions about:
- **API behavior**: See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- **Transaction linking**: See [TRANSACTION_LINKING_API_REFERENCE.md](./TRANSACTION_LINKING_API_REFERENCE.md)
- **Recent fixes**: See [TRANSACTION_LINKING_FIXES.md](./TRANSACTION_LINKING_FIXES.md)
- **Integration testing**: See [TESTING_GUIDE.md](./TESTING_GUIDE.md)
