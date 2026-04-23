# Seam Resolution Plan — Three Priority Architectural Seams

> **Status**: Seam 1 complete; Seam 2 location unknown; Seam 3 partial (debate gated off) — reconciled 2026-04-23
> **Date**: 2026-03-19
> **Depends on**: DecisionMaker migration (complete), Brutalist R1+R2 (complete)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Reconciliation against
> code:
>
> - **Seam 1 (CongressionalRep → DecisionMaker split-brain):** ✅
>   **SHIPPED**. `CongressionalRep` fully removed from `src/`;
>   `DecisionMaker` entity live in `convex/schema.ts:~1771` with
>   `by_userId_decisionMakerId` index; `/api/submissions/create`
>   uses DecisionMaker authority chain. Audit-clean.
> - **Seam 2 (Batch Ingestion / N+1 elimination):** ⚠️
>   **NOT FOUND**. Files the plan cites (`correlator.ts`,
>   `member-sync.ts`) don't exist under `src/lib/server/legislation/`
>   — that directory contains only `monitoring.ts`, `receipts/`,
>   `scorecard/`. Either the logic moved into Convex actions without
>   a matching path rename, or S2 never shipped. Verify with a grep
>   over `convex/legislation.ts` before trusting the "done" mark.
> - **Seam 3 (Debate ↔ Campaign integration):** ⚠️ **PARTIAL +
>   GATED**. `spawnDebate` action, `debateEnabled`/`debateThreshold`
>   schema, SSE stream, and campaign-page debate display all exist.
>   **Auto-spawn on threshold is not wired** — `debateThreshold` is
>   stored but never checked on action creation; the manual endpoint
>   `/api/campaigns/[id]/debate` requires `FEATURES.DEBATE=true`
>   (currently `false`). The proof-report `renderDebateSection()`
>   claimed in S3-03 was not added to `report-template.ts`.
>
> - **Three-tree / 31-input claim in the plan is correct.**
>   `src/routes/api/submissions/create/+server.ts` validates exactly
>   31 BN254 public inputs.

## Overview

Three architectural seams identified from deferred work across brutalist rounds and the broader intelligence loop depth expansion. Each seam is independently resolvable with no cross-seam dependencies.

---

## Seam 1: Split Brain (`CongressionalRep` ↔ `DecisionMaker`)

**Problem**: Same legislators exist in two tables. `CongressionalRep` (person-layer address verification) and `DecisionMaker` (org-layer accountability). Six files in `src/` still reference the old model.

**Impact**: Person-layer verified supporters and org-layer accountability can't compose. A user's verified district reps don't flow into the org's followed DMs.

**Files touched**:
- `prisma/schema.prisma` — new `UserDMRelation` model, remove old models
- `prisma/migrations/20260319_user_dm_relation/migration.sql` — DDL + backfill
- `src/routes/api/identity/verify-address/+server.ts` — DM upsert instead of CongressionalRep
- `src/lib/core/identity/identity-binding.ts` — UserDMRelation in merge logic
- `src/lib/utils/templateResolver.ts` — DM field mapping
- `src/lib/components/template/TemplateModal.svelte` — type import
- `scripts/seed-database.ts`, `tests/` — seed + assertions

### Task Graph

```
S1-01 (UserDMRelation schema)
  ├→ S1-02 (migration SQL)
  ├→ S1-03 (verify-address rewrite)
  ├→ S1-04 (identity-binding rewrite)
  ├→ S1-05 (template resolution)
  └→ S1-06 (seed + tests)
       └→ S1-07 (drop old models)
            └→ G-S1 (review gate)
```

### Agent Assignment
- **schema-eng**: S1-01, S1-02
- **person-eng**: S1-03, S1-04
- **template-eng**: S1-05, S1-06
- **team-lead**: S1-07, G-S1

---

## Seam 2: Batch Ingestion (N+1 Elimination)

**Problem**: Three serial query patterns — correlator (500-1000 queries/run), member sync (~1500 queries), backfill (O(n) UPDATEs). All break at state scale.

**Impact**: Blocks OpenStates integration and state-level legislative tracking.

**Files touched**:
- `src/lib/server/legislation/actions/correlator.ts` — batch ExternalId lookup + batch write
- `src/lib/server/legislation/ingest/member-sync.ts` — batch findMany + transaction create/update

### Task Graph

```
S2-01 (batch correlator)       S2-03 (batch backfill)
      (independent)                  (independent)
S2-02 (batch member sync)
  └→ S2-04 (departed marking)
           └→ G-S2 (review gate)
```

### Agent Assignment
- **correlator-eng**: S2-01
- **sync-eng**: S2-02, S2-03, S2-04
- **team-lead**: G-S2

---

## Seam 3: Debate ↔ Campaign Integration

**Problem**: Debate infrastructure 85% built (15 endpoints, 26 components). Missing: auto-spawn on threshold, campaign UI display, proof report section, SSE events.

**Impact**: Debates and campaigns remain parallel features. Integration creates "your voice triggered deliberation" moment.

**Files touched**:
- New: `src/lib/server/debates/spawn.ts` — shared spawn function
- `src/routes/api/campaigns/[id]/debate/+server.ts` — use shared function
- Campaign action creation points — threshold check
- `src/routes/org/[slug]/campaigns/[id]/+page.svelte` + `+page.server.ts` — debate UI
- `src/lib/server/campaigns/report.ts` — debate section in report HTML
- Campaign SSE stream endpoint — debate events

### Task Graph

```
S3-01 (extract spawn fn)      S3-03 (campaign UI)
  └→ S3-02 (threshold check)  S3-04 (report renderer)    S3-05 (SSE events)
                                          │
                               G-S3 (review gate) ← all tasks
```

### Agent Assignment
- **debate-eng**: S3-01, S3-02
- **campaign-ui-eng**: S3-03
- **report-eng**: S3-04, S3-05
- **team-lead**: G-S3

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| S1-01 | **done** | schema-eng | UserDMRelation model + reverse relations |
| S1-02 | **done** | schema-eng | Migration with backfill via bioguide→ExternalId→DM join |
| S1-03 | **done** | person-eng | ExternalId lookup → DM upsert → UserDMRelation upsert |
| S1-04 | **done** | person-eng | UserDMRelation merge with P2002 handling |
| S1-05 | **done** | template-eng | deriveChamber() + dual-shape type guards |
| S1-06 | **done** | schema-eng | DM seeds + test helpers |
| S1-07 | **done** | team-lead | Schema + code purge: 0 old refs, migration drops tables |
| G-S1 | **passed** | team-lead | 7/7 checkpoints pass: zero refs, DM writes, clean schema |
| S2-01 | **done** | correlator-eng | 4-phase batch: O(n)→O(1) lookups + O(1) write |
| S2-02 | **done** | sync-eng | 6-phase batch: collect→lookup→partition→update→create→depart |
| S2-03 | **done** | sync-eng | Single raw SQL UPDATE...FROM join |
| S2-04 | **done** | sync-eng | Raw SQL unnest, integrated into Phase 6 |
| G-S2 | **passed** | team-lead | Correlator ~3 queries, sync ~5 queries, backfill 1 query |
| S3-01 | **done** | debate-eng | spawnDebateForCampaign() shared function |
| S3-02 | **done** | debate-eng | Fire-and-forget threshold at 6 action creation sites |
| S3-03 | **done** | campaign-ui-eng | Inline debate section with status badges |
| S3-04 | **done** | report-eng | renderDebateSection() in proof report HTML |
| S3-05 | **done** | report-eng | SSE debate events: spawned, argument, status, resolved |
| G-S3 | **passed** | team-lead | All 6 verification points checked |
