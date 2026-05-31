# Commons Implementation Hypergraph — Index

**Location:** `$TMPDIR/commons-hypergraph/`
**Created:** 2026-05-28
**Source:** 10-lane planning synthesis over 9-cluster capability framing over 9-agent capability scope

## What this is

A task hypergraph realizing the full implementation plan from current state to capability transcendence. Hyperedges capture multi-way dependencies (composition, fan-out from chokepoints, fan-in convergence) that a flat task list cannot express.

## Topology summary

```
                    129 total nodes
                   /                 \
         28 meta-nodes              101 tasks
        /     |    |    \
    9 clusters 10 tracks 5 waves 4 chokepoints

         ~280 edges across 5 hyperedge types
        /        |          |          |        \
   blocks   composes  unblocks  requires  parallel
   (binary)  (n→1)    (1→n)     (n→1)    (binary undir)
```

## File layout

| File | Contents |
|---|---|
| `topology.json` | Schemas, node types, edge types, statistics |
| `nodes/clusters.json` | 9 capability clusters (verification, reach, composability, agentic-systems, quality-signaling, accountability, coordination-integrity, reader-side, data-sovereignty) |
| `nodes/tracks.json` | 10 implementation tracks |
| `nodes/waves.json` | 5 temporal waves (W-1 days 1-7 through W-5 continuous) |
| `nodes/tasks.json` | 101 task nodes with full metadata (effort, files, decisions, risks, acceptance) |
| `nodes/chokepoints.json` | 4 critical-path markers |
| `edges/blocks.json` | 60 directed binary blocking edges |
| `edges/composes.json` | ~130 task→cluster composition hyperedges |
| `edges/unblocks.json` | 10 chokepoint fan-out hyperedges |
| `edges/requires.json` | 13 fan-in convergence hyperedges |
| `edges/parallel.json` | 14 parallel groups |
| `docs/INDEX.md` | this file |
| `docs/CRITICAL_PATH.md` | 4 chokepoints with downstream chains |
| `docs/WAVE_SCHEDULE.md` | Wave-by-wave execution sequence |

## How to navigate

**By question:**

- "What's the highest-leverage task to start now?" → `docs/CRITICAL_PATH.md` (chokepoints)
- "What should ship in days 1-7?" → `nodes/waves.json` § W-1, or `docs/WAVE_SCHEDULE.md`
- "What does task X depend on?" → search `edges/blocks.json` for `target: X`
- "What does task X unblock?" → search `edges/blocks.json` for `source: X`, or `edges/unblocks.json` if X is a chokepoint
- "What capability does task X advance?" → search `edges/composes.json` for `task: X`
- "What can I parallelize?" → `edges/parallel.json`
- "What's the wave sequence?" → `docs/WAVE_SCHEDULE.md`

**By task ID:**

Task IDs use `T{track}-{item}` format. Example: `T4-1` is Track 4 (Agentic Systems) Item 1 (Delegation executor).

Tracks:
- TR-1: Launch Readiness
- TR-2: Comms Infrastructure
- TR-3: Reach Extension
- TR-4: Agentic Systems
- TR-5: Quality Signaling
- TR-6: Accountability Anchoring
- TR-7: Composability Surfaces
- TR-8: Reader-Side Product
- TR-9: Developer Platform
- TR-10: Tier System + Structural Cleanup

## Statistics

| Metric | Value |
|---|---|
| Total tasks | 101 |
| Total chokepoints | 4 |
| Tasks with no blockers | 41 (eligible to start in W-1 or W-2) |
| Effort: S (≤1 day) | 38 tasks |
| Effort: M (2-5 days) | 41 tasks |
| Effort: L (1-2 weeks) | 16 tasks |
| Effort: XL (2+ weeks) | 6 tasks |
| Wave 1 (days 1-7) | 11 tasks |
| Wave 2 (weeks 1-4) | 26 tasks |
| Wave 3 (months 1-3) | 38 tasks |
| Wave 4 (months 3-6) | 18 tasks |
| Wave 5 (continuous) | 8 tasks |
| Full closure estimate | 9-12 months |

## Effort tier definitions

| Tier | Definition |
|---|---|
| S | ≤1 day single engineer |
| M | 2-5 days |
| L | 1-2 weeks |
| XL | 2+ weeks; multi-engineer or multi-component |

## Task lifecycle

```
not_started → in_progress → completed
     │            │
     ↓            ↓
  blocked  ←→  deferred
```

Default: `not_started`. Update inline in `nodes/tasks.json` as work progresses.

## Conventions

- **Task IDs:** `T{track}-{item}` (e.g., `T4-1`)
- **Slugs:** `kebab-case` semantic name (e.g., `delegation-executor`)
- **File paths:** absolute paths from monorepo roots `/Users/noot/Documents/commons/` or `/Users/noot/Documents/voter-protocol/`
- **Cluster IDs:** `C-{slug}` (e.g., `C-agentic`)
- **Track IDs:** `TR-{n}` (e.g., `TR-4`)
- **Wave IDs:** `W-{n}` (e.g., `W-3`)
- **Chokepoint IDs:** `CP-{slug}` (e.g., `CP-delegation-executor`)

## Adjacency to project knowledge base

This hypergraph is the **execution layer** that sits on top of:

1. **Strategy:** `/Users/noot/Documents/commons/docs/strategy/capability-transcendence.md` — 9-cluster capability framing
2. **Current state:** `/Users/noot/Documents/commons/docs/design/ORG-CAPABILITY-SCOPE.md` — what's shipped/stubbed/missing with file:line citations
3. **Roadmap:** `/Users/noot/Documents/commons/docs/strategy/product-roadmap.md` — Phase 0-3 sequencing
4. **Memory:** `~/.claude/projects/-Users-noot-Documents-commons/memory/MEMORY.md` — operational facts that change as work progresses

When promoting this hypergraph to permanent storage (after first execution pass), copy to `docs/strategy/implementation-hypergraph/` and reference from MEMORY.md.

## Update protocol

This hypergraph is **immutable for sequencing decisions** once committed. Updates happen in three modes:

1. **Status updates:** patch `status` field on individual tasks in `nodes/tasks.json` as work progresses (`not_started` → `in_progress` → `completed`). No structural change.
2. **Discovery additions:** new tasks emerging from work get appended with `T{track}-{n+1}` IDs. Update blocks/composes/parallel edges. Topology unchanged.
3. **Structural changes:** if a chokepoint is removed (e.g., alternative architecture found), restructure `unblocks.json` + dependent `blocks.json` edges. Bump `topology.json` version.
