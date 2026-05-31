# Scorecard Methodology Changelog

**Canonical source:** `SCORECARD_METHODOLOGY_VERSION` constant in `convex/legislation.ts`.

Decision-maker scorecard snapshots are immutable rows in `scorecardSnapshots`, written by the analytics cron. Each row carries a `methodologyVersion` field. Bumping the constant produces a new version of snapshots running in parallel with archived versions — older rows are not rewritten, and the API surface (`getScorecard`, `/api/dm/[id]/scorecard`) returns the latest version by default while accepting an explicit `methodologyVersion` query arg for backwards-compatible reads.

The `by_decisionMakerId_periodEnd_methodologyVersion` index pre-existing on `scorecardSnapshots` means coexisting versions don't degrade query performance.

---

## v1 (2026 onward — current)

**Composite formula:** `0.5 × responsiveness + 0.5 × alignment` ∈ `[0, 1]`.

**Inputs:**
- `responsiveness = deliveriesOpened / deliveriesSent` — fraction of staffer-routed messages confirmed read.
- `alignment` — weighted by `proofWeight`: `Σ(alignment × proofWeight) / Σ(proofWeight)` over scored receipts.

**Per-snapshot fields:**
- `deliveriesSent`, `deliveriesOpened`, `repliesReceived`
- `proofWeightTotal` (sum of attached receipt weights)
- `alignedVotes`, `totalScoredVotes`
- `snapshotHash` — SHA-256 of canonical field ordering (tamper-evident)

**Window:** 90-day rolling, snapshotted at period boundaries.

**Known limitations:**
- Alignment computation depends on response-side ground truth (`responses.type === 'vote_cast'`). Coverage improves as T6-9 (auto-detection) lands.
- `responsiveness` does not distinguish "staffer read" from "automated open beacon" — a separate signal layer (deliveries.viewerKind) is planned for v2.

---

## How to bump methodology

1. Edit `SCORECARD_METHODOLOGY_VERSION` in `convex/legislation.ts` (bump integer).
2. Add a new section to this file describing the formula change, inputs, and the migration story.
3. Deploy. The next cron run writes v(N+1) snapshots in parallel with archived v(N) rows.
4. The reader API automatically defaults to v(N+1). Consumers needing the old methodology pass `?methodologyVersion=N` (REST) or `methodologyVersion: N` (Convex query).

Old versions are never deleted — they are the historical scorecard of record for the period they covered. Decisions to permanently retire a version (e.g., a formula proven incorrect) require a separate migration that rewrites the affected snapshots, with provenance preserved in this changelog.
