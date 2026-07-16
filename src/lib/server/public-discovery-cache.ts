/**
 * Two-level cache for anonymous public-discovery data.
 *
 * `caches.default` is the free, data-centre-local hot layer. The optional
 * `PUBLIC_DISCOVERY_KV` binding is the global source shield and last-known-good
 * layer: a cold Cloudflare location can hydrate from KV instead of making its
 * own Convex snapshot read. Both layers contain public data only.
 *
 * Callers may supply a materialization revision. A matching revision can live
 * for the full stale window; a changed revision refreshes synchronously and
 * atomically replaces the cached value. If that refresh fails, the prior
 * revision remains available with a retry backoff.
 */

const CACHE_SCHEMA_VERSION = 'v2';

/** Safety revalidation for callers that do not provide a materialization revision. */
export const PUBLIC_DISCOVERY_FRESH_MS = 6 * 60 * 60 * 1000;

/** Revision manifests are tiny and bound landing-page propagation delay. */
export const PUBLIC_DISCOVERY_MANIFEST_FRESH_MS = 60 * 1000;

/** A revisioned payload is immutable until its manifest revision changes. */
export const PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/** Keep a last-known-good value through a multi-day Convex outage. */
const PUBLIC_DISCOVERY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Renew an unchanged global last-known-good envelope at most once per day. */
const PUBLIC_DISCOVERY_KV_REVALIDATE_MS = 24 * 60 * 60 * 1000;

/** Do not retry a failed stale or revision refresh on every anonymous request. */
const PUBLIC_DISCOVERY_RETRY_MS = 15 * 60 * 1000;

type CacheEnvelope<T> = {
	cachedAt: number;
	globalCachedAt?: number;
	retryAfter?: number;
	revision?: string;
	value: T;
};

type CacheContext = {
	url: URL;
	platform?: App.Platform;
	freshForMs?: number;
	revision?: number | string;
	refreshMode?: 'background' | 'blocking';
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

const memoryCache = new Map<string, CacheEnvelope<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function storageIdentity(logicalKey: string, url: URL): string {
	return `${url.origin}|${logicalKey}`;
}

function edgeCacheKey(logicalKey: string, url: URL): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(logicalKey)}`;
	return new Request(keyUrl, { method: 'GET' });
}

function kvCacheKey(logicalKey: string, url: URL): string {
	return `public-discovery:${CACHE_SCHEMA_VERSION}:${url.hostname}:${encodeURIComponent(logicalKey)}`;
}

function defaultCloudflareCache(): Cache | undefined {
	if (typeof caches === 'undefined') return undefined;
	return (caches as CloudflareCacheStorage).default;
}

function publicDiscoveryKv(platform?: App.Platform): KVNamespace | undefined {
	return platform?.env?.PUBLIC_DISCOVERY_KV;
}

function parseEnvelope<T>(raw: unknown): CacheEnvelope<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<CacheEnvelope<T>>;
	if (typeof candidate.cachedAt !== 'number' || !('value' in candidate)) return null;
	if (candidate.globalCachedAt !== undefined && typeof candidate.globalCachedAt !== 'number') {
		return null;
	}
	if (candidate.revision !== undefined && typeof candidate.revision !== 'string') return null;
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

async function readKv<T>(key: string, platform?: App.Platform): Promise<CacheEnvelope<T> | null> {
	const kv = publicDiscoveryKv(platform);
	if (!kv) return null;

	try {
		return parseEnvelope<T>(await kv.get(key, 'json'));
	} catch (error) {
		console.warn(
			'[public-discovery-cache] KV read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

function persistEdge<T>(key: Request, envelope: CacheEnvelope<T>): Promise<void> {
	const cache = defaultCloudflareCache();
	if (!cache) return Promise.resolve();

	return cache
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
}

function persistKv<T>(
	key: string,
	envelope: CacheEnvelope<T>,
	platform?: App.Platform
): Promise<void> {
	const kv = publicDiscoveryKv(platform);
	if (!kv) return Promise.resolve();

	return kv.put(key, JSON.stringify(envelope)).catch((error) => {
		console.warn(
			'[public-discovery-cache] KV write failed:',
			error instanceof Error ? error.message : String(error)
		);
	});
}

function persistEnvelope<T>(
	edgeKey: Request,
	kvKey: string,
	envelope: CacheEnvelope<T>,
	platform?: App.Platform,
	writeKv = true
): Promise<void> {
	if (!defaultCloudflareCache() && (!writeKv || !publicDiscoveryKv(platform))) {
		return Promise.resolve();
	}

	const write = Promise.all([
		persistEdge(edgeKey, envelope),
		writeKv ? persistKv(kvKey, envelope, platform) : Promise.resolve()
	]).then(() => undefined);

	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(write);
		return Promise.resolve();
	}

	return write;
}

function newestEnvelope<T>(
	...candidates: Array<CacheEnvelope<T> | null | undefined>
): CacheEnvelope<T> | undefined {
	return candidates
		.filter(
			(candidate): candidate is CacheEnvelope<T> => candidate !== null && candidate !== undefined
		)
		.sort((a, b) => b.cachedAt - a.cachedAt)[0];
}

async function readCachedEnvelope<T>(
	identity: string,
	edgeKey: Request,
	kvKey: string,
	platform: App.Platform | undefined,
	refreshSharedLayers: boolean
): Promise<CacheEnvelope<T> | undefined> {
	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	if (inMemory && !refreshSharedLayers) return inMemory;

	const [edge, global] = await Promise.all([readEdge<T>(edgeKey), readKv<T>(kvKey, platform)]);
	const envelope = newestEnvelope(inMemory, edge, global);
	if (!envelope) return undefined;

	memoryCache.set(identity, envelope);
	// A KV hit in a cold location should warm its local free hot layer.
	if (global && envelope === global && (!edge || edge.cachedAt < global.cachedAt)) {
		const warm = persistEdge(edgeKey, global);
		if (platform?.context?.waitUntil) platform.context.waitUntil(warm);
	}
	return envelope;
}

function loadAndCache<T>(
	identity: string,
	edgeKey: Request,
	kvKey: string,
	platform: App.Platform | undefined,
	revision: string | undefined,
	loader: () => Promise<T>,
	previousEnvelope?: CacheEnvelope<T>
): Promise<T> {
	const flightKey = `${identity}@${revision ?? 'unversioned'}`;
	const existing = inFlight.get(flightKey) as Promise<T> | undefined;
	if (existing) return existing;

	const pending = loader()
		.then(async (value) => {
			const now = Date.now();
			const valueUnchanged =
				previousEnvelope !== undefined &&
				previousEnvelope.revision === revision &&
				JSON.stringify(previousEnvelope.value) === JSON.stringify(value);
			// Older v2 envelopes predate `globalCachedAt`; their `cachedAt` is the
			// best conservative approximation of the last successful KV write.
			const lastGlobalWrite = previousEnvelope?.globalCachedAt ?? previousEnvelope?.cachedAt ?? 0;
			const writeKv =
				publicDiscoveryKv(platform) !== undefined &&
				(!valueUnchanged || now - lastGlobalWrite >= PUBLIC_DISCOVERY_KV_REVALIDATE_MS);
			const envelope: CacheEnvelope<T> = {
				cachedAt: now,
				...(writeKv
					? { globalCachedAt: now }
					: previousEnvelope?.globalCachedAt !== undefined
						? { globalCachedAt: previousEnvelope.globalCachedAt }
						: {}),
				revision,
				value
			};
			memoryCache.set(identity, envelope);
			await persistEnvelope(edgeKey, kvKey, envelope, platform, writeKv);
			return value;
		})
		.finally(() => {
			inFlight.delete(flightKey);
		});

	inFlight.set(flightKey, pending);
	return pending;
}

async function backOffEnvelope<T>(
	identity: string,
	edgeKey: Request,
	kvKey: string,
	platform: App.Platform | undefined,
	envelope: CacheEnvelope<T>,
	error: unknown,
	reason: 'background refresh' | 'revision refresh' | 'stale refresh'
): Promise<void> {
	const backedOff = {
		...envelope,
		retryAfter: Date.now() + PUBLIC_DISCOVERY_RETRY_MS
	};
	memoryCache.set(identity, backedOff);
	// A local retry backoff must not overwrite the global last-known-good value
	// or consume one KV write per Cloudflare location during an origin outage.
	await persistEnvelope(edgeKey, kvKey, backedOff, platform, false);
	console.warn(
		`[public-discovery-cache] ${reason} failed:`,
		error instanceof Error ? error.message : String(error)
	);
}

function refreshInBackground<T>(
	identity: string,
	edgeKey: Request,
	kvKey: string,
	platform: App.Platform | undefined,
	revision: string | undefined,
	staleEnvelope: CacheEnvelope<T>,
	loader: () => Promise<T>
): void {
	const refresh = loadAndCache(
		identity,
		edgeKey,
		kvKey,
		platform,
		revision,
		loader,
		staleEnvelope
	).catch((error) =>
		backOffEnvelope(identity, edgeKey, kvKey, platform, staleEnvelope, error, 'background refresh')
	);
	platform?.context?.waitUntil(refresh);
}

/**
 * Return cached anonymous data, loading it once on a cold miss.
 *
 * With `context.revision`, the cache is content-aware: a matching generation is
 * reused, while a different generation is loaded synchronously. A failed
 * generation transition serves the prior last-known-good value and backs off.
 */
export async function getCachedPublicData<T>(
	logicalKey: string,
	context: CacheContext,
	loader: () => Promise<T>
): Promise<T> {
	const freshForMs = context.freshForMs ?? PUBLIC_DISCOVERY_FRESH_MS;
	const now = Date.now();
	const revision = context.revision === undefined ? undefined : String(context.revision);
	const identity = storageIdentity(logicalKey, context.url);
	const edgeKey = edgeCacheKey(logicalKey, context.url);
	const kvKey = kvCacheKey(logicalKey, context.url);

	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	const inMemoryAge = inMemory ? now - inMemory.cachedAt : Number.POSITIVE_INFINITY;
	const inMemoryRevisionMatches = inMemory?.revision === revision;
	const refreshSharedLayers = !inMemory || inMemoryAge > freshForMs || !inMemoryRevisionMatches;
	const envelope = await readCachedEnvelope<T>(
		identity,
		edgeKey,
		kvKey,
		context.platform,
		refreshSharedLayers
	);

	if (envelope) {
		const age = now - envelope.cachedAt;
		const revisionMatches = envelope.revision === revision;

		if (revisionMatches && age <= freshForMs) return envelope.value;

		if (age <= PUBLIC_DISCOVERY_STALE_MS) {
			if ((envelope.retryAfter ?? 0) > now) return envelope.value;

			if (!revisionMatches) {
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						kvKey,
						context.platform,
						revision,
						loader,
						envelope
					);
				} catch (error) {
					await backOffEnvelope(
						identity,
						edgeKey,
						kvKey,
						context.platform,
						envelope,
						error,
						'revision refresh'
					);
					return envelope.value;
				}
			}

			if (context.refreshMode === 'blocking') {
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						kvKey,
						context.platform,
						revision,
						loader,
						envelope
					);
				} catch (error) {
					await backOffEnvelope(
						identity,
						edgeKey,
						kvKey,
						context.platform,
						envelope,
						error,
						'stale refresh'
					);
					return envelope.value;
				}
			}

			refreshInBackground(identity, edgeKey, kvKey, context.platform, revision, envelope, loader);
			return envelope.value;
		}

		memoryCache.delete(identity);
	}

	return loadAndCache(identity, edgeKey, kvKey, context.platform, revision, loader);
}

/** Test-only reset for module-local state. */
export function clearPublicDiscoveryCache(): void {
	memoryCache.clear();
	inFlight.clear();
}
