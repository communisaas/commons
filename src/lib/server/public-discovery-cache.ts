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

// v5 is a privacy boundary: v4 list/relation envelopes predate the exhaustive
// consumer allowlists and must never be selected after that contract shipped.
const CACHE_SCHEMA_VERSION = 'v5';

/** Safety revalidation for callers that do not provide a materialization revision. */
export const PUBLIC_DISCOVERY_FRESH_MS = 6 * 60 * 60 * 1000;

/** Revision manifests are tiny and bound landing-page propagation delay. */
export const PUBLIC_DISCOVERY_MANIFEST_FRESH_MS = 60 * 1000;

/** Revalidate immutable payloads daily so their global LKG lease keeps rolling. */
export const PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS = 24 * 60 * 60 * 1000;

/** Keep a last-known-good value through a multi-day Convex outage. */
const PUBLIC_DISCOVERY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Retain KV data slightly beyond the application-level LKG window. */
export const PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS = 8 * 24 * 60 * 60;

/** Renew an unchanged global last-known-good envelope at most once per day. */
const PUBLIC_DISCOVERY_KV_REVALIDATE_MS = 24 * 60 * 60 * 1000;

/** Do not retry a failed stale or revision refresh on every anonymous request. */
const PUBLIC_DISCOVERY_RETRY_MS = 15 * 60 * 1000;

/** One bounded KV page is the hard ceiling for a global generation check. */
const PUBLIC_DISCOVERY_KV_LIST_LIMIT = 1000;

/** Hard isolate-local bounds; logical keys are fixed by trusted server callers. */
export const PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES = 64;
export const PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES = 256;

/**
 * Re-check a pointer-selected outage fallback often enough to prevent a stale
 * isolate from pinning it, while staying inside Workers KV's small Free-plan
 * list allowance. Once the Cache API lease is visible, one check per hot
 * logical key and edge location is shared through the pointer during each
 * daily payload-renewal window. Concurrent first-wave isolates can race before
 * that non-atomic marker is published; the invariant document models that C
 * multiplier explicitly.
 */
const PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS = PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS;

type CacheEnvelope<T> = {
	cachedAt: number;
	globalCachedAt?: number;
	latestRevisionCheckedAt?: number;
	latestRevisionRetryAt?: number;
	retryAfter?: number;
	retryRevision?: string;
	revision?: string;
	value: T;
};

type CacheContext = {
	url: URL;
	platform?: App.Platform;
	freshForMs?: number;
	forceRefresh?: boolean;
	revision?: number | string;
	refreshMode?: 'background' | 'blocking';
	shouldFallbackToStale?: (error: unknown) => boolean;
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

const memoryCache = new Map<string, CacheEnvelope<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const latestRequestedRevision = new Map<string, string>();
const latestRevisionRetryAfter = new Map<string, number>();

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
	// Delete first so an update becomes the newest entry in insertion order.
	map.delete(key);
	map.set(key, value);
	while (map.size > maxEntries) {
		const oldest = map.keys().next();
		if (oldest.done) break;
		map.delete(oldest.value);
	}
}

function setMemoryEnvelope<T>(identity: string, envelope: CacheEnvelope<T>): void {
	setBoundedMap(memoryCache, identity, envelope, PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES);
}

function configuredBackend(platform?: App.Platform): string | undefined {
	const configured = platform?.env?.PUBLIC_CONVEX_URL;
	if (typeof configured !== 'string' || configured.length === 0) return undefined;
	try {
		return new URL(configured).origin.toLowerCase();
	} catch {
		return undefined;
	}
}

function cacheScope(url: URL, platform?: App.Platform): string {
	const backend = configuredBackend(platform);
	return backend ? `backend=${backend}` : `origin=${url.origin.toLowerCase()}`;
}

function storageIdentity(logicalKey: string, url: URL, platform?: App.Platform): string {
	return `${url.origin}|${cacheScope(url, platform)}|${logicalKey}`;
}

function edgeCacheKey(
	logicalKey: string,
	url: URL,
	platform?: App.Platform,
	revision?: string
): Request {
	const keyUrl = new URL(url.origin);
	const revisionPath = revision === undefined ? '' : `/revision=${encodeURIComponent(revision)}`;
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(cacheScope(url, platform))}/${encodeURIComponent(logicalKey)}${revisionPath}`;
	return new Request(keyUrl, { method: 'GET' });
}

function edgeLkgPointerKey(logicalKey: string, url: URL, platform?: App.Platform): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(cacheScope(url, platform))}/${encodeURIComponent(logicalKey)}/lkg-pointer`;
	return new Request(keyUrl, { method: 'GET' });
}

function edgeRevisionRetryKey(
	logicalKey: string,
	url: URL,
	platform: App.Platform | undefined,
	revision: string
): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(cacheScope(url, platform))}/${encodeURIComponent(logicalKey)}/revision-retry=${encodeURIComponent(revision)}`;
	return new Request(keyUrl, { method: 'GET' });
}

function kvCacheKey(logicalKey: string, url: URL, platform?: App.Platform): string {
	return `public-discovery:${CACHE_SCHEMA_VERSION}:${encodeURIComponent(cacheScope(url, platform))}:${encodeURIComponent(logicalKey)}`;
}

function kvRevisionPrefix(kvKey: string): string {
	return `${kvKey}:revision=`;
}

function kvRevisionKey(kvKey: string, revision: string): string {
	return `${kvRevisionPrefix(kvKey)}${encodeURIComponent(revision)}`;
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
	if (
		candidate.latestRevisionCheckedAt !== undefined &&
		typeof candidate.latestRevisionCheckedAt !== 'number'
	) {
		return null;
	}
	if (
		candidate.latestRevisionRetryAt !== undefined &&
		typeof candidate.latestRevisionRetryAt !== 'number'
	) {
		return null;
	}
	if (candidate.retryAfter !== undefined && typeof candidate.retryAfter !== 'number') return null;
	if (candidate.retryRevision !== undefined && typeof candidate.retryRevision !== 'string') {
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

function revisionOrder(revision: string): readonly [bigint, bigint] | null {
	// Revisions and millisecond timestamps originate as safe JavaScript numbers.
	// Bound decimal parsing so an attacker-shaped cache value cannot ask BigInt
	// to allocate for an arbitrarily long digit string.
	const generation = /^(\d{1,20}):(\d{1,20}|cold)$/.exec(revision);
	if (generation) {
		return [BigInt(generation[1]), generation[2] === 'cold' ? -1n : BigInt(generation[2])];
	}
	if (/^\d{1,20}$/.test(revision)) return [BigInt(revision), 0n];
	return null;
}

function compareRevisions(left: string, right: string): number | null {
	const leftOrder = revisionOrder(left);
	const rightOrder = revisionOrder(right);
	if (!leftOrder || !rightOrder) return null;
	if (leftOrder[0] !== rightOrder[0]) return leftOrder[0] > rightOrder[0] ? 1 : -1;
	if (leftOrder[1] !== rightOrder[1]) return leftOrder[1] > rightOrder[1] ? 1 : -1;
	return 0;
}

type LatestKvRevisionResult<T> = {
	envelope: CacheEnvelope<T> | null;
	source: 'legacy' | 'none' | 'revision';
	status: 'complete' | 'error' | 'overflow';
};

async function readLatestKvRevision<T>(
	kvKey: string,
	platform?: App.Platform
): Promise<LatestKvRevisionResult<T>> {
	const kv = publicDiscoveryKv(platform);
	if (!kv) return { envelope: null, source: 'none', status: 'error' };

	const prefix = kvRevisionPrefix(kvKey);
	const list = kv.list?.bind(kv);
	if (!list) {
		const legacy = await readKv<T>(kvKey, platform);
		return { envelope: legacy, source: legacy ? 'legacy' : 'none', status: 'error' };
	}
	try {
		// Never follow a cursor here: an outage request may spend one bounded list
		// operation, regardless of how many eight-day generations exist.
		const page = await list({ prefix, limit: PUBLIC_DISCOVERY_KV_LIST_LIMIT });
		let latest: { key: string; revision: string } | undefined;
		for (const { name } of page.keys) {
			const encodedRevision = name.slice(prefix.length);
			let revision: string;
			try {
				revision = decodeURIComponent(encodedRevision);
			} catch {
				continue;
			}
			if (!revisionOrder(revision)) continue;
			if (!latest || (compareRevisions(revision, latest.revision) ?? -1) > 0) {
				latest = { key: name, revision };
			}
		}

		const selected = latest
			? await readKv<T>(latest.key, platform)
			: await readKv<T>(kvKey, platform);
		const source = selected ? (latest ? 'revision' : 'legacy') : 'none';
		if (!page.list_complete) {
			console.warn(
				`[public-discovery-cache] KV revision listing exceeded ${PUBLIC_DISCOVERY_KV_LIST_LIMIT}-key recovery bound`
			);
			return { envelope: selected, source, status: 'overflow' };
		}

		// Read the pre-revision-key layout only as a rollout fallback. New writes
		// never target this shared key, so cross-isolate completion order cannot
		// regress the current LKG.
		return { envelope: selected, source, status: 'complete' };
	} catch (error) {
		console.warn(
			'[public-discovery-cache] KV revision listing failed:',
			error instanceof Error ? error.message : String(error)
		);
		const legacy = await readKv<T>(kvKey, platform);
		return { envelope: legacy, source: legacy ? 'legacy' : 'none', status: 'error' };
	}
}

async function readKvForRevision<T>(
	kvKey: string,
	revision: string | undefined,
	platform?: App.Platform
): Promise<CacheEnvelope<T> | null> {
	if (revision === undefined) return readKv<T>(kvKey, platform);
	// A healthy publication transition should pay one exact read, then go
	// straight to its origin loader. Enumerating older generations belongs only
	// on the recovery path after that loader fails.
	return readKv<T>(kvRevisionKey(kvKey, revision), platform);
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
): Promise<boolean> {
	const kv = publicDiscoveryKv(platform);
	if (!kv) return Promise.resolve(false);

	return kv
		.put(key, JSON.stringify(envelope), {
			expirationTtl: PUBLIC_DISCOVERY_KV_EXPIRATION_TTL_SECONDS
		})
		.then(() => true)
		.catch((error) => {
			console.warn(
				'[public-discovery-cache] KV write failed:',
				error instanceof Error ? error.message : String(error)
			);
			return false;
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

function preferredEnvelope<T>(
	revision: string | undefined,
	...candidates: Array<CacheEnvelope<T> | null | undefined>
): CacheEnvelope<T> | undefined {
	const available = candidates.filter(
		(candidate): candidate is CacheEnvelope<T> => candidate !== null && candidate !== undefined
	);
	const matching = available.filter((candidate) => candidate.revision === revision);
	return (matching.length > 0 ? matching : available).sort((a, b) => b.cachedAt - a.cachedAt)[0];
}

function newestEnvelope<T>(
	...candidates: Array<CacheEnvelope<T> | null | undefined>
): CacheEnvelope<T> | undefined {
	return candidates
		.filter(
			(candidate): candidate is CacheEnvelope<T> => candidate !== null && candidate !== undefined
		)
		.sort((left, right) => {
			if (left.revision && right.revision) {
				const compared = compareRevisions(right.revision, left.revision);
				if (compared !== null && compared !== 0) return compared;
			}
			return right.cachedAt - left.cachedAt;
		})[0];
}

async function readCachedEnvelope<T>(
	identity: string,
	edgeKey: Request,
	edgePointerKey: Request | undefined,
	edgeKeyForRevision: ((revision: string) => Request) | undefined,
	kvKey: string,
	platform: App.Platform | undefined,
	refreshSharedLayers: boolean,
	revision: string | undefined,
	now: number,
	freshForMs: number
): Promise<CacheEnvelope<T> | undefined> {
	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	if (inMemory && !refreshSharedLayers) return inMemory;

	const edge = await readEdge<T>(edgeKey);
	const local = preferredEnvelope(revision, inMemory, edge);
	if (local && local.revision === revision && now - local.cachedAt <= freshForMs) {
		setMemoryEnvelope(identity, local);
		return local;
	}

	const priorEdgePromise =
		edgePointerKey && edgeKeyForRevision && (!edge || edge.revision !== revision)
			? readEdge<null>(edgePointerKey).then((pointer) =>
					pointer?.revision && pointer.revision !== revision
						? readEdge<T>(edgeKeyForRevision(pointer.revision))
						: null
				)
			: Promise.resolve(null);
	const [global, priorEdge] = await Promise.all([
		readKvForRevision<T>(kvKey, revision, platform),
		priorEdgePromise
	]);
	const envelope = preferredEnvelope(revision, inMemory, edge, priorEdge, global);
	if (!envelope) return undefined;

	setMemoryEnvelope(identity, envelope);
	// A KV hit in a cold location should warm its local free hot layer.
	if (
		global &&
		envelope === global &&
		global.revision === revision &&
		(!edge || edge.cachedAt < global.cachedAt)
	) {
		// An exact revision hit proves only that this immutable generation exists;
		// it does not prove that it is the newest generation in KV. Warm its physical
		// edge key, but never let an old request rewrite the shared LKG pointer.
		const warm = persistEdge(edgeKey, global);
		if (platform?.context?.waitUntil) platform.context.waitUntil(warm);
	}
	return envelope;
}

function observeRequestedRevision(kvKey: string, revision: string | undefined): void {
	if (revision === undefined) return;
	const existing = latestRequestedRevision.get(kvKey);
	if (existing === undefined) {
		setBoundedMap(
			latestRequestedRevision,
			kvKey,
			revision,
			PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
		);
		return;
	}

	const compared = compareRevisions(revision, existing);
	if (compared !== null) {
		if (compared >= 0) {
			setBoundedMap(
				latestRequestedRevision,
				kvKey,
				revision,
				PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
			);
		}
		return;
	}
	setBoundedMap(
		latestRequestedRevision,
		kvKey,
		revision,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
}

function mayWriteRequestedRevision(kvKey: string, revision: string | undefined): boolean {
	return revision === undefined || latestRequestedRevision.get(kvKey) === revision;
}

async function persistLoadedEnvelope<T>(
	identity: string,
	edgeKey: Request,
	edgePointerKey: Request | undefined,
	kvKey: string,
	envelope: CacheEnvelope<T>,
	platform: App.Platform | undefined,
	writeKv: boolean
): Promise<void> {
	const globallyRenewed = writeKv
		? ({ ...envelope, globalCachedAt: envelope.cachedAt } satisfies CacheEnvelope<T>)
		: envelope;
	const [_, kvWritten] = await Promise.all([
		persistEdge(edgeKey, envelope),
		writeKv
			? persistKv(
					envelope.revision ? kvRevisionKey(kvKey, envelope.revision) : kvKey,
					globallyRenewed,
					platform
				)
			: Promise.resolve(false)
	]);

	if (kvWritten) {
		if (memoryCache.get(identity) === envelope) setMemoryEnvelope(identity, globallyRenewed);
		// The first edge write makes the value available without waiting on KV. Once
		// KV succeeds, replace it with the envelope that records that confirmed lease.
		await persistEdge(edgeKey, globallyRenewed);
	}
	if (edgePointerKey && mayWriteRequestedRevision(kvKey, envelope.revision)) {
		// Normal request paths may advertise a local fallback, but they cannot
		// prove that their revision is globally newest. Leave the global-check
		// lease unset so recovery verifies immutable KV generations before using
		// this pointer when KV is bound. Cache-API-only deployments still retain
		// their best available local fallback.
		await persistEdge(edgePointerKey, {
			cachedAt: envelope.cachedAt,
			revision: envelope.revision,
			value: null
		});
	}
}

function loadAndCache<T>(
	identity: string,
	edgeKey: Request,
	edgePointerKey: Request | undefined,
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
			// A versioned payload's materialization coordinate is its content identity,
			// so comparing the revision avoids serializing snapshot bodies that may be
			// close to the 900 KB producer cap. The only unversioned caller is the tiny
			// manifest control plane; retain equality there so a changed manifest is
			// written through to KV immediately instead of waiting for daily renewal.
			const valueUnchanged =
				previousEnvelope !== undefined &&
				(revision !== undefined
					? previousEnvelope.revision === revision
					: JSON.stringify(previousEnvelope.value) === JSON.stringify(value));
			const lastGlobalWrite = previousEnvelope?.globalCachedAt ?? 0;
			const writeKv =
				publicDiscoveryKv(platform) !== undefined &&
				mayWriteRequestedRevision(kvKey, revision) &&
				(!valueUnchanged || now - lastGlobalWrite >= PUBLIC_DISCOVERY_KV_REVALIDATE_MS);
			const envelope: CacheEnvelope<T> = {
				cachedAt: now,
				...(previousEnvelope?.globalCachedAt !== undefined
					? { globalCachedAt: previousEnvelope.globalCachedAt }
					: publicDiscoveryKv(platform)
						? { globalCachedAt: 0 }
						: {}),
				revision,
				value
			};
			setMemoryEnvelope(identity, envelope);
			if (defaultCloudflareCache() || writeKv) {
				const persistence = persistLoadedEnvelope(
					identity,
					edgeKey,
					edgePointerKey,
					kvKey,
					envelope,
					platform,
					writeKv
				);
				if (platform?.context?.waitUntil) platform.context.waitUntil(persistence);
				else await persistence;
			}
			return value;
		})
		.finally(() => {
			// A bounded-map eviction can let a newer flight for this same key start
			// before this promise settles. Never let the older completion erase it.
			if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey);
		});

	setBoundedMap(inFlight, flightKey, pending, PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES);
	return pending;
}

async function backOffEnvelope<T>(
	identity: string,
	edgeKey: Request,
	kvKey: string,
	platform: App.Platform | undefined,
	envelope: CacheEnvelope<T>,
	error: unknown,
	reason: 'background refresh' | 'stale refresh',
	requestedRevision: string | undefined
): Promise<void> {
	const backedOff = {
		...envelope,
		retryAfter: Date.now() + PUBLIC_DISCOVERY_RETRY_MS,
		retryRevision: requestedRevision ?? 'unversioned'
	};
	setMemoryEnvelope(identity, backedOff);
	// A local retry backoff must not overwrite the global last-known-good value
	// or consume one KV write per Cloudflare location during an origin outage.
	// Revision-transition failures use their dedicated marker path instead.
	await persistEnvelope(edgeKey, kvKey, backedOff, platform, false);
	console.warn(
		`[public-discovery-cache] ${reason} failed:`,
		error instanceof Error ? error.message : String(error)
	);
}

function revisionRetryIsActive(
	marker: CacheEnvelope<null> | null,
	requestedRevision: string,
	now: number
): boolean {
	return marker?.retryRevision === requestedRevision && (marker.retryAfter ?? 0) > now;
}

async function recoverFailedRevision<T>(
	identity: string,
	logicalKey: string,
	url: URL,
	platform: App.Platform | undefined,
	kvKey: string,
	edgeRetryKey: Request,
	requestedRevision: string,
	transitionMarker: CacheEnvelope<null> | null,
	localEnvelope: CacheEnvelope<T> | undefined,
	error: unknown
): Promise<T> {
	const now = Date.now();
	const markerMatches = transitionMarker?.retryRevision === requestedRevision;
	const globalCheckIsFresh =
		markerMatches &&
		transitionMarker.latestRevisionCheckedAt !== undefined &&
		now - transitionMarker.latestRevisionCheckedAt <= PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS;
	const globalCheckIsBackedOff =
		markerMatches && (transitionMarker.latestRevisionRetryAt ?? 0) > now;
	const shouldCheckGlobal =
		publicDiscoveryKv(platform) !== undefined && !globalCheckIsFresh && !globalCheckIsBackedOff;
	const latestGlobal = shouldCheckGlobal
		? await readLatestKvRevision<T>(kvKey, platform)
		: undefined;
	const global = latestGlobal?.envelope;
	const recovery = newestEnvelope(localEnvelope, global);
	const recoveryIsUsable =
		recovery !== undefined && now - recovery.cachedAt <= PUBLIC_DISCOVERY_STALE_MS;

	// The requested immutable generation may have become visible in KV while the
	// origin request was in flight. In that case recovery is complete; warm the
	// exact physical edge entry and do not install a failure marker.
	if (recoveryIsUsable && recovery.revision === requestedRevision) {
		setMemoryEnvelope(identity, recovery);
		await persistEdge(edgeCacheKey(logicalKey, url, platform, requestedRevision), recovery);
		return recovery.value;
	}

	const retryAfter = now + PUBLIC_DISCOVERY_RETRY_MS;
	if (recoveryIsUsable) {
		setMemoryEnvelope(identity, {
			...recovery,
			retryAfter,
			retryRevision: requestedRevision
		});
	}

	const globalCheckLease = latestGlobal
		? latestGlobal.status === 'complete' && latestGlobal.source === 'revision'
			? { latestRevisionCheckedAt: now }
			: { latestRevisionRetryAt: now + PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS }
		: globalCheckIsFresh
			? { latestRevisionCheckedAt: transitionMarker.latestRevisionCheckedAt }
			: globalCheckIsBackedOff
				? { latestRevisionRetryAt: transitionMarker.latestRevisionRetryAt }
				: {};
	const marker: CacheEnvelope<null> = {
		cachedAt: recoveryIsUsable ? recovery.cachedAt : now,
		...globalCheckLease,
		retryAfter,
		retryRevision: requestedRevision,
		revision: recoveryIsUsable ? recovery.revision : undefined,
		value: null
	};
	await Promise.all([
		persistEdge(edgeRetryKey, marker),
		recoveryIsUsable && recovery.revision
			? persistEdge(edgeCacheKey(logicalKey, url, platform, recovery.revision), recovery)
			: Promise.resolve()
	]);

	console.warn(
		'[public-discovery-cache] revision refresh failed:',
		error instanceof Error ? error.message : String(error)
	);
	if (recoveryIsUsable) return recovery.value;
	throw error;
}

function refreshInBackground<T>(
	identity: string,
	edgeKey: Request,
	edgePointerKey: Request | undefined,
	kvKey: string,
	platform: App.Platform | undefined,
	revision: string | undefined,
	staleEnvelope: CacheEnvelope<T>,
	loader: () => Promise<T>
): void {
	const refresh = loadAndCache(
		identity,
		edgeKey,
		edgePointerKey,
		kvKey,
		platform,
		revision,
		loader,
		staleEnvelope
	).catch((error) =>
		backOffEnvelope(
			identity,
			edgeKey,
			kvKey,
			platform,
			staleEnvelope,
			error,
			'background refresh',
			revision
		)
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
	const forceRefresh = context.forceRefresh === true;
	const now = Date.now();
	const revision = context.revision === undefined ? undefined : String(context.revision);
	const identity = storageIdentity(logicalKey, context.url, context.platform);
	const edgeKey = edgeCacheKey(logicalKey, context.url, context.platform, revision);
	const edgePointerKey =
		revision === undefined
			? undefined
			: edgeLkgPointerKey(logicalKey, context.url, context.platform);
	const revisionRetryKey =
		revision === undefined
			? undefined
			: edgeRevisionRetryKey(logicalKey, context.url, context.platform, revision);
	const kvKey = kvCacheKey(logicalKey, context.url, context.platform);
	observeRequestedRevision(kvKey, revision);

	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	const inMemoryAge = inMemory ? now - inMemory.cachedAt : Number.POSITIVE_INFINITY;
	const inMemoryRevisionMatches = inMemory?.revision === revision;
	if (
		!forceRefresh &&
		inMemory &&
		inMemoryAge <= PUBLIC_DISCOVERY_STALE_MS &&
		(inMemory.retryAfter ?? 0) > now &&
		inMemory.retryRevision === (revision ?? 'unversioned')
	) {
		return inMemory.value;
	}
	const refreshSharedLayers =
		forceRefresh || !inMemory || inMemoryAge > freshForMs || !inMemoryRevisionMatches;
	let envelope = await readCachedEnvelope<T>(
		identity,
		edgeKey,
		edgePointerKey,
		revision === undefined
			? undefined
			: (candidateRevision) =>
					edgeCacheKey(logicalKey, context.url, context.platform, candidateRevision),
		kvKey,
		context.platform,
		refreshSharedLayers,
		revision,
		now,
		freshForMs
	);
	let transitionMarker: CacheEnvelope<null> | null = null;
	if (revision !== undefined && revisionRetryKey && envelope?.revision !== revision) {
		transitionMarker = await readEdge<null>(revisionRetryKey);
		if (
			transitionMarker?.retryRevision === revision &&
			transitionMarker.revision &&
			transitionMarker.revision !== revision
		) {
			const markerFallback = await readEdge<T>(
				edgeCacheKey(logicalKey, context.url, context.platform, transitionMarker.revision)
			);
			envelope = newestEnvelope(envelope, markerFallback);
		}

		if (
			!forceRefresh &&
			transitionMarker &&
			revisionRetryIsActive(transitionMarker, revision, now)
		) {
			if (envelope && now - envelope.cachedAt <= PUBLIC_DISCOVERY_STALE_MS) {
				const backedOff = {
					...envelope,
					retryAfter: transitionMarker.retryAfter,
					retryRevision: revision
				};
				setMemoryEnvelope(identity, backedOff);
				return backedOff.value;
			}
			throw new Error(`Public discovery revision ${revision} refresh is temporarily backed off`);
		}
	}

	if (envelope) {
		const age = now - envelope.cachedAt;
		const revisionMatches = envelope.revision === revision;

		if (!forceRefresh && revisionMatches && age <= freshForMs) return envelope.value;

		if (age <= PUBLIC_DISCOVERY_STALE_MS) {
			if (
				!forceRefresh &&
				(envelope.retryAfter ?? 0) > now &&
				envelope.retryRevision === (revision ?? 'unversioned')
			) {
				return envelope.value;
			}

			if (!revisionMatches) {
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						edgePointerKey,
						kvKey,
						context.platform,
						revision,
						loader,
						envelope
					);
				} catch (error) {
					if (context.shouldFallbackToStale?.(error) === false) throw error;
					return recoverFailedRevision(
						identity,
						logicalKey,
						context.url,
						context.platform,
						kvKey,
						revisionRetryKey!,
						revision!,
						transitionMarker,
						envelope,
						error
					);
				}
			}

			if (forceRefresh || context.refreshMode === 'blocking') {
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						edgePointerKey,
						kvKey,
						context.platform,
						revision,
						loader,
						envelope
					);
				} catch (error) {
					if (context.shouldFallbackToStale?.(error) === false) throw error;
					await backOffEnvelope(
						identity,
						edgeKey,
						kvKey,
						context.platform,
						envelope,
						error,
						'stale refresh',
						revision
					);
					return envelope.value;
				}
			}

			refreshInBackground(
				identity,
				edgeKey,
				edgePointerKey,
				kvKey,
				context.platform,
				revision,
				envelope,
				loader
			);
			return envelope.value;
		}

		memoryCache.delete(identity);
	}

	try {
		return await loadAndCache(
			identity,
			edgeKey,
			edgePointerKey,
			kvKey,
			context.platform,
			revision,
			loader
		);
	} catch (error) {
		if (revision === undefined || !revisionRetryKey) throw error;
		if (context.shouldFallbackToStale?.(error) === false) throw error;
		return recoverFailedRevision(
			identity,
			logicalKey,
			context.url,
			context.platform,
			kvKey,
			revisionRetryKey,
			revision,
			transitionMarker,
			envelope,
			error
		);
	}
}

/**
 * Read a still-valid payload without consulting its manifest or origin loader.
 *
 * This is intentionally a recovery-only path: callers use it when the tiny
 * manifest query itself fails, never when an authoritative manifest says a
 * family is not ready. Revision-qualified KV entries make the selected LKG
 * monotonic even when old requests finish in other Worker isolates.
 */
export async function getCachedPublicDataLastKnownGood<T>(
	logicalKey: string,
	context: Pick<CacheContext, 'platform' | 'url'>
): Promise<T | undefined> {
	const now = Date.now();
	const identity = storageIdentity(logicalKey, context.url, context.platform);
	const kvKey = kvCacheKey(logicalKey, context.url, context.platform);
	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	const pointerKey = edgeLkgPointerKey(logicalKey, context.url, context.platform);
	const pointer = await readEdge<null>(pointerKey);
	const edge = pointer?.revision
		? await readEdge<T>(edgeCacheKey(logicalKey, context.url, context.platform, pointer.revision))
		: null;
	const local = newestEnvelope(inMemory, edge);
	const localIsUsable = local !== undefined && now - local.cachedAt <= PUBLIC_DISCOVERY_STALE_MS;
	const localWasRecentlyChecked =
		localIsUsable &&
		((pointer !== null &&
			pointer.revision === local.revision &&
			pointer.latestRevisionCheckedAt !== undefined &&
			now - pointer.latestRevisionCheckedAt <= PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS) ||
			(local.latestRevisionCheckedAt !== undefined &&
				now - local.latestRevisionCheckedAt <= PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS));
	const revisionCheckRetryAt = Math.max(
		latestRevisionRetryAfter.get(identity) ?? 0,
		pointer?.latestRevisionRetryAt ?? 0,
		local?.latestRevisionRetryAt ?? 0
	);
	const revisionCheckIsBackedOff = revisionCheckRetryAt > now;
	if (
		localIsUsable &&
		(!publicDiscoveryKv(context.platform) || localWasRecentlyChecked || revisionCheckIsBackedOff)
	) {
		setMemoryEnvelope(identity, local);
		return local.value;
	}
	if (!publicDiscoveryKv(context.platform) || revisionCheckIsBackedOff) return undefined;

	// KV list operations have a much smaller Free-plan allowance than reads.
	// Consult the immutable global generations only when this location has no
	// usable memory/Cache API LKG, then keep the winner hot locally.
	const latestGlobal = await readLatestKvRevision<T>(kvKey, context.platform);
	const global = latestGlobal.envelope;
	const envelope = newestEnvelope(local, global);
	const envelopeIsUsable =
		envelope !== undefined && now - envelope.cachedAt <= PUBLIC_DISCOVERY_STALE_MS;
	const globalSelectionIsCertified =
		envelopeIsUsable &&
		latestGlobal.status === 'complete' &&
		latestGlobal.source === 'revision' &&
		global?.revision !== undefined &&
		envelope.revision === global.revision;

	if (!globalSelectionIsCertified) {
		// A failed/overflowed global check uses the same daily lease as a
		// successful check; the 15-minute origin retry cadence would exhaust the
		// much smaller KV list allowance across only a few active locations.
		const retryAt = now + PUBLIC_DISCOVERY_LKG_REVISION_CHECK_MS;
		setBoundedMap(
			latestRevisionRetryAfter,
			identity,
			retryAt,
			PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
		);
		if (envelopeIsUsable) {
			setMemoryEnvelope(identity, { ...envelope, latestRevisionRetryAt: retryAt });
		}

		// Overflow/error is a candidate observation, never a global certificate.
		// Share only its daily retry backoff so another request in this location
		// does not immediately spend another scarce list operation.
		const candidateRevision = envelopeIsUsable ? envelope.revision : pointer?.revision;
		const candidateCachedAt = envelopeIsUsable ? envelope.cachedAt : (pointer?.cachedAt ?? now);
		const warm = Promise.all([
			envelopeIsUsable && envelope.revision
				? persistEdge(
						edgeCacheKey(logicalKey, context.url, context.platform, envelope.revision),
						envelope
					)
				: Promise.resolve(),
			persistEdge(pointerKey, {
				cachedAt: candidateCachedAt,
				latestRevisionRetryAt: retryAt,
				revision: candidateRevision,
				value: null
			})
		]);
		if (context.platform?.context?.waitUntil) context.platform.context.waitUntil(warm);
		else await warm;
		return envelopeIsUsable ? envelope.value : undefined;
	}

	latestRevisionRetryAfter.delete(identity);
	// Retain the global-check lease in module memory as well as the shared edge
	// pointer so a runtime without Cache API does not spend one list per request.
	setMemoryEnvelope(identity, { ...envelope, latestRevisionCheckedAt: now });
	if (envelope.revision) {
		const warm = Promise.all([
			persistEdge(
				edgeCacheKey(logicalKey, context.url, context.platform, envelope.revision),
				envelope
			),
			persistEdge(pointerKey, {
				cachedAt: envelope.cachedAt,
				latestRevisionCheckedAt: now,
				revision: envelope.revision,
				value: null
			})
		]);
		if (context.platform?.context?.waitUntil) context.platform.context.waitUntil(warm);
		else await warm;
	}
	return envelope.value;
}

/** Test-only reset for module-local state. */
export function clearPublicDiscoveryCache(): void {
	memoryCache.clear();
	inFlight.clear();
	latestRequestedRevision.clear();
	latestRevisionRetryAfter.clear();
}
