import { describe, it, expect } from 'vitest';
import { aggregateArrivals, bandMomentum } from '$lib/core/topic/band-signals';
import type { Template } from '$lib/types/template';

/**
 * Minimal Template factory — only the dimensional fields the band signals read
 * (`daily_arrivals`, `send_count`, `coordinationScale`). The rest of the shape
 * is irrelevant to the aggregation behaviour under test.
 */
function makeTemplate(over: Partial<Template>): Template {
	return {
		id: 't',
		slug: 't',
		title: 'Template',
		description: '',
		domain: 'Housing',
		type: 'advocacy',
		deliveryMethod: 'email',
		message_body: '',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		preview: '',
		createdAt: new Date('2020-01-01T00:00:00Z'),
		updatedAt: new Date('2020-01-01T00:00:00Z'),
		...over
	} as Template;
}

describe('aggregateArrivals', () => {
	it('returns null when the band has no templates', () => {
		expect(aggregateArrivals([])).toBeNull();
	});

	it('returns null when every template lacks an arrivals array', () => {
		const band = [makeTemplate({}), makeTemplate({ daily_arrivals: undefined })];
		expect(aggregateArrivals(band)).toBeNull();
	});

	it('returns null when arrays are present but all buckets are zero (K-floored)', () => {
		// The server zeroes sub-floor days; a band of only floored days must read
		// as no Pulse, never a flat dead line.
		const band = [
			makeTemplate({ daily_arrivals: [0, 0, 0] }),
			makeTemplate({ daily_arrivals: [0, 0] })
		];
		expect(aggregateArrivals(band)).toBeNull();
	});

	it('sums element-wise across templates that carry arrivals', () => {
		const band = [
			makeTemplate({ daily_arrivals: [1, 2, 3] }),
			makeTemplate({ daily_arrivals: [10, 20, 30] })
		];
		expect(aggregateArrivals(band)).toEqual([11, 22, 33]);
	});

	it('treats a missing array as zeros (partial input sums present arrays)', () => {
		const band = [
			makeTemplate({ daily_arrivals: [5, 0, 7] }),
			makeTemplate({}),
			makeTemplate({ daily_arrivals: [0, 4, 0] })
		];
		expect(aggregateArrivals(band)).toEqual([5, 4, 7]);
	});

	it('extends to the longest present array, shorter arrays contributing nothing to trailing buckets', () => {
		const band = [
			makeTemplate({ daily_arrivals: [1, 1] }),
			makeTemplate({ daily_arrivals: [2, 2, 2, 2] })
		];
		expect(aggregateArrivals(band)).toEqual([3, 3, 2, 2]);
	});

	it('returns at least one positive bucket whenever it is non-null', () => {
		const result = aggregateArrivals([makeTemplate({ daily_arrivals: [0, 0, 9] })]);
		expect(result).not.toBeNull();
		expect(result!.some((v) => v > 0)).toBe(true);
	});

	it('ignores non-finite and negative noise in arrival buckets', () => {
		const band = [
			makeTemplate({ daily_arrivals: [Number.NaN, -3, 4] }),
			makeTemplate({ daily_arrivals: [2, 0, 0] })
		];
		expect(aggregateArrivals(band)).toEqual([2, 0, 4]);
	});
});

describe('bandMomentum', () => {
	it('is zero for an empty band', () => {
		expect(bandMomentum([])).toBe(0);
	});

	it('is zero when no template has verified reach', () => {
		const band = [makeTemplate({ send_count: 0 }), makeTemplate({})];
		expect(bandMomentum(band)).toBe(0);
	});

	it('treats a K-floored null send_count as zero reach', () => {
		// listPublic floors send_count to null below the privacy floor.
		const band = [makeTemplate({ send_count: null as unknown as number })];
		expect(bandMomentum(band)).toBe(0);
	});

	it('is monotonic in send_count — adding sends never lowers momentum', () => {
		const low = bandMomentum([makeTemplate({ send_count: 10, coordinationScale: 0.3 })]);
		const high = bandMomentum([makeTemplate({ send_count: 100, coordinationScale: 0.3 })]);
		expect(high).toBeGreaterThan(low);
	});

	it('orders a higher-reach band above a lower-reach band regardless of scale', () => {
		const fewSends = bandMomentum([makeTemplate({ send_count: 5, coordinationScale: 0.99 })]);
		const manySends = bandMomentum([makeTemplate({ send_count: 50, coordinationScale: 0.01 })]);
		expect(manySends).toBeGreaterThan(fewSends);
	});

	it('sums verified reach across the band', () => {
		const single = bandMomentum([makeTemplate({ send_count: 40 })]);
		const split = bandMomentum([
			makeTemplate({ send_count: 20 }),
			makeTemplate({ send_count: 20 })
		]);
		// Same total reach lands in the same whole-send magnitude.
		expect(Math.floor(single)).toBe(Math.floor(split));
	});
});
