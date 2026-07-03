/**
 * applyStalenessGuard — pure-function tests for the boundary-redraw staleness guard.
 *
 * The guard is total and pure: it takes an already-resolved AddressResolutionResult
 * plus the manifest vintage and layers a loud warning + lowered confidence when the
 * atlas boundary is stale (vintage unknown, or a controlling map redrawn after the
 * vintage) or the district lookup missed. These tests construct base results directly —
 * no resolveAddress, no IPFS, no network, no crypto-WASM.
 *
 * Confidence ladder semantics mirror voter-protocol's getVersionConfidence (coordinated,
 * never imported): redraw → 0 (like enjoined/superseded), unknown vintage → ≤0.4 (like
 * challenged).
 */

import { describe, it, expect } from 'vitest';
import {
	applyStalenessGuard,
	REDRAW_SIGNAL,
} from '$lib/core/shadow-atlas/redraw-guard';
import { STATE_TO_FIPS } from '$lib/core/shadow-atlas/district-format';
import type { AddressResolutionResult } from '$lib/core/shadow-atlas/client';

/** A clean, confident base result with a resolved district. Override per case. */
function baseResult(
	overrides: Partial<AddressResolutionResult> = {},
): AddressResolutionResult {
	return {
		geocode: {
			lat: 35.78,
			lng: -78.64,
			matched_address: 'Raleigh, NC',
			confidence: 0.9,
			country: 'US',
		},
		district: {
			id: 'NC-02',
			name: "North Carolina's 2nd Congressional District",
			jurisdiction: 'congressional',
			district_type: 'congressional',
		},
		officials: null,
		cell_id: '8744d8a8effffff',
		provenance: { source: 'nominatim', tigerVintage: 'TIGER2022' },
		confidence: 1.0,
		boundaryAsOf: '2022-09-01T00:00:00.000Z',
		officialsAsOf: null,
		warning: null,
		...overrides,
	};
}

const TIGER2022 = {
	tigerVintage: 'TIGER2022',
	generated: '2022-09-01T00:00:00.000Z',
	officialsGenerated: null,
};
const TIGER2024 = {
	tigerVintage: 'TIGER2024',
	generated: '2024-09-01T00:00:00.000Z',
	officialsGenerated: null,
};

describe('applyStalenessGuard', () => {
	it('seed sanity: REDRAW_SIGNAL holds a real non-CA redraw and NEVER FIPS 06 post-2024', () => {
		// NC (37) is seeded — used by the stale-state case below.
		expect(REDRAW_SIGNAL['37']).toBeDefined();
		// California (FIPS 06) must NOT be seeded with a post-2024 date — that would break
		// resolve-address.test.ts case (a)'s CA/TIGER2024 confidence-1.0 assertion.
		const ca = REDRAW_SIGNAL['06'];
		if (ca) {
			expect(Number(ca.slice(0, 4))).toBeLessThanOrEqual(2024);
		} else {
			expect(ca).toBeUndefined();
		}
	});

	// Each widened entry asserts against the REAL imported REDRAW_SIGNAL export (not
	// mocked): the FIPS key is a valid 2-digit code present in STATE_TO_FIPS and the
	// value is an ISO YYYY-MM-DD effective date. Dates verified to a real source in the
	// inline comment above each entry in redraw-guard.ts.
	const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
	it('seed sanity: Alabama (01) — court-imposed special-master plan (Allen v. Milligan)', () => {
		expect(REDRAW_SIGNAL['01']).toBeDefined();
		expect(STATE_TO_FIPS['AL']).toBe('01');
		expect(REDRAW_SIGNAL['01']).toMatch(ISO_DATE);
	});
	it('seed sanity: Georgia (13) — SB 3-EX enacted congressional plan', () => {
		expect(REDRAW_SIGNAL['13']).toBeDefined();
		expect(STATE_TO_FIPS['GA']).toBe('13');
		expect(REDRAW_SIGNAL['13']).toMatch(ISO_DATE);
	});
	it('seed sanity: New York (36) — Ch. 99 of 2024 enacted congressional plan', () => {
		expect(REDRAW_SIGNAL['36']).toBeDefined();
		expect(STATE_TO_FIPS['NY']).toBe('36');
		expect(REDRAW_SIGNAL['36']).toMatch(ISO_DATE);
	});
	it('seed sanity: Texas (48) — HB 4 (2025) enacted congressional plan', () => {
		expect(REDRAW_SIGNAL['48']).toBeDefined();
		expect(STATE_TO_FIPS['TX']).toBe('48');
		expect(REDRAW_SIGNAL['48']).toMatch(ISO_DATE);
	});

	it('(a) stale state — redraw effective-year > vintage year → confidence 0 + redraw warning + boundaryAsOf kept', () => {
		// NC redrawn (2023) after a TIGER2022 atlas vintage → superseded geometry.
		const out = applyStalenessGuard(baseResult(), TIGER2022, { state: 'NC' });

		expect(out.confidence).toBe(0);
		expect(out.warning).toBe('district boundaries redrawn after atlas vintage');
		// boundaryAsOf keeps the REAL vintage date — never fabricated, never nulled here.
		expect(out.boundaryAsOf).toBe('2022-09-01T00:00:00.000Z');
		// The district object is still returned; confidence 0 is the "not confident" signal.
		expect(out.district?.id).toBe('NC-02');
	});

	it('(a2) state derived from substrate-form district id resolves to the same redraw verdict', () => {
		// "cd-3702" → FIPS 37 (NC), no address.state fallback needed.
		const out = applyStalenessGuard(
			baseResult({ district: { id: 'cd-3702', name: 'NC 2', jurisdiction: 'congressional', district_type: 'congressional' } }),
			TIGER2022,
		);
		expect(out.confidence).toBe(0);
		expect(out.warning).toBe('district boundaries redrawn after atlas vintage');
	});

	it('(b) fresh state — not in REDRAW_SIGNAL, recent vintage → confidence unchanged + warning null', () => {
		// California (FIPS 06) is not a seeded redraw; TIGER2024 is recent → fully trusted.
		const fresh = baseResult({
			district: { id: 'CA-01', name: 'CA 1', jurisdiction: 'congressional', district_type: 'congressional' },
			confidence: 1.0,
			boundaryAsOf: '2024-09-01T00:00:00.000Z',
			provenance: { source: 'nominatim', tigerVintage: 'TIGER2024' },
		});
		const out = applyStalenessGuard(fresh, TIGER2024, { state: 'CA' });

		expect(out.confidence).toBe(1.0);
		expect(out.warning).toBeNull();
		expect(out.boundaryAsOf).toBe('2024-09-01T00:00:00.000Z');
	});

	it('(b2) redraw effective-year NOT after vintage (same/earlier year) → no downgrade', () => {
		// NC redrawn 2023, atlas vintage TIGER2024 (later) → atlas already reflects the map.
		const out = applyStalenessGuard(baseResult(), TIGER2024, { state: 'NC' });
		expect(out.confidence).toBe(1.0);
		expect(out.warning).toBeNull();
	});

	it('(b3) same-year redraw — effective date after the vintage data as-of (Jan 1) → confidence 0 + redraw warning', () => {
		// NC redrawn 2023-10-25; TIGER2023 data is as-of 2023-01-01, so the controlling
		// map post-dates the geometry even though the YEARS match (the old year-grain
		// compare under-warned exactly here).
		const out = applyStalenessGuard(
			baseResult(),
			{ tigerVintage: 'TIGER2023', generated: '2023-09-01T00:00:00.000Z', officialsGenerated: null },
			{ state: 'NC' },
		);
		expect(out.confidence).toBe(0);
		expect(out.warning).toBe('district boundaries redrawn after atlas vintage');
	});

	it('(b4) TIGER2024 sweep over the REAL REDRAW_SIGNAL export — dates after 2024-01-01 fire, earlier ones do not', () => {
		// Iterates the imported source export (never a local fixture map). Under
		// TIGER2024 the data as-of is 2024-01-01: LA (22), NY (36), TX (48) took effect
		// after it → superseded; AL (01), GA (13), NC (37) took effect during 2023 →
		// the vintage already reflects them.
		const FIRES_UNDER_TIGER2024 = new Set(['22', '36', '48']);
		const seeded = Object.keys(REDRAW_SIGNAL).sort();
		expect(seeded).toEqual(['01', '13', '22', '36', '37', '48']);

		for (const fips of seeded) {
			const out = applyStalenessGuard(
				baseResult({
					district: {
						id: `cd-${fips}01`,
						name: `district cd-${fips}01`,
						jurisdiction: 'congressional',
						district_type: 'congressional',
					},
				}),
				TIGER2024,
			);
			if (FIRES_UNDER_TIGER2024.has(fips)) {
				expect(out.confidence, `FIPS ${fips} (${REDRAW_SIGNAL[fips]}) must fire under TIGER2024`).toBe(0);
				expect(out.warning, `FIPS ${fips}`).toBe('district boundaries redrawn after atlas vintage');
			} else {
				expect(out.confidence, `FIPS ${fips} (${REDRAW_SIGNAL[fips]}) must NOT fire under TIGER2024`).toBe(1.0);
				expect(out.warning, `FIPS ${fips}`).toBeNull();
			}
		}
	});

	it('(c) district miss — district null, confidence 0 in → loud "district lookup miss" warning', () => {
		const miss = baseResult({ district: null, confidence: 0, officials: null });
		const out = applyStalenessGuard(miss, TIGER2024, { state: 'NC' });

		expect(out.district).toBeNull();
		expect(out.confidence).toBe(0); // honest 0 kept, never flipped
		expect(out.warning).toBe('district lookup miss');
	});

	it('(d) unknown vintage (resolved manifest, tigerVintage null) → confidence min(in,0.4) + warning + boundaryAsOf null', () => {
		const out = applyStalenessGuard(
			baseResult({ confidence: 1.0 }),
			{ tigerVintage: null, generated: '2022-09-01T00:00:00.000Z', officialsGenerated: null },
			{ state: 'NC' },
		);

		expect(out.confidence).toBe(0.4);
		expect(out.warning).toBe('boundary vintage unknown');
		expect(out.boundaryAsOf).toBeNull(); // never fabricated
	});

	it('(d2) unknown vintage clamps DOWN only — a sub-0.4 input confidence is not raised', () => {
		const out = applyStalenessGuard(
			baseResult({ confidence: 0.2 }),
			{ tigerVintage: 'unknown', generated: null, officialsGenerated: null },
			{ state: 'NC' },
		);
		expect(out.confidence).toBe(0.2);
		expect(out.warning).toBe('boundary vintage unknown');
	});

	it('(e) null vintage (manifest FETCH failed) → confidence preserved (transient fault is not a downgrade) + warning', () => {
		// A transient manifest fetch failure must NOT penalize a clean district hit; it only
		// adds the warning. (boundaryAsOf was already nulled by the resolver in this case.)
		const out = applyStalenessGuard(
			baseResult({ confidence: 1.0, boundaryAsOf: null }),
			null,
			{ state: 'NC' },
		);
		expect(out.confidence).toBe(1.0);
		expect(out.warning).toBe('boundary vintage unknown');
	});

	it('is total — never throws and returns the result on a malformed district id', () => {
		const out = applyStalenessGuard(
			baseResult({ district: { id: '???', name: 'x', jurisdiction: 'x', district_type: 'x' } }),
			TIGER2022,
		);
		// Unparseable id + no address fallback → no FIPS → no redraw verdict → pass-through.
		expect(out.confidence).toBe(1.0);
		expect(out.warning).toBeNull();
	});
});
