import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedFlightTimeoutError, SharedFlights } from '$lib/server/shared-flight';

const MAX_DURATION_MS = 1_000;

function flights<M = undefined>(maxEntries = 8) {
	return new SharedFlights<string, M>({
		label: 'test',
		maxDurationMs: MAX_DURATION_MS,
		maxEntries
	});
}

function never<T>(): Promise<T> {
	return new Promise<T>(() => undefined);
}

/**
 * Start a flight whose owner request has been cancelled: its work never
 * settles and every timer it armed is dropped, as the Workers runtime does.
 */
function startStrandedOwner(coordinator: SharedFlights<string>, key: string): Promise<string> {
	const realSetTimeout = globalThis.setTimeout;
	const dropped = vi
		.spyOn(globalThis, 'setTimeout')
		.mockImplementation((() => 0) as unknown as typeof setTimeout);
	try {
		const owner = coordinator.start(key, never);
		owner.catch(() => undefined);
		return owner;
	} finally {
		dropped.mockRestore();
		expect(globalThis.setTimeout).toBe(realSetTimeout);
	}
}

describe('SharedFlights', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_800_000_000_000);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('coalesces concurrent callers onto one unit of work', async () => {
		const coordinator = flights();
		let release!: (value: string) => void;
		const work = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

		const first = coordinator.run('k', work);
		const second = coordinator.run('k', work);
		await Promise.resolve();
		release('value');

		await expect(first).resolves.toBe('value');
		await expect(second).resolves.toBe('value');
		expect(work).toHaveBeenCalledTimes(1);
		expect(coordinator.size).toBe(0);
	});

	it('settles a live owner by its deadline and forgets the flight', async () => {
		const coordinator = flights();
		const owner = coordinator.start('k', never);
		const outcome = expect(owner).rejects.toBeInstanceOf(SharedFlightTimeoutError);

		await vi.advanceTimersByTimeAsync(MAX_DURATION_MS);

		await outcome;
		expect(coordinator.has('k')).toBe(false);
	});

	it('bounds a joiner by its own timer when the owner was cancelled', async () => {
		const coordinator = flights();
		startStrandedOwner(coordinator, 'k');

		const joiner = coordinator.run('k', async () => 'unexpected');
		const outcome = expect(joiner).rejects.toThrow('SHARED_FLIGHT_TIMEOUT:test');
		await vi.advanceTimersByTimeAsync(MAX_DURATION_MS + 100);

		await outcome;
		expect(coordinator.has('k')).toBe(false);
	});

	it('replaces a flight found past its deadline instead of joining it', async () => {
		const coordinator = flights();
		startStrandedOwner(coordinator, 'k');
		vi.setSystemTime(Date.now() + MAX_DURATION_MS + 100);

		const work = vi.fn(async () => 'fresh');
		await expect(coordinator.run('k', work)).resolves.toBe('fresh');
		expect(work).toHaveBeenCalledTimes(1);
	});

	it('keeps the owner’s work alive through waitUntil', async () => {
		const coordinator = flights();
		const waitUntil = vi.fn();

		await coordinator.start('k', async () => 'value', { waitUntil });

		expect(waitUntil).toHaveBeenCalledTimes(1);
		await expect(waitUntil.mock.calls[0][0]).resolves.toBe('value');
	});

	it('does not surface a failed task through the waitUntil registration', async () => {
		const coordinator = flights();
		const waitUntil = vi.fn();

		await expect(
			coordinator.start('k', async () => Promise.reject(new Error('origin')), { waitUntil })
		).rejects.toThrow('origin');
		await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
	});

	it('joins only a flight whose meta the caller accepts', async () => {
		const coordinator = flights<number>();
		let release!: (value: string) => void;
		const owner = coordinator.start('k', () => new Promise((resolve) => (release = resolve)), {
			meta: 1
		});

		expect(coordinator.join('k', (epoch) => epoch === 2)).toBeUndefined();
		const joined = coordinator.join('k', (epoch) => epoch === 1);
		expect(joined).toBeDefined();
		await Promise.resolve();
		release('value');
		await expect(owner).resolves.toBe('value');
		await expect(joined).resolves.toBe('value');
	});

	it('detaches a flight from later callers while bounding the detached wait', async () => {
		const coordinator = flights();
		startStrandedOwner(coordinator, 'k');

		const detached = coordinator.detach('k');
		expect(detached).toBeDefined();
		expect(coordinator.has('k')).toBe(false);
		const outcome = expect(detached).rejects.toBeInstanceOf(SharedFlightTimeoutError);
		await vi.advanceTimersByTimeAsync(MAX_DURATION_MS + 100);
		await outcome;
	});

	it('forgets the oldest key past its entry bound without cancelling it', async () => {
		const coordinator = flights(1);
		let release!: (value: string) => void;
		const oldest = coordinator.start('a', () => new Promise((resolve) => (release = resolve)));
		coordinator.start('b', never).catch(() => undefined);

		expect(coordinator.has('a')).toBe(false);
		expect(coordinator.has('b')).toBe(true);
		await Promise.resolve();
		release('value');
		await expect(oldest).resolves.toBe('value');
	});

	it('does not let a superseded flight evict its replacement', async () => {
		const coordinator = flights();
		let releaseOld!: (value: string) => void;
		const old = coordinator.start('k', () => new Promise((resolve) => (releaseOld = resolve)));
		const replacement = coordinator.start('k', never);
		replacement.catch(() => undefined);

		await Promise.resolve();
		releaseOld('old');
		await old;
		expect(coordinator.has('k')).toBe(true);
	});

	it('extends a flight’s deadline by exactly the flight it waits on', async () => {
		const coordinator = flights();
		let releasePrior!: (value: string) => void;
		const prior = coordinator.start('k', () => new Promise((resolve) => (releasePrior = resolve)));
		await vi.advanceTimersByTimeAsync(400);
		const priorRemainingMs = coordinator.remainingMs('k');
		expect(priorRemainingMs).toBe(MAX_DURATION_MS - 400);

		const joinedPrior = coordinator.join('k')!;
		let releaseOwn!: (value: string) => void;
		const successor = coordinator.start(
			'k',
			async () => {
				await joinedPrior;
				return new Promise<string>((resolve) => (releaseOwn = resolve));
			},
			{ precededByMs: priorRemainingMs }
		);
		expect(coordinator.remainingMs('k')).toBe(MAX_DURATION_MS + priorRemainingMs!);

		await vi.advanceTimersByTimeAsync(priorRemainingMs! - 1);
		releasePrior('prior');
		await expect(prior).resolves.toBe('prior');
		await vi.advanceTimersByTimeAsync(MAX_DURATION_MS - 1);
		releaseOwn('own');
		await expect(successor).resolves.toBe('own');
	});

	it('rejects options that would leave a flight unbounded', () => {
		expect(
			() => new SharedFlights({ label: 'bad', maxDurationMs: 0, maxEntries: 1 })
		).toThrow('SHARED_FLIGHT_OPTIONS_INVALID:bad');
		expect(
			() => new SharedFlights({ label: 'bad', maxDurationMs: 1, maxEntries: 0 })
		).toThrow('SHARED_FLIGHT_OPTIONS_INVALID:bad');
		expect(() => flights().start('k', async () => 'v', { precededByMs: -1 })).toThrow(
			'SHARED_FLIGHT_OPTIONS_INVALID:test'
		);
	});
});
