/**
 * Sub-K suppression floors on every public/cross-org aggregate surface.
 *
 * The privacy policy floors counts at 5 (districts at 3): a count of 1-4
 * identifies a small group, so it suppresses to null before leaving the
 * Convex layer. Three surfaces carry the floors — the public receipt
 * verifier, public campaign stats, and coalition aggregates — and none of
 * the floor closures is exported, so these pins are the only regression
 * guard. Source-level pins on short stable expressions, not prose.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const verify = source('convex/verify.ts');
const campaigns = source('convex/campaigns.ts');
const networks = source('convex/networks.ts');

describe('public receipt verifier (convex/verify.ts)', () => {
	it('defines the 5/3 floors and applies them to receipt counts', () => {
		expect(verify).toContain('kFloor5 = (n: number): number | null => (n < 5 ? null : n)');
		expect(verify).toContain('kFloor3 = (n: number): number | null => (n < 3 ? null : n)');
		expect(verify).toContain('verifiedCount: kFloor5(');
		expect(verify).toContain('districtCount: kFloor3(');
	});
});

describe('public campaign stats (convex/campaigns.ts)', () => {
	it('defines the 5/3 floors and applies them to action and district counts', () => {
		expect(campaigns).toContain('kFloor5 = (n: number): number | null => (n < 5 ? null : n)');
		expect(campaigns).toContain('kFloor3 = (n: number): number | null => (n < 3 ? null : n)');
		expect(campaigns).toContain('verifiedActions: kFloor5(');
		expect(campaigns).toContain('uniqueDistricts: kFloor3(');
	});
});

describe('coalition aggregates (convex/networks.ts)', () => {
	it('floors suppress 1-4 (districts 1-2) while honest zero passes through', () => {
		expect(networks).toContain('return n > 0 && n < 5 ? null : n;');
		expect(networks).toContain('return n > 0 && n < 3 ? null : n;');
	});

	it('applies the floors to every person-derived stat', () => {
		for (const field of [
			'totalSupporters: coalitionFloor5(',
			'uniqueSupporters: coalitionFloor5(',
			'verifiedSupporters: coalitionFloor5(',
			'totalCampaignActions: coalitionFloor5(',
			'verifiedCampaignActions: coalitionFloor5(',
			'districtCount: coalitionFloor3(',
			'verifiedActionEvidence: coalitionFloor5(',
			'districtSignalCount: coalitionFloor3('
		]) {
			expect(networks).toContain(field);
		}
	});

	it('suppresses sub-5 entries from the state distribution', () => {
		expect(networks).toContain('if (count >= 5) flooredStateDistribution[state] = count;');
	});
});
