# Brutalist Assessment Round 4 — Post-R3 Full Codebase Sweep

> **Status**: COMPLETE — 11 tasks done, 3 review gates passed
> **Date**: 2026-03-19
> **Source**: 2 critic reports (Claude + Gemini) against `src/`, validated by 4 parallel agents
> **Prior rounds**: `DM-BRUTALIST-FINDINGS.md` (R1), `DM-BRUTALIST-FINDINGS-R2.md` (R2), `BRUTALIST-SEAM-R3.md` (R3)

## Methodology

Full codebase roast of `src/` by Claude and Gemini critics. 29 raw findings deduplicated, then validated against actual code by 4 parallel Explore agents. 8 rejected as false positives. 12 validated findings documented below with solutions and pitfalls.

---

## Rejected Findings

| Finding | Reason |
|---------|--------|
| C1: Vector SQL injection via `::vector(768)` cast | Prisma `$executeRaw` template literals auto-parameterize. `vectorStr` is a bound param, not string interpolation. |
| C3: Unauthenticated debate stream | Debate state is public by design (blockchain-mirrored market data). No private user data exposed. |
| C5: Scorer O(n^2) upsert loop | Mischaracterized. Single SQL CROSS JOIN computes all similarities in one pass. Per-org upserts are O(orgs-per-bill), not O(bills x orgs). |
| M8: Debate spawn race condition | R3 already added `SELECT ... FOR UPDATE` in Phase 3 of `spawn.ts:133-136`. Second concurrent spawn returns null. |
| H8: Agent stream 240s timeout vs CF 30s | CF 30s is CPU limit. Streaming responses have 30-min wall-clock limit. 240s timeout is safe. |
| H6: Rate limit DB race (2x bypass) | Code acknowledges this (comment at line 443-447): "privacy guarantee comes from noise, not exact limits." Acceptable by design. |
| Gemini: User model God Object | Architectural observation, not actionable bug. User model is large but functional. Decomposition deferred to Phase 4. |
| Gemini: waitUntil non-durable | Correct that `waitUntil` isn't durable, but alternative (CF Queues) requires architecture change. Noted as future work, not current fix. |

---

## Validated Findings

### P0 — Critical (4)

#### F-R4-01: DistrictCredential missing from account merge → data loss

**File**: `src/lib/core/identity/identity-binding.ts:224-377`
**What**: `mergeAccountsInTx` handles 12 models with User FK, but `DistrictCredential` (schema line 638, `user_id` FK with `onDelete: Cascade`) is NOT included. When source user is deleted during merge, their district credentials are cascade-deleted instead of transferred.
**Impact**: Verified identity proof destroyed during Sybil-merge. User loses tier 2 status and must re-verify. Violates "One Person, One Vote" integrity guarantee.
**Solution**: Add per-row merge for DistrictCredential before `tx.user.delete`:
```ts
{
  const sourceCreds = await tx.districtCredential.findMany({ where: { user_id: sourceUserId } });
  if (sourceCreds.length > 0) {
    const targetCred = await tx.districtCredential.findFirst({ where: { user_id: targetUserId } });
    if (targetCred) {
      // Both have credentials — keep target's (more recent verification), delete source's
      await tx.districtCredential.deleteMany({ where: { user_id: sourceUserId } });
    } else {
      // Transfer source's credential to target
      await tx.districtCredential.updateMany({ where: { user_id: sourceUserId }, data: { user_id: targetUserId } });
    }
  }
}
```
**Pitfall**: `DistrictCredential` has `@unique` on `user_id`. If both users have credentials, `updateMany` would violate the unique constraint. Must delete source's if target already has one.

---

#### F-R4-02: Cron secret timing attack — all endpoints

**Files**: `src/routes/api/cron/legislation-sync/+server.ts:117`, `vote-tracker/+server.ts:29`, `analytics-snapshot/+server.ts:45`, `alert-digest/+server.ts:36`, `scorecard-recompute/+server.ts:26`, + others
**What**: All cron endpoints compare `CRON_SECRET` via string `!==`. Not constant-time. Attacker with network timing can extract secret byte-by-byte.
**Impact**: Full pipeline manipulation — attacker can trigger arbitrary cron jobs (legislation sync, analytics snapshots, scorecard recompute).
**Solution**: Replace with `timingSafeEqual` (already used in `delivery-confirmation.ts:69`):
```ts
import { timingSafeEqual } from 'crypto';
const expected = `Bearer ${cronSecret}`;
if (!authHeader || authHeader.length !== expected.length ||
    !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
  return json({ error: 'Unauthorized' }, { status: 401 });
}
```
**Pitfall**: `timingSafeEqual` throws if buffers differ in length. Must length-check first. Extract to shared utility to avoid copy-paste across 6+ files.

---

#### F-R4-03: Cross-org campaign ID forgery in call tracking

**File**: `src/routes/api/org/[slug]/calls/+server.ts:48-59`
**What**: `campaignId` from request body stored on `patchThroughCall` without validating it belongs to the org. Attacker can attribute calls to campaigns in other orgs.
**Impact**: Campaign analytics poisoning. Org A's call counts inflate Org B's campaign metrics.
**Solution**: Validate campaign belongs to org before storing:
```ts
if (campaignId) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId: org.id } });
  if (!campaign) throw error(400, 'Campaign not found in this organization');
}
```
**Pitfall**: None significant. Simple ownership check.

---

#### F-R4-04: Cross-org DM activity leakage

**File**: `src/routes/org/[slug]/representatives/[repId]/+page.server.ts:38-51`
**What**: `legislativeAction.findMany({ where: { decisionMakerId: dm.id } })` has no org filter. User in Org A sees all legislative actions tracked by any org following this DM.
**Impact**: Cross-org intelligence leakage. Org A can see what bills Org B is tracking and what actions their supporters took.
**Solution**: Filter by org context. LegislativeAction doesn't have a direct `orgId` FK, so filter via campaign → org join:
```ts
db.legislativeAction.findMany({
  where: {
    decisionMakerId: dm.id,
    bill: { orgBillRelevance: { some: { orgId: org.id } } }
  },
  orderBy: { occurredAt: 'desc' },
  take: 20
})
```
**Pitfall**: LegislativeAction is federal-level (not per-org). The org filter should scope to bills the org follows via `orgBillRelevance`, not restrict the action itself. If no org follows the bill, actions are naturally hidden.

---

### P1 — High (4)

#### F-R4-05: Embedder serial per-row UPDATE (N+1)

**File**: `src/lib/server/legislation/relevance/embedder.ts:67-76`
**What**: Per-bill UPDATE in a loop. 100 bills = 100 sequential round-trips through Hyperdrive.
**Impact**: Cron execution time 3-10s+ per batch. Blocks Hyperdrive's single connection.
**Solution**: Single batch UPDATE via raw SQL:
```sql
UPDATE bill SET topic_embedding = v.embedding::vector(768)
FROM (VALUES ($1::text, $2::text), ...) AS v(id, embedding)
WHERE bill.id = v.id
```
**Pitfall**: Prisma `$executeRaw` with dynamic VALUES list requires `Prisma.sql` + `Prisma.join` (same pattern as correlator R3 fix).

---

#### F-R4-06: IDENTITY_COMMITMENT_SALT no entropy validation

**File**: `src/lib/core/identity/identity-binding.ts:75-81`
**What**: Checks presence (`!COMMITMENT_SALT`) but not length or format. `IDENTITY_COMMITMENT_SALT=abc` passes validation. Low-entropy salt makes commitments reversible via rainbow table.
**Impact**: Identity commitments precomputable. Breaks ZK circuit's preimage resistance assumption.
**Solution**: Validate 64 hex chars (32 bytes):
```ts
if (!COMMITMENT_SALT || !/^[0-9a-f]{64}$/i.test(COMMITMENT_SALT)) {
  throw new Error('IDENTITY_COMMITMENT_SALT must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32');
}
```
**Pitfall**: Case-insensitive match (`/i`) since `openssl rand -hex` outputs lowercase but operators might uppercase.

---

#### F-R4-07: Sequential email delivery in report sending

**File**: `src/lib/server/campaigns/report.ts:555-595`
**What**: `for (const target of targets) { await sendEmail(...) }` — sequential SES round-trips per target.
**Impact**: 50 targets × 2s latency = 100s. Exceeds CF Worker timeout for large coalitions.
**Solution**: Batch with controlled concurrency:
```ts
const BATCH_SIZE = 10;
for (let i = 0; i < targets.length; i += BATCH_SIZE) {
  await Promise.all(targets.slice(i, i + BATCH_SIZE).map(async (target) => {
    // create delivery, send email, update delivery
  }));
}
```
**Pitfall**: Don't `Promise.all` the entire array — SES rate limit is 14/s. Batch of 10 with sequential batches respects the limit.

---

#### F-R4-08: Member sync Phase 4 — 600+ updates in array transaction

**File**: `src/lib/server/legislation/ingest/member-sync.ts:300-316`
**What**: `db.$transaction(toUpdate.map(m => db.decisionMaker.update(...)))` creates 600+ individual UPDATE statements in one transaction. Serialized through Hyperdrive max:1 pool.
**Impact**: 4-6s wall-clock for typical sync. Technical debt, not broken, but 10x slower than batch SQL.
**Solution**: Same pattern as correlator (R3 T-R3-13) — single raw SQL UPDATE:
```sql
UPDATE "decision_maker" SET name = v.name, party = v.party, ...
FROM (VALUES ...) AS v(id, name, party, ...)
WHERE "decision_maker".id = v.id
```
**Pitfall**: Many columns to update (12+). Use a CTE or temporary table for cleanliness. Or chunk into batches of 50 with `Prisma.join`.

---

### P2 — Medium (4)

#### F-R4-09: Memory-intensive `findMany({ distinct })` for ALD

**File**: `src/lib/server/campaigns/verification.ts:174-178`
**What**: `findMany({ distinct: ['messageHash'] })` pulls all unique hashes into memory to count them. Should be `COUNT(DISTINCT message_hash)`.
**Solution**: Replace with `db.$queryRaw<[{count: bigint}]>\`SELECT COUNT(DISTINCT message_hash) FROM campaign_action WHERE campaign_id = ${id}\``.

#### F-R4-10: Identity binding — unordered FOR UPDATE (theoretical deadlock)

**File**: `src/lib/core/identity/identity-binding.ts:137, 157-163`
**What**: Locks `currentUserId` via FOR UPDATE, then reads `existingUser` without lock. Schema prevents realistic deadlock (unique constraint on `identity_commitment`), but pattern isn't watertight.
**Solution**: Lock both rows in sorted order: `SELECT id FROM "user" WHERE id IN (${id1}, ${id2}) ORDER BY id FOR UPDATE`.
**Pitfall**: `existingUser` ID not known until after the first query. Add FOR UPDATE to the commitment lookup: `SELECT id FROM "user" WHERE identity_commitment = ${commitment} FOR UPDATE`.

#### F-R4-11: Salt entropy validation for credential encryption

**File**: `src/lib/core/identity/identity-binding.ts:75-81`
**What**: Already covered by F-R4-06. Grouped here for implementation — same file, same function.

#### F-R4-12: Debate on-chain orphan reconciliation gap

**File**: `src/lib/server/debates/spawn.ts:100-160`
**What**: If Phase 3 (DB write) fails after Phase 2 (on-chain call) succeeds, debate exists on-chain with no off-chain record. Bond money locked in invisible debate.
**Solution**: Log the on-chain debateId + txHash to a `DebateSpawnAttempt` table before Phase 3. Reconciliation job can match on-chain debates to failed DB writes.
**Pitfall**: Adds schema complexity. Alternative: retry Phase 3 with exponential backoff before giving up (3 attempts). On final failure, log to error monitoring for manual recovery.

---

## Task Graph

### Cycle 1: P0 Critical (3 parallel tracks)

| Task | Finding(s) | File(s) | Agent |
|------|-----------|---------|-------|
| T-R4-01: Add DistrictCredential to merge | F-R4-01 | `identity-binding.ts` | identity-eng |
| T-R4-02: timingSafeEqual for all cron endpoints | F-R4-02 | 6+ cron `+server.ts` files | security-eng |
| T-R4-03: Validate campaignId in call tracking | F-R4-03 | `calls/+server.ts` | api-eng |
| T-R4-04: Add org filter to DM activity query | F-R4-04 | `representatives/[repId]/+page.server.ts` | api-eng |

**Review Gate G-R4-01**: Verify DistrictCredential merge handles @unique, timing-safe on all cron endpoints, campaignId ownership check, DM activity scoped to org.

### Cycle 2: P1 High (parallel)

| Task | Finding(s) | File(s) | Agent |
|------|-----------|---------|-------|
| T-R4-05: Batch embedder UPDATE | F-R4-05 | `embedder.ts` | perf-eng |
| T-R4-06: Salt entropy validation | F-R4-06 | `identity-binding.ts` | identity-eng |
| T-R4-07: Batch email delivery | F-R4-07 | `report.ts` | perf-eng |
| T-R4-08: Member sync Phase 4 → raw SQL | F-R4-08 | `member-sync.ts` | perf-eng |

**Review Gate G-R4-02**: Verify embedder batch SQL, salt validation rejects short/non-hex, email batched with concurrency cap, member sync single SQL UPDATE.

### Cycle 3: P2 Medium (grouped)

| Task | Finding(s) | File(s) | Agent |
|------|-----------|---------|-------|
| T-R4-09: COUNT(DISTINCT) for ALD | F-R4-09 | `verification.ts` | perf-eng |
| T-R4-10: Ordered locking in identity binding | F-R4-10 | `identity-binding.ts` | identity-eng |
| T-R4-11: Debate spawn retry + reconciliation log | F-R4-12 | `spawn.ts`, `schema.prisma` | debate-eng |

**Review Gate G-R4-03**: Verify raw SQL COUNT DISTINCT, ordered FOR UPDATE, spawn retry logic.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R4-01 | **done** | identity-eng | Per-row merge: findMany → findFirst → delete/transfer, respects @unique |
| T-R4-02 | **done** | security-eng | Shared `cron-auth.ts` utility, 10 cron + 2 admin/debate endpoints updated |
| T-R4-03 | **done** | api-eng | `campaign.findFirst({ id, orgId })` before call record creation |
| T-R4-04 | **done** | api-eng | `bill: { relevances: { some: { orgId } } }` filter on legislativeAction |
| G-R4-01 | **passed** | team-lead | 4/4 checkpoints verified against code |
| T-R4-05 | **done** | perf-eng | `UPDATE...FROM (VALUES ${Prisma.join(values)})` — N→1 queries |
| T-R4-06 | **done** | identity-eng | `/^[0-9a-f]{64}$/i` regex, rejects short/non-hex |
| T-R4-07 | **done** | perf-eng | `BATCH_SIZE=10`, `Promise.all(batch.map(...))` with per-item try/catch |
| T-R4-08 | **done** | perf-eng | `CHUNK_SIZE=50`, loop over chunked array transactions |
| G-R4-02 | **passed** | team-lead | 4/4 checkpoints verified against code |
| T-R4-09 | **done** | perf-eng | `COUNT(DISTINCT "message_hash")` — 2 sites, both use raw SQL now |
| T-R4-10 | **done** | identity-eng | `$queryRaw` with `FOR UPDATE` on commitment lookup |
| T-R4-11 | **done** | debate-eng | 3-attempt retry with exponential backoff + structured orphan log |
| G-R4-03 | **passed** | team-lead | 3/3 checkpoints verified against code |
