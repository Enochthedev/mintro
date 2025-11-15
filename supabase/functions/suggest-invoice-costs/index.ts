import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const { invoice_id } = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get invoice with related data
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        blueprint_usage (
          *,
          cost_blueprints (*)
        )
      `)
      .eq("id", invoice_id)
      .eq("user_id", user.id)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get linked expenses
    const { data: linkedExpenses } = await supabaseClient
      .from("transaction_job_allocations")
      .select(`
        *,
        transactions (
          amount,
          name,
          merchant_name,
          category
        )
      `)
      .eq("job_id", invoice_id);

    // Prepare context for AI
    const context = {
      invoice_amount: invoice.amount,
      service_type: invoice.service_type,
      client: invoice.client,
      linked_expenses: linkedExpenses?.map(exp => ({
        amount: exp.allocation_amount,
        vendor: exp.transactions?.name,
        category: exp.transactions?.category,
      })) || [],
      blueprint_estimate: invoice.blueprint_usage && invoice.blueprint_usage.length > 0 ? {
        materials: invoice.blueprint_usage.reduce(
          (sum: number, u: any) => sum + parseFloat(u.cost_blueprints?.estimated_materials_cost || 0), 0
        ),
        labor: invoice.blueprint_usage.reduce(
          (sum: number, u: any) => sum + parseFloat(u.cost_blueprints?.estimated_labor_cost || 0), 0
        ),
        overhead: invoice.blueprint_usage.reduce(
          (sum: number, u: any) => sum + parseFloat(u.cost_blueprints?.estimated_overhead_cost || 0), 0
        ),
      } : null,
    };

    // Call OpenAI
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const prompt = `You are a financial analyst helping estimate actual costs for an invoice.

Invoice Details:
- Total Revenue: $${context.invoice_amount}
- Service Type: ${context.service_type || 'Not specified'}
- Client: ${context.client}

${context.blueprint_estimate ? `Blueprint Estimate:
- Materials: $${context.blueprint_estimate.materials}
- Labor: $${context.blueprint_estimate.labor}
- Overhead: $${context.blueprint_estimate.overhead}` : ''}

Linked Expenses:
${context.linked_expenses.length > 0 
  ? context.linked_expenses.map(e => `- ${e.vendor}: $${e.amount} (${e.category || 'uncategorized'})`).join('\n')
  : '- No expenses linked yet'}

Based on this information, suggest a realistic breakdown of actual costs into:
1. Materials Cost
2. Labor Cost
3. Overhead Cost

Respond ONLY with valid JSON in this exact format:
{
  "materials_cost": <number>,
  "labor_cost": <number>,
  "overhead_cost": <number>,
  "reasoning": "<brief explanation>",
  "confidence": "<high|medium|low>"
}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a financial analyst. Always respond with valid JSON only, no markdown formatting.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error("OpenAI API request failed");
    }

    const completion = await openaiResponse.json();
    const responseText = completion.choices[0].message.content || "{}";
    
    // Clean response
    const cleanedResponse = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const suggestion = JSON.parse(cleanedResponse);

    // Calculate totals
    const totalCost = suggestion.materials_cost + suggestion.labor_cost + suggestion.overhead_cost;
    const profit = context.invoice_amount - totalCost;
    const margin = context.invoice_amount > 0 ? (profit / context.invoice_amount) * 100 : 0;

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: {
          costs: {
            materials: suggestion.materials_cost,
            labor: suggestion.labor_cost,
            overhead: suggestion.overhead_cost,
            total: totalCost,
          },
          profit: {
            amount: profit,
            margin: parseFloat(margin.toFixed(2)),
          },
          reasoning: suggestion.reasoning,
          confidence: suggestion.confidence,
        },
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice,
          amount: invoice.amount,
        },
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