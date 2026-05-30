# Commons Data Hypergraph — INDEX

**Successor to** `docs/strategy/next-implementation-hypergraph/` (v2, sealed 2026-05-28).
**Horizon**: substrate-honesty audit + seed coverage + schema drift cleanup + integration tests.
**Created**: 2026-05-28.
**Promotion target**: `docs/strategy/data-hypergraph/`.

## Premise

Two capability hypergraphs (v1, v2) shipped 73 task closures including 41 v1 completions + 12 v2 completions of substrate. This hypergraph is the foundation audit — **does the substrate actually do what its code claims?** Does seed match what we ship? Are there orphaned schema fields the migration left?

No new feature work. Reductive + verifying.

## Topology

- **28 tasks**: 10 V-* verify · 5 D-* drift cleanup · 11 S-* seed coverage · 6 T-* test fixtures
- **4 tracks**: TR-V verify-substrate · TR-D drift-cleanup · TR-S seed-coverage · TR-T test-fixtures
- **3 waves**: W-0 verify (independent of all) → W-1 cleanup + seed → W-2 tests
- **0 chokepoints**: no ops/vendor/partnership gates; all engineering-bound
- **NEW edge type `verifies`**: tracks the audit-claim linkage so honesty failures are traceable to the verify task that surfaced them

## Files

| File | Purpose |
| --- | --- |
| `topology.json` | Schemas + statistics |
| `nodes/tracks.json` | 4 tracks |
| `nodes/waves.json` | 3 waves + gates |
| `nodes/clusters.json` | 9 clusters as CONTEXT (not realization metric) |
| `nodes/tasks.json` | 28 tasks with carryover_substrate |
| `nodes/chokepoints.json` | empty (no chokepoints) |
| `edges/blocks.json` | sparse — only test-on-verify-+-seed cross-edges |
| `edges/verifies.json` | 13 audit-claim linkages |
| `edges/composes.json` | task → cluster uncertainty |
| `edges/parallel.json` | 4 parallel-execution groups |
| `edges/requires.json` | soft prerequisites |
| `edges/unblocks.json` | empty |
| `docs/CRITICAL_PATH.md` | execution order |
| `docs/WAVE_SCHEDULE.md` | wave gates + exit criteria |
| `docs/EXECUTION_LOG.md` | append-only do→review record |

## Completion signal

ALL tasks status ∈ {completed, deferred} AND every verify task either confirms substrate honesty with code-grounded notes OR surfaces a GAP that becomes a new fix task in W-1.

## Anticipated discoveries

Likely GAPs (per pre-hypergraph survey):
- **V-2 atlasVersion**: no current client populates it. The substrate accepts it but no widget actually passes it from shadow-atlas client to the form. Fix → add to client + widget code.
- **V-5 AttestationVerifier**: page passes campaignTitle='(redacted on public surface)' but server's canonicalPreimage uses real title. Hash will mismatch. Fix → either return preimage from server or accept the privacy-vs-verifiability tradeoff and document.
- **V-3 debate populator**: untested against seeded data since no seeded campaign has debateId actually set. Will need S-3-adjacent fix.
- **D-3 unmaintained counters**: memory's "denormalized-counter-reset bugs" suggests there are still some.
- **D-2 unused indexes**: schema is large (90 tables, many with 5+ indexes); likely several orphans.

Each anticipated GAP becomes a new W-1 task if confirmed.
