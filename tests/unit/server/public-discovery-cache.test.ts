import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_FRESH_MS,
	clearPublicDiscoveryCache,
	getCachedPublicData
} from '$lib/server/public-discovery-cache';

const NOW = 1_800_000_000_000;
const TEST_URL = new URL('https://commons.example/browse');

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function platformCapturingWaits(pending: Promise<unknown>[]): App.Platform {
	return {
		context: {
			waitUntil: (promise: Promise<unknown>) => {
				pending.push(promise);
			}
		}
	} as App.Platform;
}

function installEdgeCache() {
	const entries = new Map<string, Response>();
	const match = vi.fn(async (request: Request) => entries.get(request.url)?.clone());
	const put = vi.fn(async (request: Request, response: Response) => {
		entries.set(request.url, response.clone());
	});
	vi.stubGlobal('caches', { default: { match, put } });
	return { entries, match, put };
}

function installKv() {
	const entries = new Map<string, string>();
	const get = vi.fn(async (key: string) => {
		const value = entries.get(key);
		return value === undefined ? null : JSON.parse(value);
	});
	const put = vi.fn(async (key: string, value: string) => {
		entries.set(key, value);
	});
	return {
		entries,
		get,
		put,
		delete: vi.fn(async (key: string) => {
			entries.delete(key);
		})
	} as unknown as KVNamespace & {
		entries: Map<string, string>;
		get: ReturnType<typeof vi.fn>;
		put: ReturnType<typeof vi.fn>;
	};
}

describe('public discovery cache', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		// Exercise the deterministic in-isolate path unless a test explicitly
		// installs a Cloudflare Cache API fake.
		vi.stubGlobal('caches', undefined);
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('loads once on a cold miss and serves the fresh value on a hit', async () => {
		const loader = vi.fn().mockResolvedValue({ templates: ['alpha'] });

		await expect(getCachedPublicData('templates', { url: TEST_URL }, loader)).resolves.toEqual({
			templates: ['alpha']
		});
		await expect(
			getCachedPublicData('templates', { url: TEST_URL }, () => Promise.reject(new Error('unused')))
		).resolves.toEqual({ templates: ['alpha'] });

		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('coalesces concurrent cold misses for the same logical key', async () => {
		const load = deferred<{ edges: string[] }>();
		const loader = vi.fn(() => load.promise);

		const first = getCachedPublicData('relations', { url: TEST_URL }, loader);
		const second = getCachedPublicData('relations', { url: TEST_URL }, loader);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

		load.resolve({ edges: ['a:b'] });
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ edges: ['a:b'] },
			{ edges: ['a:b'] }
		]);
	});

	it('keeps logical keys independent', async () => {
		const templateLoader = vi.fn().mockResolvedValue(['template']);
		const relationLoader = vi.fn().mockResolvedValue(['relation']);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL }, templateLoader)
		).resolves.toEqual(['template']);
		await expect(
			getCachedPublicData('relations', { url: TEST_URL }, relationLoader)
		).resolves.toEqual(['relation']);
		await getCachedPublicData('templates', { url: TEST_URL }, templateLoader);
		await getCachedPublicData('relations', { url: TEST_URL }, relationLoader);

		expect(templateLoader).toHaveBeenCalledTimes(1);
		expect(relationLoader).toHaveBeenCalledTimes(1);
	});

	it('reuses a matching materialization revision and refreshes immediately when it changes', async () => {
		const loader = vi.fn().mockResolvedValueOnce(['revision-1']).mockResolvedValueOnce(['revision-2']);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: 1 }, loader)
		).resolves.toEqual(['revision-1']);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: 1 }, loader)
		).resolves.toEqual(['revision-1']);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: 2 }, loader)
		).resolves.toEqual(['revision-2']);

		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('keeps the prior revision when a generation transition cannot load', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await getCachedPublicData('templates', { url: TEST_URL, revision: 1 }, async () => ['stable']);
		const loader = vi.fn().mockRejectedValue(new Error('new snapshot unavailable'));

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: 2 }, loader)
		).resolves.toEqual(['stable']);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: 2 }, loader)
		).resolves.toEqual(['stable']);

		expect(loader).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] revision refresh failed:',
			'new snapshot unavailable'
		);
	});

	it('serves stale data immediately, coalesces refreshes, then publishes the refresh', async () => {
		const pending: Promise<unknown>[] = [];
		const platform = platformCapturingWaits(pending);
		await getCachedPublicData('templates', { url: TEST_URL, platform }, async () => ['old']);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_FRESH_MS + 1);
		const refresh = deferred<string[]>();
		const loader = vi.fn(() => refresh.promise);

		const first = await getCachedPublicData('templates', { url: TEST_URL, platform }, loader);
		const second = await getCachedPublicData('templates', { url: TEST_URL, platform }, loader);
		expect(first).toEqual(['old']);
		expect(second).toEqual(['old']);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(pending).toHaveLength(2);

		refresh.resolve(['new']);
		await pending[1];
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform }, loader)
		).resolves.toEqual(['new']);
	});

	it('can block on a stale control-plane value so the first request sees a new revision', async () => {
		await getCachedPublicData('manifest', { url: TEST_URL, freshForMs: 60_000 }, async () => ({
			revision: 1
		}));
		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		const loader = vi.fn().mockResolvedValue({ revision: 2 });

		await expect(
			getCachedPublicData(
				'manifest',
				{ url: TEST_URL, freshForMs: 60_000, refreshMode: 'blocking' },
				loader
			)
		).resolves.toEqual({ revision: 2 });

		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('keeps the last-known-good value when a stale background refresh fails', async () => {
		const pending: Promise<unknown>[] = [];
		const platform = platformCapturingWaits(pending);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await getCachedPublicData('templates', { url: TEST_URL, platform }, async () => ['known-good']);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_FRESH_MS + 1);
		const failure = new Error('Convex unavailable');
		const loader = vi.fn().mockRejectedValue(failure);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform }, loader)
		).resolves.toEqual(['known-good']);
		expect(pending).toHaveLength(1);
		await pending[0];
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform }, loader)
		).resolves.toEqual(['known-good']);

		// The failed refresh installs a short retry backoff, so repeated anonymous
		// hits keep serving stale without hammering a disabled Convex deployment.
		expect(loader).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] background refresh failed:',
			'Convex unavailable'
		);
	});

	it('persists a miss to the edge cache and can rehydrate from it', async () => {
		const edge = installEdgeCache();
		const loader = vi.fn().mockResolvedValue({ conceptMap: { library: 'libraries' } });

		await getCachedPublicData('concepts', { url: TEST_URL }, loader);
		expect(edge.put).toHaveBeenCalledTimes(1);

		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicData('concepts', { url: TEST_URL }, () =>
				Promise.reject(new Error('edge entry should satisfy this request'))
			)
		).resolves.toEqual({ conceptMap: { library: 'libraries' } });

		expect(edge.match).toHaveBeenCalledTimes(2);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('uses Workers KV as a global shield after a local edge cache miss', async () => {
		const kv = installKv();
		const platform = { env: { PUBLIC_DISCOVERY_KV: kv } } as App.Platform;
		const loader = vi.fn().mockResolvedValue({ templates: ['global'] });

		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: 7 }, loader);
		expect(kv.put).toHaveBeenCalledTimes(1);

		clearPublicDiscoveryCache();
		installEdgeCache();
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 7 }, () =>
				Promise.reject(new Error('KV should satisfy this cold location'))
			)
		).resolves.toEqual({ templates: ['global'] });

		expect(kv.get).toHaveBeenCalledTimes(2);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('does not rewrite KV for every unchanged manifest revalidation', async () => {
		const kv = installKv();
		const platform = { env: { PUBLIC_DISCOVERY_KV: kv } } as App.Platform;
		const manifest = { list: { ready: true, revision: 3 } };

		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => manifest
		);
		expect(kv.put).toHaveBeenCalledTimes(1);

		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => manifest
		);
		expect(kv.put).toHaveBeenCalledTimes(1);

		// Renew the global LKG once per day so a healthy, unchanged manifest does
		// not age out of the seven-day outage window.
		vi.mocked(Date.now).mockReturnValue(NOW + 24 * 60 * 60 * 1000 + 1);
		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => manifest
		);
		expect(kv.put).toHaveBeenCalledTimes(2);
	});

	it('degrades to the loader when edge reads and writes fail', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const match = vi.fn().mockRejectedValue(new Error('edge read unavailable'));
		const put = vi.fn().mockRejectedValue(new Error('edge write unavailable'));
		vi.stubGlobal('caches', { default: { match, put } });

		await expect(
			getCachedPublicData('templates', { url: TEST_URL }, async () => ['live'])
		).resolves.toEqual(['live']);

		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] edge read failed:',
			'edge read unavailable'
		);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] edge write failed:',
			'edge write unavailable'
		);
	});
});
