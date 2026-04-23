# Commons: Using Geographic Identity for Message Routing

> **STATUS: FEATURE-GATED** — ZK district proofs built, gated behind feature flags.

**Version:** 1.0.0
**Date:** 2026-01-25
**Status:** Historical / Aspirational (conflicts with shipped routing model — see audit banner)
**Context:** How Commons consumes geographic identity proofs

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit) — architecture described
> here was never implemented.** The shipped submission path uses a
> different routing model; do not build against this spec.
>
> - **"14 districts revealed by proof" is fictional.** The live
>   `three_tree_membership` circuit has 31 public inputs (verified at
>   `src/routes/api/submissions/create/+server.ts:~125` as `!== 31`),
>   but they encode three tree roots + identity commitment + action
>   domain + nullifier + engagement data — **not a 14-element
>   districtHashes array**. Functions like `extractDistrictHashes()`
>   / `districts[0..13]` do not exist.
> - **Routing binds to `recipientSubdivision` string** (e.g. "CA-12")
>   via action-domain hash, not an enum-driven multi-district fan-out.
>   See `+server.ts:~100-101,183-189`. Campaign-level `targetDistrict`
>   enum + `additionalDistricts[]` arrays are not in the schema.
> - **Witness decryption is server-side, not TEE-side.** TEE is
>   Planned; `LocalConstituentResolver` runs in the CF Worker process.
>   Treat every "TEE decrypts witness" claim here as target design.
> - **mDL via W3C Digital Credentials API is the sole active intake.**
>   Legacy `self.xyz` / `Didit` enum values remain for stored-record
>   compat only.
> - **Storacha pinning sunsets 2026-05-31** — client cell-chunk fetch
>   chain needs a migration path; unmentioned below.
> - **24 boundary types figure is correct** (Shadow Atlas).
> - **For the live shape, reference:**
>   `docs/integration.md` (request/response shape),
>   `docs/specs/zk-proof-integration.md` (circuit),
>   `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` (atlas pipeline),
>   `docs/design/ZKP-INTEGRITY-TASK-GRAPH.md` (task graph).

---

## 1. Relationship to Geographic Identity Proofs

**The proof system provides geographic identity. Commons USES that identity for routing.**

This is a key architectural separation:
- **Proof system:** Proves "this verified user belongs to these 14 districts"
- **Commons:** Uses district mapping to route messages to representatives

Routing is Commons's concern, not the proof's concern. The proof answers "who is this user geographically?" - Commons decides what to do with that information.

### 1.1 Core Principle

When a campaign author creates a campaign, they specify which district level(s) to route to:

```typescript
// Campaign author specifies which districts to use for routing
const campaign = {
  id: "hr-1234-support",
  title: "Support the Clean Energy Act",
  targetDistrict: AuthorityLevel.CONGRESSIONAL,  // Primary routing target
  additionalDistricts: [AuthorityLevel.STATE_SENATE],  // Optional additional routing
  body: "Dear Representative {{rep_name}}..."
};
```

**How Commons uses the proof:**
1. User generates a geographic identity proof (reveals all 14 district memberships)
2. Commons verifies the proof and checks the nullifier (sybil resistance)
3. Commons reads the relevant district hashes based on campaign configuration
4. Commons routes messages to representatives for those districts

**Key insight:** The proof establishes geographic identity (district-to-user mapping). Commons consumes this identity to decide where to route messages. This is Commons's application logic, not part of the proof system.

The user never sees or chooses district levels - that's Commons's UX decision.

---

## 2. Campaign Configuration (Commons-Specific)

This section describes how Commons configures campaigns. This is entirely Commons's concern - the proof system knows nothing about campaigns or routing.

### 2.1 Campaign Schema

```typescript
// This is Commons's data model, not part of the proof system
interface CommonsCampaign {
  id: string;
  title: string;
  body: string;

  // REQUIRED: Which district from the proof to use for routing?
  targetDistrict: AuthorityLevel;

  // OPTIONAL: For campaigns that route to multiple districts
  // e.g., "Contact your congressional rep AND your state senator"
  additionalDistricts?: AuthorityLevel[];

  // Delivery configuration (Commons's responsibility)
  delivery: {
    method: 'cwc' | 'email' | 'form';
    // ...
  };

  // Metadata
  createdAt: Date;
  createdBy: string;
}
```

### 2.2 District Types (From Geographic Identity Proof)

The proof outputs 14 district hashes. Commons references them by type:

```typescript
// These correspond to the 14 districts in the geographic identity proof
enum AuthorityLevel {
  // Federal
  CONGRESSIONAL = 0,        // US House of Representatives
  SENATE_FEDERAL = 1,       // US Senate (2 per state)

  // State Legislature
  STATE_SENATE = 2,         // State upper chamber
  STATE_HOUSE = 3,          // State lower chamber (Assembly, House, Delegates)

  // Local Government
  COUNTY = 4,               // County board/commission
  CITY = 5,                 // Mayor / City manager
  CITY_COUNCIL = 6,         // City council / Board of supervisors

  // Education
  SCHOOL_UNIFIED = 7,       // Unified school district board
  SCHOOL_ELEMENTARY = 8,    // Elementary school district
  SCHOOL_SECONDARY = 9,     // Secondary/high school district

  // Special Districts
  WATER_DISTRICT = 10,
  FIRE_DISTRICT = 11,
  TRANSIT_DISTRICT = 12,

  // Electoral
  VOTING_PRECINCT = 13,     // Polling place / precinct
}
```

### 2.3 Campaign Examples

**Congressional Campaign:**
```typescript
// Commons routes to congressional representative using district_hashes[0]
const congressionalCampaign: CommonsCampaign = {
  id: "clean-energy-act-2026",
  title: "Support the Clean Energy Act",
  targetDistrict: AuthorityLevel.CONGRESSIONAL,
  body: `Dear Representative,

I am writing as your constituent to urge you to support HR 1234...`,
  delivery: { method: 'cwc' },
};
```

**State Legislature Campaign:**
```typescript
// Commons routes using district_hashes[3] (state house)
const stateLegCampaign: CommonsCampaign = {
  id: "ca-housing-bill-2026",
  title: "Support California Housing Reform",
  targetDistrict: AuthorityLevel.STATE_HOUSE,
  body: `Dear Assemblymember,

As a California resident in your district...`,
  delivery: { method: 'email' },
};
```

**School Board Campaign:**
```typescript
// Commons routes using district_hashes[7] (school unified)
const schoolCampaign: CommonsCampaign = {
  id: "sfusd-budget-concerns",
  title: "SFUSD Budget Priorities",
  targetDistrict: AuthorityLevel.SCHOOL_UNIFIED,
  body: `Dear School Board Members,

As a parent in the San Francisco Unified School District...`,
  delivery: { method: 'email' },
};
```

**Multi-District Campaign:**
```typescript
// Commons routes to 3 representatives using districts from the same proof
const multiDistrictCampaign: CommonsCampaign = {
  id: "climate-action-all-levels",
  title: "Climate Action at Every Level",
  targetDistrict: AuthorityLevel.CONGRESSIONAL,
  additionalDistricts: [
    AuthorityLevel.STATE_SENATE,
    AuthorityLevel.CITY_COUNCIL,
  ],
  body: `Dear Elected Official,

I urge you to take action on climate...`,
  delivery: { method: 'cwc' },
};
// User proves identity once, Commons routes to 3 representatives
```

---

## 3. Commons Submission Flow

This section describes how Commons processes submissions. The proof system provides geographic identity; Commons handles everything else.

### 3.1 Flow Overview

```
User clicks "Send" (Commons UI)
        │
        ▼
Frontend: Generate geographic identity proof
         - Proves membership in all 14 districts
         - nullifier = H(secret, campaign, epoch) for sybil resistance
        │
        ▼
Frontend: POST /api/submissions/create
        │
        ▼
Commons Backend: Get campaign config → which districts to route to
        │
        ▼
Commons Backend: Verify proof, check nullifier (has user already proven identity?)
        │
        ▼
Commons Backend: Extract relevant districts from geographic identity
         (based on campaign's targetDistrict + additionalDistricts)
        │
        ▼
Commons Backend: Create submission record
        │
        ▼
Commons Backend: Create delivery records for each target district
        │
        ▼
Commons Backend: Route messages to representatives (Commons's responsibility)
```

### 3.2 Implementation (Commons-Specific)

```typescript
// Commons's API endpoint: /api/submissions/create/+server.ts
// This is Commons application code, not part of the proof system

export async function POST({ request, locals }) {
  const { campaignId, proof, publicInputs } = await request.json();
  const userId = locals.session.userId;

  // 1. Get Commons campaign config (determines routing, not proof)
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    return json({ error: 'Campaign not found' }, { status: 404 });
  }

  // 2. Verify the geographic identity proof
  const verified = await verifyProof(proof, publicInputs);
  if (!verified) {
    return json({ error: 'Invalid geographic identity proof' }, { status: 400 });
  }

  // 3. Extract nullifier (sybil resistance - has user already proven identity?)
  const nullifier = publicInputs.nullifier;

  // 4. Check nullifier (user can only prove identity once per campaign)
  const nullifierUsed = await checkNullifier(nullifier, campaignId);
  if (nullifierUsed) {
    return json({
      error: 'You have already proven your identity for this campaign'
    }, { status: 409 });
  }

  // 5. Extract geographic identity (all 14 district hashes)
  const geographicIdentity = extractDistrictHashes(publicInputs);

  // 6. Commons decides which districts to use for routing
  const targetDistricts = [
    campaign.targetDistrict,
    ...(campaign.additionalDistricts ?? [])
  ];

  // 7. Create submission record
  const submission = await prisma.submission.create({
    data: {
      userId,
      campaignId,
      nullifier,
      proofHex: proof,
      publicInputs: JSON.stringify(publicInputs),
      deliveryStatus: 'pending',
    }
  });

  // 8. Commons routes based on geographic identity
  const deliveries = [];
  for (const districtType of targetDistricts) {
    const districtHash = geographicIdentity[districtType];

    if (!districtHash || districtHash === EMPTY_HASH) {
      console.warn(`User has no membership in district type ${districtType}`);
      continue; // User not in coverage area for this district type
    }

    // Commons creates delivery record (routing is Commons's concern)
    const delivery = await prisma.delivery.create({
      data: {
        submissionId: submission.id,
        districtType,
        districtHash,
        status: 'pending',
      }
    });

    deliveries.push(delivery);
  }

  // 9. Commons queues message delivery
  for (const delivery of deliveries) {
    await queueDelivery(delivery);
  }

  return json({
    success: true,
    submissionId: submission.id,
    nullifier,
    deliveryCount: deliveries.length,
    deliveries: deliveries.map(d => ({
      id: d.id,
      districtType: AuthorityLevel[d.districtType],
    }))
  });
}

// Extract geographic identity (all 14 district hashes) from proof
function extractDistrictHashes(publicInputs: PublicInputs): Record<AuthorityLevel, string> {
  // The proof reveals the user's complete geographic identity:
  // 14 district hashes representing membership in all district types
  return {
    [AuthorityLevel.CONGRESSIONAL]: publicInputs.districtHashes[0],
    [AuthorityLevel.SENATE_FEDERAL]: publicInputs.districtHashes[1],
    [AuthorityLevel.STATE_SENATE]: publicInputs.districtHashes[2],
    [AuthorityLevel.STATE_HOUSE]: publicInputs.districtHashes[3],
    [AuthorityLevel.COUNTY]: publicInputs.districtHashes[4],
    [AuthorityLevel.CITY]: publicInputs.districtHashes[5],
    [AuthorityLevel.CITY_COUNCIL]: publicInputs.districtHashes[6],
    [AuthorityLevel.SCHOOL_UNIFIED]: publicInputs.districtHashes[7],
    [AuthorityLevel.SCHOOL_ELEMENTARY]: publicInputs.districtHashes[8],
    [AuthorityLevel.SCHOOL_SECONDARY]: publicInputs.districtHashes[9],
    [AuthorityLevel.WATER_DISTRICT]: publicInputs.districtHashes[10],
    [AuthorityLevel.FIRE_DISTRICT]: publicInputs.districtHashes[11],
    [AuthorityLevel.TRANSIT_DISTRICT]: publicInputs.districtHashes[12],
    [AuthorityLevel.VOTING_PRECINCT]: publicInputs.districtHashes[13],
  };
}

const EMPTY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
```

---

## 4. Session Credentials

Session credentials contain the data needed to generate geographic identity proofs.

### 4.1 Schema

```typescript
interface SessionCredential {
  // User identity
  userId: string;
  identityCommitment: string;
  userSecret: string;

  // Geographic cell (contains ALL districts)
  cellId: string;
  boundaries: BoundaryMap;
  boundaryRoot: string;

  // Merkle proof for cell tree
  leafIndex: number;
  merklePath: string[];
  merkleRoot: string;

  // Epoch
  epochId: string;

  // TTL
  createdAt: Date;
  expiresAt: Date;  // 6 months
}

interface BoundaryMap {
  congressional?: string;
  senateFederal?: string;
  stateSenate?: string;
  stateHouse?: string;
  county?: string;
  city?: string;
  cityCouncil?: string;
  schoolUnified?: string;
  schoolElementary?: string;
  schoolSecondary?: string;
  waterDistrict?: string;
  fireDistrict?: string;
  transitDistrict?: string;
  votingPrecinct?: string;
}
```

### 4.2 Credential Storage

Credentials are stored in:
1. **IndexedDB** (browser-side, encrypted)
2. **Session table** (server-side, for proof generation)

```typescript
// session-credentials.ts

export async function storeSessionCredentials(
  userId: string,
  credentials: SessionCredential
): Promise<void> {
  // Browser: Encrypt and store in IndexedDB
  const encrypted = await encryptCredentials(credentials);
  await idb.put('session-credentials', encrypted, userId);

  // Server: Store in session table (for backend proof generation)
  await prisma.sessionCredential.upsert({
    where: { userId },
    create: {
      userId,
      cellId: credentials.cellId,
      boundariesJson: JSON.stringify(credentials.boundaries),
      boundaryRoot: credentials.boundaryRoot,
      leafIndex: credentials.leafIndex,
      merklePathJson: JSON.stringify(credentials.merklePath),
      merkleRoot: credentials.merkleRoot,
      epochId: credentials.epochId,
      // userSecret and identityCommitment are derived, not stored server-side
      expiresAt: credentials.expiresAt,
    },
    update: {
      cellId: credentials.cellId,
      boundariesJson: JSON.stringify(credentials.boundaries),
      boundaryRoot: credentials.boundaryRoot,
      leafIndex: credentials.leafIndex,
      merklePathJson: JSON.stringify(credentials.merklePath),
      merkleRoot: credentials.merkleRoot,
      epochId: credentials.epochId,
      expiresAt: credentials.expiresAt,
    }
  });
}
```

---

## 5. Nullifier: Sybil Resistance

The nullifier provides sybil resistance - it prevents users from proving their geographic identity multiple times for the same campaign.

### 5.1 Nullifier Formula

```
nullifier = Poseidon(user_secret, campaign_id, epoch_id)
```

**Key insight:** The nullifier is about sybil resistance, not "submission counting."

- Same user + same campaign + same epoch = **same nullifier** → user already proved identity
- Same user + different campaign = **different nullifier** → can prove identity for new campaign
- Same user + same campaign + **next epoch** = **different nullifier** → can prove again

### 5.2 Implications

| Scenario | Result |
|----------|--------|
| User proves geographic identity | ONE proof, ONE nullifier |
| Commons routes to congress + state + city | Uses same proof's district hashes |
| User tries to prove identity again (same epoch) | Blocked (same nullifier) |
| User proves identity for different campaign | Allowed (different nullifier) |
| Next epoch | New nullifier, can prove again |

### 5.3 Example

```typescript
// User proves geographic identity for climate campaign

const campaign = {
  id: "climate-2026",
  targetDistrict: AuthorityLevel.CONGRESSIONAL,
  additionalDistricts: [AuthorityLevel.STATE_SENATE, AuthorityLevel.CITY_COUNCIL],
};

// User generates 1 geographic identity proof:
// Nullifier: H(secret, "climate-2026", epoch)

// Proof reveals user's complete geographic identity (all 14 districts)
// Commons uses the 3 relevant ones for routing:
// → Congressional (CA-12)
// → State Senate (CA-SD-11)
// → City Council (SF-D5)

// If user tries to prove identity again for "climate-2026" in same epoch:
// → Same nullifier → BLOCKED (sybil resistance)
```

### 5.4 Privacy Boundary

```
┌─────────────────────────────────────────────────────────────┐
│  PRIVATE (hidden in proof)           PUBLIC (revealed)      │
├─────────────────────────────────────────────────────────────┤
│  • User's address                    • Geographic identity  │
│  • User's secret                       (14 district hashes) │
│  • Cell ID                           • Nullifier            │
│  • Merkle paths                      • Epoch ID             │
│                                      • Campaign ID          │
└─────────────────────────────────────────────────────────────┘

Geographic identity is public. Address is private.
Applications know WHAT districts the user belongs to, not WHERE they live.
```

---

## 6. UI Considerations (Commons-Specific)

### 6.1 What Users See

This describes Commons's UX decisions. Users:

1. See **campaign page** showing title, body, target representative(s)
2. Click **"Send"** - proves geographic identity once
3. See **confirmation** showing which representatives will receive the message

### 6.2 Campaign Display

```svelte
<!-- CampaignPage.svelte - Commons's UI -->

<script>
  export let campaign;
  export let userDistricts; // From geographic identity (session credentials)

  // Commons uses geographic identity to show target representative
  $: targetDistrict = userDistricts[authorityToKey(campaign.targetDistrict)];
  $: representative = getRepresentative(targetDistrict);
</script>

<article>
  <h1>{campaign.title}</h1>

  <div class="recipient-info">
    <strong>To:</strong>
    {representative?.name ?? 'Your Representative'}
    ({targetDistrict})
  </div>

  <div class="message-body">
    {campaign.body}
  </div>

  <button on:click={handleSubmit}>
    Send Message
  </button>
</article>
```

### 6.3 Multi-District Display

For campaigns routing to multiple districts:

```svelte
<!-- MultiDistrictCampaign.svelte - Commons's UI -->

<div class="recipients">
  <strong>This message will be sent to:</strong>
  <ul>
    {#each getTargetRepresentatives(campaign, userDistricts) as rep}
      <li>{rep.name} ({rep.title}) - {rep.district}</li>
    {/each}
  </ul>
</div>

<!-- Example output:
This message will be sent to:
• Rep. Nancy Pelosi (US House) - CA-12
• Sen. Scott Wiener (CA State Senate) - CA-SD-11
• Sup. Dean Preston (SF Board of Supervisors) - SF-D5
-->
```

---

## 7. Error Handling (Commons-Specific)

### 7.1 Missing District Coverage

Some users may not have membership in certain district types (geographic identity may have empty slots):

```typescript
// User's geographic identity (from proof) - unincorporated county area
const geographicIdentity = {
  congressional: "CA-12",      // Has membership
  stateSenate: "CA-SD-11",     // Has membership
  county: "06037",             // Has membership
  city: undefined,             // No city membership (unincorporated)
  cityCouncil: undefined,      // No city council membership
};

// If Commons campaign routes to CITY_COUNCIL:
// → Commons skips this district (user has no membership)
// → User sees: "This campaign targets city council, but your geographic identity shows no city membership"
```

### 7.2 Error Messages

```typescript
// Commons's error messages when geographic identity lacks a district
const COVERAGE_ERRORS: Record<AuthorityLevel, string> = {
  [AuthorityLevel.CITY_COUNCIL]:
    "Your geographic identity shows no city council membership. " +
    "This campaign is for city council constituents.",

  [AuthorityLevel.SCHOOL_UNIFIED]:
    "Your geographic identity doesn't include school district data.",

  // etc.
};
```

---

## 8. Migration Notes (Commons-Specific)

### 8.1 Campaign Updates

Existing Commons campaigns need `targetDistrict` field:

```sql
-- Add column with default
ALTER TABLE campaigns
ADD COLUMN target_district INTEGER NOT NULL DEFAULT 0; -- 0 = CONGRESSIONAL

-- Update existing campaigns based on their type
UPDATE campaigns SET target_district = 0 WHERE type = 'congressional';
UPDATE campaigns SET target_district = 2 WHERE type = 'state_senate';
-- etc.
```

### 8.2 Session Credential Migration

Existing session credentials need cell data:

```typescript
async function migrateSessionCredentials(): Promise<void> {
  const sessions = await prisma.sessionCredential.findMany({
    where: { cellId: null }
  });

  for (const session of sessions) {
    // Re-resolve address to get cell data
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { verifiedAddress: true }
    });

    if (user?.verifiedAddress) {
      const cell = await resolveAddressToCell(user.verifiedAddress);
      await prisma.sessionCredential.update({
        where: { userId: session.userId },
        data: {
          cellId: cell.cellId,
          boundariesJson: JSON.stringify(cell.boundaries),
          boundaryRoot: cell.boundaryRoot,
          // ... other cell data
        }
      });
    }
  }
}
```

---

## 9. Summary

| Aspect | Before (v1) | After (v2) |
|--------|-------------|------------|
| What proof provides | Single district membership | Complete geographic identity (14 districts) |
| Districts revealed | 1 (selected by authority_selector) | 14 (user's full district-to-user mapping) |
| Proofs per campaign | N (one per district type) | **1** (proves entire geographic identity) |
| Nullifier purpose | Per-authority submission tracking | **Sybil resistance** - one identity proof per campaign |
| Routing responsibility | Mixed (proof + backend) | **Commons's concern** (uses proof data) |
| Privacy boundary | Address + districts hidden | Address hidden, **geographic identity public** |

### 9.1 Architecture: Proof vs. Application

```
GEOGRAPHIC IDENTITY PROOF (core system):
┌─────────────────────────────────────────────────────────┐
│  PURPOSE: Prove "this verified user belongs to these    │
│           14 districts" (district-to-user mapping)      │
│                                                         │
│  → 1 proof per campaign                                 │
│  → 1 nullifier for sybil resistance                     │
│  → Reveals complete geographic identity                 │
│  → Knows NOTHING about routing or recipients            │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
COMMONS (downstream application):
┌─────────────────────────────────────────────────────────┐
│  PURPOSE: Route messages to representatives             │
│                                                         │
│  → Campaign config: which districts to use for routing  │
│  → Uses geographic identity from proof                  │
│  → Looks up representatives for those districts         │
│  → Handles message delivery                             │
└─────────────────────────────────────────────────────────┘
```

**Key Principles:**
1. The proof establishes **geographic identity** (district-to-user mapping)
2. Commons **consumes** this identity for message routing
3. Routing is **Commons's concern**, not the proof's concern
4. One identity proof per campaign provides sybil resistance

---

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/commons
