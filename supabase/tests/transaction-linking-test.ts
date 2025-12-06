
import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CONFIGURATION
// Set these environment variables before running the test
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TEST_USER_EMAIL = "test@example.com";
const TEST_USER_PASSWORD = "password123";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

Deno.test("Transaction Linking Integration Flow", async (t) => {
    let userId: string;
    let token: string;
    let invoiceId: string;
    let transactionId: string;
    let allocationId: string;

    // 1. Setup: Login/Create User
    await t.step("Setup: Authenticate", async () => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: TEST_USER_EMAIL,
            password: TEST_USER_PASSWORD,
        });

        if (error) {
            console.log("Could not sign in, attempting sign up...");
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: TEST_USER_EMAIL,
                password: TEST_USER_PASSWORD,
            });
            if (signUpError) throw signUpError;
            userId = signUpData.user!.id;
            token = signUpData.session!.access_token;
        } else {
            userId = data.user.id;
            token = data.session.access_token;
        }
    });

    // 2. Create Test Data
    await t.step("Create Test Invoice and Transaction", async () => {
        // Create Invoice
        const { data: invoice, error: invError } = await supabase
            .from("invoices")
            .insert({
                user_id: userId,
                client: "Test Client",
                amount: 1000,
                status: "draft",
                invoice_date: new Date().toISOString()
            })
            .select()
            .single();
        if (invError) throw invError;
        invoiceId = invoice.id;

        // Create Transaction
        const { data: transaction, error: txError } = await supabase
            .from("transactions")
            .insert({
                user_id: userId,
                amount: -100,
                name: "Test Expense",
                date: new Date().toISOString(),
                account_id: "dummy_acc_id" // Ensure this exists or mock it if FK constraints exist
            })
            .select()
            .single();
        if (txError) throw txError;
        transactionId = transaction.id;
    });

    // 3. Test Linking
    await t.step("Link Transaction to Job", async () => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/link-transaction-to-job`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                transaction_id: transactionId,
                job_id: invoiceId
            })
        });

        const data = await res.json();
        assertEquals(res.status, 200);
        assertEquals(data.success, true);
        assertExists(data.invoice_totals_updated);
        assertEquals(data.invoice_totals_updated.total_actual_cost, 100);

        allocationId = data.link.id;
    });

    // 4. Verify Invoice State
    await t.step("Verify Invoice Totals Updated", async () => {
        const { data: invoice } = await supabase
            .from("invoices")
            .select("*")
            .eq("id", invoiceId)
            .single();

        assertEquals(invoice.total_actual_cost, 100);
        assertEquals(invoice.actual_profit, 900); // 1000 - 100
    });

    // 5. Test Unlinking
    await t.step("Unlink Transaction", async () => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/unlink-transaction-from-job`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                allocation_id: allocationId
            })
        });

        const data = await res.json();
        assertEquals(res.status, 200);
        assertEquals(data.success, true);
        assertEquals(data.invoice_totals_updated.total_actual_cost, null);
    });

    // 6. Cleanup
    await t.step("Cleanup", async () => {
        await supabase.from("invoices").delete().eq("id", invoiceId);
        await supabase.from("transactions").delete().eq("id", transactionId);
    });
});
