# Geographic Scope Extraction - Phase 2: Transcendence

**Status**: Planning
**Target**: Next development cycle
**Objective**: Transform basic regex extraction into intelligent, self-improving geographic scope system

---

## Phase 1 Achievements (COMPLETE)

✅ **Database Schema**: TemplateScope with international support (5 countries)
✅ **Regex Extraction**: 70-80% coverage for common patterns
✅ **Confidence-Based UX**: Three-tier inline editing
✅ **Hierarchical Filtering**: District → Region → Country fallback
✅ **Structured Logging**: Production monitoring infrastructure

---

## Phase 2: Transcendent Geographic Intelligence

### Vision

**From**: Brittle regex patterns that miss 40% of international inputs
**To**: Self-improving AI system that learns from user corrections and handles edge cases gracefully

### Core Principle

> "The system should get smarter every time a user corrects it, and gracefully degrade when uncertain."

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTRACTION PIPELINE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. FAST PATH (Regex)          ← 70-80% of cases            │
│     └─ Existing patterns                                     │
│                                                              │
│  2. FUZZY MATCHING             ← 15-20% of cases            │
│     └─ "SoCal" → California                                  │
│     └─ "NYC" → New York                                      │
│     └─ Levenshtein distance                                  │
│                                                              │
│  3. GEOCODING API              ← 5-10% of cases             │
│     └─ Google Maps Geocoding                                 │
│     └─ Reverse geocoding                                     │
│     └─ Address normalization                                 │
│                                                              │
│  4. LLM EXTRACTION             ← Edge cases                 │
│     └─ GPT-4 with structured output                          │
│     └─ Context-aware parsing                                 │
│     └─ Cached for performance                                │
│                                                              │
│  5. USER VALIDATION            ← Ground truth               │
│     └─ IP geolocation                                        │
│     └─ OAuth location (Google, Facebook)                     │
│     └─ Verified address (self.xyz, Didit.me)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### **Epic 1: Fuzzy Matching Layer** (Week 1-2)

**Goal**: Handle common abbreviations and typos without API calls

**Implementation**:
```typescript
// src/lib/utils/fuzzy-scope-matcher.ts

interface FuzzyPattern {
  pattern: string;
  canonical: string;
  scope_level: ScopeLevel;
  confidence: number;
}

const FUZZY_PATTERNS: Record<string, FuzzyPattern[]> = {
  US: [
    { pattern: 'socal', canonical: 'California', scope_level: 'region', confidence: 0.85 },
    { pattern: 'norcal', canonical: 'California', scope_level: 'region', confidence: 0.85 },
    { pattern: 'nyc', canonical: 'New York', scope_level: 'locality', confidence: 0.9 },
    { pattern: 'bay area', canonical: 'California', scope_level: 'region', confidence: 0.8 },
    { pattern: 'dmv', canonical: 'District of Columbia', scope_level: 'region', confidence: 0.75 },
    // ... hundreds more
  ],
  GB: [
    { pattern: 'greater london', canonical: 'London', scope_level: 'locality', confidence: 0.9 },
    { pattern: 'the city', canonical: 'London', scope_level: 'locality', confidence: 0.7 },
    // ...
  ]
};

export function fuzzyMatch(text: string, countryCode: string): ScopeMapping | null {
  const normalized = text.toLowerCase().trim();

  // Exact fuzzy pattern match
  const patterns = FUZZY_PATTERNS[countryCode] || [];
  for (const pattern of patterns) {
    if (normalized === pattern.pattern) {
      return mapLocationToScope(pattern.canonical, countryCode, {
        confidence: pattern.confidence,
        extraction_method: 'fuzzy'
      });
    }
  }

  // Levenshtein distance for typos (edit distance ≤ 2)
  for (const pattern of patterns) {
    if (levenshteinDistance(normalized, pattern.pattern) <= 2) {
      return mapLocationToScope(pattern.canonical, countryCode, {
        confidence: pattern.confidence * 0.85, // Reduce confidence for typos
        extraction_method: 'fuzzy'
      });
    }
  }

  return null;
}
```

**Deliverables**:
- [ ] `src/lib/utils/fuzzy-scope-matcher.ts` - Core fuzzy matching
- [ ] `src/lib/utils/levenshtein.ts` - Edit distance calculation
- [ ] Update `extractGeographicScope()` to call fuzzy matcher after regex
- [ ] Add 200+ common patterns per country
- [ ] Unit tests with typo edge cases

**Success Metrics**:
- Coverage increase: 70% → 85%
- Latency: < 5ms (in-memory only)

---

### **Epic 2: Geocoding API Integration** (Week 2-3)

**Goal**: Handle addresses, landmarks, and unknown locations via external API

**Implementation**:
```typescript
// src/lib/server/geocoding.ts

interface GeocodeResult {
  display_text: string;
  country_code: string;
  region_code?: string;
  locality_code?: string;
  district_code?: string;
  scope_level: ScopeLevel;
  confidence: number;
  lat?: number;
  lng?: number;
}

export async function geocodeLocation(locationText: string): Promise<GeocodeResult | null> {
  // Use Google Maps Geocoding API (free tier: 40K requests/month)
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `address=${encodeURIComponent(locationText)}&` +
    `key=${process.env.GOOGLE_MAPS_API_KEY}`
  );

  const data = await response.json();

  if (data.status !== 'OK' || !data.results[0]) {
    return null;
  }

  const result = data.results[0];
  const components = result.address_components;

  // Extract hierarchical components
  const country = components.find(c => c.types.includes('country'));
  const region = components.find(c =>
    c.types.includes('administrative_area_level_1')
  );
  const locality = components.find(c => c.types.includes('locality'));

  // Determine scope level (most specific available)
  const scope_level = locality ? 'locality' : region ? 'region' : 'country';

  return {
    display_text: result.formatted_address,
    country_code: country?.short_name || 'US',
    region_code: region?.short_name,
    locality_code: locality?.short_name,
    scope_level,
    confidence: 0.85, // High confidence from official geocoding
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng
  };
}
```

**Rate Limiting Strategy**:
```typescript
// Only geocode when regex AND fuzzy fail
// Cache results in Redis for 30 days
// Fall back to LLM if geocoding quota exceeded
```

**Deliverables**:
- [ ] `src/lib/server/geocoding.ts` - Google Maps integration
- [ ] `src/lib/server/geocoding-cache.ts` - Redis caching layer
- [ ] Rate limiting with fallback to LLM
- [ ] Update extraction pipeline to call geocoding
- [ ] Cost analysis and monitoring

**Success Metrics**:
- Coverage increase: 85% → 95%
- API cost: < $50/month (free tier)
- Cache hit rate: > 80%

---

### **Epic 3: LLM Extraction (Edge Cases)** (Week 3-4)

**Goal**: Handle complex, ambiguous, or context-dependent location mentions

**Implementation**:
```typescript
// src/lib/server/llm-scope-extraction.ts

interface LLMExtractionRequest {
  message: string;
  subject: string;
  context?: {
    decision_makers?: string[]; // "Rep. Nancy Pelosi" → CA
    domain?: string; // "housing" + "rent control" → city-level
  };
}

export async function extractScopeWithLLM(
  request: LLMExtractionRequest
): Promise<ScopeMapping | null> {
  const prompt = `
Extract the geographic scope from this message. Return ONLY a JSON object.

Message subject: "${request.subject}"
Message body: "${request.message}"
${request.context?.decision_makers ? `Decision makers: ${request.context.decision_makers.join(', ')}` : ''}

Examples:
- "Contact your representative about housing" + Rep. Pelosi → {"country": "US", "region": "CA", "scope": "region"}
- "NYC rent control" → {"country": "US", "region": "NY", "locality": "New York City", "scope": "locality"}
- "Federal climate policy" → {"country": "US", "scope": "country"}

Return JSON:
{
  "country_code": "US|GB|FR|JP|BR",
  "region_code": "CA|NY|...",
  "locality": "San Francisco|...",
  "district": "CA-12|...",
  "scope_level": "country|region|locality|district",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3 // Low temperature for consistency
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Validate and map to ScopeMapping
  return {
    country_code: result.country_code,
    region_code: result.region_code,
    locality_code: result.locality,
    district_code: result.district,
    scope_level: result.scope_level,
    display_text: result.locality || result.region_code || result.country_code,
    confidence: result.confidence * 0.9, // Slightly reduce LLM confidence
    extraction_method: 'llm'
  };
}
```

**Caching Strategy**:
```typescript
// Cache LLM extractions by (subject + message).hash
// 90-day TTL (semi-permanent)
// Saves 95% of LLM API costs
```

**Deliverables**:
- [ ] `src/lib/server/llm-scope-extraction.ts` - GPT-4 integration
- [ ] Prompt engineering for structured output
- [ ] Caching layer (hash-based)
- [ ] Update extraction pipeline to call LLM as last resort
- [ ] Cost monitoring and alerts

**Success Metrics**:
- Coverage increase: 95% → 99%
- LLM cost: < $20/month (cached)
- Latency: < 2s (acceptable for edge cases)

---

### **Epic 4: User Validation & Cross-Verification** (Week 4-5)

**Goal**: Detect hallucinations by validating against user's actual location

**Implementation**:
```typescript
// src/lib/server/scope-validator.ts

interface ValidationContext {
  ip_location?: { country: string; region?: string }; // From IP geolocation
  oauth_location?: { country: string; region?: string }; // From Google/Facebook OAuth
  verified_address?: { district: string }; // From self.xyz or Didit.me
}

export function validateScope(
  extracted: ScopeMapping,
  userContext: ValidationContext
): {
  validated: boolean;
  confidence_adjustment: number;
  reason: string;
} {
  // Highest priority: verified address
  if (userContext.verified_address?.district) {
    const userDistrict = userContext.verified_address.district;

    // Extracted district matches verified district
    if (extracted.district_code === userDistrict) {
      return {
        validated: true,
        confidence_adjustment: +0.1,
        reason: 'Matches verified address district'
      };
    }

    // Extracted region matches district's state
    const userState = userDistrict.split('-')[0];
    if (extracted.scope_level === 'region' && extracted.region_code === userState) {
      return {
        validated: true,
        confidence_adjustment: +0.05,
        reason: 'Matches verified address state'
      };
    }

    // Mismatch - likely hallucination
    return {
      validated: false,
      confidence_adjustment: -0.3,
      reason: `Extracted ${extracted.display_text} but user verified in ${userDistrict}`
    };
  }

  // Medium priority: OAuth location
  if (userContext.oauth_location) {
    if (extracted.country_code !== userContext.oauth_location.country) {
      return {
        validated: false,
        confidence_adjustment: -0.2,
        reason: `Country mismatch: extracted ${extracted.country_code}, OAuth says ${userContext.oauth_location.country}`
      };
    }
  }

  // Low priority: IP location (VPNs exist)
  if (userContext.ip_location) {
    if (extracted.country_code !== userContext.ip_location.country) {
      // Don't penalize heavily (could be VPN)
      return {
        validated: false,
        confidence_adjustment: -0.05,
        reason: 'Country mismatch with IP (possible VPN)'
      };
    }
  }

  // No validation context available
  return {
    validated: false,
    confidence_adjustment: 0,
    reason: 'No user context available for validation'
  };
}
```

**UI Integration**:
```typescript
// When confidence is reduced due to validation failure:
// Show amber warning: "This message mentions California, but you're verified in Texas. Correct?"
```

**Deliverables**:
- [ ] `src/lib/server/scope-validator.ts` - Cross-validation logic
- [ ] IP geolocation integration (MaxMind GeoIP2)
- [ ] OAuth location extraction from Google/Facebook
- [ ] Update template save to validate and adjust confidence
- [ ] UI warnings for validation failures

**Success Metrics**:
- False positive rate: 25% → 5%
- User correction rate: 15% → 3%

---

### **Epic 5: Self-Improving Feedback Loop** (Week 5-6)

**Goal**: System learns from user corrections and improves over time

**Implementation**:

#### Database Schema Addition:
```ts
// convex/schema.ts
scopeCorrections: defineTable({
  templateId: v.id("templates"),

  // AI's original extraction
  aiExtracted: v.any(),          // Full ScopeMapping
  aiConfidence: v.number(),
  aiMethod: v.string(),          // 'regex' | 'fuzzy' | 'geocoder' | 'llm'

  // User's correction
  userCorrected: v.any(),        // Full ScopeMapping
  correctionType: v.string(),    // 'wrong_country' | 'wrong_region' | 'wrong_district' | 'too_broad' | 'too_specific'

  // Context for learning
  messageSnippet: v.string(),    // First 200 chars
  subject: v.string(),

  createdAt: v.number(),
})
  .index("by_method_type", ["aiMethod", "correctionType"])
  .index("by_created", ["createdAt"]);
```

#### Learning Pipeline:
```typescript
// convex/scopeLearning.ts

export const recordCorrection = mutation({
  args: {
    templateId: v.id("templates"),
    aiExtracted: v.any(),
    userCorrected: v.any(),
  },
  handler: async (ctx, { templateId, aiExtracted, userCorrected }) => {
    // Store correction for analysis
    await ctx.db.insert("scopeCorrections", {
      templateId,
      aiExtracted,
      aiConfidence: aiExtracted.confidence,
      aiMethod: aiExtracted.extraction_method ?? "unknown",
      userCorrected,
      correctionType: determineCorrectionType(aiExtracted, userCorrected),
      messageSnippet: "...",
      subject: "...",
      createdAt: Date.now(),
    });

    await updateFuzzyPatterns(aiExtracted, userCorrected);
  },
});

// Weekly batch job: analyze corrections and add to fuzzy patterns
export const analyzeCorrectionPatterns = action({
  handler: async (ctx) => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const corrections = await ctx.runQuery(api.scopeLearning.listSince, { since });

  // Find patterns (e.g., "SoCal" consistently corrected to California)
  const patterns = findPatterns(corrections);

  // Add high-confidence patterns to fuzzy matcher
  for (const pattern of patterns.filter(p => p.occurrences >= 3)) {
    await addFuzzyPattern(pattern);
  }

    // Log learning progress
    console.log('[scope-learning]', JSON.stringify({
      corrections_analyzed: corrections.length,
      patterns_found: patterns.length,
      patterns_added: patterns.filter(p => p.occurrences >= 3).length
    }));
  },
});
```

**Deliverables**:
- [ ] `scopeCorrections` Convex table
- [ ] `recordCorrection()` function (called when user edits)
- [ ] Weekly batch job for pattern analysis
- [ ] Dashboard showing learning metrics
- [ ] A/B test framework for new patterns

**Success Metrics**:
- New patterns added: 10-20/week (decreasing over time)
- Correction rate: Decreases 5% each month
- System accuracy: Approaches 99% asymptotically

---

## Deployment Strategy

### Week 1-2: Fuzzy Matching
- **Risk**: Low (in-memory, no external deps)
- **Deploy**: Incremental rollout to 10% → 50% → 100%

### Week 2-3: Geocoding API
- **Risk**: Medium (external API, cost)
- **Deploy**: Shadow mode (log results, don't use)
- **Validate**: Compare geocoding vs existing extraction
- **Full deploy**: After 1 week validation

### Week 3-4: LLM Extraction
- **Risk**: Medium (cost, latency)
- **Deploy**: Only for confidence < 0.5 cases
- **Monitor**: Cost, latency, accuracy
- **Full deploy**: After cost validation

### Week 4-5: User Validation
- **Risk**: Low (passive validation)
- **Deploy**: Immediate (doesn't change user experience)
- **Monitor**: Validation failure rate

### Week 5-6: Feedback Loop
- **Risk**: Low (background job)
- **Deploy**: Immediate
- **Monitor**: Pattern discovery rate

---

## Success Criteria

### Coverage Targets:
- Week 0 (Baseline): 70-80% coverage (regex only)
- Week 2: 85% coverage (+ fuzzy)
- Week 3: 95% coverage (+ geocoding)
- Week 4: 99% coverage (+ LLM)

### Quality Targets:
- False positive rate: < 5%
- User correction rate: < 3%
- Latency (p95): < 500ms
- Cost per extraction: < $0.001

### Learning Targets:
- New patterns discovered: 10-20/week (decreasing)
- Pattern quality (user acceptance): > 95%
- Time to incorporation: < 1 week

---

## Cost Analysis

### Monthly Operating Costs (at 10K templates/month):

| Service | Usage | Cost |
|---------|-------|------|
| Google Maps Geocoding | 1K requests (10% of templates) | $0 (free tier) |
| GPT-4 LLM Extraction | 500 requests (5% of templates) | ~$10 |
| Redis Caching | 100GB cache | ~$5 |
| IP Geolocation (MaxMind) | Unlimited | $0 (free tier) |
| **Total** | | **~$15/month** |

### Efficiency Gains:
- User time saved: 2 min/template × 10K templates = 333 hours/month
- Value of time saved: $33,300/month (at $100/hr)
- **ROI**: 2,220x

---

## Monitoring & Observability

### New Structured Logs:

```typescript
// [fuzzy-scope-match]
{
  timestamp: "2025-01-19T...",
  input: "socal",
  matched: "California",
  confidence: 0.85,
  method: "exact_pattern"
}

// [geocoding-api-call]
{
  timestamp: "2025-01-19T...",
  input: "1600 Pennsylvania Ave",
  result: "Washington, DC",
  latency_ms: 234,
  cache_hit: false
}

// [llm-extraction]
{
  timestamp: "2025-01-19T...",
  subject: "Housing crisis",
  message_preview: "Our city needs...",
  extracted: "San Francisco",
  confidence: 0.75,
  cost_usd: 0.002,
  cache_hit: false
}

// [scope-validation]
{
  timestamp: "2025-01-19T...",
  ai_extracted: "California",
  user_verified_district: "CA-12",
  validated: true,
  confidence_boost: 0.1
}

// [scope-correction]
{
  timestamp: "2025-01-19T...",
  ai_extracted: "Nationwide",
  user_corrected: "California",
  correction_type: "too_broad",
  method: "regex"
}
```

### Dashboards:

1. **Extraction Performance**:
   - Coverage by method (regex, fuzzy, geocoding, LLM)
   - Confidence distribution histogram
   - Latency by method (p50, p95, p99)

2. **Quality Metrics**:
   - User correction rate (daily trend)
   - False positive rate
   - Validation pass rate

3. **Cost Tracking**:
   - Geocoding API usage
   - LLM API cost
   - Cache hit rates

4. **Learning Progress**:
   - New patterns discovered (weekly)
   - Pattern quality (user acceptance)
   - Coverage improvement trend

---

## Risk Mitigation

### Risk: Geocoding API quota exceeded
**Mitigation**: Implement circuit breaker, fall back to LLM

### Risk: LLM hallucinations
**Mitigation**: Always validate against user context, reduce confidence

### Risk: Cost explosion
**Mitigation**: Per-user rate limits, caching, circuit breakers

### Risk: Latency regression
**Mitigation**: All external calls have 2s timeout, fallback to low-confidence

### Risk: Privacy violation
**Mitigation**: Never log PII, only log location codes (not addresses)

---

## Testing Strategy

### Unit Tests:
- [ ] Fuzzy matching with typos
- [ ] Geocoding response parsing
- [ ] LLM extraction with edge cases
- [ ] Validation logic with all context types
- [ ] Pattern learning algorithm

### Integration Tests:
- [ ] Full extraction pipeline (all layers)
- [ ] Caching effectiveness
- [ ] Fallback chain (regex → fuzzy → geocode → LLM)
- [ ] User correction flow

### E2E Tests:
- [ ] Template creation with scope extraction
- [ ] User edits scope in UI
- [ ] Correction recorded and pattern learned
- [ ] Next template uses learned pattern

### Performance Tests:
- [ ] Latency under load (1000 req/s)
- [ ] Cache hit rate validation
- [ ] Cost per extraction at scale

---

## Launch Checklist

**Pre-launch**:
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass
- [ ] Performance benchmarks met
- [ ] Cost projections validated
- [ ] Monitoring dashboards created
- [ ] Runbook for incidents created
- [ ] Privacy review completed

**Launch Day**:
- [ ] Deploy fuzzy matching (10% traffic)
- [ ] Monitor for 24 hours
- [ ] Ramp to 100% if healthy
- [ ] Enable geocoding in shadow mode

**Week 1**:
- [ ] Validate geocoding accuracy
- [ ] Enable geocoding for 10% traffic
- [ ] Monitor cost and latency

**Week 2**:
- [ ] Geocoding to 100%
- [ ] Enable LLM in shadow mode
- [ ] Validate LLM accuracy

**Week 3**:
- [ ] LLM to production (confidence < 0.5)
- [ ] Enable user validation
- [ ] Monitor validation failure rate

**Week 4**:
- [ ] Enable feedback loop
- [ ] First pattern learning batch job
- [ ] Monitor pattern quality

**Week 5**:
- [ ] Full system operational
- [ ] Weekly learning jobs automated
- [ ] Metrics review and iteration

---

## Beyond Phase 2: Future Vision

### Phase 3: Predictive Scope Inference
- Infer scope from user's writing style, past templates
- "This user usually writes about housing in SF" → auto-suggest "San Francisco"

### Phase 4: Multi-Scope Templates
- Templates that span multiple regions
- "Southwest states water crisis" → [AZ, NM, NV, CO]

### Phase 5: Temporal Scope
- "During election season" → boost district-level templates
- "Tax season" → boost nationwide templates

### Phase 6: Real-Time Scope Adjustment
- News event detection → auto-adjust scope
- "Hurricane hits Florida" → boost FL templates for 7 days

---

## Conclusion

Phase 2 transforms the geographic scope system from a **brittle regex engine** into an **intelligent, self-improving AI system** that:

1. **Handles edge cases gracefully** (fuzzy, geocoding, LLM)
2. **Validates against ground truth** (user context)
3. **Learns from mistakes** (feedback loop)
4. **Scales economically** (caching, free tiers)
5. **Improves asymptotically** (approaches 99% accuracy)

**The system transcends from rule-based extraction to learned intelligence.**

Ready to deploy distinguished SWE agents. 🚀
