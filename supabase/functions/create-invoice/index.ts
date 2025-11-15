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

    const {
      client,
      amount,
      status = "draft",
      due_date,
      invoice_date,
      service_type,
      notes,
      tags,
      items, // Optional: array of line items
      blueprint_ids, // Optional: array of blueprint IDs to link
      auto_calculate_from_blueprints = false, // Auto-calculate amount from blueprints
    } = await req.json();

    if (!client || (amount === undefined && !auto_calculate_from_blueprints)) {
      return new Response(
        JSON.stringify({ error: "client and amount are required (or provide blueprint_ids with auto_calculate_from_blueprints=true)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================
    // STEP 1: VALIDATE AND GET BLUEPRINTS
    // ============================================
    let calculatedAmount = amount;
    let blueprints: any[] = [];

    if (blueprint_ids && Array.isArray(blueprint_ids) && blueprint_ids.length > 0) {
      const { data: fetchedBlueprints, error: blueprintError } = await supabaseClient
        .from("cost_blueprints")
        .select("*")
        .eq("user_id", user.id)
        .in("id", blueprint_ids);

      if (blueprintError) {
        throw blueprintError;
      }

      if (!fetchedBlueprints || fetchedBlueprints.length !== blueprint_ids.length) {
        return new Response(
          JSON.stringify({ error: "One or more blueprints not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      blueprints = fetchedBlueprints;

      // Auto-calculate amount from blueprints
      if (auto_calculate_from_blueprints) {
        calculatedAmount = blueprints.reduce(
          (sum, bp) => sum + (parseFloat(bp.target_sale_price || 0)),
          0
        );
      }
    }

    // ============================================
    // STEP 2: CREATE INVOICE
    // ============================================
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from("invoices")
      .insert({
        user_id: user.id,
        client,
        amount: calculatedAmount,
        status,
        due_date,
        invoice_date: invoice_date || new Date().toISOString().split('T')[0],
        service_type,
        notes,
        tags,
      })
      .select()
      .single();

    if (invoiceError) {
      throw invoiceError;
    }

    // Create invoice items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      const itemsToInsert = items.map(item => ({
        invoice_id: invoice.id,
        description: item.description,
        category: item.category,
        qty: item.qty || 1,
        unit_price: item.unit_price,
      }));

      const { error: itemsError } = await supabaseClient
        .from("invoice_items")
        .insert(itemsToInsert);

      if (itemsError) {
        console.error("Error creating invoice items:", itemsError);
      }
    }

    // ============================================
    // STEP 3: CREATE BLUEPRINT USAGE RECORDS
    // ============================================
    let blueprintUsages: any[] = [];

    if (blueprints.length > 0) {
      const usagesToCreate = blueprints.map(blueprint => ({
        user_id: user.id,
        blueprint_id: blueprint.id,
        invoice_id: invoice.id,
        actual_materials_cost: 0, // Will be updated later
        actual_labor_cost: 0,
        actual_overhead_cost: 0,
        actual_sale_price: blueprint.target_sale_price || 0,
        completed_date: invoice_date || new Date().toISOString().split('T')[0],
        notes: `Created with invoice ${invoice.invoice}`,
      }));

      const { data: createdUsages, error: usageError } = await supabaseClient
        .from("blueprint_usage")
        .insert(usagesToCreate)
        .select(`
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price
          )
        `);

      if (usageError) {
        console.error("Error creating blueprint usage:", usageError);
      } else {
        blueprintUsages = createdUsages || [];
      }
    }

    // Fetch complete invoice with items and blueprint usage
    const { data: completeInvoice } = await supabaseClient
      .from("invoices")
      .select(`
        *,
        invoice_items (*),
        blueprint_usage (
          *,
          cost_blueprints (
            id,
            name,
            blueprint_type,
            estimated_materials_cost,
            estimated_labor_cost,
            estimated_overhead_cost,
            total_estimated_cost,
            target_sale_price
          )
        )
      `)
      .eq("id", invoice.id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invoice created successfully",
        invoice: completeInvoice || invoice,
        blueprints_linked: blueprintUsages.length,
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