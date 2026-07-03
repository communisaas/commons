import { describe, expect, it } from 'vitest';
import type { Resolution } from '$lib/core/shadow-atlas/provenance';

describe('Resolution provenance type', () => {
	it('keeps boundaryAsOf and officialsAsOf as two separate clocks', () => {
		const r: Resolution = {
			district: {
				id: 'CA-12',
				name: "California's 12th Congressional District",
				jurisdiction: 'congressional',
				districtType: 'congressional'
			},
			provenance: {
				source: 'tiger',
				tigerVintage: 'TIGER2024',
				authorityLevel: 0,
				dataVersion: 'v1'
			},
			confidence: 0.99,
			boundaryAsOf: '2024-01-01',
			officialsAsOf: '2024-06-15'
		};

		expect('boundaryAsOf' in r && 'officialsAsOf' in r).toBe(true);
		expect('asOf' in r).toBe(false);
		expect(r.boundaryAsOf).not.toBe(r.officialsAsOf);
	});

	it('allows both clocks to be null (honestly-unknown / degraded)', () => {
		const r: Resolution = {
			district: {
				id: 'CA-12',
				name: "California's 12th Congressional District",
				jurisdiction: 'congressional',
				districtType: 'congressional'
			},
			provenance: {
				source: 'tiger',
				tigerVintage: 'unknown'
			},
			confidence: 0,
			boundaryAsOf: null,
			officialsAsOf: null
		};

		expect('boundaryAsOf' in r && 'officialsAsOf' in r).toBe(true);
		expect('asOf' in r).toBe(false);
		expect(r.boundaryAsOf).toBeNull();
		expect(r.officialsAsOf).toBeNull();
	});
});
