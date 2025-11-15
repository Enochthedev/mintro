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

    const url = new URL(req.url);
    const months_back = parseInt(url.searchParams.get("months_back") || "6");
    const min_transactions = parseInt(url.searchParams.get("min_transactions") || "3");
    const price_change_threshold = parseFloat(url.searchParams.get("price_change_threshold") || "10");

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months_back);

    // ============================================
    // GET ALL EXPENSE TRANSACTIONS
    // ============================================
    const { data: transactions, error: txError } = await supabaseClient
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .gt("amount", 0) // Only expenses (positive amounts)
      .gte("date", startDate.toISOString().split('T')[0])
      .order("date", { ascending: true });

    if (txError) {
      throw txError;
    }

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No expense transactions found",
          vendors: [],
          price_increases: [],
          price_decreases: [],
          spending_trends: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================
    // ANALYZE BY VENDOR
    // ============================================
    const vendorData = new Map();

    transactions.forEach(tx => {
      const vendor = tx.merchant_name || tx.name || "Unknown";
      const amount = parseFloat(tx.amount);
      const date = new Date(tx.date);

      if (!vendorData.has(vendor)) {
        vendorData.set(vendor, {
          transactions: [],
          total_spent: 0,
          transaction_count: 0,
        });
      }

      const data = vendorData.get(vendor);
      data.transactions.push({ date, amount });
      data.total_spent += amount;
      data.transaction_count += 1;
    });

    // ============================================
    // FILTER VENDORS WITH MIN TRANSACTIONS
    // ============================================
    const qualifiedVendors = Array.from(vendorData.entries())
      .filter(([_, data]) => data.transaction_count >= min_transactions)
      .map(([vendor, data]) => {
        // Sort transactions by date
        data.transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Calculate average transaction amounts for first and last thirds
        const third = Math.floor(data.transactions.length / 3);
        const firstThird = data.transactions.slice(0, third);
        const lastThird = data.transactions.slice(-third);

        const avgFirst = firstThird.reduce((sum, tx) => sum + tx.amount, 0) / firstThird.length;
        const avgLast = lastThird.reduce((sum, tx) => sum + tx.amount, 0) / lastThird.length;

        const priceChange = ((avgLast - avgFirst) / avgFirst) * 100;
        const absoluteChange = avgLast - avgFirst;

        // Calculate frequency (transactions per month)
        const monthsSpan = (data.transactions[data.transactions.length - 1].date.getTime() - 
                           data.transactions[0].date.getTime()) / (1000 * 60 * 60 * 24 * 30);
        const frequency = monthsSpan > 0 ? data.transaction_count / monthsSpan : 0;

        return {
          vendor,
          transaction_count: data.transaction_count,
          total_spent: parseFloat(data.total_spent.toFixed(2)),
          average_transaction: parseFloat((data.total_spent / data.transaction_count).toFixed(2)),
          first_period_avg: parseFloat(avgFirst.toFixed(2)),
          recent_period_avg: parseFloat(avgLast.toFixed(2)),
          price_change_percent: parseFloat(priceChange.toFixed(2)),
          price_change_absolute: parseFloat(absoluteChange.toFixed(2)),
          frequency_per_month: parseFloat(frequency.toFixed(2)),
          first_transaction: data.transactions[0].date.toISOString().split('T')[0],
          last_transaction: data.transactions[data.transactions.length - 1].date.toISOString().split('T')[0],
        };
      });

    // ============================================
    // CATEGORIZE PRICE CHANGES
    // ============================================
    const priceIncreases = qualifiedVendors
      .filter(v => v.price_change_percent > price_change_threshold)
      .sort((a, b) => b.price_change_percent - a.price_change_percent);

    const priceDecreases = qualifiedVendors
      .filter(v => v.price_change_percent < -price_change_threshold)
      .sort((a, b) => a.price_change_percent - b.price_change_percent);

    const stablePrices = qualifiedVendors
      .filter(v => Math.abs(v.price_change_percent) <= price_change_threshold);

    // ============================================
    // SPENDING TRENDS BY VENDOR
    // ============================================
    const topVendorsBySpending = qualifiedVendors
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 10);

    // ============================================
    // MONTHLY SPENDING BREAKDOWN
    // ============================================
    const monthlySpending = new Map();

    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const vendor = tx.merchant_name || tx.name || "Unknown";

      if (!monthlySpending.has(monthKey)) {
        monthlySpending.set(monthKey, new Map());
      }

      const monthData = monthlySpending.get(monthKey);
      const currentAmount = monthData.get(vendor) || 0;
      monthData.set(vendor, currentAmount + parseFloat(tx.amount));
    });

    const spendingByMonth = Array.from(monthlySpending.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, vendors]) => {
        const totalMonth = Array.from(vendors.values()).reduce((sum, amt) => sum + amt, 0);
        const topVendors = Array.from(vendors.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([vendor, amount]) => ({
            vendor,
            amount: parseFloat(amount.toFixed(2)),
          }));

        return {
          month,
          total_spent: parseFloat(totalMonth.toFixed(2)),
          top_vendors: topVendors,
        };
      });

    // ============================================
    // IMPACT ANALYSIS
    // ============================================
    const totalPriceIncreaseImpact = priceIncreases.reduce(
      (sum, v) => sum + (v.price_change_absolute * v.frequency_per_month * 12),
      0
    );

    const totalSpending = transactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    return new Response(
      JSON.stringify({
        success: true,
        analysis_period: {
          months_back,
          start_date: startDate.toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
        },
        settings: {
          min_transactions,
          price_change_threshold,
        },
        summary: {
          total_spending: parseFloat(totalSpending.toFixed(2)),
          unique_vendors: vendorData.size,
          qualified_vendors: qualifiedVendors.length,
          vendors_with_increases: priceIncreases.length,
          vendors_with_decreases: priceDecreases.length,
          vendors_stable: stablePrices.length,
          estimated_annual_impact: parseFloat(totalPriceIncreaseImpact.toFixed(2)),
        },
        price_increases: priceIncreases,
        price_decreases: priceDecreases,
        top_vendors_by_spending: topVendorsBySpending,
        spending_by_month: spendingByMonth,
        recommendations: generateVendorRecommendations(
          priceIncreases,
          totalPriceIncreaseImpact,
          totalSpending
        ),
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

function generateVendorRecommendations(
  priceIncreases: any[],
  totalImpact: number,
  totalSpending: number
): string[] {
  const recommendations: string[] = [];

  if (priceIncreases.length === 0) {
    recommendations.push("✅ No significant price increases detected from regular vendors.");
    return recommendations;
  }

  const topIncrease = priceIncreases[0];
  recommendations.push(
    `⚠️ ${topIncrease.vendor} has increased prices by ${topIncrease.price_change_percent.toFixed(1)}%. Consider negotiating or finding alternatives.`
  );

  if (priceIncreases.length > 3) {
    recommendations.push(
      `📊 ${priceIncreases.length} vendors have raised prices significantly. Time to review vendor contracts.`
    );
  }

  const impactPercent = (totalImpact / totalSpending) * 100;
  if (impactPercent > 5) {
    recommendations.push(
      `💰 Price increases could cost you $${totalImpact.toFixed(2)} annually (${impactPercent.toFixed(1)}% of spending). Update your pricing to maintain margins.`
    );
  }

  const highImpactVendors = priceIncreases.filter(
    v => v.price_change_absolute * v.frequency_per_month * 12 > totalSpending * 0.01
  );

  if (highImpactVendors.length > 0) {
    recommendations.push(
      `🎯 Focus on negotiating with: ${highImpactVendors.slice(0, 3).map(v => v.vendor).join(", ")}`
    );
  }

  return recommendations;
}