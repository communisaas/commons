# DecisionMaker Migration — Brutalist Assessment Findings

> **Status**: ALL FINDINGS RESOLVED — 10 tasks, 3 review gates passed
> **Date**: 2026-03-18
> **Source**: 12 brutalist critic reports across 4 verticals (schema, security, migration, architecture)

## Methodology

Brutalist MCP roasts were run against the DecisionMaker migration across four verticals:
1. **Schema** — Prisma schema for DecisionMaker, Institution, ExternalId, OrgDMFollow
2. **Security** — Follow/unfollow API, activity endpoints, feed endpoint
3. **Migration** — SQL migration from representative/international_representatives
4. **Architecture** — Overall design: dual-table strategy, sync pipeline, identity model

Each vertical produced 3 critic reports. Findings were deduplicated, weighed for validity against actual code, and categorized. Invalid/overstated findings are documented in the rejection log below.

---

## Validated Findings

### P0 — Critical (block merge)

#### F-01: Correlator writes delivery ID into decisionMakerId FK

**File**: `src/lib/server/legislation/actions/correlator.ts:186`
**What**: `correlateVotesToDeliveries()` matches LegislativeActions to CampaignDelivery rows and writes `matched.id` (a delivery CUID) into `legislativeAction.decisionMakerId`. Post-migration, `decisionMakerId` is an FK to `decision_maker` — writing a delivery ID there either violates the FK constraint or silently corrupts data.
**Evidence**: Line 185-188 — `data: { decisionMakerId: matched.id }` where `matched` is from `campaign.deliveries`.
**Impact**: Every correlator cron run after migration either crashes (FK violation) or writes garbage FKs.

**Solution**: Rewrite the correlator to resolve the delivery target to a DecisionMaker via ExternalId lookup. The match flow becomes:
1. Match action to delivery (existing logic — bioguide or name)
2. Look up DecisionMaker by `externalId` table: `db.externalId.findUnique({ where: { system_value: { system: 'bioguide', value: action.externalId } } })`
3. Write `decisionMaker.id` (not `delivery.id`) into `legislativeAction.decisionMakerId`
4. Optionally retain delivery linkage via a separate `deliveryId` field if needed

**Pitfall**: The correlator's fallback name-matching path (no bioguide) has no ExternalId to look up. Options:
- (a) Skip DM linkage for name-only matches — acceptable, these are low-confidence anyway
- (b) Search `DecisionMaker` by lastName + jurisdiction — adds a query but resolves correctly
- Recommend (a) initially, graduate to (b) once name-matching accuracy is validated

---

#### F-02: Activity endpoint over-fetch enables DoS

**File**: `src/routes/api/org/[slug]/decision-makers/[dmId]/activity/+server.ts:45-46`
**What**: `take: limit + offset` means a request with `?offset=100000&limit=50` fetches 100,050 rows from both `legislativeAction` and `accountabilityReceipt`, then discards all but 50. An authenticated attacker (any org member) can spike DB load trivially.
**Evidence**: Lines 45 and 62 both use `take: limit + offset`.

**Solution**: Cap offset at 500 (immediate), then migrate to cursor-based pagination using `occurredAt` + `id` as cursor (same pattern used in supporters page).

**Pitfall**: Cursor pagination on a merged timeline (actions + receipts) requires sorting by a common field. Both have dates (`occurredAt` / `proofDeliveredAt`), so the cursor encodes `(date, id, source_type)`. More complex than single-table cursors but tractable.

---

### P1 — High (fix in this cycle)

#### F-03: Follow/unfollow API missing role authorization

**File**: `src/routes/api/org/[slug]/decision-makers/[dmId]/follow/+server.ts`
**What**: `loadOrgContext()` verifies org membership but not role. A `viewer`-role member can follow/unfollow DMs and change alert settings — write operations that should require `admin` or `editor` role.
**Evidence**: Lines 22, 77, 122 — all three handlers call `loadOrgContext` but never check `membership.role`.

**Solution**: Add role check after `loadOrgContext`. The existing `loadOrgContext` returns `{ org, membership }` where `membership` has `role: string`. Add:
```ts
if (!['owner', 'admin', 'editor'].includes(membership.role)) {
  throw error(403, 'Insufficient permissions');
}
```
Apply to POST, PATCH, and DELETE handlers. GET (following list, feed) can remain viewer-accessible.

**Pitfall**: Some orgs may want viewers to follow DMs (read-only tracking). Consider making follow a viewer-permitted action and restricting only PATCH (settings) and DELETE (unfollow) to editors. Decision depends on product intent — for now, restrict all writes.

---

#### F-04: Unbounded string inputs on follow API

**File**: `src/routes/api/org/[slug]/decision-makers/[dmId]/follow/+server.ts:34-37`
**What**: `reason` and `note` fields accept arbitrary-length strings with no validation beyond type check. A malicious user could send multi-MB payloads stored directly in the database.

**Solution**: Add length limits:
```ts
const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'manual';
const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;
```
Same for PATCH handler body.note.

---

#### F-05: No audit trail on follow records

**File**: `prisma/schema.prisma:2471-2487` (OrgDMFollow model)
**What**: `OrgDMFollow` records which org follows which DM but not which user performed the action. For orgs with multiple admins, there's no accountability for who changed follow/alert settings.

**Solution**: Add `followedBy String? @map("followed_by")` to OrgDMFollow, populated from `locals.user.id` in the API handler. Nullable for backcompat with existing rows.

**Pitfall**: Requires a schema migration. Can be batched with other schema changes. Don't add an FK to `user` table — just store the userId string to avoid cascade complexity.

---

#### F-06: International rep data loss in migration (constituency_name, chamber)

**File**: `prisma/migrations/20260318_decision_maker_migration/migration.sql:195-239`
**What**: The migration copies `international_representatives` into `decision_maker` but drops two columns:
- `constituency_name` (e.g., "Sheffield Hallam") — not mapped to any DM field
- `chamber` (e.g., "commons", "senate") — not mapped (title gets `office`, not chamber)

After `DROP TABLE international_representatives`, this data is unrecoverable.

**Solution**: Map `constituency_name` → `district` (it IS the constituency/district name). For `chamber`, either:
- (a) Create international institutions (UK House of Commons, etc.) and map `institution_id` — clean but requires institution seeds
- (b) Concatenate into title: `COALESCE(ir.office, '') || CASE WHEN ir.chamber IS NOT NULL THEN ' (' || ir.chamber || ')' ELSE '' END` — pragmatic
- Recommend (a) for data integrity, with (b) as fallback if institution seeding is too heavy for this cycle.

**Pitfall**: International reps are currently stubs (CA/GB/AU resolvers use hardcoded data). Data loss is real but the lost data is synthetic. Still, fixing the migration now prevents a worse problem when real international data arrives.

---

### P2 — Medium (fix before scaling)

#### F-07: Composite index missing for DM activity queries

**Files**: `prisma/schema.prisma:2300-2303` (LegislativeAction indexes)
**What**: The activity endpoint queries `legislativeAction` by `(decisionMakerId, occurredAt DESC)` but only single-column indexes exist. The DB must index-scan decisionMakerId then sort by occurredAt.

**Solution**: Add composite index:
```prisma
@@index([decisionMakerId, occurredAt])
```
Same for `accountabilityReceipt`:
```prisma
@@index([decisionMakerId, proofDeliveredAt])
```

---

#### F-08: ExternalId uniqueness constraint too strict for scoped systems

**File**: `prisma/schema.prisma:2466` — `@@unique([system, value])`
**What**: Global uniqueness on `(system, value)` means two DMs can't share the same external ID value within a system. For bioguide this is correct (globally unique). For `constituency`, IDs could theoretically collide across countries if using a generic system name.

**Solution**: Use country-specific system names when ingesting: `"uk-constituency"`, `"au-aec"`, `"ca-riding"` instead of generic `"constituency"`. Document this convention. The constraint is then correct.

**Pitfall**: The migration already uses `"constituency"` as the system for international reps. Need to update the migration to use country-scoped system names: `CONCAT(ir.country_code, '-constituency')`.

---

#### F-09: Feed endpoint pagination on merged timeline

**File**: `src/routes/api/org/[slug]/decision-makers/feed/+server.ts`
**What**: The feed endpoint only paginates LegislativeActions for followed DMs. It doesn't include AccountabilityReceipts in the feed, unlike the single-DM activity endpoint. This means the "org feed" view is incomplete.

**Solution**: Add receipt query to feed (parallel with actions), merge-sort by date, apply cursor pagination. Mirror the pattern in the activity endpoint but across all followed DMs.

---

#### F-10: Correlator fallback name-matching after DM migration

**File**: `src/lib/server/legislation/actions/correlator.ts:172-181`
**What**: The fuzzy name-matching fallback matches on last name only. Post-migration, this path should attempt DecisionMaker resolution by name + jurisdiction before writing any ID.

**Solution**: After F-01 is fixed (correlator uses DM IDs), this fallback becomes:
```ts
const dm = await db.decisionMaker.findFirst({
  where: { lastName: actionLastName, jurisdiction: /* from bill context */ }
});
```
This is more reliable than delivery-name matching and leverages the new model.

---

### P3 — Low / Deferred (track, don't block)

#### F-11: Split-brain CongressionalRep + DecisionMaker

**What**: Same person exists in both `representative` (for person-layer user_representatives FK) and `decision_maker` (for org-layer accountability). The migration preserves shared IDs, but the tables diverge over time as member-sync updates only DecisionMaker.
**Status**: Known, intentional. CongressionalRep is read-only post-migration. Full unification deferred to Phase 3 when person-layer migrates to DecisionMaker.

#### F-12: N+1 member sync at state scale

**What**: `member-sync.ts` creates individual DM + ExternalId rows per member. At federal scale (~540), this is fine. At state scale (~7,500), it's slow.
**Status**: Batch upsert optimization deferred until state-level ingestion is built. Document in `CROSS-BORDER-PLAN.md`.

#### F-13: Redundant externalId on LegislativeAction

**What**: `LegislativeAction.externalId` (raw bioguide string) is redundant with `decisionMakerId` (FK to DecisionMaker which has ExternalId relation). Both exist.
**Status**: `externalId` serves as the raw ingestion field from Congress.gov. Keeping it avoids a join during ingest. Can be deprecated once all resolution happens at ingest time. Low urgency.

---

## Rejected Findings

| Finding | Claimed by | Reason for Rejection |
|---------|-----------|---------------------|
| "String discriminators need CHECK constraints" | Schema critics | Prisma controls all writes; app validates types. CHECK constraints require raw SQL migrations and complicate schema management. Defense-in-depth but not proportionate. |
| "GET endpoints completely unrate-limited" | Security critics | All endpoints require authentication + org membership via `loadOrgContext`. Cloudflare edge rate limiting handles volumetric abuse. Per-endpoint rate limits are defense-in-depth, not a vulnerability. |
| "Name-matching is collision-prone at scale" | Architecture critics | Already documented in correlator comments. The bioguide path is primary; name matching is fallback. F-01 and F-10 address the real issue (correlator must write DM IDs, not delivery IDs). |
| "No tenant isolation on DecisionMaker reads" | Security critics | DecisionMaker is a public entity (legislators are public figures). Reads don't need org-scoping — any authenticated user should be able to view a DM's public info. Follow/receipt data IS org-scoped. |

---

## Task Graph

### Cycle 1: P0 Critical Fixes (parallel)

| Task | File(s) | Depends | Agent |
|------|---------|---------|-------|
| T-01: Fix correlator FK corruption | `correlator.ts` | — | correlator-eng |
| T-02: Cap activity offset + add cursor pagination | `activity/+server.ts` | — | api-eng |

**Review Gate G-01**: Verify correlator writes valid DM IDs; verify activity endpoint rejects offset > 500.

### Cycle 2: P1 High Fixes (parallel)

| Task | File(s) | Depends | Agent |
|------|---------|---------|-------|
| T-03: Add role check to follow API | `follow/+server.ts` | — | api-eng |
| T-04: Add input length limits to follow API | `follow/+server.ts` | T-03 (same file) | api-eng |
| T-05: Add followedBy to OrgDMFollow | `schema.prisma`, `follow/+server.ts` | — | schema-eng |
| T-06: Fix migration data loss (constituency_name → district, chamber → institution) | `migration.sql` | — | migration-eng |

**Review Gate G-02**: Verify role checks work, migration preserves all international rep data.

### Cycle 3: P2 Medium Fixes (parallel)

| Task | File(s) | Depends | Agent |
|------|---------|---------|-------|
| T-07: Add composite indexes for activity queries | `schema.prisma` | — | schema-eng |
| T-08: Scope ExternalId constituency system names | `migration.sql`, convention doc | T-06 | migration-eng |
| T-09: Add receipts to feed endpoint | `feed/+server.ts` | — | api-eng |
| T-10: Upgrade correlator name-fallback to DM resolution | `correlator.ts` | T-01 | correlator-eng |

**Review Gate G-03**: Verify indexes, feed completeness, correlator resolution accuracy.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-01 | **done** | correlator-eng | ExternalId bioguide lookup; name-only skips DM linkage |
| T-02 | **done** | api-eng | offset capped 500; skip/take per-source; count() for totals |
| T-03 | **done** | api-eng | Role check (owner/admin/editor) on POST/PATCH/DELETE |
| T-04 | **done** | api-eng | reason.slice(100), note.slice(1000) on POST+PATCH |
| T-05 | **done** | schema-eng | followedBy String? in schema + migration + API |
| T-06 | **done** | migration-eng | constituency_name→district, chamber→institution_id (6 seeds) |
| T-07 | **done** | team-lead | @@index([dmId, occurredAt]) + @@index([dmId, proofDeliveredAt]) |
| T-08 | **done** | migration-eng | LOWER(country_code)\|\|'-constituency' in ExternalId INSERT |
| T-09 | **done** | api-eng | Receipts + merge-sort + offset cap + count totals |
| T-10 | **done** | correlator-eng | findFirst by lastName (insensitive, active) fallback |
| G-01 | **passed** | team-lead | Per-source offset approximate for unified timeline — P2 scope |
| G-02 | **passed** | team-lead | Role checks, input caps, audit trail, migration data preserved |
| G-03 | **passed** | team-lead | Indexes, feed completeness, correlator accuracy verified |
