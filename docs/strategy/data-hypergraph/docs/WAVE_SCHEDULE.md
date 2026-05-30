# Wave Schedule

## W-0 — Verify substrate honesty

**Gate**: none (initial)
**Tasks**: V-1..V-10 (10 tasks, all parallel)
**Exit criteria**:
- Each V-* task carries one of three verdicts:
  - **HONEST** — code-grounded confirmation with file:line citations
  - **GAP** — discovers a failure; adds a new fix task to W-1
  - **NOT-EXERCISABLE-WITHOUT-OPS** — defer per chokepoint-defer pattern from v2 (e.g., if SES sandbox is required to test bounce flow)

**Expected outcomes** (per pre-hypergraph survey):
- V-1, V-3, V-4, V-7, V-8, V-9, V-10: likely HONEST
- V-2: likely GAP (no client populates atlasVersion)
- V-5: likely GAP (preimage title-redaction mismatch)
- V-6: HONEST or NOT-EXERCISABLE depending on whether seedAll produces webhook rows

## W-1 — Drift cleanup + Seed expansion

**Gate**: W-0 verify complete
**Tasks**: D-1..D-5 (drift) + S-1..S-11 (seed) = 16 tasks
**Exit criteria**:
- Drift: D-1/D-2/D-3 catalogs complete; D-4/D-5 fixes either landed or deferred with revisit_when
- Seed: all 9 product-meaningful unseeded tables have seed records + S-11 sets a Coalition-tier brandingAccent
- Any GAP-fix tasks added during W-0 are scheduled here

**Parallel execution**:
- Drift catalog tasks (D-1, D-2, D-3) run concurrently; their fix tasks (D-4, D-5) depend on the corresponding catalog
- Seed tasks (S-1..S-11) all append to seed.ts; coordinate merge order but design is independent

## W-2 — Integration tests

**Gate**: W-1 complete (seed reflects substrate; schema drift cleared)
**Tasks**: T-1..T-6 (6 tasks, all parallel)
**Exit criteria**:
- Each test passes against seedAll output
- Test failures attributable to substrate issues block close

**Test → substrate map**:
- T-1: T9-3 webhook dispatch → SDK verifier roundtrip
- T-2: T6-5 receipt rendering + T8-3 AttestationVerifier
- T-3: T6-9 vote-cast auto-detect backfill
- T-4: NEW-T7-3 cross-org reputation portability
- T-5: NEW-E-2 atlasVersion drift surfacing
- T-6: NEW-E-3 debate field populator
