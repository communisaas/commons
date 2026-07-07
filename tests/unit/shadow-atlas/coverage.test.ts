/**
 * Coverage-disclosure table integrity.
 *
 * The served-slot allowlist is the honesty contract of the multi-type resolve
 * surface: a boundary type reaches the wire ONLY if this table discloses it.
 * These tests pin the table to the populated-slot set of the live atlas build
 * and to the shared US_SLOT_NAMES registry so disclosure, emission, and naming
 * can never drift apart silently.
 *
 * Pure unit test: coverage.ts and district-format.ts have no runtime deps —
 * no network, no mocks.
 */

import { describe, it, expect } from 'vitest';
import {
	SERVED_SLOT_SET,
	DISTRICT_COVERAGE,
	type DistrictTypeCoverage
} from '$lib/core/shadow-atlas/coverage';
import { US_SLOT_NAMES } from '$lib/core/shadow-atlas/district-format';

describe('shadow-atlas coverage disclosure', () => {
	it('SERVED_SLOT_SET is exactly the populated-slot set of the live atlas build', () => {
		// Ops rule: changing this set must accompany an atlas publish verification —
		// diff the live district-index top-level slot keys against the new set and
		// reconcile per-type counts BEFORE flipping the version pin.
		expect([...SERVED_SLOT_SET].sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 5, 7, 8, 9, 20, 22]);
	});

	it('boundaryTypes keys are exactly the US_SLOT_NAMES jurisdiction slugs of the served slots, in slot order', () => {
		const expected = [...SERVED_SLOT_SET]
			.sort((a, b) => a - b)
			.map((slot) => US_SLOT_NAMES[slot].jurisdiction);
		// Object.keys preserves the table's insertion order — canonical slot order.
		expect(Object.keys(DISTRICT_COVERAGE.boundaryTypes)).toEqual(expected);
	});

	it("every disclosed type carries an honest class ∈ {'national','partial'}", () => {
		for (const [districtType, entry] of Object.entries(DISTRICT_COVERAGE.boundaryTypes)) {
			expect(['national', 'partial'], `bad class for ${districtType}`).toContain(
				(entry as DistrictTypeCoverage).coverage
			);
		}
	});

	it("officialsTypes is exactly ['congressional'] — the machine-readable officials constraint", () => {
		expect(DISTRICT_COVERAGE.officialsTypes).toEqual(['congressional']);
	});

	it('the disclosure object is deeply frozen — one shared instance serves every request', () => {
		expect(Object.isFrozen(DISTRICT_COVERAGE)).toBe(true);
		expect(Object.isFrozen(DISTRICT_COVERAGE.boundaryTypes)).toBe(true);
		expect(Object.isFrozen(DISTRICT_COVERAGE.officialsTypes)).toBe(true);
		for (const entry of Object.values(DISTRICT_COVERAGE.boundaryTypes)) {
			expect(Object.isFrozen(entry)).toBe(true);
		}
	});

	it('US_SLOT_NAMES holds exactly 24 entries with unique kebab-case jurisdiction slugs', () => {
		expect(US_SLOT_NAMES).toHaveLength(24);
		const slugs = US_SLOT_NAMES.map((s) => s.jurisdiction);
		expect(new Set(slugs).size).toBe(24);
		for (const slug of slugs) {
			expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
		}
	});
});
