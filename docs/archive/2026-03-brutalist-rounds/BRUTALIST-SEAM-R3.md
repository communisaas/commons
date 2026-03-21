# Brutalist Assessment Round 3 — Post-Seam Resolution

> **Status**: COMPLETE — 14 tasks done, 3 review gates passed
> **Date**: 2026-03-19
> **Source**: 8 critic reports (4 verticals × 2 critics each) across seam resolution code
> **Prior rounds**: `DM-BRUTALIST-FINDINGS.md` (R1), `DM-BRUTALIST-FINDINGS-R2.md` (R2)

## Methodology

Targeted the 4 implementation verticals touched by the 3-seam resolution: verify-address (Split Brain), legislation/ (Batch Ingestion), spawn.ts (Debate Integration), identity-binding.ts (Identity Merge). Each vertical reviewed by Claude and Gemini critics. Findings deduplicated across verticals, validated against actual code, and cross-referenced with known deferred items to avoid re-litigating resolved work.

---

## Validated Findings

### P0 — Critical (6)

#### F-R3-01: On-chain call inside DB transaction → split-brain + connection starvation

**File**: `src/lib/server/debates/spawn.ts:84-111`
**What**: `proposeDebate()` (which calls `tx.wait()` for block confirmation on Scroll, 3-30s) executes INSIDE the Prisma `$transaction`. Holds a PostgreSQL connection for the entire blockchain round-trip. On CF Workers with Hyperdrive (max:1 pool), one spawn blocks all DB access.
**Impact**: (1) Connection pool exhaustion during concurrent spawns. (2) If Prisma transaction times out (5s default) but on-chain call already committed → debate exists on-chain with no off-chain record. Permanent split-brain, unrecoverable without reconciliation job. Bond money burned.
**Solution**: Move on-chain call OUTSIDE the transaction. Pattern:
1. Acquire a "pending" lock on the campaign (advisory lock or `debateId = 'PENDING'`)
2. Do on-chain call in open code
3. On success: short transaction to create Debate row + link campaign
4. On failure: release lock
**Pitfall**: The pending marker must be distinguishable from a real debateId. Use a separate `debateSpawnStatus` enum field rather than overloading `debateId`.

---

#### F-R3-02: Race condition — no row lock on campaign → double bond burn

**File**: `src/lib/server/debates/spawn.ts:40-52`, callers at 3 sites
**What**: `findUnique` inside the transaction reads `campaign.debateId` under `READ COMMITTED` isolation — no `FOR UPDATE` lock. Two concurrent requests both see `debateId: null`, both call `proposeDebate()` on-chain, both burn bonds. One transaction wins the `campaign.update`; the other fails, leaving an orphaned on-chain debate.
**Impact**: Real money lost (bond × 2). Orphaned on-chain state with no off-chain record.
**Solution**: Replace the Prisma `findUnique` with `$queryRaw` using `SELECT ... FOR UPDATE`:
```sql
SELECT id, debate_enabled, debate_id, debate_threshold, template_id
FROM campaign WHERE id = $1 FOR UPDATE
```
**Pitfall**: `FOR UPDATE` requires the transaction to be the first writer — if another transaction already holds the lock, this one blocks until it completes. Combined with F-R3-01 (on-chain call inside transaction), the second transaction would block for the full RPC duration. Fix F-R3-01 first to keep lock duration short.

---

#### F-R3-03: identity-binding updateMany → silent data loss on P2002

**File**: `src/lib/core/identity/identity-binding.ts:250-268`
**What**: `updateMany({ userId: sourceUserId }, { userId: targetUserId })` hits a unique constraint when any source DM relation conflicts with a target relation. PostgreSQL aborts the ENTIRE statement — no partial update. The catch block then `deleteMany({ userId: sourceUserId })`, destroying ALL source relations including non-conflicting ones.
**Example**: Source follows DMs [X, Y, Z], target follows [X, W]. UpdateMany fails on X. DeleteMany removes X, Y, Z. Y and Z are permanently lost.
**Impact**: Silent data loss of non-conflicting DM relations during identity merge.
**Solution**: Replace bulk update with per-row merge:
```ts
const sourceRels = await tx.userDMRelation.findMany({ where: { userId: sourceUserId } });
const targetDmIds = new Set(
  (await tx.userDMRelation.findMany({ where: { userId: targetUserId }, select: { decisionMakerId: true } }))
    .map(r => r.decisionMakerId)
);
for (const rel of sourceRels) {
  if (targetDmIds.has(rel.decisionMakerId)) {
    await tx.userDMRelation.delete({ where: { id: rel.id } }); // Duplicate — safe to drop
  } else {
    await tx.userDMRelation.update({ where: { id: rel.id }, data: { userId: targetUserId } });
  }
}
```
**Pitfall**: Per-row is more queries, but merge is rare (Sybil detection only). Correctness over performance here.

---

#### F-R3-04: identity-binding missing Segment FK → merge always fails

**File**: `prisma/schema.prisma:1508`, `identity-binding.ts:291`
**What**: `Segment.createdBy → User.id` has no `onDelete` clause. PostgreSQL defaults to `RESTRICT`. When `tx.user.delete({ where: { id: sourceUserId } })` executes, any Segment created by the source user causes a FK violation, rolling back the entire merge transaction.
**Impact**: Merge is a hard blocker for any user who created org segments. Silent failure with no recovery.
**Solution**: Two options:
- (A) Add `onDelete: SetNull` to `Segment.createdBy` — segments survive, creator becomes null
- (B) Transfer segments in identity-binding: `tx.segment.updateMany({ where: { createdBy: sourceUserId }, data: { createdBy: targetUserId } })`
Option B is better — preserves audit trail.
**Pitfall**: Also need to handle OrgMembership (unique on userId+orgId, both users same org → pick higher role), Subscription (unique userId → transfer if source has one), EncryptedDeliveryData (unique userId → preserve).

---

#### F-R3-05: member-sync non-atomic DM create + ExternalId → orphaned records

**File**: `src/lib/server/legislation/ingest/member-sync.ts:317-348`
**What**: Phase 5 uses TWO separate `$transaction` calls: first creates DecisionMaker rows, second creates ExternalId rows. If transaction 1 succeeds and transaction 2 fails, orphaned DMs exist with no ExternalId. Next sync re-creates them (lookup misses), producing duplicates.
**Impact**: Duplicate DecisionMaker rows for the same legislator. Corrupts correlator matching.
**Solution**: Merge into a single `$transaction`:
```ts
await db.$transaction(
  toCreate.flatMap((m, i) => [
    db.decisionMaker.create({ data: { type: 'legislator', ...m.data }, select: { id: true } }),
    // Can't reference dm.id inline — need interactive transaction instead
  ])
);
```
Actually, use an interactive transaction:
```ts
await db.$transaction(async (tx) => {
  for (const m of toCreate) {
    const dm = await tx.decisionMaker.create({ data: { ... } });
    await tx.externalId.create({ data: { decisionMakerId: dm.id, ... } });
    currentDmIds.add(dm.id);
  }
});
```
**Pitfall**: Interactive transaction holds connection longer. But create batches are typically small (0-10 new members per sync).

---

#### F-R3-06: member-sync mass deactivation if API returns partial results

**File**: `src/lib/server/legislation/ingest/member-sync.ts:350-364`
**What**: Phase 6 marks all federal legislators as `active=false` if their ID is NOT in `currentDmIds`. If Phase 1 (API fetch) terminates early (partial pagination, network error captured in `result.errors`), `currentDmIds` is incomplete. Phase 6 proceeds to deactivate the entire Congress.
**Impact**: All federal legislators marked inactive. Breaks correlator, scorecards, campaign targets.
**Solution**: Add a circuit breaker before Phase 6:
```ts
const totalFederalDms = await db.decisionMaker.count({
  where: { type: 'legislator', jurisdictionLevel: 'federal', active: true }
});
const wouldDeactivate = totalFederalDms - currentDmIds.size;
if (wouldDeactivate > totalFederalDms * 0.1) {
  result.errors.push(`Circuit breaker: would deactivate ${wouldDeactivate}/${totalFederalDms} — aborting`);
  return result;
}
```
**Pitfall**: The 10% threshold should be configurable. Also skip Phase 6 entirely if `result.errors.length > 0` from Phase 1.

---

### P1 — High (8)

#### F-R3-07: verify-address unbounded officials array → DoS

**File**: `src/routes/api/identity/verify-address/+server.ts:85-107`
**What**: No upper bound on `officials` array. Each official = 3-4 serial DB queries inside the transaction. 10K officials = 40K queries in one transaction.
**Fix**: `officials = officials.slice(0, 10)` — no congressional district has more than 3 reps (1 house + 2 senators).

#### F-R3-08: verify-address no bioguide_id/chamber validation → data corruption

**File**: `src/routes/api/identity/verify-address/+server.ts:89,235`
**What**: `bioguide_id` accepts empty strings (creates phantom ExternalId `{system:'bioguide', value:''}`). `chamber` not validated against `['house','senate']` at runtime — nonsensical DM records.
**Fix**: Add runtime validation: `bioguide_id` must match `/^[A-Z]\d{6}$/`, `chamber` must be `'house'|'senate'`.

#### F-R3-09: verify-address TOCTOU on trust_tier

**File**: `src/routes/api/identity/verify-address/+server.ts:146-149,201`
**What**: `trust_tier` read outside transaction, used inside. Concurrent request could change it.
**Fix**: Use atomic SQL: `UPDATE "user" SET trust_tier = GREATEST(trust_tier, 2) WHERE id = $1`.

#### F-R3-10: vote-tracker N+1 not batch-rewritten

**File**: `src/lib/server/legislation/actions/vote-tracker.ts:217-246`
**What**: Serial `findFirst` + `create` per member vote. 435 House members × 2 queries = 870 per roll call. With 40 votes per cron = 34,800 queries. The correlator and member-sync were batch-rewritten but vote-tracker was missed.
**Fix**: Batch pattern: collect all (externalId, billId, action) tuples, findMany existing, partition into creates, createMany.

#### F-R3-11: correlator last-name collision → wrong DM

**File**: `src/lib/server/legislation/actions/correlator.ts:214-239`
**What**: When multiple legislators share last name (e.g., 2 "Smiths"), `lastNameToDmId` takes first alphabetically. Wrong DM linked to LegislativeAction.
**Fix**: Add first-name cross-check: parse `action.name` for first+last, match both. Or: add `jurisdiction` (state) filter since the delivery target's state is known.

#### F-R3-12: identity-binding TOCTOU in bindIdentityCommitment

**File**: `src/lib/core/identity/identity-binding.ts:135-155`
**What**: `findUnique(identity_commitment)` outside any transaction. Two concurrent OAuth callbacks for same person can both pass check, leading to duplicate binding or corrupted merge.
**Fix**: Wrap the check + merge in a transaction with `SELECT ... FOR UPDATE` on the User row.

#### F-R3-13: identity-binding session invalidation gap after merge

**File**: `src/lib/core/identity/identity-binding.ts:155-160`
**What**: After merge, session still references deleted source user. All subsequent requests fail with auth errors until re-login.
**Fix**: Return `{ requireReauth: true }` from bindIdentityCommitment; caller invalidates session and forces re-auth to the canonical user.

#### F-R3-14: debate fire-and-forget uses bare IIFE instead of waitUntil

**Files**: `src/routes/c/[slug]/+page.server.ts:306-323`, 2 more sites
**What**: Debate auto-spawn uses `void (async () => { ... })()` instead of `platform.context.waitUntil()`. On CF Workers, the runtime may terminate the isolate before the async work completes.
**Fix**: Pass `platform` from the request event and use `waitUntil` (pattern already used in 12 other sites in the codebase).

---

### P2 — Medium (6)

#### F-R3-15: identity-binding missing OrgMembership/Subscription/EncryptedDeliveryData handlers

**File**: `src/lib/core/identity/identity-binding.ts`
**What**: Merge doesn't handle OrgMembership (unique userId+orgId → cascade deletes source's membership), Subscription (unique userId → cascade deletes paid subscription), EncryptedDeliveryData (unique userId → cascade deletes identity blob).
**Fix**: Add explicit handlers for each model before `user.delete`.

#### F-R3-16: verify-address credential accumulation — no revocation

**File**: `src/routes/api/identity/verify-address/+server.ts:181-193`
**What**: Every call creates a new DistrictCredential with no revocation of previous ones. Ambiguous credential state.
**Fix**: Set `revoked_at = now()` on existing unexpired credentials before creating new one.

#### F-R3-17: process.env in 4 legislation files — broken on CF Workers

**Files**: `member-sync.ts:62`, `congress-gov.ts:125`, `open-states.ts:76`, `vote-tracker.ts:78`
**What**: Direct `process.env.CONGRESS_API_KEY` access. Empty on CF Workers per project architecture.
**Fix**: Accept API key as parameter from the cron endpoint handler (which has access to platform env).

#### F-R3-18: correlator 500 sequential updates in $transaction

**File**: `src/lib/server/legislation/actions/correlator.ts:289-312`
**What**: Prisma `$transaction([...updates])` runs 500 individual SQL statements serially. Holds connection for full duration.
**Fix**: Replace with raw SQL `UPDATE ... FROM (VALUES ...) AS v(id, dm_id)`.

#### F-R3-19: spawn.ts API input validation gap

**File**: `src/routes/api/campaigns/[id]/debate/+server.ts:88-95`
**What**: `duration` and `jurisdictionSizeHint` not validated. `NaN`, `Infinity`, or negative values flow through.
**Fix**: Validate: `duration` integer 1-30 days, `jurisdictionSizeHint` integer 1-10000.

#### F-R3-20: identity-binding no idempotency guard on retry

**File**: `src/lib/core/identity/identity-binding.ts:135-155`
**What**: Retry after merge finds deleted source user → `RecordNotFound` error → 500 to user.
**Fix**: Check if `currentUserId` still exists before attempting merge. If not, return success (merge already completed).

---

## Rejected Findings

| Finding | Reason |
|---------|--------|
| Non-atomic DM creation in verify-address (findUnique → create) | Inside interactive transaction — P2002 rolls back cleanly, retried on next verification. Correct behavior. |
| Privacy theater (unsalted district hash) | district_hash is for aggregate counting, not privacy. ~435 districts is inherently small keyspace. Not designed as privacy-preserving. |
| Identity commitment domain prefix mismatch | Intentional domain separation: `address-attestation` for district, `commons-identity-v1` for mDL. Different commitment contexts, no collision by design. |
| Modular reduction bias (BN254) | Theoretical. ~25% bias in identity commitments is not exploitable for Sybil or preimage attacks at current scale. Standard in practice. |
| XSS in proposition_text | SvelteKit auto-escapes in templates. Report renderer uses string building but proposition_text is server-generated, not user-controlled. |
| Non-constant-time cron auth comparison | CF Workers request latency noise makes timing attacks impractical. And cron secrets are rotated. |
| API key in URL (Congress.gov) | Standard pattern for Congress.gov API. Keys are free and rate-limited. Log exposure is a monitoring concern, not a security vulnerability. |
| Redundant institution upserts per request | Upsert with `update: {}` is a no-op write. PostgreSQL handles gracefully. |
| OrgIssueDomain prefs abuse | weight:0 prevents scoring impact. Can be excluded from embedding pipeline by label filter. Low priority. |
| ALS dependency for background tasks | All legislation cron endpoints are SvelteKit request handlers — hooks.server.ts wraps them in `runWithDb`. |

---

## Task Graph

### Cycle 1: P0 Critical Fixes (3 parallel tracks)

| Task | File(s) | Agent | Blocked by |
|------|---------|-------|------------|
| T-R3-01: Move on-chain call outside DB transaction | `spawn.ts` | debate-eng | — |
| T-R3-02: Add SELECT FOR UPDATE race guard | `spawn.ts` | debate-eng | T-R3-01 |
| T-R3-03: Fix identity-binding updateMany data loss | `identity-binding.ts` | identity-eng | — |
| T-R3-04: Add Segment/OrgMembership/Subscription handlers | `identity-binding.ts`, `schema.prisma` | identity-eng | T-R3-03 |
| T-R3-05: Fix member-sync atomicity + circuit breaker | `member-sync.ts` | sync-eng | — |

**Review Gate G-R3-01**: Verify spawn.ts chain call outside tx, race guard works, identity merge handles all models, member-sync atomic + circuit breaker.

### Cycle 2: P1 High Fixes (parallel)

| Task | File(s) | Agent | Blocked by |
|------|---------|-------|------------|
| T-R3-06: verify-address input hardening | `verify-address/+server.ts` | api-eng | — |
| T-R3-07: Batch-rewrite vote-tracker | `vote-tracker.ts` | sync-eng | — |
| T-R3-08: Correlator last-name disambiguation | `correlator.ts` | sync-eng | — |
| T-R3-09: identity-binding TOCTOU + session + idempotency | `identity-binding.ts` | identity-eng | G-R3-01 |
| T-R3-10: Debate fire-and-forget → waitUntil | 3 call sites | debate-eng | G-R3-01 |

**Review Gate G-R3-02**: Verify input validation, vote-tracker batch, correlator disambiguation, identity TOCTOU fix, waitUntil.

### Cycle 3: P2 Medium Fixes (grouped)

| Task | File(s) | Agent | Blocked by |
|------|---------|-------|------------|
| T-R3-11: Credential revocation + trust_tier atomic SQL | `verify-address/+server.ts` | api-eng | — |
| T-R3-12: process.env → parameter injection for legislation | 4 files | sync-eng | — |
| T-R3-13: Correlator batch write → raw SQL | `correlator.ts` | sync-eng | — |
| T-R3-14: Debate API input validation | `debate/+server.ts` | debate-eng | — |

**Review Gate G-R3-03**: Verify credential revocation, env fix, batch SQL, input validation.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R3-01 | **done** | debate-eng | 3-phase pattern: read tx → open-code on-chain → write tx |
| T-R3-02 | **done** | debate-eng | `SELECT ... FOR UPDATE` in Phase 3 write tx (line 133) |
| T-R3-03 | **done** | identity-eng | Per-row merge: findMany → set-diff → delete/move per-row |
| T-R3-04 | **done** | identity-eng | Segment, OrgMembership (role priority), Subscription, EncryptedDeliveryData, ShadowAtlasRegistration |
| T-R3-05 | **done** | sync-eng | Single interactive tx for DM+ExternalId; 3-guard circuit breaker in Phase 6 |
| G-R3-01 | **passed** | team-lead | 8/8 checkpoints verified against code |
| T-R3-06 | **done** | api-eng | Cap 10, bioguide `/^[A-Z]\d{6}$/`, chamber enum, atomic `GREATEST(trust_tier, 2)` |
| T-R3-07 | **done** | sync-eng | findMany + createMany = 2 queries per roll call (was 870) |
| T-R3-08 | **done** | sync-eng | `lastNameToDms` multi-candidate map + first-name cross-check, ambiguous → skip |
| T-R3-09 | **done** | identity-eng | `$transaction` + `FOR UPDATE`, `mergeAccountsInTx` (no nested tx), `requireReauth`, idempotency guard |
| T-R3-10 | **done** | debate-eng | `platform.context.waitUntil()` at 2 sites + Node.js fallback |
| G-R3-02 | **passed** | team-lead | 10/10 checkpoints verified against code |
| T-R3-11 | **done** | api-eng | `updateMany({ revoked_at: null }, { revoked_at: now })` before new credential |
| T-R3-12 | **done** | sync-eng | 4 files + 2 cron callers: `apiKey?` param with `process.env` fallback |
| T-R3-13 | **done** | sync-eng | Single `$executeRaw` UPDATE...FROM (VALUES) — ~500 queries → 1 |
| T-R3-14 | **done** | debate-eng | duration 1-30 days, jurisdictionSizeHint 1-10000, `Number.isFinite` + `Number.isInteger` |
| G-R3-03 | **passed** | team-lead | 5/5 checkpoints verified against code |
