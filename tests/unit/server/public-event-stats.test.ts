import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPublicDiscoveryCache } from '$lib/server/public-discovery-cache';
import {
	EVENT_STATS_POLL_MS,
	getCachedPublicEventStats,
	projectPublicEventStats,
	type PublicEventStats
} from '$lib/server/public-event-stats';

const NOW = 1_800_000_000_000;
const TEST_URL = new URL('https://commons.example/api/e/event-1/stats');

function stats(rsvpCount: number): PublicEventStats {
	return {
		rsvpCount,
		attendeeCount: null,
		verifiedAttendees: null,
		goingCount: rsvpCount,
		maybeCount: null,
		kAnonymityThreshold: 5
	};
}

describe('public event stats edge cache', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		vi.stubGlobal('caches', undefined);
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('shares one origin read for the full browser polling interval', async () => {
		const loader = vi.fn().mockResolvedValue(stats(5));
		await expect(getCachedPublicEventStats('event-1', { url: TEST_URL }, loader)).resolves.toEqual(
			stats(5)
		);
		vi.mocked(Date.now).mockReturnValue(NOW + EVENT_STATS_POLL_MS - 1);
		await expect(getCachedPublicEventStats('event-1', { url: TEST_URL }, loader)).resolves.toEqual(
			stats(5)
		);
		expect(loader).toHaveBeenCalledOnce();
	});

	it('refreshes synchronously after one poll interval so content changes propagate', async () => {
		const loader = vi.fn().mockResolvedValueOnce(stats(5)).mockResolvedValueOnce(stats(6));
		await getCachedPublicEventStats('event-1', { url: TEST_URL }, loader);
		vi.mocked(Date.now).mockReturnValue(NOW + EVENT_STATS_POLL_MS + 1);
		await expect(getCachedPublicEventStats('event-1', { url: TEST_URL }, loader)).resolves.toEqual(
			stats(6)
		);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent cold polls', async () => {
		let resolve!: (value: PublicEventStats) => void;
		const pending = new Promise<PublicEventStats>((done) => {
			resolve = done;
		});
		const loader = vi.fn(() => pending);
		const first = getCachedPublicEventStats('event-1', { url: TEST_URL }, loader);
		const second = getCachedPublicEventStats('event-1', { url: TEST_URL }, loader);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		resolve(stats(5));
		await expect(Promise.all([first, second])).resolves.toEqual([stats(5), stats(5)]);
	});

	it('re-applies K=5 privacy when reading an edge envelope', () => {
		expect(
			projectPublicEventStats({
				rsvpCount: 4,
				attendeeCount: 5,
				verifiedAttendees: -1,
				goingCount: 3,
				maybeCount: 9,
				kAnonymityThreshold: 1
			})
		).toEqual({
			rsvpCount: null,
			attendeeCount: 5,
			verifiedAttendees: null,
			goingCount: null,
			maybeCount: 9,
			kAnonymityThreshold: 5
		});
	});

	it('rejects attacker-sized cache keys before touching the loader', async () => {
		const loader = vi.fn();
		await expect(
			getCachedPublicEventStats('x'.repeat(129), { url: TEST_URL }, loader)
		).rejects.toThrow('EVENT_ID_INVALID');
		expect(loader).not.toHaveBeenCalled();
	});
});
