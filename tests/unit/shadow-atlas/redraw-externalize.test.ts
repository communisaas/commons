/**
 * redraw-signal.data — externalization tests.
 *
 * The redraw signal map now derives from STATIC_REDRAW_ROWS via buildRedrawSignal()
 * instead of an inline literal. These tests pin the externalized seed to the SAME
 * verbatim target map, assert every row carries a non-empty citation and a well-formed
 * ISO effective date, and confirm the guard's redraw verdict still fires end-to-end on
 * a Texas (FIPS 48) district resolved under a TIGER2022 vintage.
 */

import { describe, it, expect } from 'vitest';
import {
	buildRedrawSignal,
	STATIC_REDRAW_ROWS,
} from '$lib/core/shadow-atlas/redraw-signal.data';
import { applyStalenessGuard } from '$lib/core/shadow-atlas/redraw-guard';
import type { AddressResolutionResult } from '$lib/core/shadow-atlas/client';

const TARGET_MAP: Record<string, string> = {
	'37': '2023-10-25',
	'22': '2024-01-19',
	'01': '2023-10-05',
	'13': '2023-12-08',
	'36': '2024-02-28',
	'48': '2025-08-29',
};

describe('redraw-signal.data', () => {
	it('(a) buildRedrawSignal() deep-equals the verbatim 6-state target map', () => {
		expect(buildRedrawSignal()).toEqual(TARGET_MAP);
	});

	it('(b) every row carries a non-empty trimmed source and a well-formed ISO effective date', () => {
		expect(STATIC_REDRAW_ROWS).toHaveLength(6);
		for (const row of STATIC_REDRAW_ROWS) {
			expect(row.source.trim().length).toBeGreaterThan(0);
			expect(row.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it('(c) applyStalenessGuard on a TX (FIPS 48) district under TIGER2022 → confidence 0 + redraw warning', () => {
		const baseResult: AddressResolutionResult = {
			geocode: {
				lat: 29.76,
				lng: -95.37,
				matched_address: 'Houston, TX',
				confidence: 0.9,
				country: 'US',
			},
			district: {
				id: 'TX-21',
				name: "Texas's 21st Congressional District",
				jurisdiction: 'congressional',
				district_type: 'congressional',
			},
			officials: null,
			cell_id: '8748a8a8effffff',
			provenance: { source: 'nominatim', tigerVintage: 'TIGER2022' },
			confidence: 1.0,
			boundaryAsOf: '2022-09-01T00:00:00.000Z',
			officialsAsOf: null,
			warning: null,
		};

		const out = applyStalenessGuard(
			baseResult,
			{
				tigerVintage: 'TIGER2022',
				generated: '2022-09-01T00:00:00.000Z',
				officialsGenerated: null,
			},
			{ state: 'TX' },
		);

		expect(out.confidence).toBe(0);
		expect(out.warning).toBe('district boundaries redrawn after atlas vintage');
	});
});
