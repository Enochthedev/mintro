import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { transaction_ids } = await req.json();

    if (!transaction_ids || !Array.isArray(transaction_ids)) {
      return new Response(JSON.stringify({ error: "transaction_ids array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get transactions
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("*")
      .in("id", transaction_ids)
      .eq("user_id", user.id);

    if (txError || !transactions) {
      throw txError || new Error("Transactions not found");
    }

    // Get active blueprints
    const { data: blueprints, error: bpError } = await supabaseClient
      .from("cost_blueprints")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (bpError) throw bpError;

    const matches = [];

    for (const transaction of transactions) {
      for (const blueprint of blueprints || []) {
        const match = checkBlueprintMatch(transaction, blueprint);
        
        if (match.confidence > 0.7) {
          matches.push({
            transaction_id: transaction.id,
            blueprint_id: blueprint.id,
            confidence: match.confidence,
            expense_type: match.expense_type,
            reason: match.reason,
          });
        }
      }
    }

    // Auto-link high-confidence matches
    const autoLinked = [];
    for (const match of matches) {
      if (match.confidence > 0.9) {
        await supabaseClient.from("blueprint_expense_allocations").insert({
          transaction_id: match.transaction_id,
          blueprint_id: match.blueprint_id,
          expense_type: match.expense_type,
          allocation_amount: Math.abs(transactions.find(t => t.id === match.transaction_id)?.amount || 0),
          notes: `Auto-linked: ${match.reason}`,
        });
        
        autoLinked.push(match);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      matches_found: matches.length,
      auto_linked: autoLinked.length,
      suggestions: matches.filter(m => m.confidence <= 0.9),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function checkBlueprintMatch(transaction: any, blueprint: any): {
  confidence: number;
  expense_type: string;
  reason: string;
} {
  let confidence = 0;
  let expense_type = 'materials';
  const reasons = [];

  // Check merchant name patterns
  const merchantLower = (transaction.merchant_name || transaction.name).toLowerCase();
  
  // Materials merchants
  if (merchantLower.includes('home depot') || merchantLower.includes('lowes') || 
      merchantLower.includes('supply') || merchantLower.includes('lumber')) {
    confidence += 0.3;
    expense_type = 'materials';
    reasons.push('materials merchant');
  }
  
  // Labor/contractor
  if (merchantLower.includes('contractor') || merchantLower.includes('labor') ||
      merchantLower.includes('payroll') || merchantLower.includes('wage')) {
    confidence += 0.4;
    expense_type = 'labor';
    reasons.push('labor keyword');
  }
  
  // Subscription services
  if (blueprint.blueprint_type === 'subscription' && transaction.amount > 0 && 
      Math.abs(transaction.amount - blueprint.estimated_materials_cost) < 5) {
    confidence += 0.6;
    expense_type = 'overhead';
    reasons.push('matches subscription amount');
  }
  
  // Amount-based matching
  if (blueprint.estimated_materials_cost && 
      Math.abs(transaction.amount) >= blueprint.estimated_materials_cost * 0.8 &&
      Math.abs(transaction.amount) <= blueprint.estimated_materials_cost * 1.2) {
    confidence += 0.2;
    reasons.push('amount within range');
  }

  return {
    confidence: Math.min(confidence, 1.0),
    expense_type,
    reason: reasons.join(', '),
  };
}