# Reader-Side Privacy Model

**Status:** canonical 2026-05-28 (T8-10)

## Premise

Every consumer of a Commons verification packet — staffer, journalist, donor, anonymous /v/[hash] visitor, indexing bot — sees **the same data**. There is no "trusted reader" exception. K-anonymity floors are the only privacy mechanism.

## What this means in practice

| Reader | Surface | Sees |
| --- | --- | --- |
| Authenticated org owner | `/org/[slug]/campaigns/[id]` | Aggregate counts + geo distribution + tier histogram + integrity prose |
| Authenticated org member | `/org/[slug]/campaigns/[id]` | Same |
| Decision-maker (recipient of report email) | report email body | Same |
| Anonymous /v/[hash] visitor | `/v/[hash]` | Same |
| Indexing bot | `/v/[hash]` (cached) | Same |

There is no row of code that says "show the exact tier breakdown to authenticated staffers but only the rounded percentage to anonymous visitors." That distinction is **architecturally absent**.

## Why

A "trusted reader" exception is one acquisition, one subpoena, or one leaked credential away from being a public surface. Any privacy guarantee we can offer to *one* reader has to be offered to *every* reader, or it isn't a guarantee. We make this a structural property of the codebase, not a runtime check.

## Mechanisms

### 1. K-anonymity floors

- **Cells (H3 res-7, ~5.16 km²):** suppressed when count < 5 (see `K_ANONYMITY_THRESHOLD` in `verification-packet.ts`).
- **Per-cell category sub-buckets (identity, authorship):** never published. Any deterministic per-cell category count is bypassable by a padding-bypass attack: an adversary tops up each category to L-1 with sockpuppets, then subtracts the known padding from the published count to recover the victim's category. No L-diversity floor saves this.
- **Campaign-level identity breakdown:** published, geo-decoupled (harder to attribute to a specific person via location join).
- **Date precision in /v/[hash]:** YYYY-MM-DD only on the public-anonymous surface.

### 2. Qualitative integrity prose

The Integrity Assessment component (`src/lib/components/org/IntegrityAssessment.svelte`) renders qualitative phrases ("spread across multiple areas", "concentrated in a few areas") — never raw metric values. This is intentional: a polling oracle that watches a 0.71 → 0.72 GDS increment can attribute the increment to a single new action, defeating the per-campaign K-anonymity floor.

### 3. Aggregate-only geography

Districts are hashed at the platform layer; the verification packet never exposes raw district codes. A reader can see "3 districts" or "spread across multiple areas" but cannot enumerate which districts.

## Audits

Audit checklist when adding a new packet-consuming surface:

- [ ] Surface returns **only fields that appear on `VerificationPacket`** — no joins to raw `campaignActions` or `supporters`.
- [ ] If the surface renders prose: the prose uses qualitative thresholds (e.g. "≥ 0.7 = spread"), not raw numeric values.
- [ ] If the surface renders cells: cells with `count < 5` are filtered or labeled "below K-anonymity floor".
- [ ] If the surface renders date ranges: precision matches the audience (public = YYYY-MM-DD; staffer = ISO).

If any of these are violated, the surface fails the privacy model.

## What this excludes

- This document does **not** cover *contributor* privacy (the privacy of users who submit actions). That lives in the cryptography spec — see `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`. Contributor identity is protected by the ZK identity commitment + revocation registry, not by reader-side filtering.
- This document does **not** cover *org* privacy (which orgs exist, who their owners are). Orgs are public surfaces; that's the product.

## See also

- `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md` §"K-anonymity and the polling oracle"
- `src/lib/server/verification-packet.ts` for the computation that enforces K-floors
- `memory/cell_cluster_brutalist_2026_05_14.md` for the privacy-threat-model audit that retired cell sub-buckets
