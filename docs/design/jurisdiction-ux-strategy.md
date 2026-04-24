# Jurisdiction Precision: Data Model, UX, and Agentic Assistance

> **Note**: This is strategic UX analysis for jurisdiction selection. For implementation details, see [docs/features/jurisdiction.md](../features/jurisdiction.md).

**Created**: 2025-11-11
**Status**: Analysis & Strategic Planning

---

## The Core Question

**What are the implications of jurisdiction precision on:**
1. **Data model complexity**
2. **Template creation UX burden**
3. **How agentic systems can help**

---

## 1. Data Model Implications

### Current State (Well-Designed)

The `templateJurisdictions` table (`convex/schema.ts`) is **already comprehensive**:

```typescript
templateJurisdictions: defineTable({
  templateId: v.id("templates"),

  // Flexible jurisdiction types
  jurisdictionType: v.string(),              // 'federal' | 'state' | 'county' | 'city' | 'school_district'

  // Federal
  congressionalDistrict: v.optional(v.string()), // "TX-18", "CA-12"
  senateClass: v.optional(v.string()),           // "I", "II", "III"

  // State
  stateCode: v.optional(v.string()),             // "TX", "CA"
  stateSenateDistrict: v.optional(v.string()),
  stateHouseDistrict: v.optional(v.string()),

  // County
  countyFips: v.optional(v.string()),            // 5-digit FIPS code
  countyName: v.optional(v.string()),

  // City
  cityName: v.optional(v.string()),
  cityFips: v.optional(v.string()),

  // School district
  schoolDistrictId: v.optional(v.string()),      // NCES district ID
  schoolDistrictName: v.optional(v.string()),

  // Geospatial
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),

  // Coverage metadata
  estimatedPopulation: v.optional(v.number()),
  coverageNotes: v.optional(v.string()),         // Human-readable
}),
```

### Complexity Assessment

**✅ Good Design Decisions:**
- **Flexible hierarchy**: Single model handles all jurisdiction levels
- **Indexed for performance**: Efficient queries on district, state, county, FIPS codes
- **Geospatial support**: Lat/long for distance calculations
- **One-to-many**: Template can have multiple jurisdictions (e.g., multi-state campaigns)

**⚠️ Potential Complexity:**
- **Creator burden**: How does user specify "all of California" vs "just San Francisco"?
- **Overlapping jurisdictions**: County templates relevant to all districts within that county
- **Multi-state campaigns**: Federal templates need 50+ jurisdiction records?

---

## 2. Template Creation UX Burden

### The Progressive Precision Problem

**User wants to create**: "Tell San Francisco: Fix Muni service cuts"

**Questions they must answer:**
1. Is this city-level or county-level?
2. Which congressional districts overlap with SF? (CA-11, CA-12, CA-15, CA-17)
3. Should this also show to SF residents in adjacent counties?
4. What about people who commute to SF from East Bay?

**This is fucking impossible for normal users.**

### Current UX (Seed Script Pattern)

```typescript
// From a Convex seed mutation
if (template.jurisdictionLevel === 'federal') {
  // Easy: Just federal
  await ctx.db.insert("templateJurisdictions", {
    templateId: createdTemplate._id,
    jurisdictionType: 'federal',
  });
} else if (template.jurisdictionLevel === 'municipal' && template.specificLocations) {
  // Hard: Which jurisdictions exactly?
  for (const location of template.specificLocations) {
    if (location === 'San Francisco') {
      await ctx.db.insert("templateJurisdictions", {
        templateId: createdTemplate._id,
        jurisdictionType: 'state',  // Wait, is this state or city?
        stateCode: 'CA',
        cityName: 'San Francisco',
        countyName: 'San Francisco County',
      });
    }
  }
}
```

**Problem**: This is seed script code. We can't ask users to write database queries.

### The UX Abstraction Challenge

**What users understand:**
- "This is about San Francisco"
- "This is about Texas"
- "This is for my school board"
- "This is for Congress"

**What system needs:**
- `jurisdiction_type: 'city'` or `'county'` or `'state'`?
- `county_fips: '06075'` (FIPS code for San Francisco County)
- `congressional_district: ['CA-11', 'CA-12', 'CA-15', 'CA-17']` (all overlapping)
- `state_senate_district: ['11', '13']` (CA state senate)

**Gap**: Users think in plain language ("San Francisco"), system needs structured geospatial data.

---

## 3. How Agentic Systems Can Help

### Current Agent Infrastructure

**Content Moderation** (`src/lib/core/server/moderation/`):
- ✅ Automated 2-layer pipeline via Groq (Llama Prompt Guard 2 + `openai/gpt-oss-safeguard-20b`)
- ✅ Template quality assessment

**Jurisdiction Assignment**: **NOT YET IMPLEMENTED**

### Proposed: Jurisdiction Intelligence Agent

**Goal**: Translate user's plain-language location into structured jurisdictions.

#### User Input (Template Creator)

```
User enters:
- Title: "San Francisco Muni: Restore Service"
- Target: "San Francisco Municipal Transportation Agency"
- Description: "SFMTA is cutting bus routes..."
```

#### Agent Analysis (Multi-Step)

**Step 1: Entity Recognition**
- Extract location: "San Francisco"
- Extract organization: "SFMTA"
- Classify: Municipal agency (not federal, not state, not county alone)

**Step 2: Geospatial Resolution**
- Look up "San Francisco" → City & County of San Francisco
- County FIPS: `06075`
- State: California (`CA`)
- Congressional districts: `CA-11, CA-12, CA-15, CA-17` (Census API)
- State legislative districts: Senate 11, Assembly 17

**Step 3: Relevance Scoping**
- Municipal agency → City-level template
- But: Relevant to ALL SF residents regardless of district
- Also relevant: SF workers who commute from adjacent counties? (Agent decision: No, too broad)

**Step 4: Jurisdiction Record Creation**

```typescript
// Agent creates appropriate templateJurisdictions rows (Convex)
await ctx.db.insert("templateJurisdictions", {
  templateId,
  jurisdictionType: 'city',
  stateCode: 'CA',
  countyFips: '06075',
  countyName: 'San Francisco County',
  cityName: 'San Francisco',
  cityFips: '0667000', // Census Place FIPS
  estimatedPopulation: 873965,
  coverageNotes: 'City & County of San Francisco residents',
});
```

### Multi-Agent Consensus for Edge Cases

**Example: "Austin City Council: Affordable Housing"**

**Question**: Should this show to all of Travis County, or just Austin city limits?

**Agent 1 (OpenAI)**: "City Council = city limits only"
**Agent 2 (Gemini)**: "Housing affects commuters → Travis County"
**Agent 3 (Claude)**: "City Council decisions = city jurisdiction, but relevant to county"

**Consensus Decision**:
- **Primary jurisdiction**: `city_name: 'Austin'` (only city residents can vote for City Council)
- **Secondary relevance**: `county_name: 'Travis County'` (show in county filter with note: "Affects Austin")

### Agent-Assisted Template Creation Flow

```
┌─────────────────────────────────────────────────────────┐
│ User: "I want to create a template about..."           │
│                                                         │
│ Subject: [San Francisco Muni cuts]                     │
│ Target: [San Francisco MTA]                            │
│ Message: [SFMTA is cutting bus routes...]              │
│                                                         │
│ [Continue →]                                            │
└─────────────────────────────────────────────────────────┘
                         ↓
                  Agent Analysis
                  (2-3 seconds)
                         ↓
┌─────────────────────────────────────────────────────────┐
│ ✓ Location detected: San Francisco, California         │
│ ✓ Organization: Municipal Transit Agency                │
│                                                         │
│ Who should see this template?                           │
│                                                         │
│ ○ All California residents (statewide)                  │
│ ● San Francisco residents only (recommended)           │
│ ○ San Francisco + adjacent counties                     │
│                                                         │
│ ℹ️ Agent recommendation: This affects SF residents      │
│    who rely on Muni for transit. Recommend city-level. │
│                                                         │
│ [Review jurisdictions ▼] [Continue →]                   │
└─────────────────────────────────────────────────────────┘
```

**User sees simple choice. Agent does complex geospatial resolution.**

---

## 4. Progressive Funnel + Jurisdiction Intelligence

### The Synergy

**Progressive Funnel** (Phase 4 - current work):
- User refines location: State → County → District
- Templates filter by increasing precision
- Creates pull mechanism ("What's happening in my neighborhood?")

**Jurisdiction Intelligence Agent** (Phase 5 - next):
- Template creators don't manually specify jurisdictions
- Agent infers from content: "San Francisco Muni" → city-level
- Agent handles overlapping districts automatically

**Combined Effect:**
1. **Creator**: Writes template in plain language → Agent assigns jurisdictions automatically
2. **Browser**: Sees templates filtered by their location precision (state → county → district)
3. **System**: Matches inferred location (IP/GPS/Address) with template jurisdictions

### Example Flow

**Creator Side:**
```
User creates: "Austin City Council: Fix I-35 traffic"
Agent infers:
  - City: Austin
  - County: Travis County (for context)
  - Congressional districts: TX-25, TX-35 (overlapping Austin)
  - State legislative: Senate 14, House 46, 47, 49
```

**Browser Side (Progressive Funnel):**
```
STEP 1 (IP → State): "Texas"
- Shows: Federal + Texas state templates
- Hides: Austin template (county-level precision required)
- Preview: "12 more in Travis County" (greyed out)

STEP 2 (GPS → County): "Travis County"
- Shows: Federal + Texas state + Travis County templates
- **Now shows**: "Austin City Council: Fix I-35" (county unlocked!)
- Preview: "You + 8 others in TX-25" (district-level)

STEP 3 (Address → District): "TX-25"
- Shows: ALL templates (Federal + State + County + District)
- Personalized: "You + 8 others coordinating on I-35 fix"
```

**The Magic**: Creator never touched a jurisdiction selector. Browser user never saw irrelevant templates. Agent matched them automatically.

---

## 5. Implementation Strategy

### Phase 4 (Current): Progressive Funnel Affordances ✅

**Done:**
- 3-step affordance hierarchy (state → county → district)
- Full location name expansion ("California's 16th Congressional District")
- Progressive disclosure of privacy/precision details

**Next:**
- Template filtering by precision level
- Greyed-out preview cards
- Separate coordination counts per level

### Phase 5 (Next): Jurisdiction Intelligence Agent

**Components:**
1. **Entity Recognition Service**
   - Input: Template content (title, target, body)
   - Output: Extracted locations, organizations, jurisdiction types
   - Tech: Gemini entity extraction

2. **Geospatial Resolution Service**
   - Input: Location name ("San Francisco", "Travis County", "TX-25")
   - Output: Structured jurisdiction data (FIPS codes, district overlaps, population)
   - Tech: Census API, cached geospatial database

3. **Multi-Agent Consensus**
   - Input: Ambiguous jurisdiction ("affects commuters?")
   - Output: Primary + secondary jurisdictions with confidence scores
   - Tech: Existing LangGraph agent orchestration

4. **Template Creator UX**
   - Simple location input: Free-text or dropdown
   - Agent runs in background (2-3s)
   - User reviews/confirms agent recommendations
   - Advanced users can manually adjust if needed

### Phase 6 (Later): Semantic Embeddings

**Already in schema** (`convex/schema.ts`, `templates` table):
```typescript
locationEmbedding: v.optional(v.array(v.float64())),  // Gemini embedding of location context
topicEmbedding: v.optional(v.array(v.float64())),     // Gemini embedding of policy topic
embeddingVersion: v.string(),                          // default "v1"
embeddingsUpdatedAt: v.optional(v.number()),
```

**Use case**:
- User searches "climate change California"
- Semantic search finds templates about "clean energy" + "CA air quality" + "wildfire prevention"
- Even if exact keywords don't match, policy relevance does

---

## 6. Complexity Assessment

### Data Model: ✅ Low Complexity

**Verdict**: Schema is well-designed. No changes needed.

**Why**:
- Flexible enough for all jurisdiction types
- Properly indexed for performance
- One-to-many relationship handles multi-jurisdiction templates
- Geospatial support for future distance-based filtering

### Creator UX: ⚠️ High Complexity WITHOUT Agents

**Current state (manual)**: **Impossible for average users**
- Must understand federal vs state vs county vs city jurisdictions
- Must know FIPS codes, district overlaps, geospatial boundaries
- Must manually create multiple jurisdiction records for multi-district templates

**With agents**: **Low complexity**
- Plain language input: "San Francisco" or "Texas school boards"
- Agent infers correct jurisdictions automatically
- User reviews/confirms agent decision (trust but verify)

### Browser UX: ✅ Low Complexity (Progressive Funnel)

**Verdict**: Progressive funnel creates natural, intuitive refinement flow.

**Why**:
- IP → State (automatic, 89% accurate)
- GPS → County (optional, 95% accurate, user sees value)
- Address → District (highest value, 100% accurate, user motivated)
- Each step reveals MORE relevant templates (natural pull)

---

## 7. Bottom Line

### Without Agents: Template Creation is Broken

**Problem**: Asking users to manually specify jurisdictions = product failure.

**Evidence**:
- Seed script code shows complexity (nested loops, conditional logic, geospatial lookups)
- Average user doesn't know their county FIPS code
- Multi-district templates require Census API knowledge

### With Agents: Template Creation is Simple

**Solution**: Jurisdiction Intelligence Agent translates plain language → structured data.

**Benefits**:
1. **Creator**: Writes "San Francisco Muni" → Agent assigns city-level jurisdiction automatically
2. **Browser**: Sees only relevant templates for their location precision
3. **System**: Handles complex geospatial matching behind the scenes

### The Agentic Unlock

**Current agents**: Content moderation (Llama Guard via Groq), subject line generation, decision-maker resolution, message writing (all Gemini)
**Next agents**: Jurisdiction assignment, geospatial reasoning

**Architecture exists**:
- Gemini agent pipeline ✅
- SSE streaming ✅
- Agent performance tracking ✅

**Just need**: Jurisdiction Intelligence Agent implementing the pattern above.

---

## 8. Next Steps

### Immediate (This Sprint):
1. Complete Phase 4: Progressive Funnel template filtering
2. Implement greyed-out preview cards
3. Add separate coordination counts per precision level

### Near-term (Next Sprint):
1. Design Jurisdiction Intelligence Agent UX
2. Implement entity recognition + geospatial resolution
3. Add agent recommendation UI to template creator
4. Test with real user-generated templates

### Long-term (Phase 6):
1. Semantic embeddings for policy topic matching
2. Distance-based filtering ("within 10 miles")
3. Cross-jurisdiction relevance (commuters, regional issues)

---

**Conclusion**: The data model is already excellent. The missing piece is **agentic assistance for template creators**. Without it, jurisdiction precision creates impossible UX burden. With it, creators write plain language and agents handle the complexity.
