import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_FRESH_MS,
	PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS,
	PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
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
	const put = vi.fn(async (key: string, value: string, _options?: { expirationTtl?: number }) => {
		entries.set(key, value);
	});
	const list = vi.fn(async ({ prefix = '' }: { prefix?: string } = {}) => ({
		keys: [...entries.keys()]
			.filter((key) => key.startsWith(prefix))
			.sort()
			.map((name) => ({ name })),
		list_complete: true,
		cacheStatus: null
	}));
	return {
		entries,
		get,
		put,
		list,
		delete: vi.fn(async (key: string) => {
			entries.delete(key);
		})
	} as unknown as KVNamespace & {
		entries: Map<string, string>;
		get: ReturnType<typeof vi.fn>;
		put: ReturnType<typeof vi.fn>;
		list: ReturnType<typeof vi.fn>;
	};
}

function platformWithKv(kv: KVNamespace, convexUrl?: string, pending?: Promise<unknown>[]) {
	return {
		env: {
			PUBLIC_DISCOVERY_KV: kv,
			...(convexUrl ? { PUBLIC_CONVEX_URL: convexUrl } : {})
		},
		...(pending
			? {
					context: {
						waitUntil: (promise: Promise<unknown>) => pending.push(promise)
					}
				}
			: {})
	} as App.Platform;
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

		// The first rollout miss checks the immutable revision key, then the
		// pre-revision shared key. The cold location needs only the exact key.
		expect(kv.get).toHaveBeenCalledTimes(3);
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

	it('ignores request path and query while physically busting edge payloads by generation', async () => {
		const edge = installEdgeCache();
		const loader = vi.fn().mockResolvedValueOnce(['generation-a']).mockResolvedValueOnce(['generation-b']);

		await getCachedPublicData(
			'templates:exclude-cwc=0',
			{ url: new URL('https://commons.example/browse?random=1'), revision: '1:100' },
			loader
		);
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicData(
				'templates:exclude-cwc=0',
				{ url: new URL('https://commons.example/api/templates?random=2'), revision: '1:100' },
				loader
			)
		).resolves.toEqual(['generation-a']);

		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicData(
				'templates:exclude-cwc=0',
				{ url: new URL('https://commons.example/'), revision: '1:200' },
				loader
			)
		).resolves.toEqual(['generation-b']);

		const matchedUrls = edge.match.mock.calls
			.map(([request]) => (request as Request).url)
			.filter((url) => url.includes('/revision='));
		expect(matchedUrls[0]).toBe(matchedUrls[1]);
		expect(matchedUrls[2]).not.toBe(matchedUrls[1]);
		expect(matchedUrls[2]).toContain('revision=1%3A200');
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('shares KV across preview hosts for one backend and isolates different backends', async () => {
		const kv = installKv();
		const production = platformWithKv(kv, 'https://alpha.convex.cloud');
		const otherBackend = platformWithKv(kv, 'https://beta.convex.cloud');
		const loader = vi.fn().mockResolvedValueOnce(['alpha']).mockResolvedValueOnce(['beta']);

		await getCachedPublicData(
			'templates',
			{ url: new URL('https://first-preview.pages.dev/'), platform: production, revision: 7 },
			loader
		);
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicData(
				'templates',
				{ url: new URL('https://second-preview.pages.dev/'), platform: production, revision: 7 },
				loader
			)
		).resolves.toEqual(['alpha']);

		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicData(
				'templates',
				{ url: new URL('https://first-preview.pages.dev/'), platform: otherBackend, revision: 7 },
				loader
			)
		).resolves.toEqual(['beta']);

		const revisionKeys = kv.get.mock.calls
			.map(([key]) => key as string)
			.filter((key) => key.includes(':revision='));
		expect(revisionKeys[0]).toBe(revisionKeys[1]);
		expect(revisionKeys[2]).not.toBe(revisionKeys[1]);
	});

	it('expires KV envelopes beyond the seven-day LKG window', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv, 'https://alpha.convex.cloud');

		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: 1 }, async () => [
			'known-good'
		]);

		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(kv.put.mock.calls[0][2]).toEqual({
			expirationTtl: PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS
		});
		expect(PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS).toBeGreaterThan(7 * 24 * 60 * 60);
	});

	it('retries an unchanged KV renewal after a failed put', async () => {
		const kv = installKv();
		kv.put
			.mockRejectedValueOnce(new Error('KV quota exceeded'))
			.mockImplementationOnce(async (key: string, value: string) => {
				kv.entries.set(key, value);
			});
		const platform = platformWithKv(kv);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const manifest = { list: { ready: true, revision: 3 } };

		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => manifest
		);
		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => manifest
		);

		expect(kv.put).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV write failed:',
			'KV quota exceeded'
		);
	});

	it('does not spend a KV read when a fresh revision exists in the local edge cache', async () => {
		installEdgeCache();
		const kv = installKv();
		const platform = platformWithKv(kv);

		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: 4 }, async () => [
			'edge-hot'
		]);
		const kvReadsAfterFill = kv.get.mock.calls.length;
		clearPublicDiscoveryCache();

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 4 }, async () => {
				throw new Error('fresh edge should satisfy this request');
			})
		).resolves.toEqual(['edge-hot']);
		expect(kv.get).toHaveBeenCalledTimes(kvReadsAfterFill);
	});

	it('renews a matching payload before its seven-day LKG window can expire', async () => {
		installEdgeCache();
		const kv = installKv();
		const pending: Promise<unknown>[] = [];
		const platform = platformWithKv(kv, undefined, pending);
		const loader = vi.fn().mockResolvedValue(['rolling-good']);

		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: 8 }, loader);
		await Promise.all(pending.splice(0));
		expect(kv.put).toHaveBeenCalledTimes(1);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 8 }, loader)
		).resolves.toEqual(['rolling-good']);
		await vi.waitFor(() => expect(kv.put).toHaveBeenCalledTimes(2));
		await Promise.all(pending.splice(0));

		const renewed = JSON.parse([...kv.entries.values()][0]) as { cachedAt: number };
		expect(renewed.cachedAt).toBe(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
	});

	it('serves a prior-revision KV LKG on a cold revision transition failure', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: '1:100' }, async () => [
			'prior'
		]);

		clearPublicDiscoveryCache();
		installEdgeCache();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const failingLoader = vi.fn(async () => {
			throw new Error('new snapshot unavailable');
		});
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: '2:200' }, failingLoader)
		).resolves.toEqual(['prior']);
		const kvReadsAfterFailure = kv.get.mock.calls.length;
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: '2:200' }, failingLoader)
		).resolves.toEqual(['prior']);
		expect(kv.get).toHaveBeenCalledTimes(kvReadsAfterFailure);
		expect(failingLoader).toHaveBeenCalledTimes(1);
	});

	it('follows the local LKG pointer when KV is unavailable during a cold transition', async () => {
		installEdgeCache();
		await getCachedPublicData('templates', { url: TEST_URL, revision: '1:100' }, async () => [
			'local-prior'
		]);
		clearPublicDiscoveryCache();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: '2:200' }, async () => {
				throw new Error('Convex and KV unavailable');
			})
		).resolves.toEqual(['local-prior']);
	});

	it('does not let a failed generation backoff suppress a later generation', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await getCachedPublicData('templates', { url: TEST_URL, revision: '1:100' }, async () => [
			'revision-1'
		]);
		const revision2 = vi.fn().mockRejectedValue(new Error('revision 2 unavailable'));
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: '2:200' }, revision2)
		).resolves.toEqual(['revision-1']);

		const revision3 = vi.fn().mockResolvedValue(['revision-3']);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, revision: '3:300' }, revision3)
		).resolves.toEqual(['revision-3']);
		expect(revision2).toHaveBeenCalledTimes(1);
		expect(revision3).toHaveBeenCalledTimes(1);
	});

	it('does not let a late stale generation overwrite a newer stable KV envelope', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const newerLoad = deferred<string[]>();
		const staleLoad = deferred<string[]>();
		const newerLoader = vi.fn(() => newerLoad.promise);
		const staleLoader = vi.fn(() => staleLoad.promise);
		const newer = getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:200' },
			newerLoader
		);
		await vi.waitFor(() => expect(newerLoader).toHaveBeenCalledTimes(1));
		const stale = getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			staleLoader
		);
		await vi.waitFor(() => expect(staleLoader).toHaveBeenCalledTimes(1));

		newerLoad.resolve(['newer']);
		await expect(newer).resolves.toEqual(['newer']);
		staleLoad.resolve(['stale']);
		await expect(stale).resolves.toEqual(['stale']);

		expect(kv.put).toHaveBeenCalledTimes(1);
		const stored = JSON.parse([...kv.entries.values()][0]) as { revision: string; value: string[] };
		expect(stored).toMatchObject({ revision: '1:200', value: ['newer'] });
	});

	it('orders generations by logical revision before the publication timestamp', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const revisionNineLoad = deferred<string[]>();
		const revisionTenLoad = deferred<string[]>();
		const revisionNine = getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '9:900' },
			() => revisionNineLoad.promise
		);
		await vi.waitFor(() => expect(kv.list).toHaveBeenCalled());
		const revisionTen = getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '10:100' },
			() => revisionTenLoad.promise
		);

		revisionTenLoad.resolve(['revision-ten']);
		await expect(revisionTen).resolves.toEqual(['revision-ten']);
		revisionNineLoad.resolve(['revision-nine']);
		await expect(revisionNine).resolves.toEqual(['revision-nine']);

		expect(kv.put).toHaveBeenCalledTimes(1);
		const stored = JSON.parse([...kv.entries.values()][0]) as { revision: string; value: string[] };
		expect(stored).toMatchObject({ revision: '10:100', value: ['revision-ten'] });
	});

	it('keeps the global LKG monotonic when an older request finishes in another isolate', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const oldLoad = deferred<string[]>();
		const firstIsolate = await import('$lib/server/public-discovery-cache');
		const oldRequest = firstIsolate.getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '9:900' },
			() => oldLoad.promise
		);
		await vi.waitFor(() => expect(kv.list).toHaveBeenCalledTimes(1));

		vi.resetModules();
		const secondIsolate = await import('$lib/server/public-discovery-cache');
		const newLoad = deferred<string[]>();
		const newRequest = secondIsolate.getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '10:100' },
			() => newLoad.promise
		);
		newLoad.resolve(['newer']);
		await expect(newRequest).resolves.toEqual(['newer']);
		oldLoad.resolve(['older']);
		await expect(oldRequest).resolves.toEqual(['older']);

		const stored = [...kv.entries.entries()].map(([key, value]) => ({
			key,
			envelope: JSON.parse(value) as { revision: string; value: string[] }
		}));
		expect(stored).toHaveLength(2);
		expect(stored.map(({ key }) => key)).toEqual(
			expect.arrayContaining([
				expect.stringContaining('revision=9%3A900'),
				expect.stringContaining('revision=10%3A100')
			])
		);

		vi.resetModules();
		const thirdIsolate = await import('$lib/server/public-discovery-cache');
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(
			thirdIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '11:50' },
				async () => {
					throw new Error('origin unavailable');
				}
			)
		).resolves.toEqual(['newer']);
	});

	it('can force-refresh a fresh control-plane entry after a publish race', async () => {
		await getCachedPublicData('manifest', { url: TEST_URL }, async () => ({ revision: 1 }));
		const refresh = vi.fn().mockResolvedValue({ revision: 2 });

		await expect(
			getCachedPublicData('manifest', { url: TEST_URL, forceRefresh: true }, refresh)
		).resolves.toEqual({ revision: 2 });
		expect(refresh).toHaveBeenCalledTimes(1);
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
