# Testing Guide

This guide explains how to run the tests for the Mintro Edge Functions.

## Prerequisites

- [Deno](https://deno.land/) installed
- A running Supabase instance (Local or Remote)

## Running Tests

### 1. Set Environment Variables
You need to provide your Supabase URL and Anon Key.

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
```

### 2. Run the Test
Run the test file using `deno test`. Note that you need to allow network access.

```bash
deno test --allow-net --allow-env --allow-read supabase/tests/transaction-linking-test.ts
```

## What is Tested?

The `transaction-linking-test.ts` performs a full integration test:
1.  **Authenticates** a test user.
2.  **Creates** a dummy Invoice and Transaction.
3.  **Links** the transaction to the invoice using the `link-transaction-to-job` Edge Function.
4.  **Verifies** that the invoice's `total_actual_cost` and `actual_profit` were updated correctly in the database.
5.  **Unlinks** the transaction using the `unlink-transaction-from-job` Edge Function.
6.  **Verifies** that the invoice totals reverted to their original state.
7.  **Cleans up** the test data.

## Manual Testing via Postman

You can also use the generated Postman collection to test manually:
1.  Import `mintro_postman_collection.json` into Postman.
2.  Set the `ANON_KEY` and `ACCESS_TOKEN` variables.
3.  Run the requests in the **Transactions > Edge Functions** folder.
