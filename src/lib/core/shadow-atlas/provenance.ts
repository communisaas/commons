// Mirror of the upstream protocol's shadow-atlas provenance types
// (provenance-writer.ts ProvenanceRecord, tiger-authority-rules.ts AuthorityLevel).
// NO cross-repo import — coordinate via the R2 manifest schema. Any divergence is a correctness bug.
//
// tigerVintage is the string form ("TIGER2024"). An absent or "unknown" vintage MUST map to
// a null asOf downstream, never a fabricated or borrowed timestamp.

import type { District } from './client';

/**
 * Provenance for a single resolution, mirroring the upstream ProvenanceRecord
 * shape coordinated through the R2 manifest.
 *
 * - source / dataVersion mirror upstream ProvenanceRecord.
 * - authorityLevel mirrors the AuthorityLevel enum (numeric 0–5).
 * - tigerVintage is the D3 manifest string form ("TIGER2024").
 */
export interface ResolutionProvenance {
	source: string;
	tigerVintage: string;
	// LATENT (2026-07-03): never emitted by client.ts today; the public OpenAPI
	// spec intentionally omits them. Kept as optional slots to preserve the
	// upstream ProvenanceRecord mirror contract.
	authorityLevel?: number;
	dataVersion?: string;
}

/**
 * A resolved district plus its provenance and freshness clocks.
 *
 * confidence lives on the Resolution (not the provenance) because the commons-side
 * consumers reason about it alongside the resolved district shape.
 *
 * LATENT (2026-07-03): no runtime importer yet — the only consumer is the
 * anti-drift type test (tests/unit/shadow-atlas/provenance-type.test.ts).
 * Kept as the composed resolve-result shape for consumers that need
 * district + provenance + freshness clocks together.
 */
export interface Resolution {
	district: District;
	provenance: ResolutionProvenance;
	confidence: number;
	// Two separate freshness clocks, never collapsed into one `asOf`: boundary geometry and
	// officials data move on different cadences. A daily officials sync must not make a
	// quarter-stale boundary look fresh.
	// null = honestly-unknown (degraded), never a fabricated or borrowed timestamp.
	boundaryAsOf: string | null;
	officialsAsOf: string | null;
}
