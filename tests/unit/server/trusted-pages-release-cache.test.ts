import { describe, expect, it, vi } from 'vitest';
import {
	createTrustedPagesReleaseCache,
	PUBLIC_DISCOVERY_CACHE_NAME,
	PUBLIC_DISCOVERY_CACHE_STATUS_HEADER,
	TRUSTED_CACHE_AUTHORITY_PREREQUISITE,
	TRUSTED_PAGES_RELEASE_CACHE_POLICY,
	type TrustedCacheExecutionContext,
	type TrustedCacheLike
} from '../../../workers/trusted-pages-release-cache';

const sourceSha = 'a'.repeat(40);
const releaseTransactionId = '123456789-1';

class MemoryCache implements TrustedCacheLike {
	readonly entries = new Map<string, Response>();
	readonly match = vi.fn(async (request: Request) => this.entries.get(request.url)?.clone());
	readonly put = vi.fn(async (request: Request, response: Response) => {
		this.entries.set(request.url, response.clone());
	});
}

function workContext(): TrustedCacheExecutionContext & { flush(): Promise<void> } {
	const work: Promise<unknown>[] = [];
	return {
		async flush() {
			while (work.length > 0) await Promise.all(work.splice(0));
		},
		waitUntil(promise) {
			work.push(promise);
		}
	};
}

function html(body: string, headers: HeadersInit = {}): Response {
	return new Response(body, {
		headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
		status: 200
	});
}

function createCache(
	cache: TrustedCacheLike | undefined,
	now: () => number = () => 1_000,
	overrides: Partial<Parameters<typeof createTrustedPagesReleaseCache>[0]> = {}
) {
	return createTrustedPagesReleaseCache({
		approvedPublicHosts: ['commons.email'],
		cache,
		cachePolicyVersion: 'landing-v1',
		now,
		releaseTransactionId,
		sourceSha,
		...overrides
	});
}

function authorizedFetch(
	cache: ReturnType<typeof createTrustedPagesReleaseCache>,
	request: Request,
	fetchOrigin: () => Promise<Response>,
	context?: TrustedCacheExecutionContext
) {
	return cache.fetchAfterAuthority({
		authority: TRUSTED_CACHE_AUTHORITY_PREREQUISITE,
		context,
		fetchOrigin,
		request
	});
}

describe('trusted Pages release landing cache', () => {
	it.each([
		['non-approved host', 'https://attacker.example/', {}],
		['non-root path', 'https://commons.email/templates', {}],
		['query', 'https://commons.email/?preview=1', {}],
		['empty query delimiter', 'https://commons.email/?', {}],
		['Cookie', 'https://commons.email/', { headers: { cookie: 'session=secret' } }],
		['Authorization', 'https://commons.email/', { headers: { authorization: 'Bearer secret' } }],
		['Range', 'https://commons.email/', { headers: { range: 'bytes=0-10' } }],
		['non-GET', 'https://commons.email/', { method: 'HEAD' }],
		['non-TLS URL', 'http://commons.email/', {}],
		['explicit port', 'https://commons.email:8443/', {}]
	])('bypasses the cache for %s', async (_label, url, init) => {
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(async () => html('origin'));

		const response = await authorizedFetch(cache, new Request(url, init), origin);

		expect(await response.text()).toBe('origin');
		expect(origin).toHaveBeenCalledOnce();
		expect(inner.match).not.toHaveBeenCalled();
		expect(inner.put).not.toHaveBeenCalled();
	});

	it('refuses to operate before the caller attests release and access checks', async () => {
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(async () => html('must not run'));

		await expect(
			cache.fetchAfterAuthority({
				authority: 'unchecked' as typeof TRUSTED_CACHE_AUTHORITY_PREREQUISITE,
				fetchOrigin: origin,
				request: new Request('https://commons.email/')
			})
		).rejects.toThrow('only after release and origin-access checks pass');
		expect(origin).not.toHaveBeenCalled();
		expect(inner.match).not.toHaveBeenCalled();
	});

	it('keys the named inner cache by host, source, transaction, and policy', async () => {
		const inner = new MemoryCache();
		const context = workContext();
		const cache = createCache(inner);

		await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			async () => html('first'),
			context
		);
		await context.flush();

		expect(inner.put).toHaveBeenCalledOnce();
		const key = inner.put.mock.calls[0][0];
		const url = new URL(key.url);
		expect(url.origin).toBe('https://commons.email');
		expect(url.pathname).toBe('/.well-known/commons-cache/public-discovery');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			host: 'commons.email',
			sourceSha,
			releaseTransactionId,
			cachePolicyVersion: 'landing-v1'
		});

		expect(cache.purgePlan()).toEqual({
			cacheKeys: [key.url],
			cacheName: PUBLIC_DISCOVERY_CACHE_NAME,
			cacheTags: ['public-discovery'],
			publicationPurge: { mode: 'tag', tag: 'public-discovery' }
		});
	});

	it('replaces candidate caching headers and serves a stored hit without origin I/O', async () => {
		const inner = new MemoryCache();
		const context = workContext();
		const cache = createCache(inner);
		const origin = vi.fn(async () =>
			html('landing', {
				'cache-control': 'public, max-age=86400',
				'cache-tag': 'candidate-owned',
				'cdn-cache-control': 'public, s-maxage=86400',
				'cloudflare-cdn-cache-control': 'public, s-maxage=86400',
				expires: 'Thu, 31 Dec 2099 23:59:59 GMT',
				'surrogate-control': 'max-age=86400',
				vary: 'Accept-Encoding'
			})
		);

		const first = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		await context.flush();
		const second = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);

		for (const response of [first, second]) {
			expect(response.headers.get('cache-control')).toBe(
				'public, max-age=60, stale-while-revalidate=300'
			);
			expect(response.headers.get('cdn-cache-control')).toBe(
				'public, s-maxage=60, stale-while-revalidate=300'
			);
			expect(response.headers.get('cloudflare-cdn-cache-control')).toBe(
				'public, s-maxage=60, stale-while-revalidate=300'
			);
			expect(response.headers.get('vary')).toBe('Accept-Encoding');
			expect(response.headers.get('cache-tag')).toBe('public-discovery');
			expect(response.headers.get('age')).toBe('0');
			expect(response.headers.get('expires')).toBeNull();
			expect(response.headers.get('surrogate-control')).toBeNull();
			expect(response.headers.get('x-commons-public-discovery-cache-stored-at')).toBeNull();
		}
		expect(await first.text()).toBe('landing');
		expect(await second.text()).toBe('landing');
		expect(first.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('miss');
		expect(second.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
		expect(origin).toHaveBeenCalledOnce();
	});

	it.each(['User-Agent', 'Accept-Language', '*', 'Accept-Encoding, User-Agent'])(
		'does not store an origin response with hostile Vary: %s',
		async (vary) => {
			const inner = new MemoryCache();
			const cache = createCache(inner);
			const origin = vi.fn(async () => html(`variant-${origin.mock.calls.length}`, { vary }));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = await request();
			const second = await request();

			expect(await first.text()).toBe('variant-1');
			expect(await second.text()).toBe('variant-2');
			expect(first.headers.get('cache-control')).toBe('private, no-store, max-age=0');
			expect(second.headers.get('vary')).toBe('*');
			expect(origin).toHaveBeenCalledTimes(2);
			expect(inner.put).not.toHaveBeenCalled();
		}
	);

	it('never stores Set-Cookie and forces the eligible response to no-store', async () => {
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(async () => html('personal', { 'set-cookie': 'session=secret' }));

		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin
		);

		expect(response.headers.get('set-cookie')).toBe('session=secret');
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(response.headers.get('cdn-cache-control')).toBe('no-store');
		expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
		expect(response.headers.get('vary')).toBe('*');
		expect(response.headers.get('cache-tag')).toBeNull();
		expect(inner.put).not.toHaveBeenCalled();
	});

	it.each([
		['non-200 HTML', new Response('redirected', { headers: { 'content-type': 'text/html' }, status: 201 })],
		['non-HTML 200', new Response('{}', { headers: { 'content-type': 'application/json' }, status: 200 })]
	])('does not store %s', async (_label, candidate) => {
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			async () => candidate
		);

		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(inner.put).not.toHaveBeenCalled();
	});

	it('retains and caches an exact one-mebibyte landing response', async () => {
		const maximumBytes =
			TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumRetainedOriginResponseBytesPerKeyAndIsolate;
		const body = new Uint8Array(maximumBytes).fill(0x61);
		const inner = new MemoryCache();
		const context = workContext();
		const cache = createCache(inner);
		const origin = vi.fn(async () =>
			new Response(body.slice(), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			})
		);
		const request = () =>
			authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

		const first = await request();
		expect((await first.arrayBuffer()).byteLength).toBe(maximumBytes);
		await context.flush();
		const second = await request();
		expect((await second.arrayBuffer()).byteLength).toBe(maximumBytes);
		expect(first.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('miss');
		expect(second.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
		expect(inner.put).toHaveBeenCalledOnce();
		expect(origin).toHaveBeenCalledOnce();
	});

	it('bypasses storage and L1 when landing HTML exceeds one mebibyte by one byte', async () => {
		const maximumBytes =
			TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumRetainedOriginResponseBytesPerKeyAndIsolate;
		const body = new Uint8Array(maximumBytes + 1).fill(0x61);
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(async () =>
			new Response(body.slice(), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			})
		);
		const request = () =>
			authorizedFetch(cache, new Request('https://commons.email/'), origin);

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const response = await request();
			expect(response.status).toBe(502);
			expect(await response.text()).toBe(
				'Trusted landing response exceeded its byte boundary.'
			);
			expect(response.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('bypass');
			expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
			expect(response.headers.get('cdn-cache-control')).toBe('no-store');
			expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
			expect(response.headers.get('cache-tag')).toBeNull();
		}
		expect(inner.put).not.toHaveBeenCalled();
		expect(origin).toHaveBeenCalledTimes(2);
	});

	it('rejects a finite tiny-chunk body at the strict read-work boundary without retaining every chunk', async () => {
		const attemptedChunks = 500_000;
		let emittedChunks = 0;
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (emittedChunks === attemptedChunks) {
					controller.close();
					return;
				}
				emittedChunks += 1;
				controller.enqueue(Uint8Array.of(0x61));
			},
			cancel() {
				cancellations += 1;
			}
		});
		const inner = new MemoryCache();
		const cache = createCache(inner);

		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			async () =>
				new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
		);

		expect(response.status).toBe(502);
		expect(emittedChunks).toBeLessThan(attemptedChunks);
		expect(emittedChunks).toBeLessThanOrEqual(
			TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumResponseBodyChunksPerMaterialization + 2
		);
		expect(cancellations).toBe(1);
		expect(inner.put).not.toHaveBeenCalled();
	});

	it('terminates an infinite zero-byte body at the read-work boundary', async () => {
		let reads = 0;
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				reads += 1;
				controller.enqueue(new Uint8Array());
			},
			cancel() {
				cancellations += 1;
			}
		});
		const inner = new MemoryCache();
		const cache = createCache(inner);

		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			async () =>
				new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
		);

		expect(response.status).toBe(502);
		expect(reads).toBeLessThanOrEqual(
			TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumResponseBodyChunksPerMaterialization + 2
		);
		expect(cancellations).toBe(1);
		expect(inner.put).not.toHaveBeenCalled();
	});

	it('keeps an oversized origin quarantined until its raw cancellation settles', async () => {
		vi.useFakeTimers();
		try {
			let settleCancellation!: () => void;
			let cancellations = 0;
			const oversized = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						new Uint8Array(
							TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumEligibleOriginResponseBytes + 1
						)
					);
				},
				cancel() {
					cancellations += 1;
					return new Promise<void>((resolve) => {
						settleCancellation = resolve;
					});
				}
			});
			const inner = new MemoryCache();
			const cache = createCache(inner);
			const origin = vi
				.fn<() => Promise<Response>>()
				.mockResolvedValueOnce(
					new Response(oversized, {
						headers: { 'content-type': 'text/html; charset=utf-8' }
					})
				)
				.mockResolvedValueOnce(html('recovered'));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = request();
			const firstAssertion = expect(first).rejects.toThrow(
				'origin exceeded its flight deadline'
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(cancellations).toBe(1);
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.originFetchTimeoutMs
			);
			await firstAssertion;
			await expect(request()).rejects.toThrow('origin exceeded its flight deadline');
			expect(origin).toHaveBeenCalledOnce();

			settleCancellation();
			await vi.advanceTimersByTimeAsync(0);
			expect(await (await request()).text()).toBe('recovered');
			expect(origin).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('serves stale for 300 seconds while one background origin refresh replaces it', async () => {
		let timestamp = 1_000;
		const inner = new MemoryCache();
		const context = workContext();
		const cache = createCache(inner, () => timestamp);
		const origin = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(html('old'))
			.mockResolvedValueOnce(html('new'));

		await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		await context.flush();
		timestamp += 60_000;

		const stale = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		expect(await stale.text()).toBe('old');
		expect(stale.headers.get('age')).toBe('60');
		expect(stale.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('stale');
		await context.flush();

		const refreshed = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		expect(await refreshed.text()).toBe('new');
		expect(refreshed.headers.get('age')).toBe('0');
		expect(origin).toHaveBeenCalledTimes(2);
	});

	it('treats entries outside the full fresh-plus-stale window as misses', async () => {
		let timestamp = 1_000;
		const inner = new MemoryCache();
		const context = workContext();
		const cache = createCache(inner, () => timestamp);
		const origin = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(html('expired'))
			.mockResolvedValueOnce(html('replacement'));

		await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		await context.flush();
		timestamp += 360_000;

		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);

		expect(await response.text()).toBe('replacement');
		expect(origin).toHaveBeenCalledTimes(2);
	});

	it('opens the injected named Cache API once and reuses it', async () => {
		const inner = new MemoryCache();
		const storage = { open: vi.fn(async () => inner) };
		const context = workContext();
		const cache = createCache(undefined, () => 1_000, { cacheStorage: storage });
		const origin = vi.fn(async () => html('named cache'));

		await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);
		await context.flush();
		await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin,
			context
		);

		expect(storage.open).toHaveBeenCalledOnce();
		expect(storage.open).toHaveBeenCalledWith(PUBLIC_DISCOVERY_CACHE_NAME);
		expect(origin).toHaveBeenCalledOnce();
	});

	it('coalesces concurrent named-cache opens per isolate', async () => {
		let releaseOpen!: (cache: TrustedCacheLike) => void;
		const inner = new MemoryCache();
		const storage = {
			open: vi.fn(
				() =>
					new Promise<TrustedCacheLike>((resolve) => {
						releaseOpen = resolve;
					})
			)
		};
		const context = workContext();
		const cache = createCache(undefined, () => 1_000, { cacheStorage: storage });
		const origin = vi.fn(async () => html('one open'));
		const request = () =>
			authorizedFetch(
				cache,
				new Request('https://commons.email/'),
				origin,
				context
			);

		const responses = [request(), request(), request()];
		await vi.waitFor(() => expect(storage.open).toHaveBeenCalledOnce());
		releaseOpen(inner);
		await Promise.all(responses);
		await context.flush();

		expect(storage.open).toHaveBeenCalledOnce();
		expect(origin).toHaveBeenCalledOnce();
	});

	it('bounds a wedged named-cache open, remembers failure, and retries without late mutation', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseLateOpen!: (cache: TrustedCacheLike) => void;
			const inner = new MemoryCache();
			const storage = {
				open: vi
					.fn<() => Promise<TrustedCacheLike>>()
					.mockImplementationOnce(
						() =>
							new Promise<TrustedCacheLike>((resolve) => {
								releaseLateOpen = resolve;
							})
					)
					.mockResolvedValueOnce(inner)
			};
			const cache = createCache(undefined, () => timestamp, { cacheStorage: storage });
			const origin = vi.fn(async () => html(`origin-${origin.mock.calls.length}`));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = request();
			await Promise.resolve();
			expect(storage.open).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(250);
			expect(await (await first).text()).toBe('origin-1');

			timestamp = 10_999;
			expect(await (await request()).text()).toBe('origin-1');
			expect(storage.open).toHaveBeenCalledOnce();
			expect(origin).toHaveBeenCalledOnce();

			// Even after the visible deadline and backoff, the unresolved raw open
			// remains quarantined instead of allowing overlapping Cache API opens.
			timestamp = 361_001;
			expect(await (await request()).text()).toBe('origin-2');
			expect(storage.open).toHaveBeenCalledOnce();

			// A late result from the timed-out operation is inert. Only after its raw
			// promise settles may a later L1 expiry admit the second open.
			releaseLateOpen(inner);
			await vi.advanceTimersByTimeAsync(0);
			timestamp = 721_002;
			expect(await (await request()).text()).toBe('origin-3');
			expect(storage.open).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('bounds a wedged cache lookup and fails open to the authorized origin', async () => {
		vi.useFakeTimers();
		try {
			let releaseLookup!: (response: Response | undefined) => void;
			const inner: TrustedCacheLike = {
				match: vi.fn(
					() =>
						new Promise<Response | undefined>((resolve) => {
							releaseLookup = resolve;
						})
				),
				put: vi.fn(async () => undefined)
			};
			const cache = createCache(inner);
			const origin = vi.fn(async () => html('lookup fail-open'));
			const response = authorizedFetch(
				cache,
				new Request('https://commons.email/'),
				origin
			);

			await vi.advanceTimersByTimeAsync(0);
			expect(inner.match).toHaveBeenCalledOnce();
			expect(origin).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cacheMatchTimeoutMs
			);
			expect(origin).toHaveBeenCalledOnce();
			expect(await (await response).text()).toBe('lookup fail-open');
			expect(inner.put).not.toHaveBeenCalled();

			// A lookup result arriving after fail-open cannot replace that response or
			// cause a cache write on behalf of the completed request.
			releaseLookup(html('late cache hit'));
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledOnce();
			expect(inner.put).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('cancels a cache response that arrives after the match deadline before reading its body', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseLookup!: (response: Response | undefined) => void;
			let settleCancellation!: () => void;
			const late = html('late cache hit');
			const lateBody = late.body!;
			const getReader = vi.spyOn(lateBody, 'getReader');
			const cancel = vi.spyOn(lateBody, 'cancel').mockImplementation(
				() =>
					new Promise<void>((resolve) => {
						settleCancellation = resolve;
					})
			);
			const inner: TrustedCacheLike = {
				match: vi
					.fn<() => Promise<Response | undefined>>()
					.mockImplementationOnce(
						() =>
							new Promise<Response | undefined>((resolve) => {
								releaseLookup = resolve;
							})
					)
					.mockResolvedValue(undefined),
				put: vi.fn(async () => undefined)
			};
			const cache = createCache(inner, () => timestamp);
			const origin = vi.fn(async () => html(`origin-${origin.mock.calls.length}`));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = request();
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cacheMatchTimeoutMs
			);
			expect(await (await first).text()).toBe('origin-1');
			releaseLookup(late);
			await vi.advanceTimersByTimeAsync(0);
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();

			timestamp = 361_001;
			expect(await (await request()).text()).toBe('origin-2');
			expect(inner.match).toHaveBeenCalledOnce();

			settleCancellation();
			await vi.advanceTimersByTimeAsync(0);
			timestamp = 721_002;
			expect(await (await request()).text()).toBe('origin-3');
			expect(inner.match).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('quarantines a cache hit whose headers resolve before its body and never overlaps the raw match', async () => {
		const seeded = new MemoryCache();
		const seedContext = workContext();
		const seedCache = createCache(seeded);
		await authorizedFetch(
			seedCache,
			new Request('https://commons.email/'),
			async () => html('seed'),
			seedContext
		);
		await seedContext.flush();
		const stored = seeded.entries.values().next().value;
		expect(stored).toBeDefined();

		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let settleMatchedCancellation!: () => void;
			const matchedBody = new ReadableStream<Uint8Array>({
				cancel() {
					return new Promise<void>((resolve) => {
						settleMatchedCancellation = resolve;
					});
				}
			});
			const streamingMatch = new Response(matchedBody, {
				headers: stored!.headers,
				status: stored!.status,
				statusText: stored!.statusText
			});
			const inner: TrustedCacheLike = {
				match: vi
					.fn<(request: Request) => Promise<Response | undefined>>()
					.mockResolvedValueOnce(streamingMatch)
					.mockResolvedValue(undefined),
				put: vi.fn(async () => undefined)
			};
			const cache = createCache(inner, () => timestamp);
			const origin = vi.fn(async () => html(`origin-${origin.mock.calls.length}`));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = request();
			await vi.advanceTimersByTimeAsync(0);
			expect(inner.match).toHaveBeenCalledOnce();
			expect(origin).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cacheMatchTimeoutMs
			);
			expect(await (await first).text()).toBe('origin-1');

			// Expire the fail-open L1. The header promise has resolved, but the raw
			// match still owns its pending body read and no second match may start.
			timestamp = 361_001;
			expect(await (await request()).text()).toBe('origin-2');
			expect(inner.match).toHaveBeenCalledOnce();
			expect(origin).toHaveBeenCalledTimes(2);

			settleMatchedCancellation();
			await vi.advanceTimersByTimeAsync(0);
			timestamp = 721_002;
			expect(await (await request()).text()).toBe('origin-3');
			expect(inner.match).toHaveBeenCalledTimes(2);
			expect(origin).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('coalesces concurrent cold misses until the first cache write settles', async () => {
		let releaseOrigin!: (response: Response) => void;
		let releaseWrite!: () => void;
		const entries = new Map<string, Response>();
		const inner: TrustedCacheLike = {
			match: vi.fn(async (request) => entries.get(request.url)?.clone()),
			put: vi.fn(async (request, response) => {
				await new Promise<void>((resolve) => {
					releaseWrite = resolve;
				});
				entries.set(request.url, response.clone());
			})
		};
		const context = workContext();
		const cache = createCache(inner);
		const origin = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					releaseOrigin = resolve;
				})
		);
		const request = () =>
			authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

		const cold = Array.from({ length: 24 }, () => request());
		await vi.waitFor(() => expect(origin).toHaveBeenCalledOnce());
		releaseOrigin(html('coalesced'));
		const coldResponses = await Promise.all(cold);
		await expect(Promise.all(coldResponses.map((response) => response.text()))).resolves.toEqual(
			Array.from({ length: 24 }, () => 'coalesced')
		);

		// Cache.put is still pending and match therefore still misses. The retained
		// flight must serve this arrival without a second Pages/SSR subrequest.
		const duringWrite = await request();
		expect(await duringWrite.text()).toBe('coalesced');
		expect(origin).toHaveBeenCalledOnce();
		expect(inner.put).toHaveBeenCalledOnce();

		releaseWrite();
		await context.flush();
		const hit = await request();
		expect(await hit.text()).toBe('coalesced');
		expect(origin).toHaveBeenCalledOnce();
	});

	it('serves the fresh L1 entry without repeating origin while its raw write is quarantined', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			const inner: TrustedCacheLike = {
				match: vi.fn(async () => undefined),
				put: vi.fn(() => new Promise<void>(() => undefined))
			};
			const cache = createCache(inner, () => timestamp);
			const origin = vi.fn(async () => html('origin-1'));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = await request();
			expect(await first.text()).toBe('origin-1');
			expect(first.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('miss');
			expect(origin).toHaveBeenCalledOnce();
			expect(inner.put).toHaveBeenCalledOnce();

			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);
			timestamp = 60_999;
			const repeated = await request();
			expect(await repeated.text()).toBe('origin-1');
			expect(repeated.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
			expect(origin).toHaveBeenCalledOnce();
			expect(inner.put).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('aborts a timed-out origin before admitting a recovery generation', async () => {
		vi.useFakeTimers();
		try {
			const inner = new MemoryCache();
			const cache = createCache(inner);
			let activeOrigins = 0;
			let maximumActiveOrigins = 0;
			const origin = vi.fn((signal?: AbortSignal) => {
				if (origin.mock.calls.length > 1) return Promise.resolve(html('recovered'));
				return new Promise<Response>((_resolve, reject) => {
					activeOrigins += 1;
					maximumActiveOrigins = Math.max(maximumActiveOrigins, activeOrigins);
					signal?.addEventListener(
						'abort',
						() => {
							activeOrigins -= 1;
							reject(new DOMException('origin deadline exceeded', 'AbortError'));
						},
						{ once: true }
					);
				});
			});
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const timedOut = request();
			const timedOutAssertion = expect(timedOut).rejects.toThrow(
				'origin exceeded its flight deadline'
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(activeOrigins).toBe(1);
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.coldMissFlightMaximumAgeMs
			);
			await timedOutAssertion;

			const recovered = await request();
			expect(await recovered.text()).toBe('recovered');
			expect(origin).toHaveBeenCalledTimes(2);
			expect(activeOrigins).toBe(0);
			expect(maximumActiveOrigins).toBe(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.maximumConcurrentRawOriginFetchesPerKeyAndIsolate
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not start a shared cold origin for an already-aborted first caller', async () => {
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(async () => html('live'));
		const aborted = new AbortController();
		aborted.abort(new Error('caller already left'));

		await expect(
			authorizedFetch(
				cache,
				new Request('https://commons.email/', { signal: aborted.signal }),
				origin
			)
		).rejects.toThrow('caller already left');
		expect(origin).not.toHaveBeenCalled();

		const live = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin
		);
		expect(await live.text()).toBe('live');
		expect(origin).toHaveBeenCalledOnce();
	});

	it('lets a legitimate cold-miss waiter survive when the first caller disconnects', async () => {
		let releaseOrigin!: (response: Response) => void;
		let sharedSignal: AbortSignal | undefined;
		const inner = new MemoryCache();
		const cache = createCache(inner);
		const origin = vi.fn(
			(signal?: AbortSignal) =>
				new Promise<Response>((resolve) => {
					sharedSignal = signal;
					releaseOrigin = resolve;
				})
		);
		const attackerController = new AbortController();
		const attacker = authorizedFetch(
			cache,
			new Request('https://commons.email/', { signal: attackerController.signal }),
			origin
		);
		const attackerAssertion = expect(attacker).rejects.toThrow('attacker disconnected');
		await vi.waitFor(() => expect(origin).toHaveBeenCalledOnce());

		const legitimate = authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			origin
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		attackerController.abort(new Error('attacker disconnected'));
		await attackerAssertion;
		expect(sharedSignal?.aborted).toBe(false);
		expect(origin).toHaveBeenCalledOnce();

		releaseOrigin(html('shared-success'));
		expect(await (await legitimate).text()).toBe('shared-success');
		expect(origin).toHaveBeenCalledOnce();
	});

	it('quarantines an origin that ignores abort without admitting another origin', async () => {
		vi.useFakeTimers();
		try {
			const inner: TrustedCacheLike = {
				match: vi.fn(async () => undefined),
				put: vi.fn(async () => undefined)
			};
			const cache = createCache(inner);
			const origin = vi.fn((_signal?: AbortSignal) => new Promise<Response>(() => undefined));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin);

			const first = request();
			const firstAssertion = expect(first).rejects.toThrow(
				'origin exceeded its flight deadline'
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.coldMissFlightMaximumAgeMs
			);
			await firstAssertion;

			await expect(request()).rejects.toThrow('origin exceeded its flight deadline');
			await vi.advanceTimersByTimeAsync(10_000);
			await expect(request()).rejects.toThrow('origin exceeded its flight deadline');
			expect(origin).toHaveBeenCalledOnce();
			expect(inner.put).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('quarantines fast origin headers until the raw body settles while waitUntil drains', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let settleOriginCancellation!: () => void;
			let stalledSignal: AbortSignal | undefined;
			const stalledBody = new ReadableStream<Uint8Array>({
				cancel() {
					return new Promise<void>((resolve) => {
						settleOriginCancellation = resolve;
					});
				}
			});
			const inner = new MemoryCache();
			const context = workContext();
			const cache = createCache(inner, () => timestamp);
			const origin = vi.fn((signal?: AbortSignal) => {
				if (origin.mock.calls.length === 1) return Promise.resolve(html('baseline'));
				if (origin.mock.calls.length === 2) {
					stalledSignal = signal;
					return Promise.resolve(
						new Response(stalledBody, {
							headers: { 'content-type': 'text/html; charset=utf-8' }
						})
					);
				}
				return Promise.resolve(html('recovered'));
			});
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

			expect(await (await request()).text()).toBe('baseline');
			await context.flush();
			timestamp = 61_000;
			const stale = await request();
			expect(await stale.text()).toBe('baseline');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(2);
			expect(stalledSignal?.aborted).toBe(false);

			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.originFetchTimeoutMs
			);
			expect(stalledSignal?.aborted).toBe(true);
			// The revalidation observation is bounded even though the direct body
			// read is still pending inside the quarantined raw origin promise.
			await context.flush();

			timestamp = 62_001;
			expect(await (await request()).text()).toBe('baseline');
			await context.flush();
			expect(origin).toHaveBeenCalledTimes(2);
			expect(inner.put).toHaveBeenCalledOnce();

			settleOriginCancellation();
			await vi.advanceTimersByTimeAsync(0);
			timestamp = 63_001;
			expect(await (await request()).text()).toBe('baseline');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(3);
			await context.flush();
			timestamp = 63_002;
			expect(await (await request()).text()).toBe('recovered');
		} finally {
			vi.useRealTimers();
		}
	});

	it('updates stale L1 while a newer raw write waits, then drains it after the older write settles', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseFirstWrite!: () => void;
			let putCalls = 0;
			const entries = new Map<string, Response>();
			const inner: TrustedCacheLike = {
				match: vi.fn(async (request) => entries.get(request.url)?.clone()),
				put: vi.fn(async (request, response) => {
					putCalls += 1;
					const retained = response.clone();
					if (putCalls === 1) {
						await new Promise<void>((resolve) => {
							releaseFirstWrite = resolve;
						});
					}
					entries.set(request.url, retained);
				})
			};
			const context = workContext();
			const cache = createCache(inner, () => timestamp);
			const origin = vi
				.fn<() => Promise<Response>>()
				.mockResolvedValueOnce(html('origin-1'))
				.mockResolvedValueOnce(html('origin-2'));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

			expect(await (await request()).text()).toBe('origin-1');
			expect(inner.put).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);

			timestamp = 61_000;
			const stale = await request();
			expect(await stale.text()).toBe('origin-1');
			expect(stale.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('stale');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(2);
			expect(inner.put).toHaveBeenCalledOnce();

			timestamp = 61_001;
			const memoryHit = await request();
			expect(await memoryHit.text()).toBe('origin-2');
			expect(memoryHit.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
			expect(origin).toHaveBeenCalledTimes(2);

			// Caller-facing/writeUntil observation has expired, but the raw same-key
			// put is still the quarantine authority and B cannot start yet.
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);
			await context.flush();
			expect(inner.put).toHaveBeenCalledOnce();

			releaseFirstWrite();
			await vi.advanceTimersByTimeAsync(0);
			expect(inner.put).toHaveBeenCalledTimes(2);
			const stored = entries.values().next().value;
			expect(stored).toBeDefined();
			expect(await stored!.text()).toBe('origin-2');
		} finally {
			vi.useRealTimers();
		}
	});

	it('retains only the newest cacheable pending write behind a quarantined active write', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseFirstWrite!: () => void;
			let putCalls = 0;
			const entries = new Map<string, Response>();
			const inner: TrustedCacheLike = {
				match: vi.fn(async (request) => entries.get(request.url)?.clone()),
				put: vi.fn(async (request, response) => {
					putCalls += 1;
					const retained = response.clone();
					if (putCalls === 1) {
						await new Promise<void>((resolve) => {
							releaseFirstWrite = resolve;
						});
					}
					entries.set(request.url, retained);
				})
			};
			const context = workContext();
			const cache = createCache(inner, () => timestamp);
			const origin = vi
				.fn<() => Promise<Response>>()
				.mockResolvedValueOnce(html('origin-1'))
				.mockResolvedValueOnce(html('origin-2'))
				.mockResolvedValueOnce(html('origin-3'));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

			expect(await (await request()).text()).toBe('origin-1');
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);
			timestamp = 61_000;
			expect(await (await request()).text()).toBe('origin-1');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(2);
			timestamp = 61_001;
			const submittedPending = await request();
			expect(await submittedPending.text()).toBe('origin-2');
			expect(submittedPending.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.coldMissFlightMaximumAgeMs
			);

			timestamp = 121_000;
			expect(await (await request()).text()).toBe('origin-2');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(3);
			expect(inner.put).toHaveBeenCalledOnce();

			timestamp = 121_001;
			const latestMemory = await request();
			expect(await latestMemory.text()).toBe('origin-3');
			expect(latestMemory.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');

			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);
			await context.flush();
			expect(inner.put).toHaveBeenCalledOnce();
			releaseFirstWrite();
			await vi.advanceTimersByTimeAsync(0);
			expect(inner.put).toHaveBeenCalledTimes(2);
			const stored = entries.values().next().value;
			expect(stored).toBeDefined();
			expect(await stored!.text()).toBe('origin-3');
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not displace a cacheable pending write with a newer uncacheable origin', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseFirstWrite!: () => void;
			let putCalls = 0;
			const entries = new Map<string, Response>();
			const inner: TrustedCacheLike = {
				match: vi.fn(async (request) => entries.get(request.url)?.clone()),
				put: vi.fn(async (request, response) => {
					putCalls += 1;
					const retained = response.clone();
					if (putCalls === 1) {
						await new Promise<void>((resolve) => {
							releaseFirstWrite = resolve;
						});
					}
					entries.set(request.url, retained);
				})
			};
			const context = workContext();
			const cache = createCache(inner, () => timestamp);
			const origin = vi
				.fn<() => Promise<Response>>()
				.mockResolvedValueOnce(html('origin-1'))
				.mockResolvedValueOnce(html('origin-2'))
				.mockResolvedValueOnce(
					new Response('uncacheable', {
						headers: { 'content-type': 'text/html; charset=utf-8' },
						status: 503
					})
				);
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

			expect(await (await request()).text()).toBe('origin-1');
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cachePutTimeoutMs
			);
			timestamp = 61_000;
			expect(await (await request()).text()).toBe('origin-1');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(2);
			timestamp = 61_001;
			const submittedPending = await request();
			expect(await submittedPending.text()).toBe('origin-2');
			expect(submittedPending.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.coldMissFlightMaximumAgeMs
			);

			timestamp = 121_000;
			const staleAfterPending = await request();
			expect(await staleAfterPending.text()).toBe('origin-2');
			expect(staleAfterPending.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe(
				'stale'
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(3);
			expect(inner.put).toHaveBeenCalledOnce();

			await context.flush();
			expect(inner.put).toHaveBeenCalledOnce();
			releaseFirstWrite();
			await vi.advanceTimersByTimeAsync(0);
			expect(inner.put).toHaveBeenCalledTimes(2);
			const stored = entries.values().next().value;
			expect(stored).toBeDefined();
			expect(await stored!.text()).toBe('origin-2');
		} finally {
			vi.useRealTimers();
		}
	});

	it('cannot let an ancient stale revalidation reset the hard retention ceiling', async () => {
		vi.useFakeTimers();
		try {
			let timestamp = 1_000;
			let releaseAncientRevalidation!: (response: Response) => void;
			const inner = new MemoryCache();
			const context = workContext();
			const cache = createCache(inner, () => timestamp);
			const origin = vi
				.fn<() => Promise<Response>>()
				.mockResolvedValueOnce(html('baseline'))
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							releaseAncientRevalidation = resolve;
						})
				)
				.mockResolvedValueOnce(html('current-after-ceiling'));
			const request = () =>
				authorizedFetch(cache, new Request('https://commons.email/'), origin, context);

			await request();
			await context.flush();
			timestamp = 61_000;
			const stale = await request();
			expect(await stale.text()).toBe('baseline');
			await vi.advanceTimersByTimeAsync(0);
			expect(origin).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.coldMissFlightMaximumAgeMs
			);

			// The aborted wrapper is no longer response authority, but a raw origin
			// that ignored abort remains quarantined until it actually settles.
			releaseAncientRevalidation(html('ancient-revalidation'));
			await vi.advanceTimersByTimeAsync(0);

			timestamp = 1_000_000;
			const currentRequest = request();
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.cacheMatchTimeoutMs
			);
			const current = await currentRequest;
			expect(await current.text()).toBe('current-after-ceiling');
			expect(origin).toHaveBeenCalledTimes(3);

			await context.flush();
			const next = await request();
			expect(await next.text()).toBe('current-after-ceiling');
			expect(next.headers.get(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER)).toBe('hit');
			// The expired cloned mock response keeps cancellation pending, so this
			// generation intentionally fails open to L1 without another raw cache put.
			expect(inner.put).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(['unavailable', 'open throws', 'match throws'] as const)(
		'fails open to the authorized origin when the cache is %s',
		async (failure) => {
			const origin = vi.fn(async () => html('available'));
			let cache;
			if (failure === 'unavailable') {
				cache = createCache(undefined);
			} else if (failure === 'open throws') {
				cache = createCache(undefined, () => 1_000, {
					cacheStorage: { open: vi.fn(async () => Promise.reject(new Error('down'))) }
				});
			} else {
				cache = createCache({
					match: vi.fn(async () => Promise.reject(new Error('down'))),
					put: vi.fn(async () => undefined)
				});
			}

			const response = await authorizedFetch(
				cache,
				new Request('https://commons.email/'),
				origin
			);

			expect(await response.text()).toBe('available');
			expect(response.headers.get('cache-control')).toBe(
				'public, max-age=60, stale-while-revalidate=300'
			);
			expect(origin).toHaveBeenCalledOnce();
		}
	);

	it('does not fail the authorized response when a cache write rejects', async () => {
		const inner = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async () => Promise.reject(new Error('write failed')))
		};
		const context = workContext();
		const cache = createCache(inner);

		const response = await authorizedFetch(
			cache,
			new Request('https://commons.email/'),
			async () => html('still available'),
			context
		);
		await context.flush();

		expect(await response.text()).toBe('still available');
		expect(response.status).toBe(200);
	});

	it('publishes the exact cost policy constants used by headers and expiry', () => {
		expect(TRUSTED_PAGES_RELEASE_CACHE_POLICY).toEqual({
			cacheName: 'commons-public-discovery',
			cacheMatchFailureMemoryMs: 10_000,
			cacheMatchTimeoutMs: 250,
			cacheOpenFailureMemoryMs: 10_000,
			cacheOpenTimeoutMs: 250,
			cachePutTimeoutMs: 1_000,
			cacheTag: 'public-discovery',
			cacheStatusHeader: 'x-commons-public-discovery-cache',
			cacheWriteOrdering: 'generation-start-serialized-latest-cacheable-pending',
			cacheWriteQueueAdmission: 'cacheable-submit-only',
			coldMissFlightMaximumAgeMs: 1_000,
			freshSeconds: 60,
			lateCacheMatchDisposition: 'cancel-and-ignore',
			maximumConcurrentCacheMatchesPerKeyAndIsolate: 1,
			maximumConcurrentCacheOpensPerIsolate: 1,
			maximumConcurrentCachePutsPerKeyAndIsolate: 1,
			maximumConcurrentRawCacheOpensPerIsolate: 1,
			maximumConcurrentRawOriginFetchesPerKeyAndIsolate: 1,
			maximumEligibleOriginResponseBytes: 1_048_576,
			maximumPendingCacheWritesPerKeyAndIsolate: 1,
			maximumPublicationLagSeconds: 360,
			maximumResponseBodyChunksPerMaterialization: 4_096,
			maximumRetainedOriginResponseBytesPerKeyAndIsolate: 1_048_576,
			maximumRetainedOriginResponsesPerKeyAndIsolate: 1,
			originFetchTimeoutMs: 1_000,
			responseBodyYieldInterval: 64,
			retentionSeconds: 360,
			staleWhileRevalidateSeconds: 300,
			storedAtAuthority: 'origin-flight-start',
			timedOutCacheOpenDisposition: 'ignore-then-quarantine-until-raw-settlement',
			timedOutCachePutDisposition: 'quarantine-until-raw-settlement',
			timedOutOriginDisposition: 'abort-then-quarantine'
		});
	});
});
