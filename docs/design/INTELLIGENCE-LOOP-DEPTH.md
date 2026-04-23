# Intelligence Loop Depth: From Campaign-Scoped to Relationship-Scoped

> **Status**: Implemented + DecisionMaker migration complete (2026-03-18); schema rewritten in Convex 2026-04
> **Author**: noot
> **Date**: 2026-03-18
> **Depends on**: Intelligence Loop (INTELLIGENCE-LOOP-PLAN.md), Accountability Receipts (ACCOUNTABILITY-RECEIPT.md)
> **Builds on**: All 6 phases of the intelligence loop (implemented 2026-03-17/18)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Relationship-scoped
> architecture is shipped; the **Prisma/PostgreSQL framing is
> obsolete**. Concrete corrections:
>
> - **Schema is Convex.** The `Representative` / `OrgRepFollow` /
>   `OrgBillWatch` Prisma blocks (~lines 125-298) describe a database
>   that doesn't exist. Live tables: `decisionMakers`
>   (`convex/schema.ts:~1771`), `orgDmFollows` (~1854),
>   `orgBillWatches` (~1867), `accountabilityReceipts` (~1692),
>   `orgIssueDomains` (~1751). FKs are `decisionMakerId`,
>   not `representativeId`.
> - **Search is Convex-native.** The `searchBills()` sample using
>   `tsvector` / `to_tsquery` / `ts_rank` / Prisma `$queryRaw` (~lines
>   336-364) is fiction. Live code does
>   `ctx.db.query("bills").withSearchIndex("search_bills", q =>
>   q.search("title", args.q))` (`convex/legislation.ts`).
> - **Embeddings are Gemini `text-embedding-004`** (768-dim), not a
>   non-specified provider. No Voyage AI.
> - **"Representative" narrative is legacy.** The `Representative` →
>   `DecisionMaker` migration (Wave DM-1/2 in the implementation log)
>   renamed the table. Outside the log, the main narrative still
>   reads as if `Representative` is the canonical entity — rewrite
>   to `DecisionMaker` where it refers to the current table.
> - **API route paths are post-migration.** Routes under
>   `/api/org/[slug]/reps/*` should be `/api/org/[slug]/decision-makers/*`
>   (or whatever DM-namespaced form shipped) — verify against
>   `src/routes/` before linking.
> - **Scorecard compute is a stub** (`convex/legislation.ts:~1206` /
>   `computeScorecards` — `{ computed: 0, skipped: 0 }` log-only).
>   "Accountability score across 8 bills is 34/100" example framing
>   should read as aspirational, not live.
> - **Scroll L2 receipt anchor is Phase 3**, unmentioned below. See
>   ACCOUNTABILITY-RECEIPT banner for shipped vs. planned split.

## The Problem

The intelligence loop is one layer deep. It answers one question:

> "What happened with the specific decision-makers we contacted about specific bills we knew about?"

Every interaction in the system requires a campaign to have been created first. No campaign → no delivery → no tracking → no scorecard → no receipt. The org must already know which bill matters and which decision-maker to target before any intelligence activates.

This is the difference between a campaign tool with analytics and an intelligence platform. A campaign tool says "here's what happened with the campaign you ran." An intelligence platform says "here's what you need to know about the people and legislation that affect your mission."

### What's Missing

**Decision-maker identity is scattered.** There is no canonical Representative entity. The same person appears as:
- `LegislativeAction.externalId` (bioguide ID) + `.name` (plain text)
- `CampaignDelivery.targetEmail` + `.targetName` + `.targetTitle` + `.targetDistrict`
- `AccountabilityReceipt.bioguideId` + `.dmName`
- `Bill.sponsors[]` (JSON array with `{name, externalId, party}`)
- `InternationalRepresentative` (isolated table, no linkage to actions or bills)

Matching between these uses last-name substring comparison. "Smith" matches "Smith." Multiple representatives named Smith in the same state are indistinguishable. There's no persistent record of who a decision-maker is — only traces left by campaign interactions.

**Bill discovery is push-only.** Bills enter the system via Congress.gov cron. Orgs receive alerts when bills match their issue domain embeddings (cosine similarity > 0.75). But orgs cannot:
- Search for bills by keyword
- Browse bills by topic or jurisdiction
- Add a bill to a watchlist manually
- See "bills trending in your network"

If the embedding match misses (wrong threshold, novel framing, niche topic), the org never sees the bill.

**Org discovery doesn't exist.** Network invitations require knowing the exact org slug. There is:
- No org directory
- No org search
- No public org profiles
- No "organizations also tracking this bill"
- No coalition recommendation engine

The network decline endpoint doesn't even exist (UI calls `/decline`, returns 404).

**Vote tracking is campaign-scoped.** The vote tracker fetches roll calls for bills in the `Bill` table and correlates them to `CampaignDelivery` targets. An org cannot see:
- A representative's full voting record across all bills
- Whether a followed rep voted on anything this week
- Comparative voting patterns between representatives
- Historical accountability trends

The scorecard only scores representatives who received reports. A representative the org cares deeply about but hasn't yet sent a campaign to is invisible.

---

## Architecture

### The Representative as First-Class Entity

The foundation is a canonical `Representative` table that unifies all scattered decision-maker identity:

```
                     ┌──────────────────┐
                     │  Representative  │
                     │                  │
                     │  bioguideId ────────→ Congress.gov canonical ID
                     │  name            │
                     │  party           │
                     │  state/district  │
                     │  chamber         │
                     │  contact info    │
                     │  photoUrl        │
                     │  inOffice        │
                     └────────┬─────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
    LegislativeAction   OrgRepFollow    AccountabilityReceipt
    (FK: repId)         (org follows    (FK: repId)
                         this rep)
                              │
                              ▼
                     ┌──────────────┐
                     │  Activity    │
                     │  Feed        │
                     │              │
                     │  All votes   │
                     │  All actions │
                     │  All receipts│
                     └──────────────┘
```

Today, `LegislativeAction.decisionMakerId` is a nullable string pointing to `CampaignDelivery.id` — a delivery, not a person. With a canonical Representative, it points to an actual identity. `AccountabilityReceipt.bioguideId` becomes a proper foreign key instead of a denormalized string.

### Three Expansion Layers

**Layer 1: Representative Entity + Congress.gov Member Sync**
- Canonical table with bioguide as unique key
- Backfill from existing `LegislativeAction` + `Bill.sponsors` data
- Congress.gov members API ingestion (party, state, district, chamber, contact, photo)
- Foreign key migration: `LegislativeAction.representativeId`, `AccountabilityReceipt.representativeId`

**Layer 2: Bill Discovery + Rep Follow**
- Full-text search on Bill (PostgreSQL tsvector on title + summary)
- Bill browse by topic (existing embeddings, expose via API)
- `OrgBillWatch` for manual watchlist
- `OrgRepFollow` for persistent rep tracking
- Auto-follow on campaign delivery (rep enters org's view)
- Rep directory page with search, filter by state/party/chamber

**Layer 3: Activity Feed + Org Discovery**
- Vote history feed per followed rep (independent of campaigns)
- Proactive alerts: "Rep X voted on bill Y" for followed reps
- Public org profiles (mission, issue domains, supporter count range)
- "Also tracking this bill" surface
- Network formation from shared accountability targets

---

## Schema

### New Model: Representative

```prisma
model Representative {
  id           String   @id @default(cuid())

  /// Congress.gov canonical identifier (e.g., "B001230")
  bioguideId   String   @unique @map("bioguide_id")

  /// Display name (official Congress.gov listing)
  name         String
  firstName    String?  @map("first_name")
  lastName     String   @map("last_name")

  /// Political metadata
  party        String?  // "D" | "R" | "I" | "L" | null
  state        String?  // Two-letter state code
  district     String?  // House district number (null for senators)
  chamber      String?  // "house" | "senate"

  /// Contact
  phone        String?
  email        String?
  websiteUrl   String?  @map("website_url")
  officeAddress String? @map("office_address")
  photoUrl     String?  @map("photo_url")

  /// Status
  inOffice     Boolean  @default(true) @map("in_office")
  termStart    DateTime? @map("term_start")
  termEnd      DateTime? @map("term_end")

  /// Sync metadata
  lastSyncedAt DateTime? @map("last_synced_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  /// Relations
  actions      LegislativeAction[]
  receipts     AccountabilityReceipt[]
  followers    OrgRepFollow[]

  @@index([state, district])
  @@index([party])
  @@index([chamber])
  @@index([lastName])
  @@map("representative")
}
```

**Why bioguideId as unique key:** Congress.gov assigns a Biographical Directory ID to every member who has ever served. It's stable across terms, name changes, and party switches. It's already used as `LegislativeAction.externalId` and `AccountabilityReceipt.bioguideId`. This is the canonical identity.

**Why not merge with InternationalRepresentative:** Different identity systems (bioguide vs UK Parliament member IDs vs Canadian Parl IDs), different metadata (constituencies vs districts), different data sources. A shared base type adds complexity without value until cross-border accountability is real. Keep them separate; unify at the query layer when needed.

### New Model: OrgRepFollow

```prisma
model OrgRepFollow {
  id               String   @id @default(cuid())
  orgId            String   @map("org_id")
  representativeId String   @map("representative_id")

  /// How this follow originated
  reason           String   @default("manual") // "manual" | "campaign_delivery" | "bill_sponsor" | "alert"

  /// Whether to alert on new activity
  alertsEnabled    Boolean  @default(true) @map("alerts_enabled")

  /// Optional note from org (e.g., "key vote on water bill")
  note             String?

  followedAt       DateTime @default(now()) @map("followed_at")

  org              Organization   @relation(fields: [orgId], references: [id], onDelete: Cascade)
  representative   Representative @relation(fields: [representativeId], references: [id], onDelete: Cascade)

  @@unique([orgId, representativeId])
  @@index([orgId])
  @@index([representativeId])
  @@map("org_rep_follow")
}
```

**Auto-follow triggers:**
- When a `CampaignDelivery` is created targeting a representative, auto-create `OrgRepFollow` with `reason: 'campaign_delivery'`
- When an org acts on a `LegislativeAlert`, auto-follow the bill's sponsors with `reason: 'bill_sponsor'`
- Manual follow from the representative directory

### New Model: OrgBillWatch

```prisma
model OrgBillWatch {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")
  billId    String   @map("bill_id")

  /// How this watch originated
  reason    String   @default("manual") // "manual" | "alert" | "campaign"

  /// Org's declared position on this bill
  position  String?  // "support" | "oppose" | null

  addedBy   String?  @map("added_by") // userId who added it

  createdAt DateTime @default(now()) @map("created_at")

  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  bill      Bill         @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@unique([orgId, billId])
  @@index([orgId])
  @@map("org_bill_watch")
}
```

### Schema Modifications

**Bill — add full-text search:**

```sql
-- Migration: add tsvector column for full-text search
ALTER TABLE "bill"
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS bill_fts_gin ON bill USING gin(fts);
```

**LegislativeAction — add representative FK:**

```prisma
model LegislativeAction {
  // ... existing fields ...

  /// NEW: canonical FK to Representative (replaces string-based matching)
  representativeId String? @map("representative_id")
  representative   Representative? @relation(fields: [representativeId], references: [id])

  // decisionMakerId remains for backward compat (delivery linkage)
  // externalId remains as source system ID (bioguide, openstates, etc.)
}
```

**AccountabilityReceipt — add representative FK:**

```prisma
model AccountabilityReceipt {
  // ... existing fields ...

  /// NEW: canonical FK to Representative
  representativeId String? @map("representative_id")
  representative   Representative? @relation(fields: [representativeId], references: [id])

  // bioguideId + dmName remain as denormalized copies for display/query
}
```

**Organization — add public profile fields:**

```prisma
model Organization {
  // ... existing fields ...

  /// NEW: public profile for org discovery
  mission         String?  // One-line mission statement
  websiteUrl      String?  @map("website_url")
  logoUrl         String?  @map("logo_url")
  isPublic        Boolean  @default(false) @map("is_public") // opt-in to directory listing

  /// Relations
  repFollows      OrgRepFollow[]
  billWatches     OrgBillWatch[]
}
```

---

## Key Algorithms

### 1. Congress.gov Member Sync

The members API provides canonical data for all current and historical members:

```
GET https://api.congress.gov/v3/member?limit=250&offset={offset}
```

Returns: bioguideId, name, party, state, district, terms, depiction (photo URL).

**Sync strategy:**
- Run after bill ingestion in the legislation-sync cron
- Paginate through all current members (≈535 House + 100 Senate)
- Upsert `Representative` rows by bioguideId
- Mark `inOffice = false` for members not in the current response
- Extract firstName/lastName from the official name field
- Store term dates, photo URL, party from the most recent term

**Backfill from existing data:**
- Query distinct `externalId` + `name` from `LegislativeAction` where `externalId IS NOT NULL`
- Query distinct `externalId` from `Bill.sponsors` JSON
- Create `Representative` rows for any bioguide IDs not yet in the table
- Update `LegislativeAction.representativeId` and `AccountabilityReceipt.representativeId` via:

```sql
UPDATE legislative_action la
SET representative_id = r.id
FROM representative r
WHERE la.external_id = r.bioguide_id
AND la.representative_id IS NULL;
```

### 2. Bill Full-Text Search

PostgreSQL tsvector with ranking:

```typescript
async function searchBills(query: string, opts: {
  jurisdiction?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ bills: Bill[]; total: number }> {
  const tsQuery = query
    .trim()
    .split(/\s+/)
    .map(w => `${w}:*`)  // prefix matching
    .join(' & ');

  return db.$queryRaw`
    SELECT b.*, ts_rank(b.fts, to_tsquery('english', ${tsQuery})) AS rank
    FROM bill b
    WHERE b.fts @@ to_tsquery('english', ${tsQuery})
    ${opts.jurisdiction ? Prisma.sql`AND b.jurisdiction = ${opts.jurisdiction}` : Prisma.empty}
    ${opts.status ? Prisma.sql`AND b.status = ${opts.status}` : Prisma.empty}
    ORDER BY rank DESC, b.status_date DESC
    LIMIT ${opts.limit ?? 20}
    OFFSET ${opts.offset ?? 0}
  `;
}
```

**Why tsvector over embedding search for bill discovery:** Embedding search is great for relevance scoring (does this bill match the org's mission?). But when an org types "HR 4521" or "clean water infrastructure," they want exact keyword matching with ranking, not semantic similarity. tsvector handles this correctly; embedding search would return tangentially related bills.

Both are available — tsvector for keyword search, embedding for topic browse.

### 3. Representative Activity Feed

For a followed representative, aggregate all activity:

```typescript
interface RepActivity {
  representative: Representative;
  recentVotes: Array<{
    bill: { id: string; title: string; status: string };
    action: string;       // voted_yes | voted_no | abstained
    occurredAt: string;
    receipt?: {           // null if org hasn't sent a campaign about this bill
      proofWeight: number;
      alignment: number;
      causalityClass: string;
    };
  }>;
  stats: {
    totalVotes: number;         // all-time votes tracked
    votesOnWatchedBills: number; // votes on bills org is watching
    accountabilityScore: number | null; // from receipts, null if none
    lastActivity: string;       // ISO date of most recent action
  };
}
```

**The key insight:** Activity feed shows ALL votes by a followed rep, not just votes on bills the org sent campaigns about. But receipts and proof weight only attach to votes where the org actually delivered proof. This creates a natural gradient:

- **Tracked + proved:** "Rep. Smith voted NO on HR-4521 despite proof from 847 verified constituents (weight: 0.83, causality: strong)" — full accountability receipt attached
- **Tracked + watched:** "Rep. Smith voted YES on SB-1203" — the org watches this bill but hasn't sent a campaign → no receipt, but the vote is visible
- **Tracked + new:** "Rep. Smith voted YES on HR-789" — the org doesn't watch this bill, but follows this rep → vote visible, bill can be added to watchlist with one click

This gradient turns passive following into active intelligence. Every vote a followed rep casts is a potential trigger for a new campaign.

### 4. Proof-Weighted Rep Discovery

When an org browses the representative directory, reps are ranked by relevance to the org:

```typescript
function computeRepRelevance(rep: Representative, org: {
  watchedBillIds: Set<string>;
  issueDomainEmbeddings: Float32Array[];
  followedRepIds: Set<string>;
}): number {
  let score = 0;

  // Already following? Surface at top
  if (org.followedRepIds.has(rep.id)) score += 1.0;

  // Voted on bills the org watches?
  const votesOnWatched = rep.actions.filter(a => org.watchedBillIds.has(a.billId));
  score += Math.min(votesOnWatched.length * 0.2, 0.6);

  // Sponsored bills matching org's issue domains?
  // (uses existing OrgBillRelevance scores)
  const sponsoredRelevant = rep.sponsoredBillRelevances
    .filter(r => r.score > 0.6)
    .length;
  score += Math.min(sponsoredRelevant * 0.15, 0.4);

  return Math.min(score, 2.0); // cap for display normalization
}
```

### 5. "Also Tracking This Bill"

When an org views a bill, surface (without attribution) how many other orgs in their network are watching the same bill:

```typescript
async function getBillNetworkSignal(billId: string, orgId: string): Promise<{
  networkOrgsWatching: number;
  totalOrgsWatching: number;  // across all Commons orgs
  networkProofWeight: number; // max proof weight across network receipts for this bill
}> {
  // Get org's network member IDs
  const networkOrgIds = await getNetworkOrgIds(orgId);

  const [networkCount, totalCount, maxWeight] = await Promise.all([
    db.orgBillWatch.count({
      where: { billId, orgId: { in: networkOrgIds } }
    }),
    db.orgBillWatch.count({ where: { billId } }),
    db.accountabilityReceipt.aggregate({
      where: { billId, orgId: { in: networkOrgIds } },
      _max: { proofWeight: true }
    })
  ]);

  return {
    networkOrgsWatching: networkCount,
    totalOrgsWatching: totalCount,
    networkProofWeight: maxWeight._max.proofWeight ?? 0
  };
}
```

**Privacy:** Only counts are shown. No org names. No attribution. "3 organizations in your network are also tracking this bill" — not "Organization X is tracking this bill." Opt-in attribution follows the same pattern as the public accountability page.

---

## Integration Points

### 1. Legislation Sync Cron (extend)

Add member sync after bill ingestion:

```
Step 1: Ingest bills (existing)
Step 2: Embed bills (existing)
Step 3: Score relevance (existing)
Step 4: Generate alerts (existing)
Step 5: Auto-dismiss stale (existing)
Step 6: Sync Congress.gov members → Representative table (NEW)
Step 7: Backfill representativeId on new LegislativeActions (NEW)
```

### 2. Vote Tracker Cron (extend)

After correlating votes to deliveries, also:
- Set `LegislativeAction.representativeId` from bioguide lookup
- Create `RepActivityAlert` for orgs following this rep (if alertsEnabled)
- Auto-follow: if a vote correlates to a delivery, ensure OrgRepFollow exists

### 3. Campaign Delivery (extend)

When `CampaignDelivery` is created:
- Resolve `targetName` + `targetEmail` → `Representative` (if match found by bioguide or name+state+district)
- Create `OrgRepFollow` with reason `campaign_delivery` if not exists
- Create `OrgBillWatch` with reason `campaign` if campaign has billId

### 4. Org Dashboard (extend)

Add "Representatives" and "Bills" sections:
- **Representatives:** Followed reps with recent activity, accountability scores
- **Bills:** Watched bills with status, network signal, "Create Campaign" CTA

### 5. Network Page (extend)

Add "Shared Accountability Targets":
- Reps that multiple network orgs follow
- Bills that multiple network orgs watch
- Coalition proof weight per shared target

### 6. Onboarding (extend Step 5)

After issue domains are declared and bills are scored:
- Auto-follow sponsors of top-relevance bills
- Auto-watch top-relevance bills
- Show: "Here are the decision-makers and bills that matter to your mission"

---

## New Routes

### API Endpoints

```
GET  /api/org/[slug]/representatives          — list followed reps with activity stats
POST /api/org/[slug]/representatives/follow    — follow a rep (body: { representativeId, note? })
DELETE /api/org/[slug]/representatives/[repId] — unfollow

GET  /api/org/[slug]/bills/search             — full-text bill search (query, jurisdiction, status)
GET  /api/org/[slug]/bills/browse             — topic-based bill browse (embedding similarity)
GET  /api/org/[slug]/bills/watched            — list watched bills with status
POST /api/org/[slug]/bills/watch              — add bill to watchlist (body: { billId, position? })
DELETE /api/org/[slug]/bills/watch/[billId]   — remove from watchlist

GET  /api/org/[slug]/representatives/[repId]/activity — rep activity feed (votes, receipts)
GET  /api/org/[slug]/bills/[billId]/signal    — network signal for a bill

GET  /api/representatives                      — public rep directory (search, filter)
GET  /api/representatives/[bioguideId]         — public rep profile

GET  /api/orgs/directory                       — public org directory (search, filter by domain)
```

### Pages

```
/org/[slug]/representatives              — followed reps dashboard
/org/[slug]/representatives/directory     — browse/search all reps
/org/[slug]/representatives/[repId]       — rep detail + activity feed
/org/[slug]/bills                         — bill search + watchlist
/org/[slug]/bills/[billId]                — bill detail + network signal
/representatives/[bioguideId]             — public rep profile (votes, receipts)
/directory                                — public org directory
```

---

## Implementation Sequence

### Wave 1: Representative Entity + Member Sync (Foundation)

1. `Representative` model in schema
2. Congress.gov members API integration in legislation sync cron
3. Backfill script: existing LegislativeAction + Bill.sponsors → Representative rows
4. FK migration: LegislativeAction.representativeId, AccountabilityReceipt.representativeId
5. Bill fts tsvector column + GIN index

### Wave 2: Follow + Watch + Search (Relationship)

6. `OrgRepFollow` + `OrgBillWatch` models
7. Bill search endpoint (tsvector) + bill browse endpoint (embedding)
8. Rep directory page with search/filter
9. Follow/unfollow UI + auto-follow on delivery
10. Bill watchlist page + manual watch/unwatch

### Wave 3: Activity Feed + Alerts (Depth)

11. Rep activity feed (all votes by followed reps)
12. Activity alerts: "Rep X voted on bill Y" for followed reps
13. Bill network signal: "N orgs in your network watching this bill"
14. Org dashboard integration: reps + bills sections

### Wave 4: Org Discovery (Network)

15. Organization public profile fields + opt-in directory listing
16. Public org directory with search by name and issue domain
17. "Also tracking this bill" surface
18. Network decline endpoint (fix the 404)
19. Coalition recommendation: orgs with overlapping issue domains + accountability targets

---

## Implementation Log

### Gate 1: Wave 1 Review (2026-03-18)

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| G1-1 | High | `prisma/schema.prisma` | Legacy `model representative` and new `model Representative` both generate `db.representative` accessor — runtime shadowing | **Fixed**: Renamed legacy to `CongressionalRep` → `db.congressionalRep`. Updated 8 files. |
| G1-2 | Low | `scripts/backfill-representatives.ts:116` | `gen_random_uuid()::text` vs schema's `@default(cuid())` — mixed ID formats | Accepted: both valid strings, backfill is one-time |
| G1-3 | Info | member-sync / backfill | Two tables store overlapping rep data (`representative` legacy + `representatives` new) | Legacy table serves address-verification; canonical `Representative` is intelligence entity. Unification deferred. |
| G1-4 | Info | `bills/search/+server.ts` | 4 query variants for filter combos — verbose but correct | Accepted: tagged templates prevent SQL injection |

**Result**: 1 High fixed, 1 Low accepted, 2 Info documented. Gate passed.

### Gate 2: Wave 2 Review (2026-03-18)

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| G2-1 | High | `representatives/+page.svelte` | Party filter/badge checks full names ("Democrat") but DB stores abbreviations ("D") | **Fixed**: Updated partyColor, partyAbbr, and filter options to use abbreviations |
| G2-2 | Medium | `representatives/+page.server.ts` | Dynamic query `Record<string, unknown>` loses `include` type — TS error on `f.representative` | **Fixed**: Rewrote to use spread-based conditional cursor with proper typing |
| G2-3 | Medium | `representatives/+page.server.ts` | Missing `FEATURES.LEGISLATION` gate (legislation page had it, representatives did not) | **Fixed**: Added feature flag check + gated nav item |
| G2-4 | Low | `representatives/+page.svelte:55` | `$derived(() => ...)` instead of `$derived.by(() => ...)` — works but not idiomatic Svelte 5 | **Fixed**: Changed to `$derived.by()` and removed function call syntax |
| G2-5 | Low | `campaigns/report.ts:478` | Auto-follow matches by `email` but member-sync doesn't populate Representative.email — trigger is effectively dormant | Accepted: will activate when delivery targets include bioguideId in future |

**Result**: 2 High fixed, 2 Medium fixed, 1 Low accepted. Gate passed.

### Gate 3: Wave 3 Review (2026-03-18)

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| G3-1 | Medium | `networks/[networkId]/leave/+server.ts` | Used `orgId` instead of `ownerOrgId` (schema field name) — TS error | **Fixed**: Changed to `ownerOrgId` |
| G3-2 | Info | `reps/[repId]/activity/+server.ts` | Over-fetches both sources by `limit+offset` for merge-sort — could be optimized with cursor-based pagination | Accepted: correct for current scale, optimize later if needed |
| G3-3 | Info | `directory/+page.svelte` | Client-side search filter on loaded data (not server-side) — adequate for MVP | Accepted: server-side search can be added when directory grows |

**Result**: 1 Medium fixed, 2 Info accepted. Gate passed.

### Implementation Summary

All 4 waves complete. 19 tasks across 3 review gates.

**Files created (new):**
- `src/lib/server/legislation/ingest/member-sync.ts` — Congress.gov member sync
- `scripts/backfill-representatives.ts` — One-time rep backfill
- `src/routes/api/org/[slug]/bills/search/+server.ts` — Bill full-text search
- `src/routes/api/org/[slug]/bills/browse/+server.ts` — Bill topic browse
- `src/routes/api/org/[slug]/reps/[repId]/follow/+server.ts` — Follow/unfollow API
- `src/routes/api/org/[slug]/reps/following/+server.ts` — List followed reps
- `src/routes/api/org/[slug]/bills/[billId]/watch/+server.ts` — Watch/unwatch API
- `src/routes/api/org/[slug]/bills/watching/+server.ts` — List watched bills
- `src/routes/api/org/[slug]/reps/[repId]/activity/+server.ts` — Rep activity timeline
- `src/routes/api/org/[slug]/reps/feed/+server.ts` — Org-wide rep feed
- `src/routes/api/org/[slug]/profile/+server.ts` — Org profile API
- `src/routes/api/org/[slug]/networks/[networkId]/decline/+server.ts` — Network decline
- `src/routes/api/org/[slug]/networks/[networkId]/leave/+server.ts` — Network leave
- `src/routes/org/[slug]/representatives/+page.server.ts` + `+page.svelte` — Rep directory
- `src/routes/org/[slug]/representatives/[repId]/+page.server.ts` + `+page.svelte` — Rep detail
- `src/routes/org/[slug]/legislation/+page.server.ts` + `+page.svelte` — Bill discovery
- `src/routes/directory/+page.server.ts` + `+page.svelte` — Public org directory

**Files modified:**
- `prisma/schema.prisma` — Representative, OrgRepFollow, OrgBillWatch models + FKs + Org profile fields
- `src/routes/api/cron/legislation-sync/+server.ts` — Member sync + backfill steps
- `src/lib/server/campaigns/report.ts` — Auto-follow trigger
- `src/routes/org/[slug]/+page.server.ts` + `+page.svelte` — Dashboard intelligence widgets
- `src/routes/org/[slug]/+layout.svelte` — Nav: Representatives + Legislation items
- Legacy model rename: `representative` → `CongressionalRep` (8 files)

---

## DecisionMaker Migration (2026-03-18)

Generalized `Representative` (US Congress-only, `bioguideId @unique`) into universal `DecisionMaker` entity
supporting any type of accountability target: legislators, executives, board members, agency officials.

### Gate DM-1: Schema + Migration + Sync Review

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| DM1-1 | Critical | `migration.sql` | Table name wrong: `"representatives"` → actual table is `"representative"` (singular, from `@@map`) | **Fixed**: Rewrote migration to SELECT FROM `"representative"` |
| DM1-2 | Critical | `migration.sql` | Column names wrong: `first_name`, `last_name`, `in_office`, `created_at` don't exist on `representative` table — actual columns are `name`, `is_active`, `last_updated` | **Fixed**: Rewrote to use actual columns with name parsing |
| DM1-3 | Critical | `migration.sql` | Attempted INSERT FROM `org_rep_follow` — no such table exists (model was never committed as a migration) | **Fixed**: Removed org_rep_follow migration; table will start empty |
| DM1-4 | Critical | `migration.sql` | DROP TABLE `representative` — table still used by `CongressionalRep` model + `user_representatives` FK | **Fixed**: Keep `representative` table; only drop `international_representatives` |
| DM1-5 | High | `schema.prisma` | `DecisionMaker` model missing `district` field — member-sync and UI depend on it | **Fixed**: Added `district String?` field |
| DM1-6 | High | `migration.sql` | Missing FK constraint from `legislative_action.decision_maker_id` → `decision_maker.id` | **Fixed**: Added ALTER TABLE with orphan cleanup |
| DM1-7 | Info | 54 TS errors | Stale `db.representative`, `db.orgRepFollow`, `db.internationalRepresentative`, `bioguideId` references | Expected: Wave 2 (API + receipt rewrite) will resolve all |

**Result**: 4 Critical fixed, 2 High fixed, 1 Info documented. Gate passed.

### Gate DM-2: API + Receipt + UI Review

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| DM2-1 | High | `representatives/+server.ts` | DecisionMaker.create missing `lastName` (required field) | **Fixed**: Added name parsing for first/last split |
| DM2-2 | High | `s/[slug]/+page.server.ts` | `db.representative` should be `db.congressionalRep` (person-layer) | **Fixed**: Updated 2 references |
| DM2-3 | High | `verify/receipt/[id]/+page.server.ts` | `receipt.bioguideId` → `receipt.decisionMakerId` | **Fixed** |
| DM2-4 | High | `representatives/+page.svelte` | References `f.representative`, `rep.state`, `rep.chamber`, `rep.inOffice`, `/reps/` API paths | **Fixed**: Full rewrite to `f.decisionMaker`, `dm.jurisdiction`, `dm.active`, `/decision-makers/` paths |
| DM2-5 | High | `representatives/[repId]/+page.svelte` | References `data.representative`, `rep.state`, `rep.chamber`, `rep.inOffice`, `/reps/` API path | **Fixed**: Full rewrite to `data.decisionMaker`, `dm.jurisdiction`, `dm.active`, `/decision-makers/` path |
| DM2-6 | Medium | `+page.svelte` (dashboard) | `rep.state` → `dm.jurisdiction`, label "Representatives" → "Decision Makers" | **Fixed** |
| DM2-7 | Medium | `+layout.svelte` | Nav label "Representatives" → "Decision Makers" | **Fixed** |
| DM2-8 | Info | TS errors | 289 → 208 total (81 migration errors resolved, 0 new) | All pre-existing |

**Result**: 5 High fixed, 2 Medium fixed, 1 Info documented. Gate passed.

### DecisionMaker Migration Summary

**Schema changes:**
- `DecisionMaker` replaces `Representative` (universal accountability target with type discrimination)
- `Institution` provides hierarchical organizational context
- `ExternalId` enables multi-system identity (bioguide, openstates, constituency, etc.)
- `OrgDMFollow` replaces `OrgRepFollow`
- `LegislativeAction.decisionMakerId` promoted to FK
- `AccountabilityReceipt.bioguideId` removed; `decisionMakerId` is canonical

**API changes:**
- `/api/org/[slug]/reps/*` → `/api/org/[slug]/decision-makers/*` (4 endpoints)
- Receipt generator/aggregation updated from bioguideId to decisionMakerId
- Geographic rep-lookup updated from internationalRepresentative to decisionMaker
- Auto-follow in campaign report updated

**UI changes:**
- Labels: "Representatives" → "Decision Makers" throughout
- Fields: `state` → `jurisdiction`, `chamber` → `title`, `inOffice` → `active`
- Chamber-specific filter removed (not applicable to universal model)
- Jurisdiction filter added

---

## What This Makes Possible

**Before (campaign-scoped):**
> "We sent a report to Rep. Smith about HR-4521. She opened it. She voted no."

**After (relationship-scoped):**
> "Rep. Smith represents 3 districts where our verified supporters live. She voted NO on HR-4521 despite our proof (weight: 0.83, causality: strong). She also voted YES on SB-1203 (a bill we watch but haven't campaigned on yet — 4 orgs in our network have). Her accountability score across 8 bills is 34/100. Two coalition partners also track her. Here's her full voting record for this session."

The intelligence loop stops being "what happened with our campaigns" and becomes "what's happening in governance that our verified constituency cares about." Every followed rep, every watched bill, every network signal compounds the org's understanding. And the accountability receipt system ensures that understanding is cryptographically grounded, not just correlational.

---

## What Existing Tools Cannot Replicate

**GovTrack/Congress.gov:** Shows all votes for all members. No org-specific relevance, no proof weight, no accountability receipts. Raw data without constituency binding.

**Quorum ($10K+/yr):** Tracks legislation + stakeholder engagement. But engagement is email opens and meeting counts — not ZK-verified constituency proof. Their "impact" metric is marketing reach, not democratic evidence.

**FiscalNote:** AI-powered legislative tracking. Relevance scoring exists. But no verification pipeline, no proof weight, no cryptographic receipts. Their scoring is editorial, not mathematical.

**What Commons adds:** The representative isn't just a name with a voting record. They're an entity with a proof trail — a history of verified constituent voice delivered to them, what they did with it, and how that compounds across bills, across orgs, across time. No other platform can produce this because no other platform has ZK-backed constituency verification.

---

## Cost Model

| Component | Volume | Unit Cost | Monthly |
|-----------|--------|-----------|---------|
| Congress.gov members API | ~3 calls/sync (paginated, 635 members) | Free | $0 |
| Member photo storage | 635 URLs (hotlinked from congress.gov) | None | $0 |
| Bill tsvector index | GIN index, grows with bill count | DB storage only | ~$0 |
| OrgRepFollow rows | ~50 follows/org × 100 orgs | DB storage only | ~$0 |
| OrgBillWatch rows | ~20 watches/org × 100 orgs | DB storage only | ~$0 |
| Activity feed queries | ~10/org/day × 100 orgs | DB compute only | ~$0 |
| **Total incremental** | | | **< $0.50/month** |

The depth expansion is almost entirely DB-side work. No new API costs, no new embedding costs. The intelligence is produced by connecting existing data through proper relationships.

---

## Thesis

The intelligence loop at one layer deep is a campaign analytics tool. Useful, but replaceable. Any platform can tell you "your email was opened."

At full depth — where an org follows decision-makers, watches legislation, receives proactive alerts on every vote by every followed rep, sees network signal across coalition partners, and has every interaction anchored by a cryptographic accountability receipt — it becomes the operating system for democratic accountability.

The representative is not a target. They're a persistent relationship. The bill is not a campaign trigger. It's a node in a governance graph. The org is not a customer. It's a node in an accountability network.

The depth comes from three things no other platform has:
1. **Verified constituency binding** — every proof weight traces back to ZK-backed identity
2. **Temporal accountability** — every vote is bound to what the decision-maker provably knew
3. **Network compounding** — every org that joins strengthens every other org's intelligence about shared decision-makers

The business case is simple: an org using Commons at full depth sees more, knows more, and proves more than an org using any combination of existing tools. The switching cost is the intelligence itself — the accumulated proof trails, the followed relationships, the network signal. It's not lock-in through proprietary format. It's lock-in through accumulated truth.
