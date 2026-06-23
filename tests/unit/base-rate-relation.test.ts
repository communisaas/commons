import { describe, it, expect, beforeAll } from 'vitest';
import {
	computeBaseRateRelation,
	type BaseRateRelation
} from '$lib/server/analytics/base-rate-relation';

// A >= 32-byte secret so the HMAC path is exercised (the helper fail-softs to
// 'unknown' when the secret is missing/short).
beforeAll(() => {
	process.env.ADDRESS_RESOLUTION_TOKEN_SECRET =
		'0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('computeBaseRateRelation — coarse, non-identifying district relation', () => {
	it('returns "same" for identical district codes (HMAC equality)', async () => {
		const rel = await computeBaseRateRelation('CA-12', 'CA-12');
		expect(rel).toBe<BaseRateRelation>('same');
	});

	it('returns "diff" for different district codes', async () => {
		const rel = await computeBaseRateRelation('CA-12', 'NY-08');
		expect(rel).toBe<BaseRateRelation>('diff');
	});

	it('returns "unknown" when the viewer district is missing', async () => {
		expect(await computeBaseRateRelation(null, 'CA-12')).toBe('unknown');
		expect(await computeBaseRateRelation(undefined, 'CA-12')).toBe('unknown');
	});

	it('returns "unknown" when the author district is missing', async () => {
		expect(await computeBaseRateRelation('CA-12', null)).toBe('unknown');
		expect(await computeBaseRateRelation('CA-12', undefined)).toBe('unknown');
	});

	it('is fail-soft: never throws and always resolves to an allowed relation', async () => {
		const allowed = new Set<BaseRateRelation>(['same', 'diff', 'unknown']);
		// Empty strings are falsy → 'unknown'; odd inputs must never throw.
		for (const [v, a] of [
			['', ''],
			['', 'CA-12'],
			['CA-12', ''],
			['CA-12', 'CA-12']
		] as Array<[string, string]>) {
			const rel = await computeBaseRateRelation(v, a);
			expect(allowed.has(rel)).toBe(true);
		}
	});

	it('never emits a district identifier — only the 3-valued relation', async () => {
		const allowed = new Set<BaseRateRelation>(['same', 'diff', 'unknown']);
		for (const [v, a] of [
			['CA-12', 'CA-12'],
			['CA-12', 'NY-08'],
			[null, 'CA-12'],
			['CA-12', null]
		] as Array<[string | null, string | null]>) {
			const rel = await computeBaseRateRelation(v, a);
			expect(allowed.has(rel)).toBe(true);
			// The result must not contain any of the district codes verbatim.
			expect(rel).not.toContain('CA');
			expect(rel).not.toContain('NY');
			expect(rel).not.toMatch(/\d/);
		}
	});
});
