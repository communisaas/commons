# Commons Next Hypergraph — INDEX

**Successor to** `docs/strategy/implementation-hypergraph/` (v1, sealed 2026-05-28).
**Horizon**: first-org launch → Track B post-launch hardening → Phase 2 precision → international.
**Created**: 2026-05-28.

## Topology

- **73 tasks**: 61 carried over from v1 deferrals + 5 substrate writer wire-ups + 7 new operational items
- **6 tracks**: A (pre-launch ops) · B (post-launch hardening) · C (Phase 2 precision) · D (international) · E (substrate cleanup) · F (partnership + platform)
- **5 waves**: W-0 (ops gate) · W-1 (launch + cleanup) · W-2 (hardening) · W-3 (Phase 2 + partnerships) · W-4 (international)
- **5 chokepoints**: ABC enrollment · ses-proxy Lambda · mainnet composite · TEE enclave · Sentry on-call
- **9 capability clusters** carry over from v1; per-cluster `remaining_target` in `nodes/clusters.json` reflects what's left after v1's partial realization

## Files

| File | Purpose |
| --- | --- |
| `topology.json` | Schemas, statistics, completion signal, promotion target |
| `nodes/tracks.json` | 6 execution tracks with wave ceilings |
| `nodes/waves.json` | 5 waves with gates + exit criteria |
| `nodes/clusters.json` | 9 clusters with v1_status + remaining_target |
| `nodes/tasks.json` | 73 tasks with effort/deps/cluster/wave |
| `nodes/chokepoints.json` | 5 chokepoints with unblocks counts + gate owners |
| `edges/blocks.json` | 76 hard prerequisite edges |
| `edges/composes.json` | 88 task→cluster contribution edges |
| `edges/unblocks.json` | Subset of blocks pointing at chokepoints / wave gates |
| `edges/requires.json` | Soft prerequisites (informs, co-located) |
| `edges/parallel.json` | 7 parallel-execution groups |
| `docs/CRITICAL_PATH.md` | Chokepoint sequencing |
| `docs/WAVE_SCHEDULE.md` | Wave gates + exit criteria |
| `docs/EXECUTION_LOG.md` | Append-only do→review record |

## Premise

v1 closed 103 tasks: 42 completed + 61 deferred to documented `revisit_when` triggers. This hypergraph is the continuation. The substrate-honesty constraint carries over — five writer wire-ups (NEW-E-1..5) lift v1's "substrate shipped but writer not threaded" cases into honest user-visible features.

## Completion signal

Identical shape to v1: ALL tasks status ∈ {completed, deferred} AND every cluster's `remaining_target` met (walk `contributing_tasks`).

On completion:
1. Update `docs/strategy/capability-transcendence.md` realization table — each cluster's "Sweep progress" updates to reflect this hypergraph's completion ratio
2. Update `MEMORY.md` Build Status with the new sweep
3. Promote: `mv $TMPDIR/commons-next-hypergraph docs/strategy/next-implementation-hypergraph/`
