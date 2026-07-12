/**
 * Edge cache for anonymous public-discovery data.
 *
 * Cloudflare's Cache API is available to Pages Functions without another
 * binding or paid service. It is data-centre local, so the small in-isolate
 * cache below also coalesces concurrent misses while `caches.default` absorbs
 * later requests handled by the same Cloudflare location.
 *
 * Only already-public Convex query results belong here. Never use this helper
 * for responses that depend on cookies, auth, or other request identity.
 */

const CACHE_SCHEMA_VERSION = 'v1';

/** Refresh public discovery data at most once every six hours per edge cache. */
export const PUBLIC_DISCOVERY_FRESH_MS = 6 * 60 * 60 * 1000;

/** Keep a last-known-good value through a multi-day Convex outage. */
const PUBLIC_DISCOVERY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Do not retry a failed stale refresh on every anonymous request. */
const PUBLIC_DISCOVERY_RETRY_MS = 15 * 60 * 1000;

type CacheEnvelope<T> = {
	cachedAt: number;
	retryAfter?: number;
	value: T;
};

type CacheContext = {
	url: URL;
	platform?: App.Platform;
	freshForMs?: number;
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

const memoryCache = new Map<string, CacheEnvelope<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function cacheKey(logicalKey: string, url: URL): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(logicalKey)}`;
	return new Request(keyUrl, { method: 'GET' });
}

function defaultCloudflareCache(): Cache | undefined {
	if (typeof caches === 'undefined') return undefined;
	return (caches as CloudflareCacheStorage).default;
}

function parseEnvelope<T>(raw: unknown): CacheEnvelope<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<CacheEnvelope<T>>;
	if (typeof candidate.cachedAt !== 'number' || !('value' in candidate)) return null;
	return candidate as CacheEnvelope<T>;
}

async function readEdge<T>(key: Request): Promise<CacheEnvelope<T> | null> {
	const cache = defaultCloudflareCache();
	if (!cache) return null;

	try {
		const response = await cache.match(key);
		if (!response) return null;
		return parseEnvelope<T>(await response.json());
	} catch (error) {
		console.warn(
			'[public-discovery-cache] edge read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

function persistEdge<T>(
	key: Request,
	envelope: CacheEnvelope<T>,
	platform?: App.Platform
): Promise<void> {
	const cache = defaultCloudflareCache();
	if (!cache) return Promise.resolve();

	const write = cache
		.put(
			key,
			new Response(JSON.stringify(envelope), {
				headers: {
					'Cache-Control': `public, max-age=${Math.floor(PUBLIC_DISCOVERY_STALE_MS / 1000)}`,
					'Content-Type': 'application/json'
				}
			})
		)
		.catch((error) => {
			console.warn(
				'[public-discovery-cache] edge write failed:',
				error instanceof Error ? error.message : String(error)
			);
		});

	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(write);
		return Promise.resolve();
	}

	return write;
}

function loadAndCache<T>(
	logicalKey: string,
	requestKey: Request,
	platform: App.Platform | undefined,
	loader: () => Promise<T>
): Promise<T> {
	const existing = inFlight.get(logicalKey) as Promise<T> | undefined;
	if (existing) return existing;

	const pending = loader()
		.then(async (value) => {
			const envelope: CacheEnvelope<T> = { cachedAt: Date.now(), value };
			memoryCache.set(logicalKey, envelope);
			await persistEdge(requestKey, envelope, platform);
			return value;
		})
		.finally(() => {
			inFlight.delete(logicalKey);
		});

	inFlight.set(logicalKey, pending);
	return pending;
}

function refreshInBackground<T>(
	logicalKey: string,
	requestKey: Request,
	platform: App.Platform | undefined,
	staleEnvelope: CacheEnvelope<T>,
	loader: () => Promise<T>
): void {
	const refresh = loadAndCache(logicalKey, requestKey, platform, loader).catch(async (error) => {
		// Keep serving the last-known-good entry. A failed refresh must never
		// replace public content with an outage-shaped empty response. Persist a
		// short retry backoff too, otherwise a disabled Convex team would receive
		// one doomed refresh from every anonymous request after the soft TTL.
		const backedOff = {
			...staleEnvelope,
			retryAfter: Date.now() + PUBLIC_DISCOVERY_RETRY_MS
		};
		memoryCache.set(logicalKey, backedOff);
		await persistEdge(requestKey, backedOff);
		console.warn(
			'[public-discovery-cache] background refresh failed:',
			error instanceof Error ? error.message : String(error)
		);
	});
	platform?.context?.waitUntil(refresh);
}

/**
 * Return cached anonymous data, loading it once on a cold miss.
 *
 * Fresh entries return immediately. Stale-but-valid entries also return
 * immediately and refresh in the background; if Convex is unavailable, the
 * last-known-good response remains available for up to seven days.
 */
export async function getCachedPublicData<T>(
	logicalKey: string,
	context: CacheContext,
	loader: () => Promise<T>
): Promise<T> {
	const freshForMs = context.freshForMs ?? PUBLIC_DISCOVERY_FRESH_MS;
	const now = Date.now();
	const requestKey = cacheKey(logicalKey, context.url);

	let envelope = memoryCache.get(logicalKey) as CacheEnvelope<T> | undefined;
	if (!envelope) {
		envelope = (await readEdge<T>(requestKey)) ?? undefined;
		if (envelope) memoryCache.set(logicalKey, envelope);
	}

	if (envelope) {
		const age = now - envelope.cachedAt;
		if (age <= freshForMs) return envelope.value;
		if (age <= PUBLIC_DISCOVERY_STALE_MS) {
			if ((envelope.retryAfter ?? 0) <= now) {
				refreshInBackground(logicalKey, requestKey, context.platform, envelope, loader);
			}
			return envelope.value;
		}
		memoryCache.delete(logicalKey);
	}

	return loadAndCache(logicalKey, requestKey, context.platform, loader);
}

/** Test-only reset for module-local state. */
export function clearPublicDiscoveryCache(): void {
	memoryCache.clear();
	inFlight.clear();
}
