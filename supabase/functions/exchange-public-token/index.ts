import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Configuration, PlaidApi, PlaidEnvironments } from "npm:plaid@15.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID"),
      "PLAID-SECRET": Deno.env.get("PLAID_SECRET"),
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);
const PLAID_BASE_URL = "https://sandbox.plaid.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { public_token } = await req.json();

    if (!public_token) {
      return new Response(
        JSON.stringify({ error: "public_token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get accounts and institution info
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts;
    const institutionId = accountsResponse.data.item.institution_id;

    // Get institution name
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId!,
      country_codes: ["US" as any],
    });

    const institutionName = institutionResponse.data.institution.name;

    // Save Plaid item to database
    const { data: plaidItem, error: itemError } = await supabaseClient
      .from("plaid_items")
      .insert({
        user_id: user.id,
        item_id: itemId,
        access_token: accessToken,
        institution_id: institutionId,
        institution_name: institutionName,
        status: "active",
        needs_sync: false,
      })
      .select()
      .single();

    if (itemError) {
      throw itemError;
    }

    // Save accounts to database
    const accountsToInsert = accounts.map((account) => ({
      user_id: user.id,
      plaid_item_id: plaidItem.id,
      account_id: account.account_id,
      name: account.name,
      official_name: account.official_name,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      current_balance: account.balances.current,
      available_balance: account.balances.available,
    }));

    const { data: insertedAccounts, error: accountsError } = await supabaseClient
      .from("bank_accounts")
      .insert(accountsToInsert)
      .select();

    if (accountsError) {
      throw accountsError;
    }

    // ============================================
    // STEP 1: SYNC TRANSACTIONS IMMEDIATELY
    // ============================================
    console.log("Starting immediate transaction sync...");
    let transactionsAdded = 0;
    let insertedTransactions: any[] = [];

    try {
      const syncResponse = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PLAID-CLIENT-ID": Deno.env.get("PLAID_CLIENT_ID")!,
          "PLAID-SECRET": Deno.env.get("PLAID_SECRET")!,
        },
        body: JSON.stringify({
          access_token: accessToken,
          cursor: null,
        }),
      });

      const syncData = await syncResponse.json();

      if (syncResponse.ok && syncData.added && syncData.added.length > 0) {
        console.log(`Fetched ${syncData.added.length} transactions from Plaid`);

        const accountMap = new Map(
          insertedAccounts?.map((acc) => [acc.account_id, acc.id]) || []
        );

        const transactionsToInsert = syncData.added
          .map((txn: any) => ({
            transaction_id: txn.transaction_id,
            bank_account_id: accountMap.get(txn.account_id),
            user_id: user.id,
            date: txn.date,
            amount: txn.amount,
            name: txn.name,
            merchant_name: txn.merchant_name,
            plaid_category: txn.category,
            pending: txn.pending,
            payment_channel: txn.payment_channel,
          }))
          .filter((txn: any) => txn.bank_account_id);

        if (transactionsToInsert.length > 0) {
          const { data: txData, error: txError } = await supabaseClient
            .from("transactions")
            .insert(transactionsToInsert)
            .select();

          if (!txError && txData) {
            insertedTransactions = txData;
            transactionsAdded = txData.length;
            console.log(`✅ Successfully added ${transactionsAdded} transactions`);
          } else {
            console.error("Transaction insert error:", txError);
          }
        }

        await supabaseClient
          .from("plaid_items")
          .update({
            cursor: syncData.next_cursor,
            last_successful_sync: new Date().toISOString(),
          })
          .eq("id", plaidItem.id);

        await supabaseClient.from("plaid_sync_logs").insert({
          plaid_item_id: plaidItem.id,
          user_id: user.id,
          status: "success",
          transactions_added: transactionsAdded,
          transactions_modified: 0,
          transactions_removed: 0,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
      }
    } catch (syncError) {
      console.error("Transaction sync error:", syncError);
      await supabaseClient
        .from("plaid_items")
        .update({ needs_sync: true })
        .eq("id", plaidItem.id);
    }

    // ============================================
    // STEP 2: AUTO-CATEGORIZE & MATCH TO BLUEPRINTS
    // ============================================
    let categorizedCount = 0;
    let blueprintMatchesCount = 0;

    if (insertedTransactions.length > 0) {
      console.log("Starting auto-categorization and blueprint matching...");

      try {
        // Get active blueprints
        const { data: blueprints } = await supabaseClient
          .from("cost_blueprints")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_active", true);

        for (const transaction of insertedTransactions) {
          // Auto-categorize using OpenAI
          try {
            const category = await categorizeTransaction(transaction);
            
            if (category) {
              await supabaseClient
                .from("transaction_categorizations")
                .insert({
                  transaction_id: transaction.id,
                  category: category.category,
                  confidence: category.confidence,
                  categorized_by: "ai",
                });
              categorizedCount++;
            }
          } catch (catError) {
            console.error("Categorization error:", catError);
          }

          // Match to blueprints
          if (blueprints && blueprints.length > 0) {
            const match = findBestBlueprintMatch(transaction, blueprints);
            
            if (match && match.confidence > 0.8) {
              await supabaseClient
                .from("blueprint_expense_allocations")
                .insert({
                  transaction_id: transaction.id,
                  blueprint_id: match.blueprint_id,
                  expense_type: match.expense_type,
                  allocation_amount: Math.abs(transaction.amount),
                  notes: `Auto-linked: ${match.reason}`,
                });
              blueprintMatchesCount++;
            }
          }
        }

        console.log(`✅ Categorized ${categorizedCount} transactions`);
        console.log(`✅ Matched ${blueprintMatchesCount} transactions to blueprints`);
      } catch (aiError) {
        console.error("AI processing error:", aiError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: transactionsAdded > 0 
          ? `Bank connected! Synced ${transactionsAdded} transactions.`
          : "Bank connected successfully.",
        institution_name: institutionName,
        accounts_added: accounts.length,
        transactions_added: transactionsAdded,
        categorized: categorizedCount,
        blueprint_matches: blueprintMatchesCount,
        plaid_item_id: plaidItem.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================
// HELPER: Auto-categorize using OpenAI
// ============================================
async function categorizeTransaction(transaction: any): Promise<{
  category: string;
  confidence: number;
} | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a financial transaction categorizer. Categorize transactions into: materials, labor, overhead, income, or other. Respond with JSON only: {\"category\": \"...\", \"confidence\": 0.0-1.0}"
          },
          {
            role: "user",
            content: `Categorize this transaction:\nMerchant: ${transaction.merchant_name || transaction.name}\nAmount: $${transaction.amount}\nDescription: ${transaction.name}`
          }
        ],
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return result;
  } catch (error) {
    console.error("OpenAI categorization error:", error);
    return null;
  }
}

// ============================================
// HELPER: Match transaction to blueprint
// ============================================
function findBestBlueprintMatch(transaction: any, blueprints: any[]): {
  blueprint_id: string;
  confidence: number;
  expense_type: string;
  reason: string;
} | null {
  let bestMatch: any = null;
  let highestConfidence = 0;

  for (const blueprint of blueprints) {
    let confidence = 0;
    let expenseType = "materials";
    const reasons: string[] = [];

    const merchantLower = (transaction.merchant_name || transaction.name).toLowerCase();

    // Materials keywords
    if (merchantLower.includes("home depot") || merchantLower.includes("lowes") || 
        merchantLower.includes("supply") || merchantLower.includes("lumber") ||
        merchantLower.includes("hardware")) {
      confidence += 0.4;
      expenseType = "materials";
      reasons.push("materials merchant");
    }

    // Labor keywords
    if (merchantLower.includes("contractor") || merchantLower.includes("labor") ||
        merchantLower.includes("payroll") || merchantLower.includes("wage")) {
      confidence += 0.5;
      expenseType = "labor";
      reasons.push("labor keyword");
    }

    // Subscription matching
    if (blueprint.blueprint_type === "subscription" && 
        Math.abs(Math.abs(transaction.amount) - (blueprint.estimated_materials_cost || 0)) < 5) {
      confidence += 0.7;
      expenseType = "overhead";
      reasons.push("matches subscription amount");
    }

    // Amount-based matching
    const totalEstimated = (blueprint.estimated_materials_cost || 0) + 
                          (blueprint.estimated_labor_cost || 0) + 
                          (blueprint.estimated_overhead_cost || 0);
    
    if (totalEstimated > 0 && 
        Math.abs(transaction.amount) >= totalEstimated * 0.7 &&
        Math.abs(transaction.amount) <= totalEstimated * 1.3) {
      confidence += 0.3;
      reasons.push("amount within blueprint range");
    }

    if (confidence > highestConfidence) {
      highestConfidence = confidence;
      bestMatch = {
        blueprint_id: blueprint.id,
        confidence,
        expense_type: expenseType,
        reason: reasons.join(", "),
      };
    }
  }

  return highestConfidence > 0.5 ? bestMatch : null;
}