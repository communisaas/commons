/**
 * One home for the public-aggregate suppression floors and the template
 * aggregate shape.
 *
 * The floors (5 for counters, 3 for unique districts) and the aggregate shape
 * (rolling arrival window, district-count cap, trust-tier bucket count, day
 * bucket width) used to be re-typed as bare literals in three public-payload
 * mappers and two writers of the same template fields. Two numbers that must
 * be equal, declared in two places, with silent arrival-history zeroing as the
 * failure mode. These assertions pin the single home, prove both runtimes
 * reach it, drive the live projection across the boundary, and read the edited
 * sources back to prove no private copy survived.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	DAILY_ARRIVAL_BUCKET_MS,
	PUBLIC_COUNTER_K_FLOOR,
	PUBLIC_DISTRICT_K_FLOOR,
	TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS,
	TEMPLATE_DISTRICT_COUNT_CAP,
	TRUST_TIER_BUCKET_COUNT,
	emptyDailyArrivalWindow,
	emptyTrustTierBuckets,
	isDailyArrivalWindowShape,
	isTrustTierBucketShape,
	kFloorCounter,
	kFloorDistrictCount,
	partitionDistrictCountsByFloor,
	zeroBelowCounterFloor
} from '../../../convex/lib/publicAggregatePrivacy';
import * as aliasedPrivacy from '$convex/lib/publicAggregatePrivacy';
import { buildPublicTemplateDetailProjection } from '../../../convex/lib/publicTemplateDiscoverySource';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const sharedModule = source('convex/lib/publicAggregatePrivacy.ts');
const templates = source('convex/templates.ts');
const discoverySource = source('convex/lib/publicTemplateDiscoverySource.ts');
const submissions = source('convex/submissions.ts');
const publicTemplateQueries = source('src/lib/server/public-template-queries.ts');

function occurrences(haystack: string, pattern: RegExp): number {
	return haystack.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
}

type DetailTemplateOverrides = {
	verifiedSends: number;
	uniqueDistricts: number;
};

function detailProjectionFor(overrides: DetailTemplateOverrides) {
	const template = {
		_id: 'templates:shared-privacy-fixture',
		_creationTime: 0,
		slug: 'shared-privacy-fixture',
		title: 'Fixture',
		description: 'Fixture description',
		domain: 'housing',
		type: 'advocacy',
		deliveryMethod: 'email',
		messageBody: 'Body',
		preview: 'Preview',
		sources: [],
		researchLog: [],
		topics: [],
		status: 'published',
		isPublic: true,
		verifiedSends: overrides.verifiedSends,
		uniqueDistricts: overrides.uniqueDistricts
	} as unknown as Parameters<typeof buildPublicTemplateDetailProjection>[0];

	return buildPublicTemplateDetailProjection(template, { emails: [] });
}

describe('shared public-aggregate privacy module', () => {
	it('serves the Convex relative path and the SvelteKit $convex alias from one home', () => {
		expect(aliasedPrivacy.PUBLIC_COUNTER_K_FLOOR).toBe(PUBLIC_COUNTER_K_FLOOR);
		expect(aliasedPrivacy.PUBLIC_DISTRICT_K_FLOOR).toBe(PUBLIC_DISTRICT_K_FLOOR);
		expect(aliasedPrivacy.TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS).toBe(
			TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS
		);
		expect(aliasedPrivacy.TEMPLATE_DISTRICT_COUNT_CAP).toBe(TEMPLATE_DISTRICT_COUNT_CAP);
		expect(aliasedPrivacy.TRUST_TIER_BUCKET_COUNT).toBe(TRUST_TIER_BUCKET_COUNT);
		expect(aliasedPrivacy.DAILY_ARRIVAL_BUCKET_MS).toBe(DAILY_ARRIVAL_BUCKET_MS);
		expect(aliasedPrivacy.kFloorCounter).toBe(kFloorCounter);
	});

	it('pins the six shared values', () => {
		expect(PUBLIC_COUNTER_K_FLOOR).toBe(5);
		expect(PUBLIC_DISTRICT_K_FLOOR).toBe(3);
		expect(TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS).toBe(30);
		expect(TEMPLATE_DISTRICT_COUNT_CAP).toBe(500);
		expect(TRUST_TIER_BUCKET_COUNT).toBe(6);
		expect(DAILY_ARRIVAL_BUCKET_MS).toBe(86_400_000);
	});

	it('stays a pure leaf importable from both runtimes', () => {
		expect(sharedModule).not.toMatch(/_generated/);
		expect(sharedModule).not.toMatch(/\$lib/);
		expect(sharedModule).not.toMatch(/from '[^']*src\//);
	});
});

describe('suppression helpers', () => {
	it('nulls a counter below the floor and publishes it at the floor', () => {
		expect(kFloorCounter(PUBLIC_COUNTER_K_FLOOR - 1)).toBeNull();
		expect(kFloorCounter(PUBLIC_COUNTER_K_FLOOR)).toBe(PUBLIC_COUNTER_K_FLOOR);
		expect(kFloorCounter(PUBLIC_COUNTER_K_FLOOR + 1)).toBe(PUBLIC_COUNTER_K_FLOOR + 1);
	});

	it('keeps the existing zero-suppresses-to-null behavior', () => {
		expect(kFloorCounter(0)).toBeNull();
		expect(kFloorDistrictCount(0)).toBeNull();
	});

	it('applies the lower district floor to the unique-district counter', () => {
		expect(kFloorDistrictCount(PUBLIC_DISTRICT_K_FLOOR - 1)).toBeNull();
		expect(kFloorDistrictCount(PUBLIC_DISTRICT_K_FLOOR)).toBe(PUBLIC_DISTRICT_K_FLOOR);
	});

	it('zeroes array buckets below the counter floor instead of nulling them', () => {
		expect(zeroBelowCounterFloor(PUBLIC_COUNTER_K_FLOOR - 1)).toBe(0);
		expect(zeroBelowCounterFloor(PUBLIC_COUNTER_K_FLOOR)).toBe(PUBLIC_COUNTER_K_FLOOR);
		expect(zeroBelowCounterFloor(0)).toBe(0);
	});

	it('partitions district rows on one predicate', () => {
		const rows = [
			{ code: 'AA-01', count: PUBLIC_COUNTER_K_FLOOR },
			{ code: 'BB-02', count: PUBLIC_COUNTER_K_FLOOR - 1 },
			{ code: 'CC-03', count: PUBLIC_COUNTER_K_FLOOR + 1 },
			{ code: 'DD-04', count: 0 }
		];
		const { visible, suppressed } = partitionDistrictCountsByFloor(rows);
		expect(visible.map((row) => row.code)).toEqual(['AA-01', 'CC-03']);
		expect(suppressed.map((row) => row.code)).toEqual(['BB-02', 'DD-04']);
		expect(visible.length + suppressed.length).toBe(rows.length);
	});
});

describe('aggregate shape helpers', () => {
	it('returns a fresh, all-zero arrival window on every call', () => {
		const first = emptyDailyArrivalWindow();
		const second = emptyDailyArrivalWindow();
		expect(first).toHaveLength(TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS);
		expect(first.every((count) => count === 0)).toBe(true);
		expect(first).not.toBe(second);
		first[0] = 1;
		expect(second[0]).toBe(0);
	});

	it('returns a fresh, all-zero tier-bucket array on every call', () => {
		const first = emptyTrustTierBuckets();
		const second = emptyTrustTierBuckets();
		expect(first).toHaveLength(TRUST_TIER_BUCKET_COUNT);
		expect(first.every((count) => count === 0)).toBe(true);
		expect(first).not.toBe(second);
		first[0] = 1;
		expect(second[0]).toBe(0);
	});

	it('recognizes only the agreed shapes', () => {
		expect(isDailyArrivalWindowShape(emptyDailyArrivalWindow())).toBe(true);
		expect(
			isDailyArrivalWindowShape(new Array<number>(TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS - 1).fill(0))
		).toBe(false);
		expect(isTrustTierBucketShape(emptyTrustTierBuckets())).toBe(true);
		expect(isTrustTierBucketShape(new Array<number>(TRUST_TIER_BUCKET_COUNT - 1).fill(0))).toBe(
			false
		);
	});
});

describe('live public detail projection boundary', () => {
	it('suppresses send counters below the shared counter floor', () => {
		const detail = detailProjectionFor({
			verifiedSends: PUBLIC_COUNTER_K_FLOOR - 1,
			uniqueDistricts: PUBLIC_DISTRICT_K_FLOOR - 1
		});
		expect(detail.verified_sends).toBeNull();
		expect(detail.send_count).toBeNull();
		expect(detail.send_count).toBe(detail.verified_sends);
	});

	it('publishes exact send counters at the shared counter floor', () => {
		const detail = detailProjectionFor({
			verifiedSends: PUBLIC_COUNTER_K_FLOOR,
			uniqueDistricts: PUBLIC_DISTRICT_K_FLOOR
		});
		expect(detail.verified_sends).toBe(PUBLIC_COUNTER_K_FLOOR);
		expect(detail.send_count).toBe(PUBLIC_COUNTER_K_FLOOR);
		expect(detail.send_count).toBe(detail.verified_sends);
	});

	it('suppresses unique districts below the shared district floor', () => {
		expect(
			detailProjectionFor({
				verifiedSends: PUBLIC_COUNTER_K_FLOOR,
				uniqueDistricts: PUBLIC_DISTRICT_K_FLOOR - 1
			}).unique_districts
		).toBeNull();
	});

	it('publishes the exact unique-district count at the shared district floor', () => {
		expect(
			detailProjectionFor({
				verifiedSends: PUBLIC_COUNTER_K_FLOOR,
				uniqueDistricts: PUBLIC_DISTRICT_K_FLOOR
			}).unique_districts
		).toBe(PUBLIC_DISTRICT_K_FLOOR);
	});
});

describe('no private copy survives at the edited call sites', () => {
	it('routes every edited file through the shared module', () => {
		expect(templates).toContain("from './lib/publicAggregatePrivacy'");
		expect(discoverySource).toContain("from './publicAggregatePrivacy'");
		expect(submissions).toContain("from './lib/publicAggregatePrivacy'");
	});

	it('leaves no inline floor literal in the public mappers', () => {
		for (const [name, text] of [
			['convex/templates.ts', templates],
			['convex/lib/publicTemplateDiscoverySource.ts', discoverySource]
		] as const) {
			for (const pattern of [/< 5 \? null/, /< 3 \? null/, /< 5 \? 0/, /count >= 5/, /count < 5/]) {
				expect(`${name}:${occurrences(text, pattern)}`).toBe(`${name}:0`);
			}
		}
	});

	it('leaves no private day-bucket or window declaration behind', () => {
		expect(templates).not.toContain('const DAILY_ARRIVALS_DAY_MS');
		for (const pattern of [/DAILY_WINDOW/, /DISTRICT_CAP/, /const dayMs/]) {
			expect(`submissions:${occurrences(submissions, pattern)}`).toBe('submissions:0');
		}
	});

	it('has the SvelteKit projector schema naming the shared shape symbols', () => {
		expect(publicTemplateQueries).toContain("from '$convex/lib/publicAggregatePrivacy'");
		for (const pattern of [
			/daily_arrivals:\s*publicArray\(\s*PUBLIC_NUMBER,\s*TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS\s*\)/,
			/district_counts:\s*publicArray\(\s*publicObject\(\{[^}]*\}\),\s*MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS\s*\)/,
			/tier_counts:\s*publicArray\(\s*PUBLIC_NUMBER,\s*TRUST_TIER_BUCKET_COUNT\s*\)/
		]) {
			expect(`${pattern.source}:${pattern.test(publicTemplateQueries)}`).toBe(
				`${pattern.source}:true`
			);
		}
		// The public-payload row cap (6), never the storage cap (500).
		expect(publicTemplateQueries).not.toContain('TEMPLATE_DISTRICT_COUNT_CAP');
	});

	it('has both template-aggregate writers reading the same shape symbols', () => {
		for (const symbol of [
			'TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS',
			'TEMPLATE_DISTRICT_COUNT_CAP',
			'TRUST_TIER_BUCKET_COUNT',
			'DAILY_ARRIVAL_BUCKET_MS'
		]) {
			// One import plus at least one use in each of the two writers.
			expect(occurrences(submissions, new RegExp(symbol))).toBeGreaterThanOrEqual(3);
		}
		expect(submissions).toContain('if (!isDailyArrivalWindowShape(dailyArrivals)) {');
		expect(submissions).toContain('!isDailyArrivalWindowShape(args.dailyArrivals)');
		expect(submissions).toContain('!isTrustTierBucketShape(args.tierCounts)');
	});
});
