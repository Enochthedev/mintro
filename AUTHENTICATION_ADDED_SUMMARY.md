# Supabase Authentication Added to Postman Collection

## Summary
Added a new **🔐 Authentication** folder to the Mintro Postman collection with Supabase login endpoints.

## What Was Added

### New Folder: 🔐 Authentication
Located at the **beginning** of the collection (before Invoices), contains:

1. **Sign In with Password**
   - Endpoint: `POST /auth/v1/token?grant_type=password`
   - Body: `{"email": "...", "password": "..."}`
   - Returns: `access_token`, `refresh_token`, and user info
   - Use this to get your ACCESS_TOKEN for other API requests

2. **Sign Up**
   - Endpoint: `POST /auth/v1/signup`
   - Body: `{"email": "...", "password": "..."}`
   - Creates a new user account
   - Returns access token (if email confirmation is disabled)

3. **Refresh Token**
   - Endpoint: `POST /auth/v1/token?grant_type=refresh_token`
   - Body: `{"refresh_token": "..."}`
   - Refreshes an expired access token
   - Access tokens expire after 1 hour by default

## How to Use in Postman

### Quick Start
1. Import `mintro_postman_collection.json` into Postman
2. Set the `ANON_KEY` variable (from Supabase Dashboard → Settings → API)
3. Go to **🔐 Authentication** → **Sign In with Password**
4. Update credentials in request body:
   ```json
   {
     "email": "enochjesse884@gmail.com",
     "password": "wavedidwhat"
   }
   ```
   or
   ```json
   {
     "email": "mintrouser1@mail.com",
     "password": "1234"
   }
   ```
5. Click **Send**
6. Copy the `access_token` from the response
7. Paste it into the `ACCESS_TOKEN` collection variable
8. All other endpoints will now work!

## Documentation Updates

Updated files:
- ✅ `mintro_postman_collection.json` - Added Authentication folder with 3 endpoints
- ✅ `POSTMAN_COLLECTION_README.md` - Updated overview and instructions
  - Total endpoints: 58 (3 auth + 57 Edge Functions, 2 deprecated)
  - Added step-by-step guide to get ACCESS_TOKEN in Postman

## Authentication Endpoint Format

**Endpoint**: `/auth/v1/token?grant_type=password`

**Headers**:
- `apikey: {{ANON_KEY}}`
- `Content-Type: application/json`

**Request Body**:
```json
{
  "email": "your-email@example.com",
  "password": "your-password"
}
```

**Response**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "refresh_token_here",
  "user": {
    "id": "user-uuid",
    "email": "your-email@example.com",
    "created_at": "2025-11-25T10:00:00Z",
    "role": "authenticated"
  }
}
```

## Benefits

✅ No need to use frontend code or terminal to get ACCESS_TOKEN  
✅ All authentication flows available in one place  
✅ Easy token refresh when tokens expire  
✅ Professional organization with emoji icon for quick identification  
✅ Complete request/response examples included  

---

**Note**: This uses Supabase's built-in Auth API endpoints, not custom Edge Functions.
