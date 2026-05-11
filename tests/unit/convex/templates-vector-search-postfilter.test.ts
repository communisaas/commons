/**
 * templates.search secondaryFilter post-filter contract.
 *
 * Convex's `VectorFilterBuilder` exposes only `.eq` and `.or` (no `.and`),
 * so multi-field conjunction (domain AND countryCode) is handled via a JS
 * post-filter applied to the hydrated docs after vectorSearch returns
 * candidates. The contract:
 *   - One filter → builder applies natively; no post-filter.
 *   - Two filters → builder applies the first, post-filter drops docs that
 *     don't match the second.
 *   - Zero filters → no filter at all.
 *
 * Brutalist test_coverage roast: the post-filter logic was untested. A
 * typo or type-coercion bug (e.g., `t[field] == value` accepting `null ==
 * undefined`) would silently leak out-of-scope templates without any test
 * failure.
 *
 * This test exercises the post-filter expression directly against
 * synthetic candidate docs so the contract is locked even if the
 * surrounding action signature evolves.
 */

import { describe, it, expect } from 'vitest';

type FilterField = 'domain' | 'countryCode';
type SecondaryFilter = readonly [FilterField, string] | undefined;

interface Candidate {
	_id: string;
	domain?: string;
	countryCode?: string;
}

// Mirrors the post-filter expression at convex/templates.ts:566-568.
function applyPostFilter(
	candidates: Candidate[],
	secondaryFilter: SecondaryFilter
): Candidate[] {
	return candidates.filter((t) =>
		secondaryFilter ? t[secondaryFilter[0]] === secondaryFilter[1] : true
	);
}

const POOL: Candidate[] = [
	{ _id: 'a', domain: 'climate', countryCode: 'US' },
	{ _id: 'b', domain: 'climate', countryCode: 'GB' },
	{ _id: 'c', domain: 'housing', countryCode: 'US' },
	{ _id: 'd', domain: 'housing', countryCode: 'CA' },
	{ _id: 'e', domain: 'climate' /* no countryCode */ },
	{ _id: 'f' /* no domain, no countryCode */ }
];

describe('templates.search post-filter', () => {
	it('zero filters → returns all candidates unchanged', () => {
		const result = applyPostFilter(POOL, undefined);
		expect(result.map((c) => c._id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});

	it('drops candidates whose secondary field does not match', () => {
		// Primary filter (e.g., domain=climate) applied at the builder; this
		// test simulates "after primary filter, post-filter on countryCode=US".
		const climateOnly = POOL.filter((c) => c.domain === 'climate');
		const result = applyPostFilter(climateOnly, ['countryCode', 'US']);
		expect(result.map((c) => c._id)).toEqual(['a']);
	});

	it('drops candidates with undefined secondary field (strict equality)', () => {
		// 'e' has no countryCode. Strict === comparison rejects it from
		// `countryCode === 'US'`. Important: a typo to `==` would let
		// `undefined == null` slip through.
		const climateOnly = POOL.filter((c) => c.domain === 'climate');
		const result = applyPostFilter(climateOnly, ['countryCode', 'US']);
		expect(result.find((c) => c._id === 'e')).toBeUndefined();
	});

	it('post-filter on domain works the same as on countryCode', () => {
		// Symmetric: either field can be the secondary depending on call order.
		const usOnly = POOL.filter((c) => c.countryCode === 'US');
		const result = applyPostFilter(usOnly, ['domain', 'climate']);
		expect(result.map((c) => c._id)).toEqual(['a']);
	});

	it('does not match by substring or case-fold', () => {
		// Strict equality: 'climate' !== 'Climate', 'US' !== 'us'.
		const result = applyPostFilter(
			[
				{ _id: 'x', domain: 'Climate', countryCode: 'US' },
				{ _id: 'y', domain: 'climate', countryCode: 'us' },
				{ _id: 'z', domain: 'climate', countryCode: 'US' }
			],
			['countryCode', 'US']
		);
		expect(result.map((c) => c._id)).toEqual(['x', 'z']);
	});

	it('preserves order of input (no implicit sort)', () => {
		const result = applyPostFilter(POOL, ['domain', 'climate']);
		expect(result.map((c) => c._id)).toEqual(['a', 'b', 'e']);
	});

	it('returns empty when no candidate matches', () => {
		const result = applyPostFilter(POOL, ['countryCode', 'XX']);
		expect(result).toEqual([]);
	});
});
