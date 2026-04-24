# Multi-Level Governance & Privacy Architecture

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Privacy principles, nullifier
> shape, and XChaCha20-Poly1305 + X25519 witness encryption are accurate.
> These specific items diverge from current code and should be read as
> design intent, not current state:
>
> - **TEE is Planned, not deployed.** Lines that describe the AWS Nitro
>   enclave as live ("enclave verifies address, generates proof (2-5s
>   TEE-based)") describe the target. Current active resolver is
>   `LocalConstituentResolver` (`docs/implementation-status.md:~113`,
>   `docs/architecture.md`). Witness encryption to `/api/tee/public-key` is
>   scaffolded; nothing decrypts on an enclave yet.
> - **CWC delivery is feature-gated off.** `FEATURES.CONGRESSIONAL=false`
>   (`src/lib/config/features.ts:24`). Federal delivery code exists but is
>   not in the default user path.
> - **User-table code samples lack current fields.** Live schema lives in
>   `convex/schema.ts` and carries additional fields not shown here
>   (`authorityLevel`, `trustTier`, `identityCommitment`, etc.).
> - **"self.xyz / Didit removed in Cycle 15" is imprecise.** They remain as
>   legacy enum values on `verificationMethod`
>   (`src/lib/core/identity/session-credentials.ts:2-4`); the active intake
>   is mDL via W3C Digital Credentials API only.
> - **Client-side pseudocode (e.g. `resolveUserLocation()`)** describes
>   proposed behavior; verify against
>   `src/lib/core/location/inference-engine.ts` before relying on it.

**The Problem:** Users live in local communities with city councils, county commissioners, state legislatures, and federal representatives. VOTER Protocol's verified delivery (federal ZK proofs + CWC API) only works at federal level. Local/state delivery uses client-side `mailto:` with recipient names exposed.

**The Privacy Gap:** We encrypt addresses for federal delivery (AWS Nitro Enclaves), but what about names at local/state levels?

**The UI Agency Gap:** Users need template discovery for where they live (city, county, state, federal), but revealing their location to us defeats the privacy architecture.

-----

## Current Architecture State

### Federal Level (Fully Cryptographic - CURRENT)
```
✅ Zero-knowledge district proof (Noir browser-native, address never leaves device)
✅ Address encrypted in browser (XChaCha20-Poly1305 to TEE public key)
✅ AWS Nitro Enclave verifies address, generates proof (2-5s TEE-based)
✅ CWC API delivery (SOAP XML, whitelisted static IP)
✅ Congressional offices receive: address + message content (required for delivery)
✅ Platform operators never see address or message content
```

**Privacy Guarantee (Federal):**
- Your address: Never seen by platform operators
- Your message content: Never seen by platform operators (encrypted to TEE)
- Congressional offices: Receive both (CWC API requirement)
- Employers/data brokers: Cannot trace (no database exists mapping identity → wallet)

### State/County/City Level (Client-Side mailto - CURRENT)
```
⚠️  Client-side `mailto:` link generation
⚠️  Recipient name exposed in mailto URL (necessary for email routing)
⚠️  User's default email client opens with pre-filled recipient
⚠️  No cryptographic verification (no ZK proof infrastructure exists)
⚠️  No delivery confirmation (email is fire-and-forget)
⚠️  No reputation tracking (can't verify delivery on-chain)
```

**What We See (Local/State):**
- Template ID user clicked (know which local issue they care about)
- Timestamp of mailto link generation (when they clicked)
- Recipient name that was in the mailto: link (e.g., "Austin Mayor Kirk Watson")

**What We DON'T See:**
- Whether they actually sent the email (mailto just opens their email client)
- Their email address (unless they manually share it)
- Message content (happens in their email client, not our platform)
- Their physical address (only know they clicked a template tagged "Austin, TX")

### Current Data Model (Convex Schema)

Live in `convex/schema.ts`. camelCase fields; PII encrypted at rest.

```ts
users: defineTable({
  email: v.optional(v.string()),          // Optional — OAuth only, not required
                                          // uniqueness enforced by "by_email" index
  // Location data — stored only when user explicitly reveals via action
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  county: v.optional(v.string()),
  congressionalDistrict: v.optional(v.string()),  // Required for federal ZK proofs

  // Identity verification
  verificationMethod: v.optional(v.string()),     // 'digital-credentials-api' (mDL)
                                                  // Legacy values: 'self.xyz', 'didit.me' remain as enum values for backward compat
  verifiedAt: v.optional(v.number()),
  // ...additional live fields: authorityLevel, trustTier, identityCommitment, etc.
})
  .index("by_email", ["email"]),

templates: defineTable({
  // Governance level
  level: v.string(),                      // 'federal' | 'state' | 'county' | 'city'

  // Geographic targeting
  state: v.optional(v.string()),
  county: v.optional(v.string()),
  city: v.optional(v.string()),
  congressionalDistrict: v.optional(v.string()),

  // Recipient information
  recipientName: v.optional(v.string()),  // For mailto: links (local/state)
  recipientOffice: v.optional(v.string()),// CWC office ID (federal only)
})
  .index("by_level", ["level"]),

submissions: defineTable({
  userId: v.id("users"),
  templateId: v.id("templates"),

  // Message routing handled by protocol (users don't choose)
  deliveryMethod: v.string(),             // 'cwc_api' | 'mailto' | 'direct_form'

  submittedAt: v.number(),
  delivered: v.optional(v.boolean()),     // Only known for federal (CWC confirmation)

  recipientName: v.optional(v.string()),  // Exposed in mailto: links
})
  .index("by_userId", ["userId"])
  .index("by_templateId", ["templateId"]),
```

-----

## The Core Privacy Dilemma

### What Users Want:
1. **Template discovery for their location** - "Show me Austin city council templates"
2. **Automated recipient routing** - "I shouldn't have to look up my state rep's email"
3. **Impact tracking across all levels** - "Did my local message contribute to ordinance passage?"
4. **Cross-level coordination** - "Link my federal healthcare advocacy with state Medicaid expansion"

### What Privacy Requires:
1. **Platform never knows exact location** - Zero-knowledge proofs mean address stays local
2. **No PII in databases** - Employers/data brokers can't subpoena identity mappings
3. **Minimal metadata leakage** - Clicking "Austin templates" reveals you're in Austin
4. **No persistent correlation** - Can't link wallet → location → email → employment

### The Tension:
**To show you "Austin city council templates," we need to know you're in Austin.**
**But knowing you're in Austin defeats the zero-knowledge architecture for federal delivery.**

-----

## Solution: Tiered Privacy Model with Client-Side Location Resolution

### Principle: **Server Knows Only What User Explicitly Reveals Through Action**

**Federal Level (Maximum Privacy):**
- **ZK proof reveals**: District hash only (e.g., "TX-18" on-chain)
- **Platform never sees**: Exact address (stays in browser, only TEE sees it during proving)
- **Employers cannot trace**: No database links wallet → address

**State Level (Moderate Privacy):**
- **User action reveals**: "I clicked a Texas state legislature template"
- **Platform learns**: User is in Texas (by inference from template selection)
- **Platform never sees**: City, county, or exact address
- **Employers cannot trace**: Which specific Texas city you're in

**County Level (Less Privacy):**
- **User action reveals**: "I clicked a Travis County commissioner template"
- **Platform learns**: User is in Travis County, Texas
- **Platform never sees**: City or exact address
- **Employers cannot trace**: Specific neighborhood, just broad county

**City Level (Least Privacy):**
- **User action reveals**: "I clicked an Austin mayor template"
- **Platform learns**: User is in Austin, Travis County, Texas
- **Platform never sees**: Exact address or neighborhood
- **Employers cannot trace**: Whether you live in 78701 or 78704

### Implementation: Client-Side Geographic Resolution

**Step 1: User enters address ONCE during onboarding**
```typescript
// Browser-only, never transmitted
async function resolveUserLocation(address: string): Promise<LocalGovernanceUnits> {
  // 1. Geocode address client-side (Census Bureau API)
  const coords = await geocodeAddress(address);

  // 2. Resolve all governance units (client-side API calls)
  const governance = {
    congressional_district: await resolveDistrict(coords),
    state_senate: await resolveStateSenate(coords, address.state),
    state_house: await resolveStateHouse(coords, address.state),
    county: await resolveCounty(coords),
    city: await resolveCity(coords),
    school_district: await resolveSchoolDistrict(coords)
  };

  // 3. Store in IndexedDB (local browser storage, never synced)
  await indexedDB.put('user_governance', governance);

  // 4. NEVER transmit to server
  return governance;
}
```

**Step 2: Template discovery happens client-side**
```typescript
// User clicks "Find Templates for My Area"
async function filterTemplatesForUser(): Promise<Template[]> {
  // 1. Fetch user's governance units from IndexedDB (local only)
  const governance = await indexedDB.get('user_governance');

  // 2. Fetch ALL templates from platform (no filtering yet)
  const allTemplates = await api.get('/templates');

  // 3. Filter CLIENT-SIDE based on governance matches
  const relevant = allTemplates.filter(t => {
    // Federal templates: Match congressional district
    if (t.level === 'federal' && t.congressional_district === governance.congressional_district) {
      return true;
    }

    // State templates: Match state only (don't reveal city)
    if (t.level === 'state' && t.state === governance.state) {
      return true;
    }

    // County templates: Match county
    if (t.level === 'county' && t.county === governance.county) {
      return true;
    }

    // City templates: Match city
    if (t.level === 'city' && t.city === governance.city) {
      return true;
    }

    return false;
  });

  // 4. Return filtered list to UI (server never learned what matched)
  return relevant;
}
```

**Step 3: User selects template → ONLY THEN does server learn governance level**
```typescript
// User clicks "Send to Austin Mayor"
async function submitLocalTemplate(templateId: string): Promise<void> {
  // 1. Fetch template details from server
  const template = await api.get(`/templates/${templateId}`);

  // 2. Generate mailto: link client-side
  const mailto = `mailto:${template.recipient_email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(customizedMessage)}`;

  // 3. Record submission (server learns template ID only)
  await api.post('/submissions', {
    template_id: templateId,
    delivery_method: 'mailto',
    // NO recipient name, NO city, NO detailed location
    // Server only knows: "User submitted template abc123 at this timestamp"
  });

  // 4. Open user's email client (happens entirely client-side)
  window.location.href = mailto;
}
```

### What Platform Learns Through User Actions

**Before any template selection:**
- **Platform knows**: User exists, has verified identity (mDL via Digital Credentials API)
- **Platform doesn't know**: Where they live (city, state, county, or address)

**After clicking "Texas state legislature" template:**
- **Platform learns**: User cares about Texas state politics (inferred from template selection)
- **Platform still doesn't know**: Which city, county, or exact district in Texas

**After clicking "Austin mayor" template:**
- **Platform learns**: User cares about Austin city politics (inferred from template selection)
- **Platform still doesn't know**: Exact address, neighborhood, or whether they actually live in Austin (could be concerned non-resident)

**After federal ZK proof submission:**
- **On-chain public data**: District hash "TX-18" (anyone can see this)
- **Platform still doesn't know**: Exact address (ZK proof hides it, only TEE saw it during proving)

### Privacy Preservation Through Action-Based Revelation

**Key Principle:** Users reveal location ONLY through which templates they choose to engage with.

**Example 1: Privacy-conscious user**
```
1. Onboarding: Enters address (stored locally in IndexedDB, never transmitted)
2. Browses templates: Client-side filtering shows Austin + Texas + Federal templates
3. Clicks only federal template: Platform learns only that user is in some Texas congressional district
4. ZK proof generated: On-chain TX-18 district hash visible, but address remains hidden
5. Platform knowledge: "User is constituent in TX-18" (no city, county, or exact address known)
```

**Example 2: Locally-engaged user**
```
1. Onboarding: Same as above
2. Browses templates: Client-side filtering shows all relevant templates
3. Clicks Austin mayor template: Platform learns "User engaged with Austin template"
4. Clicks Travis County template: Platform learns "User engaged with Travis County template"
5. Clicks federal template: ZK proof shows TX-18
6. Platform knowledge: "User likely lives in Austin, Travis County, TX-18" (inferred from actions, never explicitly confirmed)
```

**What Employers/Data Brokers See:**
- Wallet address earned reputation in healthcare policy domain
- Wallet address submitted template abc123 (no location attached to template submission)
- Wallet address generated ZK proof for TX-18 (on-chain public data)
- **Cannot determine**: Which city, county, exact address, or email address
- **Cannot subpoena**: Information that doesn't exist in platform database

-----

## Technical Implementation

### Database Schema (Privacy-Preserving)

```typescript
model User {
  id String @id @default(cuid())
  email String? @unique  // Optional OAuth, not required

  // NO location fields stored on server
  // congressional_district: DELETED (only revealed through ZK proof on-chain)
  // city: DELETED
  // state: DELETED
  // county: DELETED

  verification_method String?
  verified_at DateTime?
}

model Template {
  id String @id @default(cuid())

  // Geographic targeting (public data, not user-specific)
  level String  // 'federal' | 'state' | 'county' | 'city'
  state String?
  county String?
  city String?
  congressional_district String?

  // Recipient (public data)
  recipient_name String?
  recipient_email String?  // For mailto: links
  recipient_office String?  // CWC office ID (federal)
}

model Submission {
  id String @id @default(cuid())
  user_id String
  template_id String

  // Minimal metadata
  delivery_method String  // 'cwc_api' | 'mailto'
  submitted_at DateTime

  // NO LOCATION DATA STORED
  // NO recipient_name (already in Template)
  // NO city/state/county

  // Federal only: On-chain confirmation
  delivery_confirmed Boolean?  // CWC receipt
  on_chain_proof_hash String?  // Link to ZK proof transaction
}
```

### Client-Side Storage (IndexedDB)

```typescript
// Stored ONLY in user's browser, never synced to server
interface LocalGovernance {
  address: string;  // Full address, only exists client-side
  congressional_district: string;
  state_senate: string;
  state_house: string;
  county: string;
  city: string;
  school_district: string;

  // Computed once during onboarding, cached
  resolved_at: Date;
}

// IndexedDB schema
const db = openDB('voter-protocol', 1, {
  upgrade(db) {
    // User's governance units (NEVER transmitted)
    db.createObjectStore('governance', { keyPath: 'user_id' });

    // Downloaded templates (public data, cached for offline)
    db.createObjectStore('templates', { keyPath: 'id' });

    // User's draft messages (never transmitted until submitted)
    db.createObjectStore('drafts', { keyPath: 'draft_id' });
  }
});
```

### API Endpoints (Privacy-First)

```typescript
// Templates API (NO user location filtering server-side)
GET /api/templates
// Returns: ALL templates with their geographic targeting
// Client filters locally based on IndexedDB governance data

// Template submission (minimal metadata)
POST /api/submissions
Body: {
  template_id: string;
  delivery_method: 'mailto' | 'cwc_api';
  // NO location data
  // NO recipient info (already in Template)
}
// Platform learns: "User submitted template abc123"
// Platform infers: "Template abc123 is for Austin, so user probably cares about Austin"
// Platform DOESN'T know: Whether user actually lives in Austin or is concerned outsider

// Federal ZK proof submission
POST /api/proofs/verify
Body: {
  proof: bytes;
  district_root: bytes32;  // Public: On-chain district hash
  nullifier: bytes32;
  action_id: bytes32;
}
// On-chain verification reveals district hash
// Platform still doesn't know exact address (ZK property)
```

-----

## UI/UX Implementation

### Onboarding Flow

**Screen 1: "Where do you want to participate?"**
```
[Text Input] Enter your address

Why we need this:
✓ Find your representatives (federal, state, county, city)
✓ Show relevant templates for your area
✓ Generate zero-knowledge proofs for federal delivery

Your address never leaves your device.
```

**Screen 2: Processing (client-side)**
```
[Progress indicator]
Finding your representatives...
✓ Congressional district: TX-18
✓ State senate district: SD-14
✓ State house district: HD-49
✓ County: Travis County
✓ City: Austin
✓ School district: Austin ISD

[Button] Continue
```

**Screen 3: Privacy explanation**
```
Your address is stored locally on this device only.

When you participate:
- Federal level: Zero-knowledge proof (address never seen by anyone except TEE during proving)
- State/county/city: We learn which area ONLY when you choose to send a template there

Our platform never stores your address in any database.
```

### Template Browser UI

**Filter UI (client-side, no server round-trip)**
```
[Tabs]
- All Levels
- Federal (TX-18) [12 templates]
- Texas State Legislature [8 templates]
- Travis County [3 templates]
- Austin [15 templates]

Sorted by:
[Dropdown] Congressional Signal Quality (reputation × adoption × impact)
```

**Template Card**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Medicare Drug Price Negotiation
Federal · TX-18 · Healthcare

Creator: @PolicyExpert (8,740 healthcare reputation)
Adoption: 847 verified constituents across 94 districts
Impact: Correlated with H.R. 3337 introduction (85% confidence)

[Button] Send to Representative

Privacy note: Generates zero-knowledge proof (address never leaves your device)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4-Day Work Week for City Employees
City · Austin · Labor

Creator: @LaborOrganizer (3,200 labor reputation)
Adoption: 89 Austin residents
Recipient: Mayor Kirk Watson

[Button] Send to Mayor

Privacy note: Opens your email client (we'll know you care about Austin issues)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Submission Flow (Local Template)

**User clicks "Send to Mayor"**
```
[Modal]
Send to Austin Mayor Kirk Watson?

This will open your email client with:
To: [email protected]
Subject: Support 4-Day Work Week for City Employees
Body: [Pre-filled template + your customization]

What we'll record:
✓ You submitted template abc123
✓ Timestamp of submission

What we WON'T record:
✗ Your email address
✗ Whether you actually sent it
✗ Your exact address (only know you clicked an Austin template)

[Button] Open Email Client
[Button] Cancel
```

### User Dashboard (Multi-Level Activity)

```
Your Impact Dashboard

Reputation Score: 8,740
- Healthcare Policy: 6,200 (Federal focus)
- Labor Policy: 1,800 (City focus)
- Climate Policy: 740 (State focus)

Activity This Month:
Federal Level:
- 6 messages to TX-18 Representative (zero-knowledge verified)
- 2 templates created (124 federal adoptions)
- Impact: Correlated with H.R. 3337 introduction

State Level:
- 2 messages to Texas state representatives (email delivery)
- Participating in: Medicaid expansion advocacy

City Level:
- 4 messages to Austin officials (email delivery)
- Participating in: 4-day work week campaign

Privacy Status:
✓ Address stored locally only (IndexedDB)
✓ Federal proofs: Zero-knowledge (TX-18 on-chain, address hidden)
✓ Local templates: Inferred location (Austin), exact address unknown
```

-----

## Recipient Name Privacy (Local/State Delivery)

### The Question: Does platform see recipient names in mailto: links?

**Current Reality:**
```typescript
// When user clicks "Send to Austin Mayor"
const mailto = `mailto:[email protected]?subject=...&body=...`;
window.location.href = mailto;
```

**What we know:**
- Template ID user clicked (abc123)
- Template contains recipient name: "Mayor Kirk Watson"
- Template contains recipient email: "[email protected]"

**What we DON'T know:**
- Whether user actually sent the email (mailto just opens their client)
- User's email address (not exposed in mailto: link)
- User's exact address (only know they clicked Austin template)

### Privacy Assessment

**Recipient names are PUBLIC OFFICIALS:**
- "Mayor Kirk Watson" is public information (anyone can Google)
- "[email protected]" is public contact info
- Not PII, not private data

**What mailto: links don't reveal:**
- User's email address (sender info only appears if they actually send)
- User's device information (mailto is protocol-level, no metadata)
- User's location beyond city (template is Austin-tagged, user clicked it)

**Threat model:**
- **Employer surveillance**: Can't determine which employee sent which message (no database links wallet → email → employer)
- **Data broker monitoring**: Can't harvest user email addresses (not exposed to platform)
- **Political targeting**: Can't build profile of user's stances across all templates (wallet actions not linked to real identity)

### Recommendation: Recipient names in mailto: are acceptable

**Rationale:**
1. **Public officials, public information** - Recipient names are not PII
2. **No user PII exposed** - User's email address never touches platform
3. **Action-based revelation only** - Platform learns "user clicked Austin template" (already minimal)
4. **No persistent surveillance** - Can't link wallet → email → employer without additional data

**Alternative (if paranoid):**
```typescript
// Don't even log template submissions for local templates
POST /api/submissions/local
Body: {
  template_id: string;  // Server learns user engaged with this template
  delivery_method: 'mailto';
  // Immediately discard after acknowledgment, no database storage
}
Response: { acknowledged: true }
```

-----

## Recommendation: Implement Tiered Privacy Model

### Phase 1 Launch (3 months):

**Federal Delivery:**
- ✅ Zero-knowledge proofs (Noir browser-native, address never leaves device)
- ✅ AWS Nitro Enclave verification (address seen only in TEE during proving, then destroyed)
- ✅ CWC API delivery (verified on-chain, congressional offices receive address + message)
- ✅ Platform operators never see address or message content

**Local/State Delivery:**
- ✅ Client-side `mailto:` link generation (opens user's email client)
- ✅ Recipient names exposed (public officials, acceptable privacy trade-off)
- ✅ User location inferred from template selection (action-based revelation)
- ✅ Platform never stores exact address (only IndexedDB, browser-local)
- ✅ No delivery confirmation (email is fire-and-forget)
- ❌ No reputation tracking (can't verify delivery without on-chain proof)

**Template Discovery:**
- ✅ Client-side filtering (ALL templates downloaded, filtered locally in browser)
- ✅ User's governance units stored in IndexedDB (never transmitted to server)
- ✅ Platform learns location ONLY when user selects template (action-based)
- ✅ Privacy scales by governance level (federal = most private, city = least private)

### Phase 2 Enhancements (12-18 months):

**Cross-Level Coordination:**
- Link federal advocacy with state/local positions
- "You supported federal Medicare expansion; Texas Medicaid expansion aligns with your position"
- Correlation happens client-side (no server-side profiling)

**Local ZK Proof Infrastructure:**
- Extend Shadow Atlas to state/county/city boundaries (expensive, low priority)
- Enables verified local delivery without revealing exact address
- Requires negotiating delivery APIs with 50 states + 3,000 counties + 19,000 cities (infeasible short-term)

-----

## Summary: Privacy-First Multi-Level Design

**Core Principle:** Server learns ONLY what user explicitly reveals through action.

**Federal (Maximum Privacy):**
- ZK proof reveals district hash only
- Address never leaves browser (only TEE sees it during proving, then destroyed)
- Platform operators architecturally cannot access address or message content

**State/County/City (Action-Based Privacy):**
- Clicking "Austin mayor template" reveals you care about Austin politics
- Platform infers you're likely in Austin (not confirmed, could be concerned outsider)
- Exact address remains unknown (stored locally in IndexedDB, never transmitted)
- Recipient names exposed (public officials, acceptable)

**UI Agency Without Surveillance:**
- All templates downloaded to client (no server-side filtering)
- User's governance units stored locally (IndexedDB)
- Client-side filtering shows relevant templates (no server round-trip reveals location)
- Template selection triggers submission (reveals minimal metadata)

**Threat Model Satisfied:**
- Employers can't trace: No database links wallet → email → employer
- Data brokers can't harvest: User email addresses never exposed to platform
- Political profiling limited: Can infer location from template selection, can't determine exact address
- Subpoena-resistant: Databases don't contain identity mappings or exact addresses

**Phase 1 ships with this architecture. Phase 2 adds token rewards and cross-level coordination (still privacy-preserving).**
