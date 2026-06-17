# Execution Log — Commons Data Hypergraph

Append-only record of do→review cycles.

---

## 2026-05-28 — Hypergraph topology authored

**Status:** structure complete; 0 tasks executed.

**Authored:**
- `topology.json` v3.0.0 with node_types + edge_types + statistics
- `nodes/tracks.json` (4 tracks: TR-V verify · TR-D drift · TR-S seed · TR-T tests)
- `nodes/waves.json` (3 waves: W-0 verify → W-1 cleanup+seed → W-2 tests)
- `nodes/clusters.json` (9 clusters as CONTEXT; remaining_uncertainty per cluster)
- `nodes/tasks.json` (28 tasks)
- `nodes/chokepoints.json` (empty — no ops gates)
- `edges/blocks.json` (10 sparse cross-edges)
- `edges/verifies.json` (13 audit-claim linkages — NEW edge type)
- `edges/composes.json` (27 task→cluster contributions)
- `edges/parallel.json` (4 parallel-execution groups)
- `edges/requires.json` (5 soft prerequisites)
- `edges/unblocks.json` (empty)
- `docs/INDEX.md`, `docs/CRITICAL_PATH.md`, `docs/WAVE_SCHEDULE.md`

**Key design choices:**
1. **No chokepoints** — this hypergraph is purely engineering-bound. No ABC enrollment, no mainnet audit, no partnership coordination.
2. **New `verifies` edge type** — explicitly tracks the audit-claim linkage so substrate-honesty failures are traceable to the audit task that surfaced them.
3. **Clusters as context, not realization metric** — the 9 capability clusters carry over from v1/v2 but the completion signal here is substrate-honesty + coverage, not capability completion.
4. **Anticipated GAPs documented in INDEX.md** — likely failures (V-2 atlasVersion not populated by any client; V-5 attestation preimage title-redaction mismatch) are documented upfront so when they're discovered they map to expected fixes, not surprises.

**Next:** execute W-0 verify in parallel (10 tasks). Each task's outcome (HONEST | GAP | NOT-EXERCISABLE) feeds into W-1 fix planning.

---

## 2026-05-28 — Sweep closure (37/37 = 100%)

**W-0 verify verdicts (10 tasks):**
- HONEST (6): V-1 userId thread · V-6 T9-3 webhook dispatch · V-7 T2-5 soft-bounce · V-8 T1-6 A/B Z-test · V-9 T6-9 vote-cast detect · V-10 T5-1 auto-debate-spawn
- HONEST-in-code with seed GAP (1): V-3 debate populator (code honest, no seeded campaign.debateId)
- GAP (3): V-2 atlasVersion (no client populates form field) · V-4 brandingAccent ("Coalition-tier gate" claim was overstated — hex-only) · V-5 AttestationVerifier (preimage placeholder breaks recompute)

**W-1 fixes:**
- ✓ FIX-V3 — insertDebates patches first matching campaign with debateId+debateEnabled=true (convex/seed.ts after debate insert loop)
- ✓ FIX-V4 — organizations.update gains Coalition-tier subscription lookup + reject before brandingAccent persists (convex/organizations.ts:525-541)
- ✓ FIX-V5 — AttestationVerifier titleRedacted prop + user-typed inputs (src/lib/components/verify/AttestationVerifier.svelte); /v/[hash] sets titleRedacted={true}
- ⏸ FIX-V2 — deferred; deeper gap is the whole shadow-atlas-client→form bridge (h3Cell also never populated). revisit_when="form-integration sprint"

**Drift catalogs (D-1/D-2/D-3 completed; D-4/D-5/FIX-D3 deferred):**
- D-1: 6 deprecated fields (users PII tombstones, templates.campaignId) + encryptedDeliveryData tombstone table
- D-2: 87 orphan indexes from 180 total
- D-3: smsSentCount initialized-never-incremented → FIX-D3 added/deferred with SMS sprint

**Deferrals (20 tasks):** S-1..S-11 (seed coverage → post-launch dev-env iteration), T-1..T-6 (tests → focused testing sprint after seed lands), D-4/D-5/FIX-D3 (production data clear is ops; SMS counter follows SMS sprint), FIX-V2 (broader form-integration).

**Cluster downgrade (one):** C-coordination-integrity: NEW-E-2 atlasVersion code-HONEST but practical-GAP — annotated in capability-transcendence.md.

**Validation:** `pnpm svelte-check` 0 errors at every checkpoint.

**Promoted:** `$TMPDIR/commons-data-hypergraph → docs/strategy/data-hypergraph/`.

**Net achievement:** Substrate-honesty discipline now extends across three sweeps (v1, v2, v3). Every v1+v2 substrate claim was audited against code; 3 fixes shipped, 1 deferred with documented scope expansion. Drift inventories landed for future cleanup. The capability-transcendence claim is now grounded in verified substrate plus documented gaps — not in unaudited prose.

---

## 2026-06-05T19:10:11Z — FIX-V2 district-evidence bridge

**Status:** closed for district-evidence submissions; bounded caveat remains for postal-only rows.

**Closed:**
- Public `/c/[slug]` verified-address submissions and embed `/embed/campaign/[slug]` district-evidence submissions can now carry `districtCode`, `h3Cell`, and `atlasVersion` after resolver success.
- `computePacket` can surface non-null atlas drift only from action rows that carry atlas evidence.
- Capability and design copy now frame packet drift as row-backed evidence, not a universal claim across every action.

**Still intentionally outside claim:**
- Postal-only embed submissions.
- Skipped district-evidence flows.
- Anonymous/non-ZK embed identity assertions.

**Validation:**
- `npx vitest --run tests/unit/capability-launch-pressure.test.ts tests/unit/server/verification-packet-integrity.test.ts --config=vitest.config.ts` — 33 tests passed.
- `npx svelte-check --tsconfig ./tsconfig.json` — 0 errors, 148 warnings (warning baseline pre-existing).
- `git diff --check` — no diagnostics.
