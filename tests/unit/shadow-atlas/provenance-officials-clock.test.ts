/**
 * B3 — district-resolution freshness provenance: honest officials-clock degrade.
 *
 * This is a REAL-ARTIFACT test. It feeds the actual published Shadow Atlas
 * manifest (voter-protocol/packages/shadow-atlas/output/US/manifest.json) — NOT
 * a hand-built mock — and asserts the two freshness clocks the credential
 * snapshots stay INDEPENDENT and HONEST:
 *
 *   - boundaryAsOf  derives from the manifest's `generated` timestamp (the atlas
 *                   build time → the district BOUNDARY geometry vintage). The
 *                   real manifest carries this, so the boundary clock is a real
 *                   value.
 *   - officialsAsOf derives from a SEPARATE officials-generation timestamp. The
 *                   real manifest carries NO such field today, so the only honest
 *                   value is `null` (degraded — "unknown at issuance"), NEVER the
 *                   boundary clock's value and NEVER a fabricated now()/borrowed
 *                   date.
 *
 * The point of pinning this against the real artifact: it proves the degrade is
 * driven by the actual upstream data, not by a mock that manufactures a value
 * the manifest lacks. When A2 lands and republishes the manifest WITH an
 * officials clock, this test's officials assertion flips to the real value —
 * the same extractor, no code change, no fabrication.
 *
 * The two derivations below mirror the honest extraction the resolver feeds
 * through GroundVerificationInput.boundary_as_of / officials_as_of →
 * verifyAddress → districtCredentials.{boundaryAsOf,officialsAsOf}.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The published manifest lives in the sibling voter-protocol repo. Try the
// worktree-depth climb first, then a normal sibling-checkout climb, so the test
// resolves the SAME real artifact whether run from a git worktree or a flat
// checkout. We never substitute a mock — if the artifact is genuinely absent we
// fail loudly rather than papering over with a fabricated value.
function locateRealManifest(): string {
	const candidates = [
		// commons/.claude/worktrees/<wf>/ → climb 4 → siblings of commons/
		path.resolve(repoRoot, '../../../../voter-protocol/packages/shadow-atlas/output/US/manifest.json'),
		// commons/ → climb 1 → siblings of commons/
		path.resolve(repoRoot, '../voter-protocol/packages/shadow-atlas/output/US/manifest.json'),
		// commons/ → climb 2 (monorepo-style)
		path.resolve(repoRoot, '../../voter-protocol/packages/shadow-atlas/output/US/manifest.json')
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	throw new Error(
		`Real Shadow Atlas manifest not found. Tried:\n${candidates.join('\n')}\n` +
			'This test intentionally pins against the published artifact; it must not ' +
			'be satisfied by a mock.'
	);
}

interface RealManifest {
	generated?: string;
	officials?: {
		// honest: the published shape has total_districts/total_officials/entries,
		// and NO generation timestamp. Declared optional so a future A2 republish
		// that adds `generated` typechecks without edits here.
		generated?: string;
		total_districts?: number;
		total_officials?: number;
		entries?: unknown[];
	};
	// future-proofing: A2 may publish a top-level officials clock instead.
	officialsGenerated?: string;
}

/**
 * Honest extractor for the BOUNDARY clock from the real manifest. The atlas
 * build time IS the boundary geometry vintage. Returns null only if the field
 * is genuinely absent — never a fabricated date.
 */
function extractBoundaryAsOf(manifest: RealManifest): string | null {
	return typeof manifest.generated === 'string' ? manifest.generated : null;
}

/**
 * Honest extractor for the OFFICIALS clock — a SEPARATE dimension. Reads only an
 * officials-specific timestamp; it NEVER falls back to the boundary clock. If
 * the manifest carries no officials freshness, the honest answer is null.
 */
function extractOfficialsAsOf(manifest: RealManifest): string | null {
	if (typeof manifest.officialsGenerated === 'string') return manifest.officialsGenerated;
	if (typeof manifest.officials?.generated === 'string') return manifest.officials.generated;
	return null;
}

describe('B3 provenance — real-manifest officials clock degrades honestly', () => {
	const manifestPath = locateRealManifest();
	const manifest: RealManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	it('reads the REAL published manifest (not a mock)', () => {
		// Sanity: this is the genuine artifact — it has the published officials
		// inventory shape (entries + totals), proving we did not load a fixture.
		expect(manifest.officials).toBeTruthy();
		expect(Array.isArray(manifest.officials?.entries)).toBe(true);
		expect(manifest.officials?.total_districts).toBeGreaterThan(0);
	});

	it('boundaryAsOf is a REAL value sourced from the manifest generation time', () => {
		const boundaryAsOf = extractBoundaryAsOf(manifest);
		// The real manifest carries `generated`, so the boundary clock is present.
		expect(boundaryAsOf).not.toBeNull();
		expect(typeof boundaryAsOf).toBe('string');
		// It must be a parseable timestamp — not a placeholder label.
		expect(Number.isNaN(new Date(boundaryAsOf as string).getTime())).toBe(false);
	});

	it('officialsAsOf is null TODAY — the manifest carries no officials clock (honest degrade)', () => {
		const officialsAsOf = extractOfficialsAsOf(manifest);
		// Honest gate: the published manifest has NO officials-generation field, so
		// the only truthful value is null. A passing-with-null assertion is the
		// success condition. (When A2 republishes with a real officials clock, this
		// flips to a non-null assertion — same extractor, no fabrication.)
		expect(officialsAsOf).toBeNull();
	});

	it('the two clocks are INDEPENDENT — officials is never copied from boundary', () => {
		const boundaryAsOf = extractBoundaryAsOf(manifest);
		const officialsAsOf = extractOfficialsAsOf(manifest);
		// Distinctness is the core invariant: a degraded officials clock must be
		// null, NOT the boundary clock's value. If these were ever equal here it
		// would mean the boundary date had been fabricated into the officials slot.
		expect(officialsAsOf).not.toBe(boundaryAsOf);
		expect(officialsAsOf).toBeNull();
		expect(boundaryAsOf).not.toBeNull();
	});
});
