import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const QUICKBOOKS_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID");
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
const QUICKBOOKS_REDIRECT_URI = Deno.env.get("QUICKBOOKS_REDIRECT_URI");
const QUICKBOOKS_ENVIRONMENT = Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox";
const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QUICKBOOKS_API_BASE_URL = QUICKBOOKS_ENVIRONMENT === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // Get query parameters (works for both GET and POST)
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    const error = url.searchParams.get("error");
    console.log("Callback received:", {
      method: req.method,
      code: code ? "present" : "missing",
      state: state ? "present" : "missing",
      realmId,
      error
    });
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    if (error) {
      console.error("QuickBooks authorization failed:", error);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=${encodeURIComponent(error)}`
        }
      });
    }
    if (!code || !realmId || !state) {
      console.error("Missing required parameters:", {
        code: !!code,
        realmId,
        state: !!state
      });
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=missing_params`
        }
      });
    }
    // Decode state to get user_id
    let userId;
    let adminClient;
    try {
      const stateData = JSON.parse(atob(state));
      userId = stateData.user_id;
      console.log("Decoded user_id from state:", userId);

      adminClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
    } catch (e) {
      console.error("Failed to decode state:", e);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=invalid_state`
        }
      });
    }
    // Exchange code for tokens
    const basicAuth = btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`);
    console.log("Exchanging code for tokens...");
    const tokenResponse = await fetch(QUICKBOOKS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: QUICKBOOKS_REDIRECT_URI
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error("QuickBooks token exchange failed:", tokenData);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=token_exchange_failed`
        }
      });
    }
    const { access_token, refresh_token, expires_in } = tokenData;
    console.log("Token exchange successful, expires_in:", expires_in);
    // Get company info - don't fail the whole flow if this errors
    let companyName = "Unknown";
    let country = "US";
    try {
      console.log("Fetching company info...");
      const companyResponse = await fetch(
        `${QUICKBOOKS_API_BASE_URL}/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            "Authorization": `Bearer ${access_token}`,
            "Accept": "application/json",
          },
        }
      );

      if (companyResponse.ok) {
        const companyData = await companyResponse.json();
        const companyInfo = companyData.CompanyInfo || {};
        companyName = companyInfo.CompanyName || "Unknown";
        country = companyInfo.Country || "US";
        console.log("Company name:", companyName);
      } else {
        console.error("Company info fetch failed:", companyResponse.status, await companyResponse.text());
      }
    } catch (e) {
      console.error("Company info fetch error (continuing anyway):", e.message);
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Check if user has existing connection with different realm_id
    const { data: existing } = await adminClient
      .from("quickbooks_connections")
      .select("id, realm_id, company_name")
      .eq("user_id", userId)
      .single();

    // If switching companies, auto-clear old synced data
    if (existing && existing.realm_id !== realmId) {
      console.log("Company switch detected:", existing.company_name, "->", companyName, "- clearing old data");

      // Get QB expenses to find affected invoices
      const { data: qbExpenses } = await adminClient
        .from("quickbooks_expenses")
        .select("id, linked_invoice_id, is_linked_to_invoice")
        .eq("user_id", userId);

      const qbIds = (qbExpenses || []).map((e: any) => e.id);
      const invSet = new Set<string>();
      (qbExpenses || []).forEach((e: any) => {
        if (e.is_linked_to_invoice && e.linked_invoice_id) invSet.add(e.linked_invoice_id);
      });
      const affectedInvoiceIds = Array.from(invSet);

      // Clear duplicate flags on Plaid transactions
      if (qbIds.length > 0) {
        await adminClient
          .from("transactions")
          .update({ potential_qb_duplicate_id: null, duplicate_confidence: null, duplicate_status: null })
          .eq("user_id", userId)
          .in("potential_qb_duplicate_id", qbIds);
      }

      // Delete QB expenses
      await adminClient.from("quickbooks_expenses").delete().eq("user_id", userId);

      // Delete QB P&L reports
      await adminClient.from("quickbooks_pnl_reports").delete().eq("user_id", userId);

      // Delete QB invoice mappings
      await adminClient.from("quickbooks_invoice_mappings").delete().eq("user_id", userId);

      // Recalculate affected invoice costs
      for (const invoiceId of Array.from(affectedInvoiceIds)) {
        try {
          const { data: plaidAllocs } = await adminClient
            .from("transaction_job_allocations")
            .select("allocation_amount")
            .eq("job_id", invoiceId)
            .eq("user_id", userId);

          const overhead = (plaidAllocs || []).reduce(
            (s: number, a: any) => s + Math.abs(Number(a.allocation_amount || 0)), 0
          );

          await adminClient.from("invoices").update({
            actual_materials_cost: 0,
            actual_labor_cost: 0,
            actual_overhead_cost: overhead,
            total_actual_cost: overhead,
            updated_at: new Date().toISOString(),
          }).eq("id", invoiceId);
        } catch (e: any) {
          console.error("Recalc failed:", e.message);
        }
      }

      console.log("Old company data cleared");
    }

    // Upsert connection - works for fresh, reconnect, and company switch
    console.log("Saving connection to database...");
    const { data: connection, error: insertError } = await adminClient
      .from("quickbooks_connections")
      .upsert({
        user_id: userId,
        realm_id: realmId,
        access_token,
        refresh_token,
        token_expires_at: expiresAt.toISOString(),
        company_name: companyName,
        country: country,
        status: "active",
      }, {
        onConflict: "user_id",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Database insert error:", insertError);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${frontendUrl}/quickbooks?status=error&message=database_error`
        }
      });
    }

    console.log("Connection saved successfully:", connection.id);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `${frontendUrl}/quickbooks?status=success&company=${encodeURIComponent(companyName)}`
      }
    });
  } catch (error) {
    console.error("Callback error:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `${frontendUrl}/quickbooks?status=error&message=${encodeURIComponent(error.message)}`
      }
    });
  }
});
