# Contextual Template Discovery: Intuiting Where Users Are At

> ⚠️ **PARTIAL IMPLEMENTATION (2026-04-23 audit).** Conceptual vision is the
> direction of travel; several concrete sections describe architecture that
> differs from shipped code. Do not copy code snippets without verifying.
>
> - **Template DB migration already done.** Jurisdictions are flattened on the
>   template record (`convex/schema.ts:224-243`, `jurisdictions` array with
>   `congressionalDistrict`, `stateSenateDistrict`, `countyFips`, `cityName`,
>   etc.). The "migration prerequisite" framing below is obsolete.
> - **IP geolocation is server-side**, not client-direct to ipify/ipinfo —
>   see `src/lib/core/location/inference-engine.ts:131`
>   (`fetch('/api/location/ip-lookup')`).
> - **Semantic search is hybrid, not "all client-side"**. Query embedding is
>   generated server-side; vector search runs as a Convex `.vectorSearch`
>   (`convex/templates.ts:~499`, `by_topicEmbedding`). IndexedDB cache in
>   `src/lib/core/search/cache.ts` holds results, not the full model.
> - **Domain + topics replaced `category`.** `category` remains as a deprecated
>   column for backward compat; new code uses `domain` + `topics`
>   (`convex/schema.ts:167-169`).
> - **"Happening in Your Area" landing UX is aspirational** — no matching
>   component in `src/routes/` / `src/lib/components/`.
> - **mDL is optional, not required.** `FEATURES.CONGRESSIONAL=false`;
>   `verificationMethod` enum still accepts legacy `'self.xyz' | 'didit'` for
>   stored records (`convex/schema.ts:~503`), but only `digital-credentials-api`
>   is the active path for new verification.

**The Problem with Discrete Filters:**
```
❌ Federal / State / County / City [dropdown]
❌ Healthcare / Climate / Labor [checkboxes]
❌ Sort by: Relevance / Newest / Popular [dropdown]
```

This is database thinking. Users don't live in discrete buckets. They live in Austin during a housing crisis while caring about federal healthcare while their kid's school district just cut funding.

**The Real Problem:**
- Users exist in overlapping civic contexts (federal healthcare + local housing + state education funding)
- Templates address problems at multiple levels simultaneously ("mental health crisis" spans city police + state Medicaid + federal funding)
- Users don't know which "level" their concern belongs to (just know "housing is unaffordable")
- Rigid filters force users to think like bureaucrats, not citizens

**What We Need:**
Contextual discovery that intuits **where the user is at** across every dimension:
- Geographic (Austin, Travis County, TX-18, Texas)
- Topical (housing, healthcare, climate)
- Temporal (happening now, upcoming deadlines)
- Social (what their neighbors are doing)
- Efficacy (which templates actually change things)

-----

## Database Architecture Prerequisite

**CRITICAL:** The semantic search strategy described in this document REQUIRES structured jurisdictions in the database. Current schema is inadequate.

**Required reading:** See [TEMPLATE-LOCATION-ARCHITECTURE.md](./TEMPLATE-LOCATION-ARCHITECTURE.md) for complete database migration plan, including:
- `TemplateJurisdiction` table (structured congressional districts, state/county/city FIPS codes)
- Template embeddings (location_embedding, topic_embedding for semantic search)
- VPN-resistant location resolution through 5-signal progressive inference
- Template writer UX (jurisdiction picker with autocomplete, coverage preview)

**Why this matters:** Without structured jurisdictions:
- ❌ VPN users see wrong templates (IP geolocation fails, no fallback)
- ❌ Semantic search impossible (can't match "Austin" string to congressional districts)
- ❌ Network effects broken (can't count adoptions by district)
- ❌ Template creators have no coverage preview (unstructured location strings)

**Implementation dependency:** Database migration MUST happen before semantic search can work.

---

## Privacy-First Location Resolution

**The Constraint:** Must know where user is to show relevant templates, but can't store location server-side.

### Silent, Progressive Location Resolution

**Principle:** Resolve location through increasingly specific signals user provides naturally, never asking directly.

#### Signal 1: IP Geolocation (Coarse, Immediate) ⚠️ VPN-Vulnerable

```typescript
// On first page load, before any auth
async function resolveCoarseLocation(): Promise<CoarseLocation> {
  // Use IP geolocation (free tier: MaxMind, IPinfo)
  const ip = await fetch('https://api.ipify.org?format=json');
  const geo = await fetch(`https://ipinfo.io/${ip.ip}/json`);

  return {
    country: 'US',
    state: 'TX',
    city: 'Austin',  // ~80% accurate for city-level WITHOUT VPN
    confidence: 0.8,  // Drops to 0.0 with VPN
    source: 'ip'
  };
}

// Store in sessionStorage (cleared on browser close, never transmitted)
sessionStorage.setItem('coarse_location', JSON.stringify(coarseLocation));
```

**Privacy:** IP geolocation is what every website does by default. City-level accuracy without revealing address. User hasn't provided ANY input yet.

**VPN Limitation:** If user is on VPN, this returns VPN exit node location (London, Singapore, etc.) instead of actual location. This is why we need 4 additional signals below that override IP-based inference.

**UI Response:**
```
Landing page shows:
"Trending in Austin" (no user account yet)
"Texas state issues getting traction"
"Federal representatives for Central Texas"
```

#### Signal 2: Browser Permissions API (Optional, User-Initiated)
```typescript
// ONLY if user clicks "Find templates near me" or similar action
async function requestPreciseLocation(): Promise<PreciseLocation | null> {
  try {
    // Browser's native permission prompt (standard UX, not custom)
    const position = await navigator.geolocation.getCurrentPosition();

    // Resolve to governance units (Census Bureau API, client-side)
    const governance = await resolveGovernanceUnits({
      lat: position.coords.latitude,
      lon: position.coords.longitude
    });

    // Store in IndexedDB (persistent, local-only)
    await indexedDB.put('governance_units', governance);

    return governance;
  } catch (error) {
    // User denied permission - gracefully degrade to IP geolocation
    return null;
  }
}
```

**Privacy:** Standard browser permission flow. User opts in. Location never transmitted to server. Stored locally in IndexedDB.

**UI Response:**
```
[After user grants permission]
✓ Found your representatives
  Congressional: TX-18 (Lloyd Doggett)
  State Senate: SD-14 (Sarah Eckhardt)
  State House: HD-49 (Gina Hinojosa)
  County: Travis County Commissioners
  City: Austin City Council District 9

Templates now personalized for your districts.
```

#### Signal 3: OAuth Profile Data (When User Authenticates)
```typescript
// If user signs in with Google/Facebook/etc.
async function enrichLocationFromOAuth(profile: OAuthProfile): Promise<void> {
  // OAuth providers sometimes include city/state in profile
  if (profile.location) {
    const inferred = parseLocation(profile.location);

    // Compare with existing IP geolocation
    if (inferred.city !== coarseLocation.city) {
      // Conflict - trust user's OAuth profile over IP
      coarseLocation = {
        ...inferred,
        confidence: 0.9,
        source: 'oauth'
      };
    }
  }

  // NEVER transmit to server beyond OAuth login flow
  // Store in sessionStorage, cleared on logout
}
```

**Privacy:** OAuth profile location is what user already shared with Google/Facebook. We're not asking for new info, just using what's already provided.

**UI Response:** Silent enhancement. If OAuth location conflicts with IP location, update template suggestions without alerting user.

#### Signal 4: Template Interaction Patterns (Behavioral Inference)
```typescript
// Learn from which templates user clicks, NOT from stored location
async function inferLocationFromBehavior(): Promise<InferredLocation> {
  const recentClicks = await indexedDB.getAll('template_clicks', 30); // Last 30 days

  // Count geographic signals from clicked templates
  const locationFrequency = {};
  recentClicks.forEach(click => {
    const template = click.template;
    if (template.city) locationFrequency[template.city] = (locationFrequency[template.city] || 0) + 1;
    if (template.county) locationFrequency[template.county] = (locationFrequency[template.county] || 0) + 1;
    if (template.state) locationFrequency[template.state] = (locationFrequency[template.state] || 0) + 1;
  });

  // Infer primary location from click patterns
  const inferredCity = Object.entries(locationFrequency).sort((a, b) => b[1] - a[1])[0];

  return {
    city: inferredCity[0],
    confidence: Math.min(inferredCity[1] / recentClicks.length, 0.95),
    source: 'behavior'
  };
}
```

**Privacy:** Client-side analysis only. Template clicks stored in IndexedDB. Inference happens locally. Server never sees results.

**UI Response:** After user clicks several Austin templates, show more Austin content. No explicit "We think you're in Austin" message.

#### Signal 5: Explicit Address Entry (During Identity Verification)
```typescript
// When user verifies with mDL via Digital Credentials API, address is REQUIRED
// (self.xyz and Didit.me removed in Cycle 15)
async function onIdentityVerification(verificationResult: VerificationResult): Promise<void> {
  // mDL verification provides address from mobile driver's license

  const address = verificationResult.address;

  // Resolve to ALL governance units (Census Bureau API, client-side)
  const governance = await resolveAllGovernanceUnits(address);

  // Store in IndexedDB (local-only, never transmitted)
  await indexedDB.put('verified_governance', {
    ...governance,
    verified: true,
    verified_at: Date.now(),
    source: 'identity_verification'
  });

  // Generate ZK proof of congressional district (for federal delivery)
  // Address used ONLY for proof generation, then discarded from memory
  const zkProof = await generateDistrictProof(address, governance.congressional_district);

  // Submit ZK proof to chain (reveals only district hash, not address)
  await submitProofToScroll(zkProof);

  // Address now destroyed - only governance units remain in IndexedDB
}
```

**Privacy:** Address required for identity verification anyway (mDL via Digital Credentials API). We're not asking for NEW data, just using verification flow. Address never transmitted to server, only stored locally and used for ZK proof generation (in TEE, then destroyed).

**UI Response:**
```
✓ Identity verified
✓ Your representatives confirmed
  [List of all governance units]

You can now send verified messages to all your representatives.
```

### Location Resolution Priority (Client-Side Only)

```typescript
async function getCurrentLocation(): Promise<Location> {
  // Check IndexedDB first (highest confidence)
  const verified = await indexedDB.get('verified_governance');
  if (verified) return { ...verified, confidence: 1.0 };

  // Check precise browser geolocation (user granted permission)
  const precise = await indexedDB.get('governance_units');
  if (precise) return { ...precise, confidence: 0.95 };

  // Check behavioral inference (30-day click patterns)
  const behavioral = await inferLocationFromBehavior();
  if (behavioral.confidence > 0.7) return behavioral;

  // Check OAuth profile location
  const oauth = sessionStorage.getItem('oauth_location');
  if (oauth) return { ...JSON.parse(oauth), confidence: 0.9 };

  // Fall back to IP geolocation
  const coarse = sessionStorage.getItem('coarse_location');
  if (coarse) return { ...JSON.parse(coarse), confidence: 0.8 };

  // No location data available
  return null;
}
```

**Privacy Guarantee:** Every location signal resolved CLIENT-SIDE. Results stored in IndexedDB/sessionStorage. Server NEVER receives location data until user takes action (clicks template, submits proof).

-----

## Semantic Template Discovery: Intuiting Context

### Beyond Keywords: Multi-Dimensional Embeddings

**The Problem:** User searches "I can't afford rent"
- Keywords match: "rent", "afford", "housing"
- Misses: "zoning reform", "property tax relief", "tenant protections", "Section 8 vouchers"
- Misses: Federal (HUD funding) + State (Medicaid work requirements) + City (ADU zoning) interconnections

**The Solution:** Semantic embeddings that understand civic problem space

```typescript
// Pre-compute embeddings for all templates (server-side, one-time)
async function generateTemplateEmbeddings(template: Template): Promise<TemplateEmbedding> {
  // Multi-dimensional embedding captures:
  // - Issue area (housing, healthcare, climate)
  // - Governance level (federal, state, county, city)
  // - Problem type (affordability, access, quality, safety)
  // - Solution approach (funding, regulation, enforcement)
  // - Temporal urgency (crisis, ongoing, preventive)

  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: `
      Title: ${template.title}
      Description: ${template.description}
      Issue: ${template.issue_area}
      Level: ${template.governance_level}
      Problem: ${template.problem_statement}
      Solution: ${template.policy_solution}
      Context: ${template.local_context}
    `
  });

  return {
    template_id: template.id,
    embedding: embedding.data[0].embedding,  // 3072-dim vector
    computed_at: Date.now()
  };
}
```

**Client-Side Search:**
```typescript
async function searchTemplates(query: string): Promise<Template[]> {
  // 1. Get user's current location context (IndexedDB)
  const location = await getCurrentLocation();

  // 2. Generate embedding for user's query
  const queryEmbedding = await generateQueryEmbedding(query, location);

  // 3. Fetch ALL templates (cached in IndexedDB, refreshed daily)
  const allTemplates = await indexedDB.getAll('templates');

  // 4. Compute semantic similarity + contextual boosting (CLIENT-SIDE)
  const scored = allTemplates.map(template => {
    // Cosine similarity between query and template embeddings
    const semanticScore = cosineSimilarity(queryEmbedding, template.embedding);

    // Contextual boosts (client-side, no server knows location)
    let contextBoost = 1.0;

    // Geographic relevance
    if (location && matchesLocation(template, location)) {
      contextBoost *= 2.0;  // 2x boost for user's districts
    }

    // Temporal relevance (happening now vs. upcoming vs. past)
    if (isActiveNow(template)) {
      contextBoost *= 1.5;
    }

    // Network effects (what neighbors are doing)
    if (hasLocalAdoption(template, location)) {
      contextBoost *= 1.3;
    }

    // Impact history (templates that actually changed things)
    if (hasLegislativeCorrelation(template)) {
      contextBoost *= 1.8;
    }

    // Reputation of creator
    const creatorScore = template.creator_reputation / 10000;  // Normalize
    contextBoost *= (1 + creatorScore);

    return {
      template,
      score: semanticScore * contextBoost
    };
  });

  // 5. Sort by combined score
  return scored.sort((a, b) => b.score - a.score).slice(0, 20);
}
```

**Example: User searches "I can't afford rent"**

**Semantic matches returned (in order):**
1. **Austin Zoning Reform** (City, Housing) - 89 local adoptions, active vote next month
2. **Federal Housing Choice Vouchers** (Federal, Housing) - Creator has 9,200 housing reputation
3. **Texas Property Tax Relief** (State, Housing) - Correlated with SB 482 introduction
4. **Travis County Homeless Services Funding** (County, Housing) - 12 neighbors sent this
5. **Tenant Protection Ordinance** (City, Housing) - Active city council campaign
6. **Inclusionary Zoning Requirements** (City, Housing) - Draft ordinance pending
7. **Federal Community Development Block Grants** (Federal, Housing) - HUD deadline approaching
8. **Texas Medicaid Work Requirements** (State, Housing) - Affects housing stability
9. **Austin Minimum Wage Ordinance** (City, Labor) - Semantic connection: affordability
10. **Federal EITC Expansion** (Federal, Labor) - Semantic connection: income adequacy

**Why this works:**
- Semantic embeddings understand "rent affordability" spans zoning + vouchers + wages + taxes
- Geographic context boosts Austin/Travis County/TX-18/Texas templates
- Network effects surface "89 local adoptions" for zoning reform
- Impact history prioritizes templates correlated with actual legislative outcomes
- Creator reputation signals quality
- Temporal urgency highlights "active vote next month"

**Privacy:** All scoring happens CLIENT-SIDE. Server provided embeddings (pre-computed), but search/ranking happens in browser using IndexedDB location data.

### Search UI: Contextual, Not Discrete

**Instead of filters:**
```
❌ [Federal v] [Healthcare v] [Sort by: Newest v]
```

**Contextual search:**
```
[Search bar] "What's on your mind?"

[Below search, before user types:]
Happening in Your Area:
- Austin zoning vote next Thursday (89 people coordinating)
- TX-18 town hall on healthcare (Rep. Doggett hosting)
- Travis County budget hearing (your neighbors are organizing)

Issues Your Neighbors Are Working On:
- Housing affordability (247 templates sent across Austin this month)
- School funding (Texas legislature, session ending soon)
- Climate resilience (ongoing federal + city coordination)

Templates That Changed Things Recently:
- Medicare negotiation (H.R. 3337 introduced after 847 constituents coordinated)
- Austin tenant protections (ordinance passed, 312 constituents participated)
```

**After user types "rent" (real-time, client-side):**
```
[Search: "rent"]

For You (Austin, TX-18):
🏠 Austin Zoning Reform
   City · Active vote Thu 3/21 · 89 neighbors coordinating
   "Reform single-family zoning to allow duplexes/ADUs"

🏠 Federal Housing Choice Vouchers Expansion
   Federal · Rep. Doggett (TX-18) · 34 constituents sent
   "Increase Section 8 funding to reduce waitlist"

🏠 Texas Property Tax Relief
   State · Session ending May · Correlated with SB 482
   "Cap annual property tax increases at 3%"

Related Issues You Might Care About:
💰 Austin Minimum Wage (Labor, affects rent affordability)
🏘️ Homeless Services Funding (County, housing stability)

Explore Other Areas:
[Can't send unless you move, but can view for advocacy ideas]
- San Francisco: Rent control expansion (2,400 adoptions)
- Portland: Social housing initiative (passed, impact verified)
```

### Enabling Cross-Jurisdiction Exploration

**The Constraint:** User can VIEW templates from anywhere, but can only SEND to their own representatives.

#### Exploration Affordances

**1. "Learn from other cities" mode**
```typescript
// User clicks "Show me what San Francisco is doing about housing"
async function exploreCrossjurisdiction(targetCity: string): Promise<Template[]> {
  const userLocation = await getCurrentLocation();

  // Fetch templates for target city
  const templates = await getTemplatesForLocation({ city: targetCity });

  // Mark each template with actionability
  return templates.map(t => ({
    ...t,
    actionable: canUserSend(t, userLocation),  // false for SF templates if user in Austin
    adaptation_suggestion: suggestAdaptation(t, userLocation)  // How to adapt for Austin
  }));
}
```

**UI for cross-jurisdiction templates:**
```
[Template from San Francisco]
🏠 Rent Control Expansion
   City: San Francisco · 2,400 residents sent · Ordinance passed

❌ You can't send this template (you're not a San Francisco constituent)

But you can:
✓ Create adapted version for Austin City Council
✓ Share with friends in San Francisco
✓ Track this as example for your area

[Button] Adapt for Austin
[Button] Share with SF friends
[Button] Follow for updates
```

**2. "Adapt for my area" workflow**
```typescript
// User clicks "Adapt for Austin" on SF rent control template
async function adaptTemplate(sourceTemplate: Template, targetLocation: Location): Promise<DraftTemplate> {
  // AI suggests adaptation
  const adaptation = await suggestAdaptation({
    source: sourceTemplate,
    target: {
      city: targetLocation.city,
      state: targetLocation.state,
      local_context: await fetchLocalContext(targetLocation)
    }
  });

  return {
    title: adaptation.title,  // "Rent Control for Austin" (adapted from SF)
    description: adaptation.description,  // Adjusted for Austin context
    attribution: {
      adapted_from: sourceTemplate.id,
      original_city: 'San Francisco'
    },
    recipients: await resolveRecipientsForLocation(targetLocation),  // Austin City Council
    is_draft: true
  };
}
```

**UI for adaptation:**
```
[Creating adapted template]

Original (San Francisco):
"Expand rent control to buildings built after 1979"

Suggested for Austin:
"Establish rent control for buildings with 5+ units"

Why the difference:
- San Francisco: Existing rent control since 1979
- Austin: No current rent control, need different approach
- Texas state law: Preemption concerns, need legal review

[Text editor with AI suggestions]
Your version:
[Pre-filled with adaptation, user can edit]

Recipients:
✓ Austin City Council
✓ Mayor Kirk Watson

[Button] Create Template (requires 500+ reputation)
```

**3. "Share with friends elsewhere" flow**
```typescript
// User clicks "Share with SF friends" on SF template
async function shareTemplateWithExternalUsers(template: Template): Promise<ShareLink> {
  // Generate shareable link (PUBLIC, no user data)
  const shareLink = await createPublicShareLink({
    template_id: template.id,
    shared_by: null,  // Anonymous sharing, no user ID exposed
    context: 'cross_jurisdiction_share'
  });

  return {
    url: `https://commons.email/t/${shareLink}`,
    message: `Check out this template: ${template.title}`
  };
}
```

**UI:**
```
[Share modal]
Share "SF Rent Control Expansion" with friends in San Francisco:

[Copy link] https://commons.email/t/abc123
[Share via] Email · SMS · WhatsApp · Twitter

Note: Only San Francisco constituents can send this template.
Your identity is not revealed in the share link.
```

**4. "Track advocacy elsewhere" feature**
```typescript
// User clicks "Follow for updates" on template from another city
async function trackExternalTemplate(templateId: string): Promise<void> {
  // Store in IndexedDB (local-only, no server notification)
  await indexedDB.put('tracked_templates', {
    template_id: templateId,
    tracked_at: Date.now(),
    reason: 'cross_jurisdiction_learning'
  });

  // Client-side polling (no server knows user is tracking SF template)
  setInterval(async () => {
    const updates = await checkTemplateUpdates(templateId);
    if (updates.length > 0) {
      showNotification(`Update: SF Rent Control passed city council!`);
    }
  }, 1000 * 60 * 60 * 24);  // Check daily
}
```

**UI:**
```
[Notification]
📬 Update on template you're tracking:

San Francisco Rent Control Expansion
✓ Passed city council 8-3 vote
✓ 2,400 constituents participated
✓ Correlated with ordinance passage (92% confidence)

Want to try adapting this for Austin?
[Button] Create Austin version
```

### Handling "You Can't Send This" Gracefully

**Principle:** Never say "you can't do X" without offering "but you CAN do Y"

**Example 1: User tries sending SF template (they're in Austin)**
```
[Attempting to send SF template]

❌ Can't send to San Francisco officials (you're not a constituent)

Your options:
1. ✓ Create adapted version for Austin City Council
   [Button] Adapt for Austin

2. ✓ Share with friends in San Francisco
   [Button] Get share link

3. ✓ Track this template for updates
   [Button] Follow this effort

4. ✓ Explore similar Austin templates
   [Carousel of related Austin templates]
```

**Example 2: User tries sending Travis County template (they're in Williamson County)**
```
[Attempting to send Travis County template]

❌ Can't send to Travis County commissioners (you're in Williamson County)

Your options:
1. ✓ Create version for Williamson County
   [Button] Adapt for your county

2. ✓ Search for similar Williamson County templates
   [Button] Find Williamson templates

3. ✓ Share with Travis County friends
   [Button] Get share link
```

**Example 3: User hasn't verified address yet**
```
[Attempting to send any template]

⚠️  Can't send yet (address not verified)

To send verified messages:
[Button] Verify with Mobile Driver's License (2 min)

While you wait:
✓ Browse templates and save favorites
✓ Track templates for updates
✓ Share templates with friends
```

-----

## Privacy-Preserving Reputation & Network Effects

### "Your neighbors are working on this" Without Revealing Who

**The Problem:** Want to show "89 Austin residents sent this template" but can't expose which wallets are in Austin.

**The Solution:** On-chain district commitments + zero-knowledge set membership

```solidity
// On-chain (Scroll L2)
contract TemplateAdoptions {
    // Template ID → District Hash → Count
    mapping(bytes32 => mapping(bytes32 => uint256)) public adoptionsByDistrict;

    // User submits ZK proof of district + template action
    function recordAdoption(
        bytes calldata zkProof,
        bytes32 templateId,
        bytes32 districtCommitment  // Poseidon(district, salt) - hides actual district
    ) external {
        // Verify ZK proof (user is in some district, proves action)
        require(verifyProof(zkProof), "Invalid proof");

        // Increment count for this template + district commitment
        adoptionsByDistrict[templateId][districtCommitment] += 1;

        emit TemplateAdopted(templateId, districtCommitment, block.timestamp);
    }
}
```

**Client-side resolution:**
```typescript
// User wants to see "how many Austin neighbors sent this template"
async function getLocalAdoptionCount(templateId: string): Promise<number> {
  // 1. Get user's governance units from IndexedDB (local-only)
  const location = await getCurrentLocation();

  // 2. Compute district commitment (same as what we'd submit for ZK proof)
  const districtCommitment = poseidonHash(location.city, SALT);

  // 3. Query on-chain count (no server intermediary)
  const count = await scrollContract.adoptionsByDistrict(templateId, districtCommitment);

  return count;
}
```

**Privacy guarantee:**
- On-chain data: Template ID → District Commitment (hashed) → Count
- Platform operators see: On-chain data only (public blockchain)
- Platform CANNOT reverse-engineer: Which district commitment = which city (Poseidon hash is one-way)
- User's browser KNOWS: Their own district commitment (computed locally from IndexedDB location)
- User CAN SEE: "89 Austin residents" (only they can compute Austin's district commitment)
- Other users SEE: Different numbers based on THEIR districts (SF user sees "2,400 SF residents")

**UI:**
```
[Template card]
🏠 Austin Zoning Reform

89 Austin residents sent this
12 from your City Council district
Active vote Thursday 3/21

[Button] Join your neighbors
```

**How this works without surveillance:**
- User's browser knows they're in Austin District 9 (IndexedDB)
- Contract has: adoptionsByDistrict[template][hash("Austin")] = 89
- Contract has: adoptionsByDistrict[template][hash("District9")] = 12
- User's browser computes these hashes locally, queries contract
- No server intermediary learns user's location
- Other users in SF see different counts (their browser computes hash("SF"))

-----

## Implementation Roadmap

### Phase 1: Silent Location Resolution (Launch)
```
✅ IP geolocation on first page load (coarse: state/city)
✅ SessionStorage for coarse location (cleared on browser close)
✅ Template search uses coarse location for contextual boosting
✅ No user-visible "Enter your location" prompt yet
```

**UX:** User lands on site, immediately sees "Trending in Austin" without any setup.

### Phase 2: Optional Precise Location (Post-Launch)
```
✅ "Find templates near me" button triggers browser geolocation permission
✅ IndexedDB storage for governance units (persistent, local-only)
✅ Census Bureau API calls (client-side) to resolve all districts
✅ Enhanced template discovery with precise district matching
```

**UX:** User optionally grants location permission, sees "TX-18 · SD-14 · HD-49 · District 9" precision.

### Phase 3: Identity Verification Address (Federal Delivery)
```
✅ mDL via Digital Credentials API (sole provider; self.xyz and Didit.me removed in Cycle 15)
✅ Address extracted from mobile driver's license
✅ Address stored in IndexedDB only (never transmitted)
✅ ZK proof generation uses address, then destroys it
✅ All governance units resolved and stored locally
```

**UX:** User verifies identity, address automatically resolves to all districts, federal delivery enabled.

### Phase 4: Semantic Search & Cross-Jurisdiction (Post-Launch)
```
✅ Pre-compute template embeddings (server-side, cached)
✅ Client-side semantic search with contextual boosting
✅ Cross-jurisdiction exploration ("Learn from SF")
✅ Template adaptation workflow ("Create Austin version")
✅ Share-with-friends-elsewhere
```

**UX:** User searches "can't afford rent", sees semantically relevant templates across all governance levels + ability to explore/adapt templates from other cities.

### Phase 5: Privacy-Preserving Network Effects (Phase 2)
```
✅ On-chain district commitments (hashed, ZK set membership)
✅ Client-side count resolution (browser computes own district hash)
✅ "Your neighbors are working on this" without exposing who
```

**UX:** User sees "89 Austin residents sent this, 12 from your district" without any centralized tracking.

-----

## Summary: Intuiting Where Users Are At

**Geographic Context (Silent, Progressive):**
1. IP geolocation (immediate, coarse)
2. Browser geolocation API (optional, precise)
3. OAuth profile (when authenticating)
4. Template click patterns (behavioral inference)
5. Identity verification address (federal delivery requirement)

**All resolved CLIENT-SIDE. Stored in IndexedDB/sessionStorage. Server learns ONLY through user actions (clicking templates).**

**Semantic Discovery (Multi-Dimensional):**
- Embeddings understand problem interconnections (rent → zoning + vouchers + wages + taxes)
- Contextual boosting: geography + temporal + network effects + impact history + reputation
- Real-time client-side scoring (no server knows location context)

**Cross-Jurisdiction Affordances:**
- VIEW any template from anywhere (learning, inspiration)
- SEND only to your own representatives (enforced by ZK proof verification)
- ADAPT templates across jurisdictions (SF rent control → Austin version)
- SHARE with friends elsewhere (anonymous public links)
- TRACK external efforts (client-side polling, no server notification)

**Privacy-First Network Effects:**
- On-chain district commitments (hashed, irreversible)
- Client-side count resolution (browser knows own district)
- "Your neighbors" without centralized identity mapping
- Zero-knowledge set membership proofs

**The Result:** Users navigate civic space naturally ("I can't afford rent") instead of bureaucratically (Federal > Housing > Affordability). Templates discovered through semantic intuition, not discrete filters. Privacy preserved through client-side intelligence, not server-side ignorance.
