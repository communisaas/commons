# Progressive Onboarding - Agency-Driven Funnel

> **STATUS: PARTIALLY IMPLEMENTED** — Decision-maker agent pipeline exists at `src/lib/core/agents/agents/decision-maker.ts` (3-phase: identification → enrichment → validation via Gemini). UX components below (DecisionMakerSearch, AddressOrLookup) are **design proposals not yet built**. Congressional address flow is implemented.

> ⚠️ **2026-04-23 audit — additional corrections to trust in-line examples:**
>
> - **Decision-maker lookup endpoint:** `/api/decision-makers/search`
>   (described as a Hunter.io / Clearbit / pattern-guessing waterfall)
>   **does not exist**. The live endpoint is
>   `POST /api/agents/stream-decision-makers`
>   (`src/routes/api/agents/stream-decision-makers/+server.ts`), which
>   streams SSE `ThoughtSegment` objects from a Gemini agent pipeline.
>   Email validation uses DNS MX checks via Cloudflare DOH, not
>   Hunter.io confidence scores. Apollo.io is not used in the codebase.
> - **Trust Tier 4 (passport) is unreachable** — `deriveAuthorityLevel`
>   has no `document_type === 'passport'` branch. Reachable trust tiers
>   are 0–3 + 5 (Government mDL). Passkey path accepted by
>   `deriveTrustTier` but gated off (`FEATURES.PASSKEY = false`).
> - **Trust tiers (0–5, identity)** are distinct from **engagement tiers
>   (0–4, reputation)** — treat numeric "Tier N" language below as trust
>   tier unless stated.
> - **Identity providers:** `'self.xyz'` / `'didit'` remain only as
>   legacy enum values for stored-record backward compatibility. Only
>   `'digital-credentials-api'` (mDL via W3C Digital Credentials API) is
>   the active intake.
> - **Email verification is integrated into OAuth** (required at
>   callback, unverified email → lower trust_score), not a separate
>   post-signup stage.
> - **Backend:** Convex-only. Session and user mutations are Convex
>   actions, not Prisma.

**Date**: 2025-01-08 (Updated)
**Goal**: Draw users in step-by-step, engaging their agency, minimizing friction

---

## CRITICAL DISTINCTION: Two User Flows

### Flow 1: Template Senders (General Public - No Login Required)
**Who**: Anyone who wants to send an existing template
**Journey**: Browse templates → Click "Send" → Enter address (if government) → Send
**Email lookup**: NOT USED (recipients already defined by template creator)
**Login**: NOT REQUIRED (guests can send)

### Flow 2: Template Creators (Authenticated Users - Login Required)
**Who**: Activists, organizers, campaign creators
**Journey**: Sign in → Create template → Find decision-maker emails → Publish template
**Email lookup**: REQUIRED (need to source recipient emails)
**Login**: REQUIRED (before accessing template creator)

**Key insight**: Email lookup tools (Hunter.io, Apollo.io, etc.) are for **template creators**, not senders.

---

## The Core Insight

**People don't fill forms. They take action.**

### ❌ Traditional Onboarding (High Friction):
```
[Sign up form]
Name: ____________
Email: ____________
Address: ____________
Password: ____________
[Create Account]

Then browse templates
Then maybe send
```
**Drop-off**: 80%+ at signup form

### ✅ Progressive Onboarding (Agency-Driven):

**For Senders (General Public)**:
```
See template → Click "Send" → Enter address (if government) → Send message

(Address collected only for government targets, routing already defined)
```

**For Template Creators (Authenticated)**:
```
Sign in → Create template → Find decision-makers → Publish template

(Email lookup tools used to source recipient contacts)
```

**Drop-off**: ~20% (people who engage first, commit later)

---

## Template Sender Funnel (General Public - No Login)

### Step 1: Immediate Action (No Barriers)
```
User lands on homepage
↓
Sees template: "Tell Delta Airlines to stop overbooking"
  (Recipients: customercare@delta.com, ed.bastian@delta.com)
  (Already defined by template creator)
↓
Clicks "Send Now"
↓
[Modal opens - NO signup required]
```

**Agency engaged**: They clicked. They want to send.

**NO EMAIL LOOKUP**: Recipients already defined by template creator.

---

### Step 2: Address Collection (Only if Government Target)
```
┌─────────────────────────────────────┐
│   Find who represents you           │
│                                     │
│   Your address routes your message  │
│   to the right officials.           │
│                                     │
│   Street: [________________]        │
│   City: [______] State: [__]        │
│   Zip: [_____]                      │
│                                     │
│   [Find Representatives]            │
│                                     │
│   Used once. Deleted immediately.   │
└─────────────────────────────────────┘
```

**Why address**:
- Required for congressional routing
- Census Bureau API → District lookup
- Constituent verification

**Agency engaged**: They want their specific representatives.

**NO EMAIL LOOKUP**: Census API + CWC API handle routing automatically.

---

---

## Template Creator Funnel (Authenticated Users - Login Required)

**IMPORTANT**: Email lookup is ONLY for template creators, not senders.

### Step 1: Authentication Gate
```
User wants to create template
↓
"Sign in to create a template"
↓
OAuth (Google, Twitter, etc.)
↓
Authenticated → Access template creator
```

**Why authentication first**:
- Email lookup tools cost money (per-credit APIs)
- Prevents spam/abuse
- Enables template ownership + editing
- Required for publishing

---

### Step 2: Template Creation Form
```
┌─────────────────────────────────────┐
│   Create Template                   │
│                                     │
│   Title: [________________]         │
│   Category: [________]              │
│   Message: [_____________]          │
│                                     │
│   Target type:                      │
│   ○ Congress/Government             │
│   ○ Company executives              │
│   ○ School board                    │
│   ○ City council/Municipal          │
│                                     │
│   [Next: Find Recipients]           │
└─────────────────────────────────────┘
```

**Agency engaged**: They're creating a campaign.

---

### Step 3: Decision-Maker Lookup (CREATOR-ONLY FEATURE)
```
┌─────────────────────────────────────┐
│   Find Decision-Makers              │
│                                     │
│   Who should receive this template? │
│                                     │
│   Search: [Delta Airlines_____]     │
│          (company, person, or role) │
│                                     │
│   [Search]                          │
└─────────────────────────────────────┘

Results (from Hunter.io API):
┌─────────────────────────────────────┐
│ ☑ Ed Bastian (CEO)                  │
│   ed.bastian@delta.com              │
│   ✓ 95% verified (Hunter.io)        │
│                                     │
│ ☑ Delta Customer Care               │
│   customercare@delta.com            │
│   ✓ 100% verified (Official)        │
└─────────────────────────────────────┘

[Add Selected (2)]
```

**How it works**:
- **Tier 1**: Hunter.io API (50 free searches/month, then $0.025/email)
- **Tier 2**: Apollo.io API ($59/month unlimited for creators)
- **Tier 3**: Pattern guessing (firstname.lastname@company.com)
- **Government**: Census Bureau Geocoding API (FREE)

**Agency engaged**: They're defining campaign targets.

**Cost**: Template creator pays (via platform subscription or per-template fee).

---

### Step 4: Publish Template
```
Template ready:
- Title: "Tell Delta to stop overbooking"
- Recipients: customercare@delta.com, ed.bastian@delta.com
- Type: Direct email (mailto:)

[Publish Template]
```

**Now**: Template available for **senders** (general public, no login required).

---

## The Decision-Maker Lookup Challenge (CREATOR-ONLY)

### The Problem:
**Input**: Company name, person's name, or role
**Output**: Actual email addresses

### Examples:

**Government** (Easy):
- Input: User's address
- Lookup: Census Bureau API → Congressional district → Representatives
- Output: Official contact forms (CWC API)

**Public Company Executives** (Medium):
- Input: "Tim Cook" or "Apple CEO"
- Lookup: Hunter.io API, RocketReach, LinkedIn scraping
- Output: `tim_cook@apple.com` (verified)

**School Board Members** (Hard):
- Input: Zip code + "school board"
- Lookup: Ballotpedia API, local .gov sites
- Output: `board@sfusd.edu` or individual emails

**Private Company** (Very Hard):
- Input: "Pantone" or "Pantone CEO"
- Lookup: Company website scraping, WHOIS, LinkedIn
- Output: `info@pantone.com` or `ceo@pantone.com` (unverified)

---

## The Lookup Strategy (AI Agent Pipeline)

### Current Implementation: Three-Phase Agent Pipeline

**Location:** `src/lib/core/agents/agents/decision-maker.ts`

**How it works:**

#### Phase 1: Identification (Google Search Grounding)
- Agent uses Google Search grounding to find 3-5 REAL candidates
- Prevents hallucination by requiring verifiable search results
- Extracts names, titles, organizations from search snippets

#### Phase 2: Enrichment (Parallel Contact Discovery)
- Parallel contact information lookup for each candidate
- Hunter.io API (50 searches/month free tier)
- Clearbit API fallback (1000 requests/month free tier)
- Pattern guessing as last resort

#### Phase 3: Validation (Email Verification)
- Filters to only verified, contactable decision-makers
- Merges duplicate entries
- Returns validated list with confidence scores

**Rate Limiting:** No per-user limits currently enforced (relies on API provider limits)

**Fallback Strategy:**
1. Hunter.io → Clearbit → Pattern guessing
2. Pattern guessing generates common formats with low confidence scores:
   - `firstname.lastname@company.com`
   - `firstinitial.lastname@company.com`
   - `firstname@company.com`

**See:** `docs/specs/decision-maker-enrichment-pipeline.md` for comprehensive pipeline docs

---

## The Progressive Flow (Two Paths)

### Path A: Government (Address Required)

**Step 1: Engage**
```
[Template: "Tell Congress to protect net neutrality"]
[Send Now button]
```

**Step 2: Name**
```
Your name: [____________]
[Continue]
```

**Step 3: Address**
```
Find your representatives:
Street: [____________]
City: [______] State: [__] Zip: [_____]
[Find Representatives]
```

**Step 4: Confirm & Send**
```
✓ Found your representatives:
• Sen. Dianne Feinstein
• Sen. Alex Padilla
• Rep. Nancy Pelosi

[Send Message]
```

---

### Path B: Public Email (Name + Lookup)

**Step 1: Engage**
```
[Template: "Tell Apple to allow sideloading"]
[Send Now button]
```

**Step 2: Name**
```
Your name: [____________]
[Continue]
```

**Step 3: Lookup & Select**
```
Finding Apple decision-makers...

[Search results - API lookup]

Who should receive this?
☑ Tim Cook (CEO)
☑ Craig Federighi (SVP, Software Engineering)
☐ Phil Schiller (Fellow, Marketing)

[Send to Selected (2)]
```

**Step 4: Message Preview & Send**
```
Your message to Apple:

From: [Your Name]
To: Tim Cook, Craig Federighi

[Message preview]

Send from:
○ Your email (connect Gmail/Outlook)
○ Anonymous (via our relay)

[Send Message]
```

---

## The Lookup UI Components

### Component 1: DecisionMakerSearch.svelte

```svelte
<script lang="ts">
  let query = $state('');
  let results = $state([]);
  let loading = $state(false);

  async function searchDecisionMakers() {
    loading = true;
    // API call to lookup service
    results = await fetch(`/api/decision-makers/search?q=${query}`).then(r => r.json());
    loading = false;
  }
</script>

<div>
  <input
    type="text"
    bind:value={query}
    placeholder="Company name or person (e.g., 'Tim Cook' or 'Apple CEO')"
    onkeydown={(e) => e.key === 'Enter' && searchDecisionMakers()}
  />

  {#if loading}
    <div class="loading">Finding decision-makers...</div>
  {/if}

  {#if results.length > 0}
    <div class="results">
      <p class="heading">Who should receive this?</p>
      {#each results as person}
        <label class="person-option">
          <input type="checkbox" bind:checked={person.selected} />
          <div>
            <p class="name">{person.name}</p>
            <p class="role">{person.role}, {person.company}</p>
            <p class="email">{person.email}</p>
            {#if person.confidence < 80}
              <p class="confidence">~{person.confidence}% verified</p>
            {/if}
          </div>
        </label>
      {/each}
    </div>
  {/if}

  <button onclick={sendToSelected}>
    Send to Selected ({results.filter(p => p.selected).length})
  </button>
</div>
```

---

### Component 2: AddressOrLookup.svelte (Smart Router)

```svelte
<script lang="ts">
  let { template } = $props();

  // Decide which path based on template metadata
  const requiresAddress = template.deliveryMethod === 'cwc' || template.targetType === 'government';
</script>

{#if requiresAddress}
  <!-- Path A: Government (address required) -->
  <AddressCollectionModal {template} />
{:else}
  <!-- Path B: Public Email (lookup) -->
  <DecisionMakerSearch {template} />
{/if}
```

---

## The Lookup API (Backend)

### Endpoint: `/api/decision-makers/search`

**Input**:
```json
{
  "query": "Tim Cook",
  "context": "Apple CEO",
  "type": "executive" // or "school_board", "local_official"
}
```

**Waterfall Logic**:
```typescript
async function findDecisionMakers(query: string, context?: string) {
  // Tier 1: Try Hunter.io
  const hunterResults = await hunterAPI.search(query, context);
  if (hunterResults.length > 0 && hunterResults[0].confidence > 80) {
    return hunterResults;
  }

  // Tier 2: Try Clearbit
  const clearbitResults = await clearbitAPI.search(query);
  if (clearbitResults.length > 0) {
    return clearbitResults;
  }

  // Tier 3: Web scraping
  const scrapedResults = await scrapeCompanyWebsite(context);
  if (scrapedResults.length > 0) {
    return scrapedResults;
  }

  // Tier 4: Pattern guessing
  const guessedEmails = guessEmailPattern(query, context);
  return guessedEmails.map(email => ({
    email,
    confidence: 50, // Low confidence
    verification: 'pattern-guessed'
  }));
}
```

**Output**:
```json
[
  {
    "name": "Tim Cook",
    "role": "CEO",
    "company": "Apple Inc.",
    "email": "tcook@apple.com",
    "confidence": 95,
    "source": "hunter.io",
    "verified": true
  },
  {
    "name": "Craig Federighi",
    "role": "SVP, Software Engineering",
    "company": "Apple Inc.",
    "email": "federighi@apple.com",
    "confidence": 85,
    "source": "clearbit",
    "verified": true
  }
]
```

---

## API Providers (Implemented)

### 1. Hunter.io (Email Finder)
- **Free tier**: 50 searches/month
- **API**: `https://api.hunter.io/v2/email-finder`
- **Returns**: Email + confidence score
- **Used in**: Phase 2 enrichment (first priority)

### 2. Clearbit (Company Enrichment)
- **Free tier**: 1000 requests/month
- **API**: `https://company.clearbit.com/v2/companies/find`
- **Returns**: Company officers + emails
- **Used in**: Phase 2 enrichment (fallback)

### 3. Google Search (Grounding)
- **Free**: Research agent grounding
- **Used in**: Phase 1 identification (prevents hallucination)
- **Returns**: Verifiable candidate names from search results

**Note**: Google Civic Information API, Ballotpedia, and OpenCorporates are NOT currently used. The three-phase agent pipeline (Identification → Enrichment → Validation) handles all decision-maker resolution.

---

## The Interesting Challenges

### Challenge 1: School Board Emails
**Input**: User's zip code + "school board"
**Difficulty**: No centralized API

**Solution**:
1. Zip → School district (NCES database - free)
2. District → School board website (Google search)
3. Website → Scrape board member emails
4. Cache results (update monthly)

### Challenge 2: Private Company Executives
**Input**: "Pantone CEO"
**Difficulty**: Private companies hide contact info

**Solution**:
1. Company website → "About" page scraping
2. LinkedIn → Executive profiles (public data)
3. Press releases → Often include PR contact
4. Pattern guessing + verification
5. Fallback: `info@pantone.com` (always exists)

### Challenge 3: Local Officials (City Council, HOA)
**Input**: User's address + "city council"
**Difficulty**: Hyper-local, no APIs

**Solution**:
1. Address → City/County (Census Bureau)
2. City → Official website (Google)
3. Website → Council member directory
4. Scrape emails + cache
5. Show confidence score

---

## The User Experience (Full Flow)

### Example 1: Sending to Congress

```
[Homepage: Template "Protect Net Neutrality"]
↓
Click "Send Now"
↓
[Modal] Your name: Alice Johnson [Continue]
↓
[Modal] Find your representatives:
        123 Main St, San Francisco, CA 94102
        [Find Representatives]
↓
[Modal] ✓ Found:
        • Sen. Dianne Feinstein
        • Sen. Alex Padilla
        • Rep. Nancy Pelosi
        [Send Message]
↓
[Success] Message sent! Join 247 others who sent this today.
```

### Example 2: Sending to Apple

```
[Homepage: Template "Allow iPhone Sideloading"]
↓
Click "Send Now"
↓
[Modal] Your name: Bob Smith [Continue]
↓
[Modal] Finding Apple decision-makers...

        Who should receive this?
        ☑ Tim Cook (CEO) - tcook@apple.com
        ☑ Craig Federighi (SVP) - federighi@apple.com
        ☐ Phil Schiller (Fellow) - schiller@apple.com

        [Send to Selected (2)]
↓
[Modal] Send from:
        ○ Your email (connect Gmail)
        ○ Anonymous relay

        [Send Message]
↓
[Success] Opening your email client...
          (We'll verify you sent it)
```

### Example 3: Sending to School Board

```
[Homepage: Template "Increase Teacher Pay"]
↓
Click "Send Now"
↓
[Modal] Your name: Carol Davis [Continue]
↓
[Modal] Your zip code: 94102
        [Find School Board]
↓
[Modal] ✓ Found: San Francisco Unified School Board

        Board members:
        ☑ Jenny Lam (President)
        ☑ Kevine Boggess (VP)
        ☑ All 7 board members

        [Send to Selected]
↓
[Success] Message sent to SF school board!
          Join 89 others in your district.
```

---

## Implementation Priority

### Phase 1 (This Week): Government Path
1. ✅ Address collection (already built)
2. ✅ Census API → Congressional district
3. ✅ CWC API delivery
4. ⬜ Progressive onboarding (name first, address second)

### Phase 2 (Future): Public Email Path + Lookup
1. ⬜ DecisionMakerSearch component (design only — component does not exist)
2. ⬜ Dedicated search API route (decision-maker resolution uses Gemini agent pipeline, not a separate endpoint)
3. ⬜ AddressOrLookup router (design only — component does not exist)
4. ✅ Decision-maker agent pipeline (`src/lib/core/agents/agents/decision-maker.ts` — 3-phase Gemini agent with Google Search grounding)

**Next Steps**:
- Add environment variables: `HUNTER_IO_API_KEY`, `CLEARBIT_API_KEY` (optional)
- Integrate AddressOrLookup into TemplateModal flow
- Add name collection step before routing
- Test waterfall lookup with real APIs

### Phase 3 (Week 3): School Board / Local
1. ⬜ Zip → School district lookup
2. ⬜ Web scraping (board member emails)
3. ⬜ Caching layer (monthly updates)
4. ⬜ Local officials (city council, county supervisors)

### Phase 4 (Week 4): Private Companies
1. ⬜ Company website scraping
2. ⬜ LinkedIn public data extraction
3. ⬜ Press release parsing
4. ⬜ Info@ fallback emails

---

## The Bottom Line

**Progressive onboarding**:
1. Engage first (click "Send")
2. Minimal input (name only)
3. Context-aware collection (address OR lookup)
4. Agency at every step (they choose, they send)

**Lookup strategy**:
1. Free APIs first (Census Bureau geocoding, Gemini agent pipeline)
2. Web scraping second (company sites, LinkedIn)
3. Pattern guessing last (with confidence scores)
4. Always show verification status

**Two paths**:
- **Government** → Name → Address → Auto-send
- **Public Email** → Name → Lookup → User sends (OAuth verification)

**Next**: Build DecisionMakerSearch component + Hunter.io integration
