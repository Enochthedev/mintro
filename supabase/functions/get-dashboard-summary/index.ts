import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    // Calculate date ranges
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    // ============================================
    // 1. KEY METRICS (KPI CARDS)
    // ============================================
    
    // Current month invoices
    const { data: currentMonthInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .gte("invoice_date", currentMonthStart.toISOString().split('T')[0]);

    const currentMonthRevenue = currentMonthInvoices?.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0), 0
    ) || 0;

    const currentMonthProfit = currentMonthInvoices
      ?.filter(inv => inv.actual_profit !== null)
      .reduce((sum, inv) => sum + parseFloat(inv.actual_profit || 0), 0) || 0;

    // Last month comparison
    const { data: lastMonthInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .gte("invoice_date", lastMonthStart.toISOString().split('T')[0])
      .lte("invoice_date", lastMonthEnd.toISOString().split('T')[0]);

    const lastMonthRevenue = lastMonthInvoices?.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0), 0
    ) || 0;

    const revenueChange = lastMonthRevenue > 0 
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
      : 0;

    // Year-to-date
    const { data: ytdInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .gte("invoice_date", yearStart.toISOString().split('T')[0]);

    const ytdRevenue = ytdInvoices?.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0), 0
    ) || 0;

    const ytdProfit = ytdInvoices
      ?.filter(inv => inv.actual_profit !== null)
      .reduce((sum, inv) => sum + parseFloat(inv.actual_profit || 0), 0) || 0;

    // Average profit margin
    const invoicesWithProfit = currentMonthInvoices?.filter(inv => inv.actual_profit !== null) || [];
    const avgMargin = invoicesWithProfit.length > 0
      ? (currentMonthProfit / currentMonthRevenue) * 100
      : 0;

    // ============================================
    // 2. RECENT ACTIVITY
    // ============================================
    
    // Recent invoices
    const { data: recentInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // Recent transactions
    const { data: recentTransactions } = await supabaseClient
      .from("transactions")
      .select(`
        *,
        bank_accounts (
          name,
          mask
        )
      `)
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(10);

    // Recent blueprint usages
    const { data: recentUsages } = await supabaseClient
      .from("blueprint_usage")
      .select(`
        *,
        cost_blueprints (
          name
        ),
        invoices (
          invoice,
          client
        )
      `)
      .eq("user_id", user.id)
      .order("completed_date", { ascending: false })
      .limit(5);

    // ============================================
    // 3. ALERTS & WARNINGS
    // ============================================
    
    // Low margin jobs (< 20%)
    const lowMarginJobs = currentMonthInvoices
      ?.filter(inv => {
        const revenue = parseFloat(inv.amount || 0);
        const profit = parseFloat(inv.actual_profit || 0);
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return margin > 0 && margin < 20;
      })
      .map(inv => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice,
        client: inv.client,
        margin: parseFloat(((parseFloat(inv.actual_profit || 0) / parseFloat(inv.amount || 0)) * 100).toFixed(2)),
      })) || [];

    // Low stock items
    const { data: lowStockItems } = await supabaseClient
      .from("inventory_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .lte("current_quantity", supabaseClient.raw("minimum_quantity"));

    // Unpaid invoices
    const { data: unpaidInvoices } = await supabaseClient
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["draft", "sent"])
      .lte("due_date", today.toISOString().split('T')[0]);

    const overdueAmount = unpaidInvoices?.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0), 0
    ) || 0;

    // Uncategorized transactions
    const { data: uncategorizedTxns, count: uncategorizedCount } = await supabaseClient
      .from("transactions")
      .select("id", { count: "exact" })
      .eq("user_id", user.id)
      .is("category", null);

    // ============================================
    // 4. INVOICE STATUS BREAKDOWN
    // ============================================
    const invoicesByStatus = {
      draft: currentMonthInvoices?.filter(inv => inv.status === "draft").length || 0,
      sent: currentMonthInvoices?.filter(inv => inv.status === "sent").length || 0,
      paid: currentMonthInvoices?.filter(inv => inv.status === "paid").length || 0,
      overdue: currentMonthInvoices?.filter(inv => inv.status === "overdue").length || 0,
    };

    // ============================================
    // 5. TOP CLIENTS (BY REVENUE)
    // ============================================
    const clientRevenue = new Map();
    ytdInvoices?.forEach(inv => {
      const current = clientRevenue.get(inv.client) || 0;
      clientRevenue.set(inv.client, current + parseFloat(inv.amount || 0));
    });

    const topClients = Array.from(clientRevenue.entries())
      .map(([client, revenue]) => ({ client, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ============================================
    // 6. QUICK STATS
    // ============================================
    const { count: totalBlueprints } = await supabaseClient
      .from("cost_blueprints")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { count: totalInventoryItems } = await supabaseClient
      .from("inventory_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { count: totalCategorizationRules } = await supabaseClient
      .from("categorization_rules")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    return new Response(
      JSON.stringify({
        success: true,
        generated_at: new Date().toISOString(),
        kpis: {
          current_month_revenue: parseFloat(currentMonthRevenue.toFixed(2)),
          current_month_profit: parseFloat(currentMonthProfit.toFixed(2)),
          average_profit_margin: parseFloat(avgMargin.toFixed(2)),
          ytd_revenue: parseFloat(ytdRevenue.toFixed(2)),
          ytd_profit: parseFloat(ytdProfit.toFixed(2)),
          revenue_change_mom: parseFloat(revenueChange.toFixed(2)),
          trend: revenueChange > 0 ? "up" : revenueChange < 0 ? "down" : "flat",
        },
        recent_activity: {
          recent_invoices: recentInvoices?.map(inv => ({
            id: inv.id,
            invoice_number: inv.invoice,
            client: inv.client,
            amount: inv.amount,
            status: inv.status,
            created_at: inv.created_at,
          })) || [],
          recent_transactions: recentTransactions?.map(tx => ({
            id: tx.id,
            date: tx.date,
            name: tx.name,
            amount: tx.amount,
            account: tx.bank_accounts?.name,
          })) || [],
          recent_blueprint_usages: recentUsages?.map(usage => ({
            id: usage.id,
            blueprint_name: usage.cost_blueprints?.name,
            invoice_number: usage.invoices?.invoice,
            client: usage.invoices?.client,
            actual_profit: usage.actual_profit,
            completed_date: usage.completed_date,
          })) || [],
        },
        alerts: {
          low_margin_jobs: {
            count: lowMarginJobs.length,
            jobs: lowMarginJobs,
          },
          low_stock_items: {
            count: lowStockItems?.length || 0,
            items: lowStockItems?.slice(0, 5).map(item => ({
              id: item.id,
              name: item.name,
              current_quantity: item.current_quantity,
              minimum_quantity: item.minimum_quantity,
            })) || [],
          },
          overdue_invoices: {
            count: unpaidInvoices?.length || 0,
            amount: parseFloat(overdueAmount.toFixed(2)),
          },
          uncategorized_transactions: {
            count: uncategorizedCount || 0,
          },
        },
        invoice_status: invoicesByStatus,
        top_clients: topClients,
        quick_stats: {
          active_blueprints: totalBlueprints || 0,
          inventory_items: totalInventoryItems || 0,
          categorization_rules: totalCategorizationRules || 0,
          total_invoices_this_month: currentMonthInvoices?.length || 0,
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