import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES,
	PUBLIC_DISCOVERY_FRESH_MS,
	PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS,
	PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES,
	PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
	clearPublicDiscoveryCache,
	getCachedPublicData,
	getCachedPublicDataLastKnownGood
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
	const list = vi.fn(
		async (
			{ cursor, limit = 1000, prefix = '' }: { cursor?: string; limit?: number; prefix?: string } = {}
		) => {
			const matching = [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
			const start = cursor === undefined ? 0 : Number(cursor);
			const end = Math.min(start + limit, matching.length);
			return {
				keys: matching.slice(start, end).map((name) => ({ name })),
				list_complete: end >= matching.length,
				...(end < matching.length ? { cursor: String(end) } : {}),
				cacheStatus: null
			};
		}
	);
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

	it('bounds isolate-local cache entries and evicts the oldest logical key', async () => {
		for (let index = 0; index <= PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES; index += 1) {
			await getCachedPublicData(`bounded-${index}`, { url: TEST_URL }, async () => index);
		}

		const reloadOldest = vi.fn().mockResolvedValue('reloaded');
		await expect(
			getCachedPublicData('bounded-0', { url: TEST_URL }, reloadOldest)
		).resolves.toBe('reloaded');
		expect(reloadOldest).toHaveBeenCalledOnce();
	});

	it('does not let an evicted flight erase a newer same-key flight when it settles', async () => {
		const original = deferred<number>();
		const originalLoader = vi.fn(() => original.promise);
		const originalRequest = getCachedPublicData('flight-0', { url: TEST_URL }, originalLoader);

		const fillerLoads = Array.from(
			{ length: PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES },
			() => deferred<number>()
		);
		const fillerLoader = vi.fn((index: number) => fillerLoads[index].promise);
		const fillerRequests = fillerLoads.map((_load, index) =>
			getCachedPublicData(`flight-${index + 1}`, { url: TEST_URL }, () => fillerLoader(index))
		);
		await vi.waitFor(() => {
			expect(originalLoader).toHaveBeenCalledOnce();
			expect(fillerLoader).toHaveBeenCalledTimes(PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES);
		});

		// The coordination cap has evicted the original key, so a newer flight B
		// can start for it while the original flight A is still unsettled.
		const replacement = deferred<number>();
		const replacementLoader = vi.fn(() => replacement.promise);
		const replacementRequest = getCachedPublicData(
			'flight-0',
			{ url: TEST_URL },
			replacementLoader
		);
		await vi.waitFor(() => expect(replacementLoader).toHaveBeenCalledOnce());

		original.reject(new Error('evicted flight failed'));
		await expect(originalRequest).rejects.toThrow('evicted flight failed');

		const duplicateLoader = vi.fn().mockResolvedValue(3);
		const coalescedRequest = getCachedPublicData('flight-0', { url: TEST_URL }, duplicateLoader);
		// Cold misses consult the active flight before any asynchronous shared-layer
		// read, so this assertion is synchronous and scheduler-independent.
		expect(duplicateLoader).not.toHaveBeenCalled();
		replacement.resolve(2);
		await expect(Promise.all([replacementRequest, coalescedRequest])).resolves.toEqual([2, 2]);
		expect(replacementLoader).toHaveBeenCalledOnce();
		expect(duplicateLoader).not.toHaveBeenCalled();

		for (const [index, load] of fillerLoads.entries()) load.resolve(index);
		await Promise.all(fillerRequests);
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

	it('reprojects an edge envelope before returning its serialized value', async () => {
		const edge = installEdgeCache();
		await getCachedPublicData('cards', { url: TEST_URL, revision: 1 }, async () => ({
			publicTitle: 'Safe title',
			privateRecipient: 'private@example.test'
		}));
		clearPublicDiscoveryCache();
		const loader = vi.fn().mockRejectedValue(new Error('projected edge value should satisfy'));

		await expect(
			getCachedPublicData(
				'cards',
				{
					url: TEST_URL,
					revision: 1,
					projectCachedValue: (value) => {
						if (
							!value ||
							typeof value !== 'object' ||
							typeof (value as { publicTitle?: unknown }).publicTitle !== 'string'
						) {
							throw new Error('unsafe cached card');
						}
						return { publicTitle: (value as { publicTitle: string }).publicTitle };
					}
				},
				loader
			)
		).resolves.toEqual({ publicTitle: 'Safe title' });
		expect(loader).not.toHaveBeenCalled();
		expect(edge.match).toHaveBeenCalled();
	});

	it('uses Workers KV as a global shield after a local edge cache miss', async () => {
		const kv = installKv();
		const platform = { env: { PUBLIC_DISCOVERY_KV: kv } } as App.Platform;
		const loader = vi.fn().mockResolvedValue({ templates: ['global'] });

		await getCachedPublicData('templates', { url: TEST_URL, platform, revision: 7 }, loader);
		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(kv.put.mock.calls[0][0]).toContain('public-discovery:v5:');
		expect(kv.put.mock.calls[0][0]).not.toContain('public-discovery:v4:');

		clearPublicDiscoveryCache();
		installEdgeCache();
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 7 }, () =>
				Promise.reject(new Error('KV should satisfy this cold location'))
			)
		).resolves.toEqual({ templates: ['global'] });

		// Healthy misses and cold hits both perform only the exact revision read;
		// generation enumeration is reserved for origin-failure recovery.
		expect(kv.get).toHaveBeenCalledTimes(2);
		expect(kv.list).not.toHaveBeenCalled();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('treats a malformed KV envelope value as a cache miss', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		await getCachedPublicData('cards', { url: TEST_URL, platform, revision: 2 }, async () => ({
			message_body: { privateRecipient: 'private@example.test' }
		}));
		clearPublicDiscoveryCache();
		const loader = vi.fn().mockResolvedValue({ message_body: 'Safe message' });

		await expect(
			getCachedPublicData(
				'cards',
				{
					url: TEST_URL,
					platform,
					revision: 2,
					projectCachedValue: (value) => {
						if (
							!value ||
							typeof value !== 'object' ||
							typeof (value as { message_body?: unknown }).message_body !== 'string'
						) {
							throw new Error('unsafe cached card');
						}
						return { message_body: (value as { message_body: string }).message_body };
					}
				},
				loader
			)
		).resolves.toEqual({ message_body: 'Safe message' });
		expect(loader).toHaveBeenCalledOnce();
		expect(kv.get).toHaveBeenCalledTimes(2);
	});

	it('never serves a pre-v5 unallowlisted envelope or pointer during origin failure', async () => {
		const edge = installEdgeCache();
		const kv = installKv();
		const platform = platformWithKv(kv);
		const legacyPayload = {
			recipient_config: { recipients: [{ email: 'legacy-private@example.test' }] },
			recipientEmails: ['legacy-private@example.test']
		};

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: 7 },
			async () => legacyPayload
		);

		for (const [url, response] of [...edge.entries]) {
			edge.entries.delete(url);
			edge.entries.set(url.replace('/v5/', '/v4/'), response);
		}
		for (const [key, value] of [...kv.entries]) {
			kv.entries.delete(key);
			kv.entries.set(key.replace(':v5:', ':v4:'), value);
		}
		expect([...edge.entries.keys()].some((url) => url.includes('/v4/') && url.endsWith('/lkg-pointer'))).toBe(true);
		expect([...kv.entries.keys()].some((key) => key.includes('public-discovery:v4:'))).toBe(true);

		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicDataLastKnownGood<typeof legacyPayload>('templates', {
				url: TEST_URL,
				platform
			})
		).resolves.toBeUndefined();

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 8 }, () =>
				Promise.reject(new Error('origin unavailable'))
			)
		).rejects.toThrow('origin unavailable');
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] revision refresh failed:',
			'origin unavailable'
		);
		expect(edge.match.mock.calls.every(([request]) => request.url.includes('/v5/'))).toBe(true);
		expect(kv.get.mock.calls.every(([key]) => String(key).includes(':v5:'))).toBe(true);
	});

	it('does not list older generations during a healthy cross-isolate revision transition', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		installEdgeCache();

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['revision-one']
		);
		vi.resetModules();
		const publishingIsolate = await import('$lib/server/public-discovery-cache');
		const healthyLoader = vi.fn().mockResolvedValue(['revision-two']);
		await expect(
			publishingIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				healthyLoader
			)
		).resolves.toEqual(['revision-two']);

		vi.resetModules();
		installEdgeCache();
		const coldIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			coldIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				async () => {
					throw new Error('exact KV generation should satisfy the cold isolate');
				}
			)
		).resolves.toEqual(['revision-two']);

		expect(healthyLoader).toHaveBeenCalledTimes(1);
		expect(kv.put).toHaveBeenCalledTimes(2);
		expect(kv.list).not.toHaveBeenCalled();
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

	it('writes a changed unversioned manifest through before daily renewal', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);

		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => ({ list: { ready: true, revision: 1 } })
		);
		expect(kv.put).toHaveBeenCalledTimes(1);

		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		await getCachedPublicData(
			'manifest',
			{ url: TEST_URL, platform, freshForMs: 60_000, refreshMode: 'blocking' },
			async () => ({ list: { ready: true, revision: 2 } })
		);

		expect(kv.put).toHaveBeenCalledTimes(2);
		expect(JSON.parse([...kv.entries.values()][0]).value.list.revision).toBe(2);
	});

	it('uses a versioned coordinate instead of serializing the payload to decide KV renewal', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		let serializations = 0;
		const payload = (label: string) => ({
			toJSON: () => {
				serializations += 1;
				return { templates: [label] };
			}
		});

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100', freshForMs: 60_000 },
			async () => payload('first')
		);
		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(serializations).toBe(1);

		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100', freshForMs: 60_000 },
			async () => payload('second')
		);

		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(serializations).toBe(1);
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

	it('isolates KV by request origin and configured backend', async () => {
		const kv = installKv();
		const production = platformWithKv(kv, 'https://alpha.convex.cloud');
		const otherBackend = platformWithKv(kv, 'https://beta.convex.cloud');
		const loader = vi.fn()
			.mockResolvedValueOnce(['alpha-first-origin'])
			.mockResolvedValueOnce(['alpha-second-origin'])
			.mockResolvedValueOnce(['beta']);

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
		).resolves.toEqual(['alpha-second-origin']);

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
		expect(revisionKeys[0]).not.toBe(revisionKeys[1]);
		expect(revisionKeys[2]).not.toBe(revisionKeys[1]);
		expect(loader).toHaveBeenCalledTimes(3);
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
		expect(kv.list).toHaveBeenCalledTimes(1);
		const kvReadsAfterFailure = kv.get.mock.calls.length;
		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: '2:200' }, failingLoader)
		).resolves.toEqual(['prior']);
		expect(kv.get).toHaveBeenCalledTimes(kvReadsAfterFailure);
		expect(failingLoader).toHaveBeenCalledTimes(1);
	});

	it('shares revision-scoped transition backoff without suppressing a newer revision', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const edge = installEdgeCache();
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['stable']
		);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		vi.resetModules();
		const firstIsolate = await import('$lib/server/public-discovery-cache');
		const firstRevisionTwoLoad = vi.fn().mockRejectedValue(new Error('revision two unavailable'));
		await expect(
			firstIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				firstRevisionTwoLoad
			)
		).resolves.toEqual(['stable']);
		expect(firstRevisionTwoLoad).toHaveBeenCalledTimes(1);
		expect(kv.list).toHaveBeenCalledTimes(1);
		expect(kv.put).toHaveBeenCalledTimes(1);
		expect(
			[...edge.entries.keys()].some((url) => url.includes('/revision-retry=2%3A200'))
		).toBe(true);
		expect(
			[...edge.entries.keys()].some((url) => url.includes('/revision=2%3A200'))
		).toBe(false);

		// A fresh isolate in the same Cache API location reuses the revision-two
		// marker: no origin retry, generation list, or KV write.
		vi.resetModules();
		const secondIsolate = await import('$lib/server/public-discovery-cache');
		const suppressedRevisionTwoLoad = vi.fn().mockRejectedValue(new Error('must not run'));
		await expect(
			secondIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				suppressedRevisionTwoLoad
			)
		).resolves.toEqual(['stable']);
		expect(suppressedRevisionTwoLoad).not.toHaveBeenCalled();
		expect(kv.list).toHaveBeenCalledTimes(1);

		// The physical retry key is revision-qualified, so revision three still
		// receives its own origin attempt and recovery check.
		vi.resetModules();
		const newerIsolate = await import('$lib/server/public-discovery-cache');
		const revisionThreeLoad = vi.fn().mockRejectedValue(new Error('revision three unavailable'));
		await expect(
			newerIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '3:300' },
				revisionThreeLoad
			)
		).resolves.toEqual(['stable']);
		expect(revisionThreeLoad).toHaveBeenCalledTimes(1);
		expect(kv.list).toHaveBeenCalledTimes(2);

		// Origin retries every 15 minutes, but the completed global-generation
		// check is reused for a day instead of spending another list operation.
		vi.mocked(Date.now).mockReturnValue(NOW + 15 * 60 * 1000 + 1);
		vi.resetModules();
		const retryingIsolate = await import('$lib/server/public-discovery-cache');
		const retriedRevisionTwoLoad = vi.fn().mockRejectedValue(new Error('still unavailable'));
		await expect(
			retryingIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				retriedRevisionTwoLoad
			)
		).resolves.toEqual(['stable']);
		expect(retriedRevisionTwoLoad).toHaveBeenCalledTimes(1);
		expect(kv.list).toHaveBeenCalledTimes(2);
		expect(kv.put).toHaveBeenCalledTimes(1);
	});

	it('shares a failed cold-revision marker even when no fallback exists', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		installEdgeCache();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const firstLoader = vi.fn().mockRejectedValue(new Error('first publication unavailable'));
		await expect(
			getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '1:cold' },
				firstLoader
			)
		).rejects.toThrow('first publication unavailable');
		expect(firstLoader).toHaveBeenCalledTimes(1);
		expect(kv.list).toHaveBeenCalledTimes(1);

		vi.resetModules();
		const nextIsolate = await import('$lib/server/public-discovery-cache');
		const suppressedLoader = vi.fn().mockRejectedValue(new Error('must not run'));
		await expect(
			nextIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '1:cold' },
				suppressedLoader
			)
		).rejects.toThrow('temporarily backed off');
		expect(suppressedLoader).not.toHaveBeenCalled();
		expect(kv.list).toHaveBeenCalledTimes(1);
		expect(kv.put).not.toHaveBeenCalled();
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
		const revisionNineLoader = vi.fn(() => revisionNineLoad.promise);
		const revisionNine = getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '9:900' },
			revisionNineLoader
		);
		await vi.waitFor(() => expect(revisionNineLoader).toHaveBeenCalledTimes(1));
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
		expect(kv.list).not.toHaveBeenCalled();
		const stored = JSON.parse([...kv.entries.values()][0]) as { revision: string; value: string[] };
		expect(stored).toMatchObject({ revision: '10:100', value: ['revision-ten'] });
	});

	it('keeps the global LKG monotonic when an older request finishes in another isolate', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const oldLoad = deferred<string[]>();
		const firstIsolate = await import('$lib/server/public-discovery-cache');
		const oldLoader = vi.fn(() => oldLoad.promise);
		const oldRequest = firstIsolate.getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '9:900' },
			oldLoader
		);
		await vi.waitFor(() => expect(oldLoader).toHaveBeenCalledTimes(1));

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
		expect(kv.list).not.toHaveBeenCalled();

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
		expect(kv.list).toHaveBeenCalledTimes(1);
	});

	it('does not let an older KV hit regress a globally checked edge LKG pointer', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);

		// Publish both immutable generations without a shared Cache API layer.
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '9:900' },
			async () => ['older']
		);
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '10:100' },
			async () => ['newer']
		);

		clearPublicDiscoveryCache();
		installEdgeCache();
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['newer']);
		expect(kv.list).toHaveBeenCalledTimes(1);

		// A stale isolate can still read its exact immutable KV generation, but that
		// hit must not replace the globally checked pointer with revision 9.
		vi.resetModules();
		const staleIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			staleIsolate.getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '9:900' },
				async () => {
					throw new Error('exact KV generation should satisfy the request');
				}
			)
		).resolves.toEqual(['older']);

		vi.resetModules();
		const recoveryIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			recoveryIsolate.getCachedPublicDataLastKnownGood<string[]>('templates', {
				url: TEST_URL,
				platform
			})
		).resolves.toEqual(['newer']);
		// Recovery remains local-first while the shared global-check lease is live.
		expect(kv.list).toHaveBeenCalledTimes(1);
	});

	it('periodically revalidates a pointer-selected LKG without listing KV on every recovery', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		installEdgeCache();

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['revision-one']
		);
		clearPublicDiscoveryCache();
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['revision-one']);
		const listCallsAfterCheck = kv.list.mock.calls.length;

		clearPublicDiscoveryCache();
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['revision-one']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsAfterCheck);

		// Once the shared lease expires, one recovery checks immutable KV again.
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
		clearPublicDiscoveryCache();
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['revision-one']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsAfterCheck + 1);
	});

	it('refuses an overflow candidate while retaining an independently local LKG', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const edge = installEdgeCache();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['revision-one']
		);
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '2000:100' },
			async () => ['local-newest']
		);

		const seedKey = [...kv.entries.keys()].find((key) => key.includes(':revision='));
		expect(seedKey).toBeDefined();
		const revisionPrefix = seedKey!.slice(0, seedKey!.indexOf(':revision=') + ':revision='.length);
		for (let revision = 2; revision <= 1001; revision += 1) {
			const generation = `${revision}:100`;
			kv.entries.set(
				`${revisionPrefix}${encodeURIComponent(generation)}`,
				JSON.stringify({
					cachedAt: NOW,
					globalCachedAt: NOW,
					revision: generation,
					value: [`revision-${revision}`]
				})
			);
		}

		clearPublicDiscoveryCache();
		const listCallsBeforeRecovery = kv.list.mock.calls.length;
		const readsBeforeRecovery = kv.get.mock.calls.length;
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['local-newest']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsBeforeRecovery + 1);
		expect(kv.get).toHaveBeenCalledTimes(readsBeforeRecovery);
		expect(kv.list.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 1000 });
		expect(kv.list.mock.calls.at(-1)?.[0]).not.toHaveProperty('cursor');
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV revision listing exceeded 1000-key recovery bound'
		);

		const pointerResponse = [...edge.entries.entries()].find(([url]) =>
			url.endsWith('/lkg-pointer')
		)?.[1];
		expect(pointerResponse).toBeDefined();
		const pointer = (await pointerResponse!.clone().json()) as Record<string, unknown>;
		expect(pointer.latestRevisionCheckedAt).toBeUndefined();
		expect(pointer.latestRevisionRetryAt).toBe(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS);

		vi.mocked(Date.now).mockReturnValue(NOW + 16 * 60 * 1000);
		vi.resetModules();
		const nextIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			nextIsolate.getCachedPublicDataLastKnownGood<string[]>('templates', {
				url: TEST_URL,
				platform
			})
		).resolves.toEqual(['local-newest']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsBeforeRecovery + 1);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
		vi.resetModules();
		const nextDayIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			nextDayIsolate.getCachedPublicDataLastKnownGood<string[]>('templates', {
				url: TEST_URL,
				platform
			})
		).resolves.toEqual(['local-newest']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsBeforeRecovery + 2);
	});

	it('fails closed and spends one daily list when overflow has no local LKG', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['revision-one']
		);
		const seedKey = [...kv.entries.keys()].find((key) => key.includes(':revision='));
		expect(seedKey).toBeDefined();
		const revisionPrefix = seedKey!.slice(0, seedKey!.indexOf(':revision=') + ':revision='.length);
		for (let revision = 2; revision <= 1001; revision += 1) {
			const generation = `${revision}:100`;
			kv.entries.set(
				`${revisionPrefix}${encodeURIComponent(generation)}`,
				JSON.stringify({
					cachedAt: NOW,
					globalCachedAt: NOW,
					revision: generation,
					value: [`revision-${revision}`]
				})
			);
		}
		clearPublicDiscoveryCache();
		const readsBeforeRecovery = kv.get.mock.calls.length;

		await expect(
			getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform })
		).resolves.toBeUndefined();
		await expect(
			getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform })
		).resolves.toBeUndefined();

		expect(kv.list).toHaveBeenCalledOnce();
		expect(kv.get).toHaveBeenCalledTimes(readsBeforeRecovery);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV revision listing exceeded 1000-key recovery bound'
		);
	});

	it('does not read or serve the global legacy key when KV revision listing is unavailable', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);

		await getCachedPublicData('templates', { url: TEST_URL, platform }, async () => [
			'legacy-global'
		]);
		clearPublicDiscoveryCache();
		const readsBeforeRecovery = kv.get.mock.calls.length;
		const listlessKv = {
			get: kv.get,
			put: kv.put,
			delete: kv.delete
		} as unknown as KVNamespace;

		await expect(
			getCachedPublicDataLastKnownGood<string[]>('templates', {
				url: TEST_URL,
				platform: platformWithKv(listlessKv)
			})
		).resolves.toBeUndefined();

		expect(kv.list).not.toHaveBeenCalled();
		expect(kv.get).toHaveBeenCalledTimes(readsBeforeRecovery);
	});

	it('does not read or serve the global legacy key when KV revision listing throws', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await getCachedPublicData('templates', { url: TEST_URL, platform }, async () => [
			'legacy-global'
		]);
		clearPublicDiscoveryCache();
		const readsBeforeRecovery = kv.get.mock.calls.length;
		kv.list.mockRejectedValueOnce(new Error('KV list unavailable'));

		await expect(
			getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform })
		).resolves.toBeUndefined();

		expect(kv.list).toHaveBeenCalledOnce();
		expect(kv.get).toHaveBeenCalledTimes(readsBeforeRecovery);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV revision listing failed:',
			'KV list unavailable'
		);
	});

	it('retains an independently edge-local LKG when KV revision listing throws', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		installEdgeCache();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['edge-known-good']
		);
		clearPublicDiscoveryCache();
		const readsBeforeRecovery = kv.get.mock.calls.length;
		kv.list.mockRejectedValueOnce(new Error('KV list unavailable'));

		await expect(
			getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform })
		).resolves.toEqual(['edge-known-good']);

		expect(kv.list).toHaveBeenCalledOnce();
		expect(kv.get).toHaveBeenCalledTimes(readsBeforeRecovery);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV revision listing failed:',
			'KV list unavailable'
		);
	});

	it('does not certify a failed KV check and shares its daily retry backoff', async () => {
		const kv = installKv();
		const platform = platformWithKv(kv);
		const edge = installEdgeCache();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform, revision: '1:100' },
			async () => ['known-good']
		);
		clearPublicDiscoveryCache();
		await getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform });
		const listCallsAfterHealthyCheck = kv.list.mock.calls.length;

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
		kv.list.mockRejectedValueOnce(new Error('KV list unavailable'));
		clearPublicDiscoveryCache();
		await expect(getCachedPublicDataLastKnownGood<string[]>('templates', { url: TEST_URL, platform }))
			.resolves.toEqual(['known-good']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsAfterHealthyCheck + 1);
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] KV revision listing failed:',
			'KV list unavailable'
		);

		const pointerResponse = [...edge.entries.entries()].find(([url]) =>
			url.endsWith('/lkg-pointer')
		)?.[1];
		const pointer = (await pointerResponse!.clone().json()) as Record<string, unknown>;
		expect(pointer.latestRevisionCheckedAt).toBeUndefined();
		expect(pointer.latestRevisionRetryAt).toBe(
			NOW + 2 * PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1
		);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 16 * 60 * 1000);
		vi.resetModules();
		const retryingIsolate = await import('$lib/server/public-discovery-cache');
		await expect(
			retryingIsolate.getCachedPublicDataLastKnownGood<string[]>('templates', {
				url: TEST_URL,
				platform
			})
		).resolves.toEqual(['known-good']);
		expect(kv.list).toHaveBeenCalledTimes(listCallsAfterHealthyCheck + 1);
	});

	it('keeps outage backoff writes local across independent Worker isolates', async () => {
		const kv = installKv();
		const seedPlatform = platformWithKv(kv);
		installEdgeCache();
		await getCachedPublicData(
			'templates',
			{ url: TEST_URL, platform: seedPlatform, revision: '1:100' },
			async () => ['stable']
		);
		expect(kv.put).toHaveBeenCalledTimes(1);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS + 1);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		for (let isolateIndex = 0; isolateIndex < 2; isolateIndex += 1) {
			vi.resetModules();
			const isolate = await import('$lib/server/public-discovery-cache');
			installEdgeCache();
			const pending: Promise<unknown>[] = [];
			const platform = platformWithKv(kv, undefined, pending);
			await expect(
				isolate.getCachedPublicData(
					'templates',
					{ url: TEST_URL, platform, revision: '1:100' },
					async () => {
						throw new Error(`origin unavailable in isolate ${isolateIndex}`);
					}
				)
			).resolves.toEqual(['stable']);
			await Promise.all(pending);
		}

		// Failed refresh metadata belongs only in memory/Cache API. A fleet-wide
		// outage must not multiply scarce KV writes by active location count.
		expect(kv.put).toHaveBeenCalledTimes(1);
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
