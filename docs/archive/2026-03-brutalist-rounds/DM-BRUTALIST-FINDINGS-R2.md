# DecisionMaker Migration — Brutalist Assessment Round 2

> **Status**: ALL FINDINGS RESOLVED — 8 tasks, 3 review gates passed
> **Date**: 2026-03-18
> **Source**: 11 critic reports across 4 verticals (correlator, security, API endpoints, migration)
> **Prior round**: `DM-BRUTALIST-FINDINGS.md` — 10 tasks completed, 3 gates passed

## Methodology

Round 2 roasts targeted post-fix code from Round 1. 4 verticals, 11 critics total (1 Gemini timeout). Findings were deduplicated across verticals, validated against actual code, and cross-referenced with Round 1 to avoid re-litigating resolved or already-deferred items.

---

## Validated Findings

### P0 — Critical (3)

#### F-R2-01: Scorecard compute.ts still compares decisionMakerId to delivery ID

**File**: `src/lib/server/legislation/scorecard/compute.ts:277`
**What**: `a.decisionMakerId === d.id` — post-migration, `decisionMakerId` is a DecisionMaker FK while `d.id` is a CampaignDelivery ID. This comparison NEVER matches. The "bioguide match via correlated decisionMakerId" path (lines 271-286) is dead code.
**Impact**: Scorecard always falls through to surname matching (line 289-290). The entire correlator fix (Round 1 T-01) provides zero benefit to the scorecard system — it still uses the same fragile name matching it always did.

**Solution**: Replace delivery-ID comparison with DM-aware matching:
```ts
// Look up the delivery target's DM via ExternalId or direct DM FK
const actionDmId = a.decisionMakerId;
if (actionDmId && targetDmId && actionDmId === targetDmId) {
  matchedActions = acts;
}
```
Requires resolving each delivery target to a DecisionMaker (via ExternalId from the delivery's correlated bioguide, or from the campaign's target metadata).

**Pitfall**: CampaignDelivery has no `decisionMakerId` field. The connection from delivery→DM requires joining through Bill.sponsors[].externalId→ExternalId→DecisionMaker, or through the correlator's match results. Consider adding a `decisionMakerId` FK to CampaignDelivery to make this join explicit.

---

#### F-R2-02: Correlator counts matches when dmId is null — infinite retry loop

**File**: `src/lib/server/legislation/actions/correlator.ts:226-228`
**What**: `result.matched++` and `result.matches.push(...)` execute regardless of whether `dmId` was resolved. When DM lookup fails (no ExternalId row, or name fallback finds nothing):
1. The action is counted as "matched" — inflated cron metrics
2. The action's `decisionMakerId` stays `null`
3. Next cron run re-fetches it (line 55: `decisionMakerId: null`)
4. Same null DM, same match, same null write — **forever**

**Impact**: Unresolvable actions create an infinite retry loop. The correlator processes the same 500 null-DM actions every 2 hours, generating 1500 DB queries per run with zero progress.

**Solution**: Two changes:
1. Only increment `matched` and push to `matches` when `dmId` is not null
2. Add a `correlatedAt` timestamp or `correlationStatus` field to LegislativeAction — mark actions as "attempted" even when DM resolution fails, so they're excluded from future runs. Alternatively, use a simpler approach: skip actions older than 30 days with null `decisionMakerId` (aging out stale actions).

**Pitfall**: Adding a schema field requires migration. Simpler immediate fix: move `matched++`/`matches.push()` inside the `if (dmId)` block, and add a separate `result.dmNotResolved++` counter for visibility.

---

#### F-R2-03: Broken merge-sort pagination in feed + activity

**Files**: `feed/+server.ts:48,78,152`, `activity/+server.ts:46,64,130`
**What**: Both endpoints apply `skip: offset` independently to each source (actions, receipts), then merge-sort and slice. When paginating:
- Page 1 (offset=0): shows correct top-N merged items
- Page 2 (offset=20): each source skips 20 of its own rows — but only some were consumed by page 1. Items the user never saw get skipped.

Example: 100 actions + 100 receipts interleaved. Page 1 correctly shows 10 of each. Page 2 skips 20 from each source — but only 10 from each were shown. **10 items from each source are permanently invisible.**

**Impact**: Users scrolling the feed see gaps and potentially duplicates. Every page after the first has incorrect results.

**Solution**: Replace offset-based dual-source pagination with cursor-based unified pagination:
```ts
// Cursor encodes: { date: ISO string, id: CUID, source: 'action'|'receipt' }
// Each source queries: WHERE (occurred_at, id) < (cursor.date, cursor.id)
// Merge-sort and take limit
// Return last item as next cursor
```
This is more complex but produces correct results. The alternative (UNION ALL in raw SQL) is simpler but requires raw queries.

**Pitfall**: Cursor pagination on a merged timeline needs both sources to sort by the same semantic field. Actions use `occurredAt`, receipts use `proofDeliveredAt`. These are different timestamps but serve the same purpose (when the event happened). The cursor must encode the source type to apply the correct field filter.

---

### P1 — High (5)

#### F-R2-04: Follow API uses phantom 'admin' role, bypasses requireRole helper

**File**: `src/routes/api/org/[slug]/decision-makers/[dmId]/follow/+server.ts:23,83,132`
**What**: Role check includes `'admin'` but `OrgRole = 'owner' | 'editor' | 'member'` (org.ts:4). The `requireRole()` helper at org.ts:79 already handles the hierarchy correctly. Three hand-rolled checks bypass it.
**Fix**: Replace all three with `requireRole(membership.role, 'editor')`.

---

#### F-R2-05: Correlator findFirst has no type/jurisdiction filter — wrong-person assignment

**File**: `src/lib/server/legislation/actions/correlator.ts:202-208`
**What**: `db.decisionMaker.findFirst({ where: { lastName, active: true } })` searches the ENTIRE DecisionMaker table — legislators, executives, board members, corporate officers, international officials. A federal House vote for "Smith" could be assigned to a corporate officer named Smith.
**Impact**: Once written, the wrong DM assignment is sticky — `backfillActionDecisionMakerIds` only updates null rows and won't correct it.
**Fix**: Add `type: 'legislator'` and `jurisdictionLevel: 'federal'` filters (the correlator only processes Congress.gov data). Add `orderBy: { lastName: 'asc' }` for deterministic results.

---

#### F-R2-06: following/+server.ts missing offset cap

**File**: `src/routes/api/org/[slug]/decision-makers/following/+server.ts:28`
**What**: `offset` is not capped. `?offset=999999999` forces PostgreSQL to scan and discard that many rows. Same DoS vector fixed in activity (Round 1 T-02) but missed here.
**Fix**: `Math.min(..., 500)` — one line.

---

#### F-R2-07: accountability_receipt composite index references non-existent table

**File**: backend migration script `20260318_decision_maker_migration`
**What**: Declaring the composite index `by_dm_delivered` on `accountabilityReceipts` fails if the table hasn't been created yet. Both this migration and the accountability receipt system are uncommitted — schema order is ambiguous.
**Fix**: Remove this index from the DM migration. It belongs in the accountability receipt migration (or a standalone migration that runs after both).

---

#### F-R2-08: jurisdiction_level 'international' is US-centric taxonomy

**File**: backend migration script `20260318_decision_maker_migration`
**What**: UK House of Commons is labeled `jurisdiction_level='international'` but it's a federal/national legislature within the UK. When adding Canadian provincial legislators (Cross-Border Plan), both federal Canadian MPs and provincial MPPs would have `jurisdiction='CA'` with no way to distinguish — federal is already coded as 'international'.
**Fix**: Change institution seeds and DM rows from `'international'` to `'federal'`. Reserve `'international'` for genuinely supranational bodies (EU Parliament, UN).

---

### P2 — Medium (5)

#### F-R2-09: PATCH handler missing JSON parse catch

**File**: `follow/+server.ts:100`
**What**: POST has `.catch(() => ({}))` but PATCH does raw `request.json()`. Malformed JSON throws unhandled 500.
**Fix**: Add `.catch(() => null)` then throw 400 if null.

---

#### F-R2-10: POST upsert returns 201 even on existing record

**File**: `follow/+server.ts:70`
**What**: `update: {}` returns old data unchanged but response says 201 Created.
**Fix**: Check if the follow was created or already existed inside a single Convex mutation (unique index lookup + insert), and return 200 when the insert was a no-op.

---

#### F-R2-11: reason field allows provenance forgery

**File**: `follow/+server.ts:38`
**What**: User can set `reason: "campaign_delivery"` which is a machine-generated provenance marker used in `report.ts:494`. UI treats this value specially in the representatives page.
**Fix**: Validate against allowed manual reasons: `['manual', 'research', 'constituent', 'coalition']`. Reject machine-only values.

---

#### F-R2-12: Nondeterministic sort ordering — no tiebreaker

**Files**: `feed/+server.ts:151`, `activity/+server.ts:129`, `following/+server.ts:33`
**What**: All three endpoints sort by a single timestamp with no tiebreaker. Equal timestamps produce unstable page boundaries — duplicates/gaps across refreshes.
**Fix**: Add `id` as secondary sort: `orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }]`. For the app-level merge sort, compare by `(date, id)`.

---

#### F-R2-13: Correlator Strategy 2 confidence label is "exact" but match is surname-only

**File**: `correlator.ts:155-169`
**What**: When `action.externalId` exists but isn't in sponsors, the code matches by last name only but labels confidence as `'exact'` (line 165). Having a bioguide on the action proves nothing about the delivery target's identity.
**Fix**: Set `confidence = 'fuzzy'` in the Strategy 2 block. Only Strategy 1 (bioguide in sponsors + name match) should be 'exact'.

---

## Rejected Findings

| Finding | Reason |
|---------|--------|
| N+1 correlator queries | Already noted R1 as P3/F-12. Valid but deferred to batch optimization phase. |
| Name parsing Western assumption | Already noted R1 as P3/F-06-R2. Only Congress.gov data flows through correlator. |
| Split-brain CongressionalRep | Already noted R1 as P3/F-11. Intentional, deferred to Phase 3. |
| Redundant external_id index | Cosmetic — Postgres handles gracefully, zero correctness impact. |
| Receipt model is snapshot not timeline | By design — receipts are unique on (orgId, billId, decisionMakerId). |
| Inconsistent name-splitting US vs intl | Different source formats require different parsing. US names come in "First Last" from Congress.gov. |
| Unbounded IN clause on follows | Valid performance concern but requires architectural change (subquery). Deferred — current scale is <100 follows/org. |
| Delete uses deleteMany | Intentional for idempotency. |
| Response leaks CUIDs | CUIDs are not sequential. Authenticated API. Acceptable. |
| Large body DoS | CF Workers + SvelteKit enforce body size limits. Rate limiting handles frequency. |
| Nullable decisionMakerId crash | Convex `.withIndex(...).filter(...)` on an `in` set skips null matches. No crash possible. |
| Missing (orgId, dmId, proofDeliveredAt) composite index | The existing (decisionMakerId, proofDeliveredAt) composite + orgId single index cover the query plan via bitmap AND. |

---

## Task Graph

### Cycle 1: P0 Critical Fixes (3 parallel tasks)

| Task | File(s) | Agent |
|------|---------|-------|
| T-R2-01: Fix scorecard dead delivery-ID comparison | `scorecard/compute.ts` | scorecard-eng |
| T-R2-02: Fix correlator match counting + retry guard | `correlator.ts` | correlator-eng |
| T-R2-03: Fix merge-sort pagination (feed + activity) | `feed/+server.ts`, `activity/+server.ts` | api-eng |

**Review Gate G-R2-01**: Verify scorecard uses DM IDs, correlator doesn't retry null DMs, pagination produces correct page sequences.

### Cycle 2: P1 High Fixes (grouped, 3 tasks)

| Task | File(s) | Agent |
|------|---------|-------|
| T-R2-04: Follow API — requireRole, PATCH catch, upsert semantics | `follow/+server.ts` | api-eng |
| T-R2-05: Correlator findFirst scope + confidence fix | `correlator.ts` | correlator-eng |
| T-R2-06: Migration — offset cap, receipt index, jurisdiction_level | `migration.sql`, `following/+server.ts` | migration-eng |

**Review Gate G-R2-02**: Verify role check uses helper, correlator scoped to legislator+federal, migration has no dangling refs.

### Cycle 3: P2 Medium Fixes (grouped, 2 tasks)

| Task | File(s) | Agent |
|------|---------|-------|
| T-R2-07: Sort tiebreaker + reason validation | `feed/+server.ts`, `activity/+server.ts`, `following/+server.ts`, `follow/+server.ts` | api-eng |
| T-R2-08: POST upsert 201 semantics | `follow/+server.ts` | api-eng |

**Review Gate G-R2-03**: Verify sort stability, reason validation, HTTP status codes.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R2-01 | **done** | scorecard-eng | DM-aware matching replaces dead delivery-ID comparison |
| T-R2-02 | **done** | correlator-eng-r2 | matched++ inside if(dmId); confidence='fuzzy' on Strategy 2 |
| T-R2-03 | **done** | api-eng-r2 | Cursor-based pagination (DATE__ID), tiebreaker sort, nextCursor |
| T-R2-04 | **done** | api-eng-r2 | requireRole, PATCH catch, reason allowlist |
| T-R2-05 | **done** | correlator-eng-r2 | type:'legislator', jurisdictionLevel:'federal', orderBy |
| T-R2-06 | **done** | migration-eng-r2 | Receipt index removed, 'federal' taxonomy, offset cap |
| T-R2-07 | **done** | team-lead | (date DESC, id DESC) tiebreaker on following endpoint |
| T-R2-08 | **done** | team-lead | findUnique→create, 200+created:false / 201+created:true |
| G-R2-01 | **passed** | team-lead | Scorecard DM-aware, correlator no retry, cursor pagination correct |
| G-R2-02 | **passed** | team-lead | requireRole helper, scoped findFirst, migration clean |
| G-R2-03 | **passed** | team-lead | Sort tiebreaker, reason validation, correct HTTP status codes |
