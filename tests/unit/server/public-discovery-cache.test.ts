import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES,
	PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES,
	PUBLIC_DISCOVERY_FRESH_MS,
	PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES,
	PublicDiscoveryPayloadNotPublishedError,
	PublicDiscoveryRefreshBackoffError,
	clearPublicDiscoveryCache,
	getCachedPublicData,
	publishPublicDiscoveryPayload
} from '$lib/server/public-discovery-cache';

const NOW = 1_800_000_000_000;
const TEST_URL = new URL('https://commons.example/browse');
const TEST_CONVEX_URL = 'https://production.example.convex.cloud';

function r2RevisionPrefix(logicalKey: string, revision?: string): string {
	return (
		'public-discovery/v8/' +
		encodeURIComponent(`backend=${new URL(TEST_CONVEX_URL).origin}`) +
		'/' +
		encodeURIComponent(logicalKey) +
		'/revision=' +
		(revision === undefined ? '' : `${encodeURIComponent(revision)}/`)
	);
}

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

type StoredR2Object = {
	body: string;
	customMetadata?: Record<string, string>;
	etag: string;
	uploaded: Date;
};

function installR2() {
	const entries = new Map<string, StoredR2Object>();
	let nextEtag = 1;
	const object = (key: string, stored: StoredR2Object) => ({
		customMetadata: stored.customMetadata,
		etag: stored.etag,
		httpEtag: `"${stored.etag}"`,
		json: async <T>() => JSON.parse(stored.body) as T,
		key,
		size: stored.body.length,
		text: async () => stored.body,
		uploaded: stored.uploaded
	});
	const get = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		return stored ? object(key, stored) : null;
	});
	const put = vi.fn(
		async (
			key: string,
			value: string,
			options?: {
				customMetadata?: Record<string, string>;
				onlyIf?: Headers | { etagMatches?: string };
			}
		) => {
			const existing = entries.get(key);
			const ifNoneMatch =
				options?.onlyIf instanceof Headers ? options.onlyIf.get('If-None-Match') : null;
			const ifMatch = options?.onlyIf instanceof Headers ? options.onlyIf.get('If-Match') : null;
			const etagMatches =
				options?.onlyIf && !(options.onlyIf instanceof Headers)
					? options.onlyIf.etagMatches
					: undefined;
			if (ifNoneMatch === '*' && existing) return null;
			if (ifMatch && existing?.etag !== ifMatch.replaceAll('"', '')) return null;
			if (etagMatches !== undefined && existing?.etag !== etagMatches) return null;
			const stored: StoredR2Object = {
				body: String(value),
				customMetadata: options?.customMetadata,
				etag: `etag-${nextEtag++}`,
				uploaded: new Date(Date.now())
			};
			entries.set(key, stored);
			return object(key, stored);
		}
	);
	const list = vi.fn(
		async ({ limit = 1000, prefix = '' }: { limit?: number; prefix?: string } = {}) => {
			const matching = [...entries.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.sort(([left], [right]) => left.localeCompare(right));
			return {
				objects: matching.slice(0, limit).map(([key, stored]) => object(key, stored)),
				truncated: matching.length > limit,
				...(matching.length > limit ? { cursor: String(limit) } : {})
			};
		}
	);
	const remove = vi.fn(async (keys: string | string[]) => {
		for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
	});
	return {
		entries,
		get,
		put,
		list,
		delete: remove
	} as unknown as R2Bucket & {
		entries: Map<string, StoredR2Object>;
		get: ReturnType<typeof vi.fn>;
		put: ReturnType<typeof vi.fn>;
		list: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};
}

function platformWithR2(
	r2: R2Bucket,
	convexUrl = TEST_CONVEX_URL,
	pending?: Promise<unknown>[]
) {
	return {
		env: {
			PUBLIC_DISCOVERY_R2: r2,
			PUBLIC_CONVEX_URL: convexUrl
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

	it('never returns a retry-backed-off payload after a withdrawal floor retires it', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await getCachedPublicData('retired-retry', { url: TEST_URL, revision: 4 }, async () => [
			'revision-4'
		]);
		const unavailable = vi.fn().mockRejectedValue(new Error('revision 5 unavailable'));

		await expect(
			getCachedPublicData('retired-retry', { url: TEST_URL, revision: 5 }, unavailable)
		).resolves.toEqual(['revision-4']);
		await expect(
			getCachedPublicData(
				'retired-retry',
				{ url: TEST_URL, revision: 5, retiredRevisionFloor: 4 },
				unavailable
			)
		).rejects.toThrow('revision 5 refresh is temporarily backed off');
		expect(unavailable).toHaveBeenCalledOnce();
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

	it('memoizes a fail-closed control-plane error without reauthorizing its stale value', async () => {
		installEdgeCache();
		const context = {
			url: TEST_URL,
			freshForMs: 60_000,
			failClosedRefreshBackoffMs: 60_000,
			refreshMode: 'blocking' as const,
			shouldFallbackToStale: () => false
		};
		await getCachedPublicData('manifest', context, async () => ({ revision: 1 }));
		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		const loader = vi.fn().mockRejectedValue(new Error('manifest unavailable'));

		await expect(getCachedPublicData('manifest', context, loader)).rejects.toThrow(
			'manifest unavailable'
		);
		await expect(getCachedPublicData('manifest', context, loader)).rejects.toBeInstanceOf(
			PublicDiscoveryRefreshBackoffError
		);
		expect(loader).toHaveBeenCalledOnce();

		vi.mocked(Date.now).mockReturnValue(NOW + 120_002);
		loader.mockResolvedValue({ revision: 2 });
		await expect(getCachedPublicData('manifest', context, loader)).resolves.toEqual({
			revision: 2
		});
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('caps fail-closed refresh backoff even when a caller requests an unsafe duration', async () => {
		const context = {
			url: TEST_URL,
			failClosedRefreshBackoffMs: Number.MAX_SAFE_INTEGER,
			shouldFallbackToStale: () => false
		};
		const loader = vi.fn().mockRejectedValue(new Error('control plane unavailable'));

		await expect(getCachedPublicData('manifest', context, loader)).rejects.toThrow(
			'control plane unavailable'
		);
		const retry = await getCachedPublicData('manifest', context, loader).catch((error) => error);

		expect(retry).toBeInstanceOf(PublicDiscoveryRefreshBackoffError);
		expect((retry as PublicDiscoveryRefreshBackoffError).retryAt - NOW).toBe(15 * 60 * 1000);
		expect(loader).toHaveBeenCalledOnce();
	});

	it('coalesces stale blocking resolution before shared reads and keeps R2 disabled', async () => {
		const edge = installEdgeCache();
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const context = {
			url: TEST_URL,
			platform,
			freshForMs: 60_000,
			r2Policy: 'none' as const,
			refreshMode: 'blocking' as const
		};

		await getCachedPublicData('manifest', context, async () => ({ revision: 1 }));
		edge.match.mockClear();
		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		const refresh = deferred<{ revision: number }>();
		const loader = vi.fn(() => refresh.promise);

		const first = getCachedPublicData('manifest', context, loader);
		const second = getCachedPublicData('manifest', context, loader);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

		expect(edge.match).toHaveBeenCalledOnce();
		expect(r2.get).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		refresh.resolve({ revision: 2 });
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ revision: 2 },
			{ revision: 2 }
		]);
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
					projectCachedValue: (value, envelopeRevision) => {
						expect(envelopeRevision).toBe('1');
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

	it('keeps every anonymous exact miss to one GET per cold isolate and zero mutation or origin work', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const coldIsolates: Array<typeof import('$lib/server/public-discovery-cache')> = [];
		const loaders = Array.from({ length: 24 }, () =>
			vi.fn().mockResolvedValue(['must-not-load'])
		);

		for (let index = 0; index < loaders.length; index += 1) {
			vi.resetModules();
			coldIsolates.push(await import('$lib/server/public-discovery-cache'));
		}

		const results = await Promise.allSettled(
			coldIsolates.map((isolate, index) =>
				isolate.getCachedPublicData(
					'templates:exclude-cwc=0',
					{
						url: new URL('https://pop-' + index + '.commons.example/'),
						platform,
						revision: '7:700'
					},
					loaders[index]
				)
			)
		);

		expect(results).toHaveLength(24);
		for (const result of results) {
			expect(result.status).toBe('rejected');
			if (result.status === 'rejected') {
				expect(result.reason).toMatchObject({
					name: 'PublicDiscoveryPayloadNotPublishedError',
					revision: '7:700'
				});
			}
		}
		expect(r2.get).toHaveBeenCalledTimes(24);
		const exactKeys = r2.get.mock.calls.map(([key]) => String(key));
		expect(new Set(exactKeys)).toEqual(
			new Set([r2RevisionPrefix('templates:exclude-cwc=0', '7:700') + 'payload.json'])
		);
		expect(exactKeys.every((key) => !key.endsWith('/claim.json'))).toBe(true);
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(loaders.every((loader) => loader.mock.calls.length === 0)).toBe(true);
	});

	it('producer-publishes one immutable object and reuses it without another write', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const firstLoader = vi.fn().mockResolvedValue({ templates: ['published'] });

		await expect(
			publishPublicDiscoveryPayload(
				'templates:exclude-cwc=0',
				{ platform, revision: '7:700' },
				firstLoader
			)
		).resolves.toEqual({ templates: ['published'] });

		const payloadKey =
			r2RevisionPrefix('templates:exclude-cwc=0', '7:700') + 'payload.json';
		expect(firstLoader).toHaveBeenCalledOnce();
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).toHaveBeenCalledOnce();
		expect(r2.put).toHaveBeenCalledWith(
			payloadKey,
			expect.any(String),
			expect.objectContaining({
				customMetadata: { kind: 'payload', revision: '7:700' },
				onlyIf: expect.any(Headers)
			})
		);
		expect(r2.put.mock.calls[0]?.[2]?.onlyIf.get('If-None-Match')).toBe('*');
		expect(r2.entries.has(payloadKey)).toBe(true);
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();

		r2.get.mockClear();
		r2.put.mockClear();
		r2.delete.mockClear();
		const duplicateLoader = vi.fn().mockResolvedValue({ templates: ['must-not-replace'] });
		await expect(
			publishPublicDiscoveryPayload(
				'templates:exclude-cwc=0',
				{ platform, revision: '7:700' },
				duplicateLoader
			)
		).resolves.toEqual({ templates: ['published'] });
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(duplicateLoader).not.toHaveBeenCalled();
	});

	it('serves a producer-published exact hit with one GET and no mutation or origin work', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		await publishPublicDiscoveryPayload(
			'templates:exclude-cwc=0',
			{ platform, revision: '8:800' },
			async () => ['global']
		);
		clearPublicDiscoveryCache();
		r2.get.mockClear();
		r2.put.mockClear();
		r2.list.mockClear();
		r2.delete.mockClear();
		const anonymousLoader = vi.fn().mockResolvedValue(['must-not-load']);

		await expect(
			getCachedPublicData(
				'templates:exclude-cwc=0',
				{ url: TEST_URL, platform, revision: '8:800' },
				anonymousLoader
			)
		).resolves.toEqual(['global']);
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(anonymousLoader).not.toHaveBeenCalled();
	});

	it('isolates producer-published payloads by the trusted Convex backend', async () => {
		const r2 = installR2();
		const production = platformWithR2(r2, TEST_CONVEX_URL);
		const previewUrl = 'https://preview.example.convex.cloud';
		const preview = platformWithR2(r2, previewUrl);

		await publishPublicDiscoveryPayload(
			'templates',
			{ platform: production, revision: 8 },
			async () => ['production']
		);
		await publishPublicDiscoveryPayload(
			'templates',
			{ platform: preview, revision: 8 },
			async () => ['preview']
		);

		const payloadKeys = [...r2.entries.keys()].filter((key) => key.endsWith('/payload.json'));
		expect(payloadKeys).toHaveLength(2);
		expect(
			payloadKeys.some((key) =>
				key.includes(encodeURIComponent('backend=' + new URL(TEST_CONVEX_URL).origin))
			)
		).toBe(true);
		expect(
			payloadKeys.some((key) =>
				key.includes(encodeURIComponent('backend=' + new URL(previewUrl).origin))
			)
		).toBe(true);
	});

	it('fails closed on a malformed exact R2 payload without reading origin or mutating R2', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const payloadKey = r2RevisionPrefix('cards', '2') + 'payload.json';
		r2.entries.set(payloadKey, {
			body: JSON.stringify({
				cachedAt: NOW,
				revision: '2',
				value: { message_body: { privateRecipient: 'private@example.test' } }
			}),
			etag: 'malformed-payload',
			uploaded: new Date(NOW)
		});
		const loader = vi.fn().mockResolvedValue({ message_body: 'must-not-load' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

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
						return value as { message_body: string };
					}
				},
				loader
			)
		).rejects.toThrow('could not be read safely');
		expect(loader).not.toHaveBeenCalled();
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			'[public-discovery-cache] invalid R2 payload envelope:',
			payloadKey
		);
	});

	it('rejects an oversized exact R2 payload before JSON parsing or origin work', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const payloadKey = r2RevisionPrefix('oversized-payload', '2') + 'payload.json';
		r2.entries.set(payloadKey, {
			body: 'x'.repeat(PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES + 1),
			etag: 'oversized-payload',
			uploaded: new Date(NOW)
		});
		const loader = vi.fn().mockResolvedValue(['must-not-load']);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(
			getCachedPublicData(
				'oversized-payload',
				{ url: TEST_URL, platform, revision: 2 },
				loader
			)
		).rejects.toThrow('could not be read safely');
		expect(loader).not.toHaveBeenCalled();
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('never bypasses an R2 read error with an origin load', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		r2.get.mockRejectedValueOnce(new Error('R2 unavailable'));
		const loader = vi.fn().mockResolvedValue(['must-not-load']);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 3 }, loader)
		).rejects.toThrow('could not be read safely');
		expect(loader).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('rejects an exact object whose embedded revision does not match its key', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const payloadKey = r2RevisionPrefix('templates', '4') + 'payload.json';
		r2.entries.set(payloadKey, {
			body: JSON.stringify({ cachedAt: NOW, revision: '999', value: ['wrong-coordinate'] }),
			etag: 'wrong-coordinate',
			uploaded: new Date(NOW)
		});
		const loader = vi.fn().mockResolvedValue(['must-not-load']);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(
			getCachedPublicData('templates', { url: TEST_URL, platform, revision: 4 }, loader)
		).rejects.toThrow('could not be read safely');
		expect(loader).not.toHaveBeenCalled();
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('requires R2 before a deployed versioned payload may read origin', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const loader = vi.fn().mockResolvedValue(['must-not-load']);
		await expect(
			getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform: { env: {} } as App.Platform, revision: 1 },
				loader
			)
		).rejects.toThrow('PUBLIC_DISCOVERY_R2 binding is required');
		expect(loader).not.toHaveBeenCalled();
	});

	it('keeps mutable control values out of the immutable payload-cache R2 protocol', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		const context = {
			url: TEST_URL,
			platform,
			freshForMs: 60_000,
			r2Policy: 'none' as const,
			refreshMode: 'blocking' as const
		};
		const loader = vi
			.fn()
			.mockResolvedValueOnce({ revision: 1 })
			.mockResolvedValueOnce({ revision: 2 });

		await expect(getCachedPublicData('manifest', context, loader)).resolves.toEqual({
			revision: 1
		});
		vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
		await expect(getCachedPublicData('manifest', context, loader)).resolves.toEqual({
			revision: 2
		});
		expect(r2.get).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('lets only the producer retire exact, strictly older revisions and never lists globally', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		await publishPublicDiscoveryPayload(
			'templates',
			{ platform, revision: '1:100' },
			async () => ['prior']
		);
		const priorKey = r2RevisionPrefix('templates', '1:100') + 'payload.json';
		const currentKey = r2RevisionPrefix('templates', '2:200') + 'payload.json';
		r2.get.mockClear();
		r2.put.mockClear();
		r2.list.mockClear();
		r2.delete.mockClear();

		await expect(
			publishPublicDiscoveryPayload(
				'templates',
				{ platform, retireRevisions: ['1:100'], revision: '2:200' },
				async () => ['current']
			)
		).resolves.toEqual(['current']);
		expect(r2.entries.has(priorKey)).toBe(false);
		expect(r2.entries.has(currentKey)).toBe(true);
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.put).toHaveBeenCalledOnce();
		expect(r2.delete).toHaveBeenCalledWith([priorKey]);
		expect(r2.list).not.toHaveBeenCalled();

		r2.get.mockClear();
		r2.put.mockClear();
		r2.delete.mockClear();
		const invalidLoader = vi.fn().mockResolvedValue(['invalid']);
		await expect(
			publishPublicDiscoveryPayload(
				'templates',
				{ platform, retireRevisions: ['4:400'], revision: '3:300' },
				invalidLoader
			)
		).rejects.toThrow('may retire only an older exact revision');
		expect(invalidLoader).not.toHaveBeenCalled();
		expect(r2.get).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('never lets an older producer completion delayed over five minutes delete a newer payload', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		await publishPublicDiscoveryPayload(
			'templates',
			{ platform, revision: '7:100' },
			async () => ['seed']
		);
		const olderValue = deferred<string[]>();
		const olderLoader = vi.fn(() => olderValue.promise);
		const olderPublication = publishPublicDiscoveryPayload(
			'templates',
			{ platform, retireRevisions: ['7:100'], revision: '8:100' },
			olderLoader
		);
		await vi.waitFor(() => expect(olderLoader).toHaveBeenCalledOnce());

		vi.mocked(Date.now).mockReturnValue(NOW + 1);
		await publishPublicDiscoveryPayload(
			'templates',
			{ platform, retireRevisions: ['8:100'], revision: '9:100' },
			async () => ['newer']
		);
		const newerKey = r2RevisionPrefix('templates', '9:100') + 'payload.json';
		expect(r2.entries.has(newerKey)).toBe(true);

		vi.mocked(Date.now).mockReturnValue(NOW + 5 * 60 * 1000 + 2);
		olderValue.resolve(['older']);
		await expect(olderPublication).resolves.toEqual(['older']);
		expect(r2.entries.has(newerKey)).toBe(true);
		expect(r2.list).not.toHaveBeenCalled();
		expect(
			r2.delete.mock.calls.every(([keys]) =>
				(Array.isArray(keys) ? keys : [keys]).every((key) => key !== newerKey)
			)
		).toBe(true);
	});

	it('never performs a global LIST or chooses an older LKG for an anonymous exact miss', async () => {
		const r2 = installR2();
		const platform = platformWithR2(r2);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await publishPublicDiscoveryPayload(
			'templates',
			{ platform, revision: '1:100' },
			async () => ['older']
		);
		const olderKey = r2RevisionPrefix('templates', '1:100') + 'payload.json';
		clearPublicDiscoveryCache();
		r2.get.mockClear();
		r2.put.mockClear();
		r2.list.mockClear();
		r2.delete.mockClear();
		const loader = vi.fn().mockResolvedValue(['must-not-load']);

		await expect(
			getCachedPublicData(
				'templates',
				{ url: TEST_URL, platform, revision: '2:200' },
				loader
			)
		).rejects.toBeInstanceOf(PublicDiscoveryPayloadNotPublishedError);
		expect(r2.get).toHaveBeenCalledWith(
			r2RevisionPrefix('templates', '2:200') + 'payload.json'
		);
		expect(r2.get).toHaveBeenCalledOnce();
		expect(r2.entries.has(olderKey)).toBe(true);
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
		expect(loader).not.toHaveBeenCalled();
	});

	it('keeps the hard account-wide Cloudflare operation envelope inside the free tiers', () => {
		// Use the longest billing month. These are account-wide ceilings, so the
		// apparent remainder is usable only if siblings have left it unspent; none
		// of this test's positive margins is reserved Commons capacity.
		const days = 31;
		const liveBackendRealms = 2;
		const workersFreeRequestsPerDay = 100_000;
		const maxAcceptedProducerCycles = liveBackendRealms * days * 24 * 60;
		// A destructive cycle may use acquisition, staged withdrawal, and final
		// authority PUTs. Every admitted cycle may also publish both list variants
		// and both bundled graph variants. This deliberately covers urgent writes
		// instead of assuming ordinary six-hour producer floors.
		const manifestClassAPuts = maxAcceptedProducerCycles * 3;
		const immutablePayloadPuts = maxAcceptedProducerCycles * 4;
		const exactRetirementClassAOperations = 0;
		const monthlyClassAOperations =
			manifestClassAPuts + immutablePayloadPuts + exactRetirementClassAOperations;
		const standardClassAFreeTier = 1_000_000;
		const classAReserve = standardClassAFreeTier - monthlyClassAOperations;

		expect(maxAcceptedProducerCycles).toBe(89_280);
		expect(manifestClassAPuts).toBe(267_840);
		expect(immutablePayloadPuts).toBe(357_120);
		expect(monthlyClassAOperations).toBe(624_960);
		expect(classAReserve).toBe(375_040);
		expect(classAReserve).toBeGreaterThan(0);

		// The Workers Free account ceiling is a harder anonymous-read bound than
		// a guessed POP count: every allowed request can spend at most one exact
		// manifest GET and one exact bundled-payload GET. Producer cycles add one
		// manifest-state GET and four payload-existence GETs.
		const maxMonthlyWorkerRequests = workersFreeRequestsPerDay * days;
		const anonymousClassBOperations = maxMonthlyWorkerRequests * 2;
		const producerExactReads = maxAcceptedProducerCycles * 5;
		const monthlyClassBOperations = anonymousClassBOperations + producerExactReads;
		const standardClassBFreeTier = 10_000_000;
		const classBReserve = standardClassBFreeTier - monthlyClassBOperations;

		expect(maxMonthlyWorkerRequests).toBe(3_100_000);
		expect(anonymousClassBOperations).toBe(6_200_000);
		expect(producerExactReads).toBe(446_400);
		expect(monthlyClassBOperations).toBe(6_646_400);
		expect(classBReserve).toBe(3_353_600);
		expect(classBReserve).toBeGreaterThan(0);

		// The manifest retains exactly three generations for each of the four
		// immutable payload families. Charge every retained payload at the 2 MiB
		// parser ceiling and every realm one complete 4 KiB manifest. Even this
		// deliberately pessimistic ring is tiny relative to the account-wide 10 GB
		// Standard-storage allowance.
		const retainedGenerationsPerRealm = 3;
		const immutablePayloadsPerGeneration = 4;
		const manifestMaxBytes = 4 * 1024;
		const monthlyStandardStorageFreeBytes = 10_000_000_000;
		const retainedR2Bytes =
			liveBackendRealms *
			(retainedGenerationsPerRealm *
				immutablePayloadsPerGeneration *
				PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES +
				manifestMaxBytes);
		expect(PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES).toBe(2 * 1024 * 1024);
		expect(retainedR2Bytes).toBe(50_339_840);
		expect(monthlyStandardStorageFreeBytes - retainedR2Bytes).toBe(9_949_660_160);
		expect(retainedR2Bytes).toBeLessThan(monthlyStandardStorageFreeBytes);

		// Workers/Pages inbound requests and DO requests are separate account-level
		// meters. A valid call spends one of each; the endpoint's Workers ceiling
		// therefore also bounds calls into this object when siblings spend nothing.
		// The transaction reads at most two singleton rows. Alternating an admitted
		// cycle with an authenticated deployment-priority marker/clear is the
		// conservative row-write bound; ordinary operation is far lower.
		const durableObjectFreeRequestsPerDay = 100_000;
		const durableObjectFreeRowsReadPerDay = 5_000_000;
		const durableObjectFreeRowsWrittenPerDay = 100_000;
		const durableObjectFreeStorageBytes = 5_000_000_000;
		const durableObjectFreeDurationGbSecondsPerDay = 13_000;
		const maxRowsReadPerValidRequest = 2;
		const maxRowsWrittenPerDay = liveBackendRealms * 2 * 24 * 60;
		const ordinaryCronAndPushRequestsPerDay = liveBackendRealms * (2 * 24 * 60 + 4);
		expect(ordinaryCronAndPushRequestsPerDay).toBe(5_768);
		expect(durableObjectFreeRequestsPerDay - workersFreeRequestsPerDay).toBe(0);
		expect(
			durableObjectFreeRowsReadPerDay -
				workersFreeRequestsPerDay * maxRowsReadPerValidRequest
		).toBe(4_800_000);
		expect(durableObjectFreeRowsWrittenPerDay - maxRowsWrittenPerDay).toBe(94_240);

		// Each realm has two fixed singleton rows and cannot accumulate request
		// history. Budgeting a loose whole MiB per realm for rows, schema, indexes,
		// and SQLite internal pages still uses only 2 MiB of the account's 5 GB.
		const conservativeSqliteBytesPerRealm = 1024 * 1024;
		const conservativeSqliteStorageBytes =
			liveBackendRealms * conservativeSqliteBytesPerRealm;
		expect(conservativeSqliteStorageBytes).toBe(2_097_152);
		expect(durableObjectFreeStorageBytes - conservativeSqliteStorageBytes).toBe(
			4_997_902_848
		);
		expect(conservativeSqliteStorageBytes).toBeLessThan(durableObjectFreeStorageBytes);

		// Duration is billed for actual handler lifetime. As a conservative proxy,
		// charge every one of the account's 100,000 possible calls the full 750 ms
		// caller deadline at the 128 MB Worker memory ceiling. Faster synchronous
		// gate responses bill less; the proxy leaves only an account-wide reserve.
		const gateCallerDeadlineSeconds = 0.75;
		const workerMemoryGb = 0.128;
		const conservativeDurationGbSecondsPerDay =
			durableObjectFreeRequestsPerDay * gateCallerDeadlineSeconds * workerMemoryGb;
		expect(conservativeDurationGbSecondsPerDay).toBe(9_600);
		expect(
			durableObjectFreeDurationGbSecondsPerDay - conservativeDurationGbSecondsPerDay
		).toBe(3_400);
	});

	it('can force-refresh a fresh control-plane entry after a publish race', async () => {
		await getCachedPublicData('manifest', { url: TEST_URL }, async () => ({ revision: 1 }));
		const refresh = vi.fn().mockResolvedValue({ revision: 2 });

		await expect(
			getCachedPublicData('manifest', { url: TEST_URL, forceRefresh: true }, refresh)
		).resolves.toEqual({ revision: 2 });
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('bounds a lengthless oversized Cache API envelope before parsing it', async () => {
		const oversized = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode('x'.repeat(PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES + 1))
				);
				controller.close();
			}
		});
		const match = vi.fn().mockResolvedValue(new Response(oversized));
		const put = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('caches', { default: { match, put } });
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const loader = vi.fn().mockResolvedValue(['live']);

		await expect(
			getCachedPublicData('oversized-edge-envelope', { url: TEST_URL }, loader)
		).resolves.toEqual(['live']);
		expect(loader).toHaveBeenCalledOnce();
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
