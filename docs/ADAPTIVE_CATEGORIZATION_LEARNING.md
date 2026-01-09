# Adaptive Categorization Learning

> **Status:** Proposed  
> **Priority:** Future Enhancement  
> **AI Provider:** OpenAI

## Overview

This document outlines a system to improve automatic transaction categorization by learning from user behavior. When users manually categorize transactions or override AI suggestions, the system captures these signals and uses them to improve future predictions.

---

## Goals

1. **Reduce manual work** - Learn user preferences so they categorize less over time
2. **Improve accuracy** - Use corrections to fix recurring mistakes
3. **Auto-suggest rules** - Detect patterns and propose categorization rules
4. **Personalized AI** - Tailor suggestions to each user's business type

---

## Data We Already Capture

| Field | Table | Description |
|-------|-------|-------------|
| `method` | `transaction_categorizations` | `"manual"`, `"rule"`, or `"ai"` |
| `is_user_override` | `transaction_categorizations` | `true` if user changed an auto-categorization |
| `previous_category_id` | `transaction_categorizations` | The category that was replaced |
| `confidence` | `transaction_categorizations` | AI confidence score (0-1) |
| `merchant_name` | `transactions` | Vendor/merchant name |
| `name` | `transactions` | Transaction description |
| `amount` | `transactions` | Transaction amount |

---

## Learning Signals

### Signal 1: Manual Categorizations
When a user manually categorizes a transaction, it's a strong signal of their preference.

```sql
-- Find manual categorization patterns by merchant
SELECT 
    t.merchant_name,
    ec.name as category_name,
    COUNT(*) as times_assigned,
    MAX(tc.created_at) as last_assigned
FROM transaction_categorizations tc
JOIN transactions t ON tc.transaction_id = t.id
JOIN expense_categories ec ON tc.category_id = ec.id
WHERE tc.method = 'manual'
  AND tc.user_id = $user_id
GROUP BY t.merchant_name, ec.name
HAVING COUNT(*) >= 3
ORDER BY times_assigned DESC;
```

### Signal 2: User Overrides
When a user changes an AI or rule-based categorization, it indicates the system got it wrong.

```sql
-- Find patterns where AI is frequently wrong
SELECT 
    t.merchant_name,
    prev_cat.name as ai_suggested,
    curr_cat.name as user_preferred,
    COUNT(*) as override_count
FROM transaction_categorizations tc
JOIN transactions t ON tc.transaction_id = t.id
JOIN expense_categories prev_cat ON tc.previous_category_id = prev_cat.id
JOIN expense_categories curr_cat ON tc.category_id = curr_cat.id
WHERE tc.is_user_override = true
  AND tc.user_id = $user_id
GROUP BY t.merchant_name, prev_cat.name, curr_cat.name
HAVING COUNT(*) >= 2
ORDER BY override_count DESC;
```

### Signal 3: Ignored Suggestions
Track when users receive AI suggestions but choose a different category.

---

## Feature 1: Auto-Suggest Rules

### Trigger
When a user manually categorizes **3+ transactions** from the same merchant with the same category.

### Implementation

```typescript
// After manual categorization, check if we should suggest a rule
async function checkForRuleSuggestion(userId: string, merchantName: string, categoryId: string) {
    const { count } = await supabase
        .from("transaction_categorizations")
        .select("id", { count: "exact" })
        .eq("user_id", userId)
        .eq("method", "manual")
        .eq("category_id", categoryId)
        .eq("transactions.merchant_name", merchantName);
    
    if (count >= 3) {
        // Check if rule already exists
        const { data: existingRule } = await supabase
            .from("categorization_rules")
            .select("id")
            .eq("user_id", userId)
            .ilike("match_value", merchantName)
            .single();
        
        if (!existingRule) {
            return {
                suggest_rule: true,
                message: `You've categorized ${count} transactions from "${merchantName}" as this category. Create a rule?`,
                proposed_rule: {
                    rule_type: "vendor_contains",
                    match_value: merchantName.toLowerCase(),
                    category_id: categoryId
                }
            };
        }
    }
    return { suggest_rule: false };
}
```

### API Response Enhancement
Modify `categorize-transaction` response to include suggestions:

```json
{
    "success": true,
    "categorization": { ... },
    "suggestion": {
        "type": "create_rule",
        "message": "You've categorized 5 Home Depot transactions as 'Materials'. Create a rule?",
        "proposed_rule": {
            "rule_type": "vendor_contains",
            "match_value": "home depot",
            "category_id": "cat-materials-uuid"
        }
    }
}
```

---

## Feature 2: AI Learning from Corrections

### OpenAI Integration

When categorizing with AI, include the user's historical preferences in the prompt:

```typescript
async function getAICategorySuggestion(transaction: Transaction, userId: string) {
    // Get user's categorization history for this merchant
    const history = await getUserCategorizationHistory(userId, transaction.merchant_name);
    
    // Get user's category list
    const categories = await getUserCategories(userId);
    
    const prompt = `You are a financial categorization assistant for a small business.

TRANSACTION:
- Merchant: ${transaction.merchant_name}
- Description: ${transaction.name}
- Amount: $${Math.abs(transaction.amount)}

USER'S CATEGORIES:
${categories.map(c => `- ${c.name}: ${c.description || 'No description'}`).join('\n')}

USER'S HISTORY WITH THIS MERCHANT:
${history.length > 0 
    ? history.map(h => `- Previously categorized as "${h.category_name}" (${h.count} times)`).join('\n')
    : '- No previous categorizations for this merchant'}

USER CORRECTIONS:
${history.filter(h => h.was_override).map(h => 
    `- User changed from "${h.ai_suggested}" to "${h.user_choice}"`
).join('\n') || '- No corrections recorded'}

Based on this context, which category best fits this transaction?
Return JSON: { "category_id": "...", "confidence": 0.0-1.0, "reasoning": "..." }`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });
    
    return JSON.parse(response.choices[0].message.content);
}
```

### Feedback Loop

```
User Action → Store in DB → Next AI Call Includes History → Better Prediction
     ↑                                                              ↓
     └──────────────── User confirms or corrects ←──────────────────┘
```

---

## Feature 3: Batch Learning Job

### Purpose
Periodically analyze user behavior and auto-generate/update rules.

### Implementation

```typescript
// Scheduled job (daily or weekly)
async function learnFromUserBehavior(userId: string) {
    // 1. Find merchants with consistent manual categorizations
    const patterns = await findCategorizationPatterns(userId);
    
    const suggestions = [];
    
    for (const pattern of patterns) {
        // Only suggest if 90%+ consistency
        if (pattern.consistency_rate >= 0.9 && pattern.count >= 5) {
            // Check if rule exists
            const existingRule = await findExistingRule(userId, pattern.merchant_name);
            
            if (!existingRule) {
                suggestions.push({
                    type: "new_rule",
                    merchant: pattern.merchant_name,
                    suggested_category: pattern.most_common_category,
                    confidence: pattern.consistency_rate,
                    based_on_transactions: pattern.count
                });
            } else if (existingRule.category_id !== pattern.most_common_category) {
                suggestions.push({
                    type: "update_rule",
                    rule_id: existingRule.id,
                    current_category: existingRule.category_id,
                    suggested_category: pattern.most_common_category,
                    reason: "User frequently overrides this rule"
                });
            }
        }
    }
    
    // Store suggestions for user to review
    await storeLearningInsights(userId, suggestions);
    
    return suggestions;
}
```

---

## Feature 4: Learning Insights Dashboard

### API Endpoint: `GET /functions/v1/get-learning-insights`

```json
{
    "success": true,
    "insights": {
        "suggested_rules": [
            {
                "merchant": "Home Depot",
                "suggested_category": "Materials",
                "based_on": 12,
                "confidence": 0.95
            }
        ],
        "rule_updates": [
            {
                "rule_id": "rule-123",
                "current": "Equipment",
                "suggested": "Materials",
                "override_count": 5
            }
        ],
        "ai_accuracy": {
            "overall": 0.78,
            "by_category": [
                { "category": "Materials", "accuracy": 0.92 },
                { "category": "Labor", "accuracy": 0.65 }
            ]
        },
        "categorization_stats": {
            "total_categorized": 500,
            "by_method": {
                "manual": 120,
                "rule": 280,
                "ai": 100
            }
        }
    }
}
```

---

## Database Schema Additions

### New Table: `learning_insights`

```sql
CREATE TABLE learning_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    insight_type TEXT NOT NULL, -- 'suggested_rule', 'rule_update', 'pattern_detected'
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'dismissed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acted_on_at TIMESTAMPTZ
);

CREATE INDEX idx_learning_insights_user ON learning_insights(user_id, status);
```

### New Table: `ai_feedback`

```sql
CREATE TABLE ai_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    transaction_id UUID REFERENCES transactions(id),
    ai_suggested_category UUID REFERENCES expense_categories(id),
    ai_confidence DECIMAL(3,2),
    user_chosen_category UUID REFERENCES expense_categories(id),
    was_correct BOOLEAN GENERATED ALWAYS AS (ai_suggested_category = user_chosen_category) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_feedback_user ON ai_feedback(user_id);
CREATE INDEX idx_ai_feedback_accuracy ON ai_feedback(user_id, was_correct);
```

---

## Implementation Phases

### Phase 1: Data Collection ✅ (Already Done)
- [x] Track `method` (manual/rule/ai)
- [x] Track `is_user_override`
- [x] Track `previous_category_id`

### Phase 2: Rule Suggestions
- [ ] Add pattern detection after manual categorization
- [ ] Return suggestions in API response
- [ ] Add "Accept Rule" quick action

### Phase 3: AI Enhancement
- [ ] Include user history in OpenAI prompts
- [ ] Store AI feedback for accuracy tracking
- [ ] Create feedback loop

### Phase 4: Insights Dashboard
- [ ] Create `get-learning-insights` endpoint
- [ ] Build UI to show suggestions
- [ ] Allow bulk accept/dismiss of suggestions

### Phase 5: Automated Learning
- [ ] Scheduled job for pattern analysis
- [ ] Auto-create high-confidence rules (optional setting)
- [ ] Weekly learning report email

---

## Success Metrics

| Metric | Target |
|--------|--------|
| AI accuracy improvement | +15% over 3 months |
| Manual categorizations reduced | -40% after rules generated |
| User override rate | < 10% of AI suggestions |
| Time to full automation | < 30 days for new users |

---

## Security Considerations

- User data is never shared across accounts
- AI learning is per-user only
- OpenAI API calls don't include user identifiers
- Learning insights are user-specific and protected by RLS

---

## Related Files

- `/supabase/functions/categorize-transaction/index.ts`
- `/supabase/functions/auto-categorize-transactions/index.ts`
- `/supabase/functions/suggest-category-ai/index.ts`
- `/supabase/functions/create-categorization-rule/index.ts`
