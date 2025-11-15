// Auto-Categorization Helper
// This can be imported by exchange-public-token and sync-plaid-transactions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function autoCategorizeTransactions(
  supabaseClient: any,
  userId: string,
  transactionIds: string[]
) {
  if (!transactionIds || transactionIds.length === 0) {
    return { categorized: 0, errors: [] };
  }

  let categorizedCount = 0;
  const errors = [];

  try {
    // Get all active categorization rules for this user
    const { data: rules, error: rulesError } = await supabaseClient
      .from("categorization_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rulesError) {
      console.error("Error fetching rules:", rulesError);
      return { categorized: 0, errors: [rulesError.message] };
    }

    if (!rules || rules.length === 0) {
      console.log("No active categorization rules found");
      return { categorized: 0, errors: [] };
    }

    // Get transactions that need categorization
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("id, name, merchant_name, category")
      .eq("user_id", userId)
      .in("id", transactionIds)
      .is("category", null);

    if (txError) {
      console.error("Error fetching transactions:", txError);
      return { categorized: 0, errors: [txError.message] };
    }

    if (!transactions || transactions.length === 0) {
      console.log("No uncategorized transactions found");
      return { categorized: 0, errors: [] };
    }

    // Apply rules to each transaction
    for (const transaction of transactions) {
      const searchText = `${transaction.name || ""} ${transaction.merchant_name || ""}`.toLowerCase();

      // Find matching rule
      let matchedRule = null;
      for (const rule of rules) {
        const keywords = rule.keywords || [];
        const isMatch = keywords.some((keyword: string) =>
          searchText.includes(keyword.toLowerCase())
        );

        if (isMatch) {
          matchedRule = rule;
          break;
        }
      }

      // Apply category if rule matched
      if (matchedRule) {
        const { error: updateError } = await supabaseClient
          .from("transactions")
          .update({ category: matchedRule.category })
          .eq("id", transaction.id);

        if (updateError) {
          console.error(`Error updating transaction ${transaction.id}:`, updateError);
          errors.push(`Transaction ${transaction.id}: ${updateError.message}`);
        } else {
          categorizedCount++;
          console.log(`Auto-categorized transaction ${transaction.id} as ${matchedRule.category}`);
        }
      }
    }

    return { categorized: categorizedCount, errors };
  } catch (error: any) {
    console.error("Auto-categorization error:", error);
    return { categorized: 0, errors: [error.message] };
  }
}