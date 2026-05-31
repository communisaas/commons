# Critical Path

```
W-0 (verify) — 10 tasks parallel
   V-1..V-10 audit substrate claims independently
                    ↓
              gather discoveries
                    ↓
============ W-0 → W-1 gate ============
                    ↓
       ┌────────────┴────────────┐
       ↓                          ↓
   D-1 D-2 D-3 (catalog)    S-1..S-11 (seed)
       ↓                          ↓
   D-4 D-5 (fix)                  ↓
       └────────────┬────────────┘
                    ↓
============ W-1 → W-2 gate ============
                    ↓
       T-1..T-6 integration tests (6 parallel)
                    ↓
              All-tasks-closed
```

## Critical chain length

- **W-0 verify**: ~3 hours if all 10 confirm honest; longer per discovered GAP
- **W-1 drift**: ~3-4 hours catalog + 1-2 day fix
- **W-1 seed**: ~3-5 hours across 11 sections of seed.ts
- **W-2 tests**: ~3-4 hours for 6 specs

Total estimate: 1.5-2 days engineering, dominated by drift catalog + seed authoring.

## Substrate audit linkage

13 verify-edges trace audit task → substrate claim. If V-N flags GAP, the corresponding substrate is downgraded from "shipped" to "partially shipped" in `docs/strategy/capability-transcendence.md`.

Audit linkage by cluster:
- **C-coordination-integrity**: V-1 (NEW-E-1 + T10-1), V-2 (NEW-E-2 + T10-9)
- **C-quality-signaling**: V-3 (NEW-E-3), V-8 (T1-6), V-10 (T5-1)
- **C-composability**: V-4 (NEW-E-4 + T7-7), V-6 (T9-3)
- **C-reader-side**: V-5 (NEW-E-5)
- **C-reach**: V-7 (T2-5)
- **C-accountability**: V-9 (T6-9)
