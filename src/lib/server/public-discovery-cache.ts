import {
	clearPublicDiscoveryManifestShield,
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	putR2ObjectIfAbsent
} from './public-discovery-manifest-shield';
import {
	PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES,
	readPublicTemplateOgImage
} from './public-template-og-image';
import { PUBLIC_TEMPLATE_OG_QUEUE_SEND_ATTEMPTS_MAX } from './public-template-og-queue';

export { PUBLIC_DISCOVERY_MANIFEST_FRESH_MS };

/**
 * Two-level cache for anonymous public-discovery data.
 *
 * `caches.default` is the free, data-centre-local hot layer. The strongly
 * consistent `PUBLIC_DISCOVERY_R2` binding is the global source shield and
 * last-known-good layer for immutable, revision-qualified payloads. Anonymous
 * deployed reads are exact-key GET-only: a missing generation fails closed and
 * can never claim, list, write, clean up, or fall through to Convex. The
 * authenticated producer publishes every payload before advertising its
 * manifest generation.
 * The mutable manifest uses its separate globally coordinated control-plane
 * shield; this module owns revision-qualified payloads only.
 * Every layer contains public data only.
 *
 * Callers may supply a materialization revision. A matching revision can live
 * for the full stale window; a changed revision refreshes synchronously and
 * atomically replaces the cached value. If that refresh fails, the prior
 * revision remains available with a retry backoff.
 */

// v5 is a privacy boundary: v4 list/relation envelopes predate the exhaustive
// consumer allowlists and must never be selected after that contract shipped.
// v7 separated location-local edge identities from the backend-scoped R2
// source shield. Origin-scoped v6 objects must not participate in the shared
// claim protocol because they can authorize one Convex fill per Pages alias.
// v8 is the withdrawal-floor boundary: payloads written before the globally
// durable manifest tombstone protocol cannot be eligible after launch.
const CACHE_SCHEMA_VERSION = 'v8';

/** Safety revalidation for callers that do not provide a materialization revision. */
export const PUBLIC_DISCOVERY_FRESH_MS = 6 * 60 * 60 * 1000;

/** Recertify immutable payloads daily against their manifest generation. */
export const PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS = 24 * 60 * 60 * 1000;

/** Keep a last-known-good value through a multi-day Convex outage. */
const PUBLIC_DISCOVERY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Retain immutable R2 payloads slightly beyond the application-level LKG window. */
export const PUBLIC_DISCOVERY_R2_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

/** Do not retry a failed stale or revision refresh on every anonymous request. */
const PUBLIC_DISCOVERY_RETRY_MS = 15 * 60 * 1000;

/** Hard isolate-local bounds; logical keys are fixed by trusted server callers. */
export const PUBLIC_DISCOVERY_MEMORY_CACHE_MAX_ENTRIES = 64;
export const PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES = 256;

/**
 * Serialized public snapshot envelopes are bounded above the producer's
 * 900 KiB per-row ceiling while remaining comfortably below Worker memory
 * limits.
 */
export const PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Absorb harmless inter-location clock skew without accepting future authority. */
const PUBLIC_DISCOVERY_CACHE_CLOCK_SKEW_MS = 60 * 1000;

// The producer checkpoint carries the complete compact coordinate plan so the
// other fifteen clean backfill cycles do not re-read the Convex inventory. Its
// cardinality and serialized size are both hard bounded below.
export const PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES = 128 * 1024;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS =
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + PUBLIC_DISCOVERY_CACHE_CLOCK_SKEW_MS;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX = 100;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX = 32;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_CANDIDATE_MAX = 32;
const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROTECTED_MAX = 500;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES = 32 * 1024;

export type PublicTemplatePageBackfillProgress = {
	version: 1;
	generation: string;
	coordinateDigest: string;
	coordinates: Array<{ templateId: string; slug: string; artifactRevision: number }>;
	total: number;
	/** Highest contiguous JSON+PNG pair certified by exact metadata HEADs. */
	nextOffset: number;
	/** Highest contiguous coordinate handed durably to the Queue. */
	enqueuedOffset: number;
	enqueuedAt: number | null;
	enqueueAttempts: number;
};

export type PublicTemplatePageBackfillProgressState = {
	progress: PublicTemplatePageBackfillProgress;
	etag: string;
};

type CacheEnvelope<T> = {
	cachedAt: number;
	retryAfter?: number;
	retryRevision?: string;
	revision?: string;
	value: T;
};

/** The envelope revision is part of the serialized-value trust boundary. */
type CachedValueProjector<T> = (value: unknown, envelopeRevision?: string) => T;

type CacheContext<T = unknown> = {
	url: URL;
	platform?: App.Platform;
	freshForMs?: number;
	forceRefresh?: boolean;
	/** Keep mutable/non-discovery values out of the immutable shared store. */
	r2Policy?: 'none' | 'read-only';
	/** Cache a refresh failure as a negative result without serving the stale value. */
	failClosedRefreshBackoffMs?: number;
	/** Producer-durable floor: this payload revision and every older fallback are retired. */
	retiredRevisionFloor?: number;
	/** Multi-family equivalent used by bundled landing-surface artifacts. */
	retiredRevisionFloors?: readonly number[];
	revision?: number | string;
	refreshMode?: 'background' | 'blocking';
	shouldFallbackToStale?: (error: unknown) => boolean;
	/** Reconstruct serialized cache values at the public-data trust boundary. */
	projectCachedValue?: CachedValueProjector<T>;
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

const memoryCache = new Map<string, CacheEnvelope<unknown>>();
// Coalesce the complete cache-resolution path before its first Cache API or R2
// read. `inFlight` below remains the narrower origin-load coordinator used by
// background refreshes after a stale value has already been selected.
const resolutionFlights = new Map<string, Promise<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const latestRequestedRevision = new Map<string, string>();
const failClosedRefreshRetryAfter = new Map<string, number>();
const publicTemplateOgImageFlights = new Map<string, Promise<Uint8Array>>();

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
	const origin = url.origin.toLowerCase();
	return backend ? `origin=${origin}|backend=${backend}` : `origin=${origin}`;
}

/**
 * R2 is the cross-location source shield, so its realm must not depend on the
 * request Host. The configured Convex backend is trusted Worker configuration
 * and is also the deployment-data boundary: every production alias shares one
 * realm, while preview/staging deployments pointed at their separate backend
 * cannot read or claim production generations. `unconfigured` keeps local test
 * and recovery tooling deterministic; deployed readiness requires a valid
 * `PUBLIC_CONVEX_URL` before traffic is accepted.
 */
function r2CacheRealm(platform?: App.Platform): string {
	const backend = configuredBackend(platform);
	return backend ? `backend=${backend}` : 'backend=unconfigured';
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

function edgeFailClosedRefreshRetryKey(
	logicalKey: string,
	url: URL,
	platform?: App.Platform
): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(cacheScope(url, platform))}/${encodeURIComponent(logicalKey)}/fail-closed-refresh-retry`;
	return new Request(keyUrl, { method: 'GET' });
}

function r2CachePrefixForRealm(logicalKey: string, realm: string): string {
	// Per-template page coordinates may remain unchanged for months. Keep these
	// immutable objects outside the eight-day landing-snapshot lifecycle prefix;
	// the producer deletes the prior exact coordinate on change/removal, and the
	// request path can reach one only through the current bounded inventory.
	if (logicalKey.startsWith('template-page:slug=')) {
		return `public-template-pages/v1/${encodeURIComponent(realm)}/${encodeURIComponent(logicalKey)}/`;
	}
	return `public-discovery/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(realm)}/${encodeURIComponent(logicalKey)}/`;
}

function r2CachePrefix(logicalKey: string, platform?: App.Platform): string {
	return r2CachePrefixForRealm(logicalKey, r2CacheRealm(platform));
}

function r2RevisionPrefix(cachePrefix: string): string {
	return `${cachePrefix}revision=`;
}

function r2RevisionPrefixFor(cachePrefix: string, revision: string): string {
	return `${r2RevisionPrefix(cachePrefix)}${encodeURIComponent(revision)}/`;
}

function r2PayloadKey(cachePrefix: string, revision: string): string {
	return `${r2RevisionPrefixFor(cachePrefix, revision)}payload.json`;
}

/** Exact backend-scoped immutable payload key for offline control-plane proof. */
export function publicDiscoveryPayloadObjectKeyForBackend(
	logicalKey: string,
	backend: string,
	revisionValue: number | string
): string {
	if (typeof logicalKey !== 'string' || logicalKey.length < 1 || logicalKey.length > 256) {
		throw new Error('Public discovery payload logical key is invalid');
	}
	let parsed: URL;
	try {
		parsed = new URL(backend);
	} catch {
		throw new Error('Public discovery payload backend is invalid');
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error('Public discovery payload backend is invalid');
	}
	const revision = String(revisionValue);
	if (revisionOrder(revision) === null) {
		throw new Error('Public discovery payload revision is invalid');
	}
	return r2PayloadKey(
		r2CachePrefixForRealm(logicalKey, `backend=${parsed.origin.toLowerCase()}`),
		revision
	);
}

function r2PublicTemplateOgImageKey(cachePrefix: string, revision: string): string {
	return `${r2RevisionPrefixFor(cachePrefix, revision)}og-image.png`;
}

function publicTemplatePageArtifactKeys(
	cachePrefix: string,
	revision: string
): readonly [payload: string, ogImage: string] {
	return [r2PayloadKey(cachePrefix, revision), r2PublicTemplateOgImageKey(cachePrefix, revision)];
}

/**
 * The GC ledger deliberately names one canonical coordinate rather than two
 * independently collectible files. This prevents a pagination split between
 * siblings from shortening either file's authority grace.
 */
function publicTemplatePageArtifactPayloadKeyForObject(key: string): string | null {
	if (key.endsWith('/payload.json')) return key;
	if (key.endsWith('/og-image.png')) return `${key.slice(0, -'og-image.png'.length)}payload.json`;
	return null;
}

function publicTemplatePageArtifactPairForPayloadKey(
	payloadKey: string
): readonly [payload: string, ogImage: string] {
	if (!payloadKey.endsWith('/payload.json')) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_INVALID');
	}
	const prefix = payloadKey.slice(0, -'payload.json'.length);
	return [payloadKey, `${prefix}og-image.png`];
}

function publicTemplateSlugFromLogicalKey(logicalKey: string): string | null {
	const match = /^template-page:slug=([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(logicalKey);
	return match && match[1]!.length <= 100 ? match[1]! : null;
}

function publicTemplateOgImageEdgeKey(
	slug: string,
	revision: string,
	url: URL,
	platform?: App.Platform
): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-template-og/v1/${encodeURIComponent(cacheScope(url, platform))}/slug=${encodeURIComponent(slug)}/revision=${encodeURIComponent(revision)}`;
	return new Request(keyUrl, { method: 'GET' });
}

function defaultCloudflareCache(): Cache | undefined {
	if (typeof caches === 'undefined') return undefined;
	return (caches as CloudflareCacheStorage).default;
}

function publicDiscoveryR2(platform?: App.Platform): R2Bucket | undefined {
	return platform?.env?.PUBLIC_DISCOVERY_R2;
}

function publicTemplatePageBackfillProgressKey(platform?: App.Platform): string {
	// Producer-only mutable singleton. It deliberately sits outside both the
	// anonymous logical-key namespace and the public-discovery lifecycle prefix.
	return `public-template-pages/v1/${encodeURIComponent(r2CacheRealm(platform))}/control/backfill-progress.json`;
}

function publicTemplatePageArtifactGcProgressKey(platform?: App.Platform): string {
	return `public-template-pages/v1/${encodeURIComponent(r2CacheRealm(platform))}/control/gc-progress.json`;
}

type PublicTemplatePageArtifactGcProgress = {
	version: 2;
	cursor: string | null;
	candidates: Array<{ key: string; firstSeenUnreferencedAt: number }>;
	updatedAt: number;
};

function readPublicTemplatePageArtifactGcProgressValue(
	value: unknown
): PublicTemplatePageArtifactGcProgress {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(key) => !['version', 'cursor', 'candidates', 'updatedAt'].includes(key)
		) ||
		record.version !== 2 ||
		(record.cursor !== null &&
			(typeof record.cursor !== 'string' ||
				record.cursor.length < 1 ||
				record.cursor.length > 2_048)) ||
		!Array.isArray(record.candidates) ||
		record.candidates.length > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_CANDIDATE_MAX ||
		!Number.isSafeInteger(record.updatedAt) ||
		(record.updatedAt as number) < 0
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
	}
	const candidates = record.candidates.map((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
		}
		const candidate = raw as Record<string, unknown>;
		if (
			Object.keys(candidate).some((key) => !['key', 'firstSeenUnreferencedAt'].includes(key)) ||
			typeof candidate.key !== 'string' ||
			candidate.key.length < 1 ||
			candidate.key.length > 1_024 ||
			!Number.isSafeInteger(candidate.firstSeenUnreferencedAt) ||
			(candidate.firstSeenUnreferencedAt as number) < 0 ||
			(candidate.firstSeenUnreferencedAt as number) > (record.updatedAt as number)
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
		}
		return {
			key: candidate.key,
			firstSeenUnreferencedAt: candidate.firstSeenUnreferencedAt as number
		};
	});
	if (
		new Set(candidates.map(({ key }) => key)).size !== candidates.length ||
		candidates.some((candidate, index) =>
			index === 0 ? false : candidates[index - 1]!.key.localeCompare(candidate.key) >= 0
		)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
	}
	return {
		version: 2,
		cursor: record.cursor as string | null,
		candidates,
		updatedAt: record.updatedAt as number
	};
}

function readPublicTemplatePageBackfillProgressValue(
	value: unknown
): PublicTemplatePageBackfillProgress {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const record = value as Record<string, unknown>;
	const allowedKeys = [
		'version',
		'generation',
		'coordinateDigest',
		'coordinates',
		'total',
		'nextOffset',
		'enqueuedOffset',
		'enqueuedAt',
		'enqueueAttempts'
	];
	if (
		Object.keys(record).sort().join('\0') !== allowedKeys.sort().join('\0') ||
		record.version !== 1 ||
		typeof record.generation !== 'string' ||
		record.generation.length < 1 ||
		record.generation.length > 128 ||
		typeof record.coordinateDigest !== 'string' ||
		!/^[a-f0-9]{64}$/.test(record.coordinateDigest) ||
		!Array.isArray(record.coordinates) ||
		record.coordinates.length > 250 ||
		!Number.isSafeInteger(record.total) ||
		(record.total as number) < 0 ||
		(record.total as number) > record.coordinates.length ||
		!Number.isSafeInteger(record.nextOffset) ||
		(record.nextOffset as number) < 0 ||
		(record.nextOffset as number) > (record.total as number)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const coordinates = record.coordinates.map((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
		}
		const coordinate = raw as Record<string, unknown>;
		if (
			Object.keys(coordinate).sort().join('\0') !==
				['artifactRevision', 'slug', 'templateId'].join('\0') ||
			typeof coordinate.templateId !== 'string' ||
			coordinate.templateId.length < 1 ||
			coordinate.templateId.length > 128 ||
			typeof coordinate.slug !== 'string' ||
			coordinate.slug.length < 1 ||
			coordinate.slug.length > 100 ||
			!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(coordinate.slug) ||
			!Number.isSafeInteger(coordinate.artifactRevision) ||
			(coordinate.artifactRevision as number) < 1
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
		}
		return {
			templateId: coordinate.templateId,
			slug: coordinate.slug,
			artifactRevision: coordinate.artifactRevision as number
		};
	});
	if (
		new Set(coordinates.map(({ templateId }) => templateId)).size !== coordinates.length ||
		new Set(coordinates.map(({ slug }) => slug)).size !== coordinates.length ||
		coordinates.some((coordinate, index) =>
			index === 0 ? false : coordinates[index - 1]!.slug.localeCompare(coordinate.slug) >= 0
		)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const enqueuedOffset = record.enqueuedOffset;
	const enqueuedAt = record.enqueuedAt;
	const enqueueAttempts = record.enqueueAttempts;
	if (
		!Number.isSafeInteger(enqueuedOffset) ||
		(enqueuedOffset as number) < (record.nextOffset as number) ||
		(enqueuedOffset as number) > (record.total as number) ||
		(enqueuedAt !== null &&
			(!Number.isSafeInteger(enqueuedAt) ||
				(enqueuedAt as number) < 0 ||
				(enqueuedAt as number) > Date.now())) ||
		!Number.isSafeInteger(enqueueAttempts) ||
		(enqueueAttempts as number) < 0 ||
		(enqueueAttempts as number) > PUBLIC_TEMPLATE_OG_QUEUE_SEND_ATTEMPTS_MAX ||
		((enqueuedOffset as number) === (record.nextOffset as number)
			? enqueuedAt !== null || enqueueAttempts !== 0
			: enqueuedAt === null || (enqueueAttempts as number) < 1)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	return {
		version: 1,
		generation: record.generation,
		coordinateDigest: record.coordinateDigest,
		coordinates,
		total: record.total as number,
		nextOffset: record.nextOffset as number,
		enqueuedOffset: enqueuedOffset as number,
		enqueuedAt: enqueuedAt as number | null,
		enqueueAttempts: enqueueAttempts as number
	};
}
/** Producer-only exact GET of the one CAS-fenced page backfill checkpoint. */
export async function readPublicTemplatePageBackfillProgress(context: {
	platform: App.Platform;
}): Promise<PublicTemplatePageBackfillProgressState | null> {
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer backfill progress');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer progress');
	const object = await bucket.get(publicTemplatePageBackfillProgressKey(context.platform));
	if (!object) return null;
	if (
		object.customMetadata?.kind !== 'template-page-backfill-progress' ||
		object.customMetadata?.schema !== '1' ||
		!Number.isSafeInteger(object.size) ||
		object.size < 1 ||
		object.size > PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES ||
		typeof object.etag !== 'string' ||
		object.etag.length < 1
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const progress = readPublicTemplatePageBackfillProgressValue(
		await boundedR2Json(object, PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES)
	);
	return { progress, etag: object.etag };
}

/**
 * Producer-only compare-and-swap. `expectedEtag:null` is create-if-absent;
 * otherwise the exact prior receipt fences timed-out and stale-generation writers.
 */
export async function writePublicTemplatePageBackfillProgress(context: {
	platform: App.Platform;
	expectedEtag: string | null;
	progress: PublicTemplatePageBackfillProgress;
}): Promise<PublicTemplatePageBackfillProgressState | null> {
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer backfill progress');
	}
	const progress = readPublicTemplatePageBackfillProgressValue(context.progress);
	const body = JSON.stringify(progress);
	if (
		new TextEncoder().encode(body).byteLength > PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer progress');
	const key = publicTemplatePageBackfillProgressKey(context.platform);
	const metadata = {
		customMetadata: { kind: 'template-page-backfill-progress', schema: '1' },
		httpMetadata: { contentType: 'application/json' }
	};
	const written =
		context.expectedEtag === null
			? await putR2ObjectIfAbsent(bucket, key, body, metadata)
			: await bucket.put(key, body, {
					...metadata,
					onlyIf: { etagMatches: context.expectedEtag }
				});
	return written ? { progress, etag: written.etag } : null;
}

/**
 * Producer-only, cursor-resumable orphan/supersession collector. Anonymous
 * requests never call LIST. This is a two-phase mark/sweep: an exact key must
 * remain unreferenced for a full authority grace after its first observation,
 * regardless of the immutable object's upload age. The CAS ledger advances
 * before exact deletes, so a crash can only postpone collection and never
 * shorten the grace.
 */
export async function collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh(context: {
	/** The manifest writer must hold its pre-publication acquisition. */
	ownership: 'manifest-before-publish';
	platform: App.Platform;
	protectedCoordinates: readonly { slug: string; artifactRevision: number | string }[];
	now?: number;
}): Promise<{
	scanned: number;
	marked: number;
	deleted: number;
	fenced: boolean;
	cursor: string | null;
}> {
	if (context.ownership !== 'manifest-before-publish') {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_OWNERSHIP_REQUIRED');
	}
	if (context.protectedCoordinates.length > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROTECTED_MAX) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROTECTION_CAP_EXCEEDED');
	}
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer page artifact GC');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer page GC');
	const protectedKeys = new Set<string>();
	const protect = (coordinate: { slug: string; artifactRevision: number | string }) => {
		if (
			typeof coordinate.slug !== 'string' ||
			coordinate.slug.length < 1 ||
			coordinate.slug.length > 100 ||
			!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(coordinate.slug)
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_COORDINATE_INVALID');
		}
		const revision = String(coordinate.artifactRevision);
		if (revisionOrder(revision) === null) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_COORDINATE_INVALID');
		}
		protectedKeys.add(
			r2PayloadKey(
				r2CachePrefix(`template-page:slug=${coordinate.slug}`, context.platform),
				revision
			)
		);
	};
	for (const coordinate of context.protectedCoordinates) protect(coordinate);
	// A target may deliberately reuse an older immutable coordinate. Protect the
	// entire active CAS plan as well as the currently advertised inventory before
	// considering any mark or sweep.
	const activePlan = await readPublicTemplatePageBackfillProgress({ platform: context.platform });
	for (const coordinate of activePlan?.progress.coordinates ?? []) protect(coordinate);
	if (protectedKeys.size > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROTECTED_MAX) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROTECTION_CAP_EXCEEDED');
	}
	const progressKey = publicTemplatePageArtifactGcProgressKey(context.platform);
	const progressObject = await bucket.get(progressKey);
	let observed: { progress: PublicTemplatePageArtifactGcProgress; etag: string } | null = null;
	if (progressObject) {
		if (
			progressObject.customMetadata?.kind !== 'template-page-artifact-gc-progress' ||
			progressObject.customMetadata?.schema !== '2' ||
			!Number.isSafeInteger(progressObject.size) ||
			progressObject.size < 1 ||
			progressObject.size > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES ||
			typeof progressObject.etag !== 'string' ||
			progressObject.etag.length < 1
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
		}
		observed = {
			progress: readPublicTemplatePageArtifactGcProgressValue(
				await boundedR2Json(progressObject, PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES)
			),
			etag: progressObject.etag
		};
	}
	const prefix = `public-template-pages/v1/${encodeURIComponent(r2CacheRealm(context.platform))}/`;
	if (
		observed?.progress.candidates.some(
			({ key }) =>
				!key.startsWith(prefix) ||
				!key.includes('/template-page%3Aslug%3D') ||
				!key.endsWith('/payload.json')
		)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
	}
	const page = await bucket.list({
		prefix,
		limit: PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX,
		...(observed?.progress.cursor ? { cursor: observed.progress.cursor } : {})
	});
	if (page.objects.length > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PAGE_CAP_EXCEEDED');
	}
	const nextCursor = page.truncated
		? typeof page.cursor === 'string' && page.cursor.length > 0 && page.cursor.length <= 2_048
			? page.cursor
			: (() => {
					throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_CURSOR_INVALID');
				})()
		: null;
	// R2's CAS receipt orders collectors; isolate wall clocks do not. Preserve a
	// monotonic logical mark/sweep clock so skew or a backward step can neither
	// corrupt retained marks nor shorten their grace.
	const now = Math.max(context.now ?? Date.now(), observed?.progress.updatedAt ?? 0);
	const candidateMap = new Map(
		(observed?.progress.candidates ?? [])
			.filter(({ key }) => !protectedKeys.has(key))
			.map((candidate) => [candidate.key, candidate] as const)
	);
	let marked = 0;
	for (const object of page.objects) {
		const coordinateKey = publicTemplatePageArtifactPayloadKeyForObject(object.key);
		if (
			candidateMap.size >= PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_CANDIDATE_MAX ||
			!object.key.includes('/template-page%3Aslug%3D') ||
			coordinateKey === null ||
			protectedKeys.has(coordinateKey) ||
			candidateMap.has(coordinateKey)
		) {
			continue;
		}
		candidateMap.set(coordinateKey, {
			key: coordinateKey,
			firstSeenUnreferencedAt: now
		});
		marked += 1;
	}
	const matured = [...candidateMap.values()]
		.filter(
			({ firstSeenUnreferencedAt }) =>
				firstSeenUnreferencedAt <= now - PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS
		)
		.slice(0, PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX);
	for (const { key } of matured) candidateMap.delete(key);
	const retainedCandidates = [...candidateMap.values()].sort((left, right) =>
		left.key.localeCompare(right.key)
	);
	const nextProgress = readPublicTemplatePageArtifactGcProgressValue({
		version: 2,
		cursor: nextCursor,
		candidates: retainedCandidates,
		updatedAt: now
	});
	const body = JSON.stringify(nextProgress);
	if (
		new TextEncoder().encode(body).byteLength > PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
	}
	const metadata = {
		customMetadata: { kind: 'template-page-artifact-gc-progress', schema: '2' },
		httpMetadata: { contentType: 'application/json' }
	};
	const advanced = observed
		? await bucket.put(progressKey, body, {
				...metadata,
				onlyIf: { etagMatches: observed.etag }
			})
		: await putR2ObjectIfAbsent(bucket, progressKey, body, metadata);
	if (!advanced) {
		return {
			scanned: page.objects.length,
			marked: 0,
			deleted: 0,
			fenced: true,
			cursor: nextCursor
		};
	}
	// Re-read the active plan after winning the ledger CAS. A concurrent target
	// can only make deletion more conservative: newly referenced keys leave the
	// ledger and must complete another full unreferenced grace later.
	const latestPlan = await readPublicTemplatePageBackfillProgress({ platform: context.platform });
	const latestProtectedKeys = new Set(protectedKeys);
	for (const coordinate of latestPlan?.progress.coordinates ?? []) {
		const revision = String(coordinate.artifactRevision);
		latestProtectedKeys.add(
			r2PayloadKey(
				r2CachePrefix(`template-page:slug=${coordinate.slug}`, context.platform),
				revision
			)
		);
	}
	const deletableCoordinates = matured
		.map(({ key }) => key)
		.filter((key) => !latestProtectedKeys.has(key));
	const deletableObjects = deletableCoordinates.flatMap((key) => [
		...publicTemplatePageArtifactPairForPayloadKey(key)
	]);
	if (deletableObjects.length > 0) await bucket.delete(deletableObjects);
	return {
		scanned: page.objects.length,
		marked,
		deleted: deletableCoordinates.length,
		fenced: false,
		cursor: nextCursor
	};
}

async function boundedStreamText(
	stream: ReadableStream<Uint8Array>,
	maximumBytes: number
): Promise<string | null> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let body = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > maximumBytes) {
				await reader.cancel('public-discovery body exceeds byte ceiling').catch(() => undefined);
				return null;
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		body += decoder.decode();
		return body;
	} finally {
		reader.releaseLock();
	}
}

async function boundedResponseJson(response: Response, maximumBytes: number): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^\d+$/.test(declared)) throw new Error('invalid Content-Length');
		const declaredBytes = Number(declared);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
			throw new Error('body exceeds byte ceiling');
		}
	}
	if (!response.body) throw new Error('response body missing');
	const body = await boundedStreamText(response.body, maximumBytes);
	if (body === null) throw new Error('body exceeds byte ceiling');
	return JSON.parse(body);
}

async function boundedR2Json(object: R2ObjectBody, maximumBytes: number): Promise<unknown> {
	if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > maximumBytes) {
		throw new Error('R2 body exceeds byte ceiling');
	}
	// Production R2 bodies expose a stream. The text fallback keeps local test
	// doubles compatible while retaining the authoritative R2 size precheck and
	// a post-read byte check.
	const stream = (object as R2ObjectBody & { body?: ReadableStream<Uint8Array> }).body;
	const body = stream
		? await boundedStreamText(stream, maximumBytes)
		: await object
				.text()
				.then((value) =>
					new TextEncoder().encode(value).byteLength <= maximumBytes ? value : null
				);
	if (body === null) throw new Error('R2 body exceeds byte ceiling');
	return JSON.parse(body);
}

function parseEnvelope<T>(
	raw: unknown,
	projectCachedValue?: CachedValueProjector<T>,
	persistedAt?: number
): CacheEnvelope<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<CacheEnvelope<T>>;
	const now = Date.now();
	const isSafeTimestamp = (value: unknown): value is number =>
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
	if (
		!isSafeTimestamp(candidate.cachedAt) ||
		candidate.cachedAt > now + PUBLIC_DISCOVERY_CACHE_CLOCK_SKEW_MS ||
		(persistedAt !== undefined &&
			(!isSafeTimestamp(persistedAt) ||
				candidate.cachedAt > persistedAt + PUBLIC_DISCOVERY_CACHE_CLOCK_SKEW_MS)) ||
		!('value' in candidate)
	) {
		return null;
	}
	// A remote writer may be marginally ahead of this isolate. Normalize that
	// harmless skew now so no future timestamp can extend the seven-day lease.
	// R2's upload timestamp is trusted durable receipt evidence: anchoring to it
	// prevents raw skew from regaining authority after a later cold-isolate read.
	const cachedAt = Math.min(candidate.cachedAt, now, persistedAt ?? candidate.cachedAt);
	if (
		candidate.retryAfter !== undefined &&
		(!isSafeTimestamp(candidate.retryAfter) ||
			candidate.retryAfter > now + PUBLIC_DISCOVERY_RETRY_MS + PUBLIC_DISCOVERY_CACHE_CLOCK_SKEW_MS)
	) {
		return null;
	}
	if (candidate.retryRevision !== undefined && typeof candidate.retryRevision !== 'string') {
		return null;
	}
	if (candidate.revision !== undefined && typeof candidate.revision !== 'string') return null;
	if (projectCachedValue) {
		try {
			return {
				...candidate,
				cachedAt,
				value: projectCachedValue(candidate.value, candidate.revision)
			} as CacheEnvelope<T>;
		} catch {
			return null;
		}
	}
	return { ...candidate, cachedAt } as CacheEnvelope<T>;
}

async function readEdge<T>(
	key: Request,
	projectCachedValue?: CachedValueProjector<T>
): Promise<CacheEnvelope<T> | null> {
	const cache = defaultCloudflareCache();
	if (!cache) return null;

	try {
		const response = await cache.match(key);
		if (!response) return null;
		return parseEnvelope<T>(
			await boundedResponseJson(response, PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES),
			projectCachedValue
		);
	} catch (error) {
		console.warn(
			'[public-discovery-cache] edge read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

type R2PayloadRead<T> =
	| { envelope: CacheEnvelope<T>; status: 'hit' }
	| { status: 'error' | 'miss' };

async function readR2Payload<T>(
	key: string,
	revision: string,
	platform?: App.Platform,
	projectCachedValue?: CachedValueProjector<T>
): Promise<R2PayloadRead<T>> {
	const bucket = publicDiscoveryR2(platform);
	if (!bucket) return { status: 'miss' };

	try {
		const object = await bucket.get(key);
		if (!object) return { status: 'miss' };
		const envelope = parseEnvelope<T>(
			await boundedR2Json(object, PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES),
			projectCachedValue,
			object.uploaded.getTime()
		);
		if (!envelope || envelope.revision !== revision) {
			console.warn('[public-discovery-cache] invalid R2 payload envelope:', key);
			return { status: 'error' };
		}
		return { envelope, status: 'hit' };
	} catch (error) {
		console.warn(
			'[public-discovery-cache] R2 payload read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return { status: 'error' };
	}
}

type PublicTemplateOgImageRead =
	| { bytes: Uint8Array; status: 'hit' }
	| { status: 'error' }
	| { status: 'miss' };

type R2BinaryObjectBody = R2ObjectBody & { arrayBuffer(): Promise<ArrayBuffer> };
type R2ObjectWithHttpMetadata = R2Object & { httpMetadata?: R2HTTPMetadata };

function copyPublicTemplateOgImage(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	const validated = readPublicTemplateOgImage(value);
	const copy = new Uint8Array(validated.byteLength);
	copy.set(validated);
	return copy;
}

async function boundedResponseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
	if (!response.body) throw new Error('response body missing');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > maximumBytes) {
				await reader.cancel('public template OG image exceeds byte ceiling').catch(() => undefined);
				throw new Error('body exceeds byte ceiling');
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function validPublicTemplateOgImageMetadata(
	object: R2Object,
	key: string,
	slug: string,
	revision: string
): boolean {
	return (
		object.key === key &&
		(object as R2ObjectWithHttpMetadata).httpMetadata?.contentType === 'image/png' &&
		object.customMetadata?.kind === 'template-og-image' &&
		object.customMetadata?.schema === '1' &&
		object.customMetadata?.revision === revision &&
		object.customMetadata?.slug === slug &&
		Number.isSafeInteger(object.size) &&
		object.size > 0 &&
		object.size <= PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES
	);
}

async function readR2PublicTemplateOgImage(
	bucket: R2Bucket,
	key: string,
	slug: string,
	revision: string
): Promise<PublicTemplateOgImageRead> {
	try {
		const object = await bucket.get(key);
		if (!object) return { status: 'miss' };
		if (
			!validPublicTemplateOgImageMetadata(object, key, slug, revision) ||
			typeof (object as Partial<R2BinaryObjectBody>).arrayBuffer !== 'function'
		) {
			console.warn('[public-discovery-cache] invalid R2 template OG metadata:', key);
			return { status: 'error' };
		}
		const body = await (object as R2BinaryObjectBody).arrayBuffer();
		if (body.byteLength !== object.size) {
			console.warn('[public-discovery-cache] invalid R2 template OG length:', key);
			return { status: 'error' };
		}
		return { bytes: copyPublicTemplateOgImage(body), status: 'hit' };
	} catch (error) {
		console.warn(
			'[public-discovery-cache] R2 template OG read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return { status: 'error' };
	}
}

async function readEdgePublicTemplateOgImage(
	key: Request,
	slug: string,
	revision: string
): Promise<PublicTemplateOgImageRead> {
	const cache = defaultCloudflareCache();
	if (!cache) return { status: 'miss' };
	try {
		const response = await cache.match(key);
		if (!response) return { status: 'miss' };
		const declared = response.headers.get('content-length');
		if (
			response.headers.get('content-type') !== 'image/png' ||
			response.headers.get('x-commons-template-slug') !== slug ||
			response.headers.get('x-commons-template-revision') !== revision ||
			declared === null ||
			!/^\d+$/.test(declared) ||
			!Number.isSafeInteger(Number(declared)) ||
			Number(declared) < 1 ||
			Number(declared) > PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES
		) {
			throw new Error('invalid edge metadata');
		}
		const body = await boundedResponseBytes(response, PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES);
		if (body.byteLength !== Number(declared)) throw new Error('invalid edge body length');
		return { bytes: copyPublicTemplateOgImage(body), status: 'hit' };
	} catch (error) {
		await cache.delete(key).catch(() => false);
		console.warn(
			'[public-discovery-cache] template OG edge read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return { status: 'miss' };
	}
}

function persistPublicTemplateOgImageEdge(
	key: Request,
	bytes: Uint8Array,
	slug: string,
	revision: string,
	platform?: App.Platform
): Promise<void> {
	const cache = defaultCloudflareCache();
	if (!cache) return Promise.resolve();
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	const write = cache
		.put(
			key,
			new Response(body, {
				headers: {
					'Cache-Control': `public, max-age=${Math.floor(PUBLIC_DISCOVERY_R2_RETENTION_MS / 1000)}, immutable`,
					'Content-Length': String(bytes.byteLength),
					'Content-Type': 'image/png',
					'X-Commons-Template-Revision': revision,
					'X-Commons-Template-Slug': slug
				}
			})
		)
		.catch((error) => {
			console.warn(
				'[public-discovery-cache] template OG edge write failed:',
				error instanceof Error ? error.message : String(error)
			);
		});
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(write);
		return Promise.resolve();
	}
	return write;
}

export class PublicTemplateOgImageNotPublishedError extends Error {
	readonly revision: string;
	readonly slug: string;

	constructor(slug: string, revision: string) {
		super(`Public template OG image ${slug}@${revision} has not been producer-published`);
		this.name = 'PublicTemplateOgImageNotPublishedError';
		this.slug = slug;
		this.revision = revision;
	}
}

function validatedPublicTemplateOgCoordinate(slug: string, revisionValue: number | string) {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) {
		throw new Error('Public template OG image slug is invalid');
	}
	const revision = String(revisionValue);
	if (
		revisionOrder(revision) === null ||
		!/^\d{1,20}$/.test(revision) ||
		!Number.isSafeInteger(Number(revision)) ||
		Number(revision) < 1 ||
		String(Number(revision)) !== revision
	) {
		throw new Error('Public template OG image revision is invalid');
	}
	return { revision, slug };
}

/**
 * Anonymous exact-coordinate reader. It may use only Cache API MATCH/PUT and
 * one exact R2 GET; it has no origin loader, stale pointer, LIST, or R2 write.
 */
export async function getPublicTemplateOgImageArtifact(context: {
	platform?: App.Platform;
	revision: number | string;
	slug: string;
	url: URL;
}): Promise<Uint8Array> {
	const { revision, slug } = validatedPublicTemplateOgCoordinate(context.slug, context.revision);
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for template OG image reads');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket)
		throw new Error('PUBLIC_DISCOVERY_R2 binding is required for template OG image reads');
	const cachePrefix = r2CachePrefix(`template-page:slug=${slug}`, context.platform);
	const objectKey = r2PublicTemplateOgImageKey(cachePrefix, revision);
	const edgeKey = publicTemplateOgImageEdgeKey(slug, revision, context.url, context.platform);
	const flightKey = edgeKey.url;
	const existing = publicTemplateOgImageFlights.get(flightKey);
	if (existing) return existing.then((bytes) => copyPublicTemplateOgImage(bytes));
	const pending = (async () => {
		const edge = await readEdgePublicTemplateOgImage(edgeKey, slug, revision);
		if (edge.status === 'hit') return edge.bytes;
		const exact = await readR2PublicTemplateOgImage(bucket, objectKey, slug, revision);
		if (exact.status === 'miss') throw new PublicTemplateOgImageNotPublishedError(slug, revision);
		if (exact.status === 'error') {
			throw new Error(`R2 template OG image ${slug}@${revision} could not be read safely`);
		}
		await persistPublicTemplateOgImageEdge(edgeKey, exact.bytes, slug, revision, context.platform);
		return exact.bytes;
	})().finally(() => {
		if (publicTemplateOgImageFlights.get(flightKey) === pending) {
			publicTemplateOgImageFlights.delete(flightKey);
		}
	});
	setBoundedMap(
		publicTemplateOgImageFlights,
		flightKey,
		pending,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
	return pending.then((bytes) => copyPublicTemplateOgImage(bytes));
}

function revisionOrder(revision: string): readonly bigint[] | null {
	// Revisions and millisecond timestamps originate as safe JavaScript numbers.
	// Bound decimal parsing so an attacker-shaped cache value cannot ask BigInt
	// to allocate for an arbitrarily long digit string.
	const surface = /^list=(\d{1,20}):(\d{1,20}|cold);relations=(\d{1,20}):(\d{1,20}|cold)$/.exec(
		revision
	);
	if (surface) {
		return [
			BigInt(surface[1]),
			surface[2] === 'cold' ? -1n : BigInt(surface[2]),
			BigInt(surface[3]),
			surface[4] === 'cold' ? -1n : BigInt(surface[4])
		];
	}
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
	if (!leftOrder || !rightOrder || leftOrder.length !== rightOrder.length) return null;
	for (let index = 0; index < leftOrder.length; index += 1) {
		if (leftOrder[index] !== rightOrder[index]) {
			return leftOrder[index] > rightOrder[index] ? 1 : -1;
		}
	}
	return 0;
}

function normalizedRetiredRevisionFloors(
	single: number | undefined,
	multiple: readonly number[] | undefined
): readonly number[] | undefined {
	if (single !== undefined && multiple !== undefined) return undefined;
	return multiple ?? (single === undefined ? undefined : [single]);
}

function revisionAdvancesFloors(order: readonly bigint[], floors: readonly number[]): boolean {
	return (
		floors.length * 2 === order.length &&
		floors.every(
			(floor, index) =>
				Number.isSafeInteger(floor) && floor >= 0 && order[index * 2] > BigInt(floor)
		)
	);
}

function revisionIsCoveredByFloors(order: readonly bigint[], floors: readonly number[]): boolean {
	return (
		floors.length * 2 === order.length &&
		floors.every(
			(floor, index) =>
				Number.isSafeInteger(floor) && floor >= 0 && order[index * 2] <= BigInt(floor)
		)
	);
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

function persistEnvelope<T>(
	edgeKey: Request,
	envelope: CacheEnvelope<T>,
	platform?: App.Platform
): Promise<void> {
	if (!defaultCloudflareCache()) return Promise.resolve();
	const write = persistEdge(edgeKey, envelope);

	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(write);
		return Promise.resolve();
	}

	return write;
}

export class PublicDiscoveryRefreshBackoffError extends Error {
	readonly retryAt: number;

	constructor(logicalKey: string, retryAt: number) {
		super(`Public discovery ${logicalKey} refresh is temporarily backed off`);
		this.name = 'PublicDiscoveryRefreshBackoffError';
		this.retryAt = retryAt;
	}
}

async function activeFailClosedRefreshRetry(
	identity: string,
	edgeKey: Request,
	now: number
): Promise<number | undefined> {
	const localRetryAt = failClosedRefreshRetryAfter.get(identity) ?? 0;
	if (localRetryAt > now) return localRetryAt;
	if (localRetryAt !== 0) failClosedRefreshRetryAfter.delete(identity);

	const marker = await readEdge<null>(edgeKey);
	const retryAt = marker?.retryRevision === 'fail-closed-refresh' ? (marker.retryAfter ?? 0) : 0;
	if (retryAt <= now) return undefined;
	setBoundedMap(
		failClosedRefreshRetryAfter,
		identity,
		retryAt,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
	return retryAt;
}

async function memoizeFailClosedRefreshFailure(
	identity: string,
	edgeKey: Request,
	backoffMs: number
): Promise<void> {
	const now = Date.now();
	const retryAt = now + backoffMs;
	setBoundedMap(
		failClosedRefreshRetryAfter,
		identity,
		retryAt,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
	await persistEdge(edgeKey, {
		cachedAt: now,
		retryAfter: retryAt,
		retryRevision: 'fail-closed-refresh',
		value: null
	});
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

function fallbackEnvelopeIsEligible<T>(
	envelope: CacheEnvelope<T> | null | undefined,
	retiredRevisionFloors: readonly number[] | undefined
): envelope is CacheEnvelope<T> {
	if (!envelope) return false;
	if (retiredRevisionFloors === undefined) return true;
	if (!envelope.revision) return false;
	const order = revisionOrder(envelope.revision);
	return order !== null && revisionAdvancesFloors(order, retiredRevisionFloors);
}

async function readCachedEnvelope<T>(
	identity: string,
	edgeKey: Request,
	edgePointerKey: Request | undefined,
	edgeKeyForRevision: ((revision: string) => Request) | undefined,
	cachePrefix: string,
	platform: App.Platform | undefined,
	refreshSharedLayers: boolean,
	revision: string | undefined,
	now: number,
	freshForMs: number,
	projectCachedValue?: CachedValueProjector<T>
): Promise<CacheEnvelope<T> | undefined> {
	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	if (inMemory && !refreshSharedLayers) return inMemory;

	const edge = await readEdge<T>(edgeKey, projectCachedValue);
	const local = preferredEnvelope(revision, inMemory, edge);
	if (local && local.revision === revision && now - local.cachedAt <= freshForMs) {
		setMemoryEnvelope(identity, local);
		return local;
	}
	if (local && revision !== undefined && local.revision === revision) {
		// The caller obtained this immutable coordinate from the fresh manifest and
		// projection validation already succeeded while reading `local`. Re-reading
		// either R2 or the same Convex snapshot cannot make the value more current;
		// it only creates a synchronized daily refresh herd across Worker isolates.
		// Renew only the free location-local lease and its recovery pointer.
		const recertified: CacheEnvelope<T> = {
			...local,
			cachedAt: now,
			retryAfter: undefined,
			retryRevision: undefined
		};
		setMemoryEnvelope(identity, recertified);
		const localRenewal = Promise.all([
			persistEdge(edgeKey, recertified),
			edgePointerKey && mayWriteRequestedRevision(cachePrefix, revision)
				? persistEdge(edgePointerKey, {
						cachedAt: now,
						revision,
						value: null
					})
				: Promise.resolve()
		]).then(() => undefined);
		if (platform?.context?.waitUntil) platform.context.waitUntil(localRenewal);
		else await localRenewal;
		return recertified;
	}

	const priorEdgePromise =
		edgePointerKey && edgeKeyForRevision && (!edge || edge.revision !== revision)
			? readEdge<null>(edgePointerKey).then((pointer) =>
					pointer?.revision && pointer.revision !== revision
						? readEdge<T>(edgeKeyForRevision(pointer.revision), projectCachedValue)
						: null
				)
			: Promise.resolve(null);
	const priorEdge = await priorEdgePromise;
	const envelope = preferredEnvelope(revision, inMemory, edge, priorEdge);
	if (!envelope) return undefined;

	setMemoryEnvelope(identity, envelope);
	return envelope;
}

function observeRequestedRevision(cachePrefix: string, revision: string | undefined): void {
	if (revision === undefined) return;
	const existing = latestRequestedRevision.get(cachePrefix);
	if (existing === undefined) {
		setBoundedMap(
			latestRequestedRevision,
			cachePrefix,
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
				cachePrefix,
				revision,
				PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
			);
		}
		return;
	}
	setBoundedMap(
		latestRequestedRevision,
		cachePrefix,
		revision,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
}

function mayWriteRequestedRevision(cachePrefix: string, revision: string | undefined): boolean {
	return revision === undefined || latestRequestedRevision.get(cachePrefix) === revision;
}

export class PublicDiscoveryPayloadNotPublishedError extends Error {
	readonly revision: string;

	constructor(revision: string) {
		super(`Public discovery revision ${revision} has not been producer-published`);
		this.name = 'PublicDiscoveryPayloadNotPublishedError';
		this.revision = revision;
	}
}

function exactRetirementKeys(
	cachePrefix: string,
	completedRevision: string,
	retireRevisions: readonly (number | string)[]
): string[] {
	if (retireRevisions.length > 8) {
		throw new Error('Public discovery producer retirement batch exceeds eight exact keys');
	}
	const keys = new Set<string>();
	for (const rawRevision of retireRevisions) {
		const revision = String(rawRevision);
		if (compareRevisions(revision, completedRevision) !== -1) {
			throw new Error('Public discovery producer may retire only an older exact revision');
		}
		keys.add(r2PayloadKey(cachePrefix, revision));
	}
	return [...keys];
}

/**
 * Retire the exact generations made unreachable by a staged withdrawal. The
 * manifest writer supplies its bounded, trusted generation ring; this helper
 * never discovers keys with LIST and validates the complete batch before I/O.
 */
export async function retireWithdrawnPublicDiscoveryPayloads(
	logicalKey: string,
	context: {
		platform: App.Platform;
		retiredRevisionFloor?: number;
		retiredRevisionFloors?: readonly number[];
		retireRevisions: readonly (number | string)[];
	}
): Promise<void> {
	if (
		(context.retiredRevisionFloor !== undefined && context.retiredRevisionFloors !== undefined) ||
		context.retireRevisions.length > 8
	) {
		throw new Error('Public discovery withdrawal retirement bounds are invalid');
	}
	const retiredRevisionFloors = normalizedRetiredRevisionFloors(
		context.retiredRevisionFloor,
		context.retiredRevisionFloors
	);
	if (!retiredRevisionFloors) {
		throw new Error('Public discovery withdrawal retirement floors are required');
	}
	const cachePrefix = r2CachePrefix(logicalKey, context.platform);
	const keys = new Set<string>();
	for (const rawRevision of context.retireRevisions) {
		const revision = String(rawRevision);
		const order = revisionOrder(revision);
		if (!order || !revisionIsCoveredByFloors(order, retiredRevisionFloors)) {
			throw new Error('Public discovery withdrawal may retire only a floor-covered revision');
		}
		keys.add(r2PayloadKey(cachePrefix, revision));
	}
	if (keys.size === 0) return;
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer retirement');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer retirement');
	await bucket.delete([...keys]);
}

/**
 * Delete exact producer-owned per-template coordinates without LIST. This is
 * intentionally narrower than general discovery retirement: only page-artifact
 * logical keys are accepted, and one call can name at most eight revisions.
 */
export async function retirePublicTemplatePageArtifactPayloads(
	logicalKey: string,
	context: { platform: App.Platform; revisions: readonly (number | string)[] }
): Promise<void> {
	if (!publicTemplateSlugFromLogicalKey(logicalKey) || context.revisions.length > 8) {
		throw new Error('Public template page artifact retirement bounds are invalid');
	}
	const revisions = [...new Set(context.revisions.map(String))];
	if (revisions.some((revision) => revisionOrder(revision) === null)) {
		throw new Error('Public template page artifact retirement revision is invalid');
	}
	if (revisions.length === 0) return;
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer retirement');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer retirement');
	const cachePrefix = r2CachePrefix(logicalKey, context.platform);
	const objectSets = revisions.map((revision) =>
		publicTemplatePageArtifactKeys(cachePrefix, revision)
	);
	await bucket.delete(objectSets.flatMap(([payload, ogImage]) => [payload, ogImage]));
}

/**
 * Bulk exact retirement for inventory removals. R2 accepts an array of exact
 * keys, so a full 250-entry withdrawal remains one Class-A operation instead
 * of one Worker subrequest per former slug. No key discovery is permitted.
 */
export async function retirePublicTemplatePageArtifactCoordinates(context: {
	platform: App.Platform;
	coordinates: readonly {
		logicalKey: string;
		revision: number | string;
	}[];
}): Promise<void> {
	if (context.coordinates.length > 250) {
		throw new Error('Public template page artifact bulk retirement cap exceeded');
	}
	const payloadKeys = new Set<string>();
	const ogImageKeys = new Set<string>();
	for (const coordinate of context.coordinates) {
		if (!publicTemplateSlugFromLogicalKey(coordinate.logicalKey)) {
			throw new Error('Public template page artifact bulk retirement key is invalid');
		}
		const revision = String(coordinate.revision);
		if (revisionOrder(revision) === null) {
			throw new Error('Public template page artifact bulk retirement revision is invalid');
		}
		const [payload, ogImage] = publicTemplatePageArtifactKeys(
			r2CachePrefix(coordinate.logicalKey, context.platform),
			revision
		);
		payloadKeys.add(payload);
		ogImageKeys.add(ogImage);
	}
	if (payloadKeys.size === 0) return;
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer retirement');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer retirement');
	await bucket.delete([...payloadKeys, ...ogImageKeys]);
}

export type PublicTemplatePageArtifactPublicationState = 'complete' | 'json-only' | 'missing';

/**
 * Producer-only exact pair HEAD state. Both siblings are independently bounded
 * and metadata-qualified; only `complete` may advance request-visible progress.
 */
export async function publicTemplatePageArtifactPublicationState(
	logicalKey: string,
	context: { platform: App.Platform; revision: number | string }
): Promise<PublicTemplatePageArtifactPublicationState> {
	const slug = publicTemplateSlugFromLogicalKey(logicalKey);
	if (!slug) {
		throw new Error('Public template page artifact state key is invalid');
	}
	const revision = String(context.revision);
	if (revisionOrder(revision) === null) {
		throw new Error('Public template page artifact state revision is invalid');
	}
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer artifact state');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket)
		throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer artifact state');
	const cachePrefix = r2CachePrefix(logicalKey, context.platform);
	const [payloadKey, ogImageKey] = publicTemplatePageArtifactKeys(cachePrefix, revision);
	const [payload, ogImage] = await Promise.all([bucket.head(payloadKey), bucket.head(ogImageKey)]);
	const payloadValid =
		payload !== null &&
		payload.key === payloadKey &&
		(payload as R2ObjectWithHttpMetadata).httpMetadata?.contentType === 'application/json' &&
		payload.customMetadata?.kind === 'payload' &&
		payload.customMetadata?.revision === revision &&
		Number.isSafeInteger(payload.size) &&
		payload.size > 0 &&
		payload.size <= PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES;
	const ogImageValid =
		ogImage !== null &&
		ogImage.key === ogImageKey &&
		(ogImage as R2ObjectWithHttpMetadata).httpMetadata?.contentType === 'image/png' &&
		ogImage.customMetadata?.kind === 'template-og-image' &&
		ogImage.customMetadata?.schema === '1' &&
		ogImage.customMetadata?.revision === revision &&
		ogImage.customMetadata?.slug === slug &&
		Number.isSafeInteger(ogImage.size) &&
		ogImage.size > 0 &&
		ogImage.size <= PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES;
	if ((payload !== null && !payloadValid) || (ogImage !== null && !ogImageValid)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_PAIR_CORRUPT');
	}
	if (payloadValid && ogImageValid) return 'complete';
	if (payloadValid) return 'json-only';
	if (ogImageValid) throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_PAIR_ORPHANED');
	return 'missing';
}

/** Backward-compatible boolean used by bounded producer tests/callers. */
export async function publicTemplatePageArtifactPayloadExists(
	logicalKey: string,
	context: { platform: App.Platform; revision: number | string }
): Promise<boolean> {
	return (await publicTemplatePageArtifactPublicationState(logicalKey, context)) === 'complete';
}

async function loadR2Winner<T>(
	bucket: R2Bucket,
	cachePrefix: string,
	revision: string,
	platform: App.Platform | undefined,
	loader: () => Promise<T>,
	projectCachedValue?: CachedValueProjector<T>
): Promise<CacheEnvelope<T>> {
	const loaded = await loader();
	const value = projectCachedValue ? projectCachedValue(loaded, revision) : loaded;
	const envelope: CacheEnvelope<T> = { cachedAt: Date.now(), revision, value };
	const payloadKey = r2PayloadKey(cachePrefix, revision);
	const serialized = JSON.stringify(envelope);
	if (new TextEncoder().encode(serialized).byteLength > PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES) {
		throw new Error('Public discovery payload exceeds serialized byte ceiling');
	}
	const written = await putR2ObjectIfAbsent(bucket, payloadKey, serialized, {
		customMetadata: { kind: 'payload', revision },
		httpMetadata: { contentType: 'application/json' }
	});
	if (!written) {
		// Another authenticated producer may have won the immutable create. The
		// exact object already in R2 is authoritative; never overwrite it.
		const existing = await readR2Payload<T>(payloadKey, revision, platform, projectCachedValue);
		if (existing.status === 'hit') return { ...existing.envelope, cachedAt: Date.now() };
		throw new Error(`R2 payload ${revision} appeared but could not be validated`);
	}

	return envelope;
}

/**
 * Publish one immutable payload from the authenticated control-plane owner.
 *
 * This is the only production path allowed to turn a missing exact generation
 * into Convex work or Class-A R2 operations. The manifest writer calls it
 * before making the generation visible. Retirement is producer-owned and uses
 * caller-supplied exact keys only—never LIST. Every retirement coordinate must
 * be strictly older than the completed revision, so a delayed older producer
 * cannot delete newer data.
 */
export async function publishPublicDiscoveryPayload<T>(
	logicalKey: string,
	context: {
		platform: App.Platform;
		projectCachedValue?: CachedValueProjector<T>;
		retireRevisions?: readonly (number | string)[];
		retiredRevisionFloor?: number;
		retiredRevisionFloors?: readonly number[];
		revision: number | string;
	},
	loader: () => Promise<T>
): Promise<T> {
	const revision = String(context.revision);
	const order = revisionOrder(revision);
	if (!order) throw new Error('Public discovery producer revision is invalid');
	if (context.retiredRevisionFloor !== undefined && context.retiredRevisionFloors !== undefined) {
		throw new Error('Public discovery producer floor configuration is ambiguous');
	}
	const retiredRevisionFloors = normalizedRetiredRevisionFloors(
		context.retiredRevisionFloor,
		context.retiredRevisionFloors
	);
	if (
		retiredRevisionFloors !== undefined &&
		!revisionAdvancesFloors(order, retiredRevisionFloors)
	) {
		throw new Error('Public discovery producer revision does not advance its withdrawal floors');
	}
	if (!configuredBackend(context.platform)) {
		throw new Error('PUBLIC_CONVEX_URL is required for producer publication');
	}
	const bucket = publicDiscoveryR2(context.platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for producer publication');

	const cachePrefix = r2CachePrefix(logicalKey, context.platform);
	const payloadKey = r2PayloadKey(cachePrefix, revision);
	// Validate the full retirement intent before the first shared read, origin
	// load, or mutation. An invalid authenticated producer request is zero-I/O.
	const retirementKeys = exactRetirementKeys(cachePrefix, revision, context.retireRevisions ?? []);
	const exact = await readR2Payload<T>(
		payloadKey,
		revision,
		context.platform,
		context.projectCachedValue
	);
	let envelope: CacheEnvelope<T>;
	if (exact.status === 'hit') {
		envelope = exact.envelope;
	} else {
		if (exact.status === 'error') {
			throw new Error(`R2 payload ${revision} could not be read safely`);
		}
		envelope = await loadR2Winner(
			bucket,
			cachePrefix,
			revision,
			context.platform,
			loader,
			context.projectCachedValue
		);
	}

	if (retirementKeys.length > 0) await bucket.delete(retirementKeys);
	return envelope.value;
}

async function loadVersionedThroughR2<T>(
	cachePrefix: string,
	platform: App.Platform | undefined,
	revision: string,
	projectCachedValue?: CachedValueProjector<T>
): Promise<CacheEnvelope<T>> {
	const bucket = publicDiscoveryR2(platform);
	if (!bucket) throw new Error('PUBLIC_DISCOVERY_R2 binding is required for versioned payloads');
	const payloadKey = r2PayloadKey(cachePrefix, revision);

	const exact = await readR2Payload<T>(payloadKey, revision, platform, projectCachedValue);
	if (exact.status === 'hit') return { ...exact.envelope, cachedAt: Date.now() };
	if (exact.status === 'error') throw new Error(`R2 payload ${revision} could not be read safely`);
	throw new PublicDiscoveryPayloadNotPublishedError(revision);
}

async function persistLoadedEnvelope<T>(
	edgeKey: Request,
	edgePointerKey: Request | undefined,
	cachePrefix: string,
	envelope: CacheEnvelope<T>
): Promise<void> {
	await persistEdge(edgeKey, envelope);
	if (edgePointerKey && mayWriteRequestedRevision(cachePrefix, envelope.revision)) {
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
	cachePrefix: string,
	platform: App.Platform | undefined,
	revision: string | undefined,
	r2Policy: 'none' | 'read-only',
	loader: () => Promise<T>,
	projectCachedValue?: CachedValueProjector<T>
): Promise<T> {
	const flightKey = `${identity}@${revision ?? 'unversioned'}`;
	const existing = inFlight.get(flightKey) as Promise<T> | undefined;
	if (existing) return existing;

	const pending = Promise.resolve()
		.then(async () => {
			let envelope: CacheEnvelope<T>;
			if (revision !== undefined && r2Policy !== 'none') {
				if (platform && !publicDiscoveryR2(platform)) {
					throw new Error('PUBLIC_DISCOVERY_R2 binding is required for versioned payloads');
				}
				envelope = publicDiscoveryR2(platform)
					? await loadVersionedThroughR2(cachePrefix, platform, revision, projectCachedValue)
					: await loader().then((loaded) => ({
							cachedAt: Date.now(),
							revision,
							value: projectCachedValue ? projectCachedValue(loaded, revision) : loaded
						}));
			} else {
				const loaded = await loader();
				envelope = {
					cachedAt: Date.now(),
					revision,
					value: projectCachedValue ? projectCachedValue(loaded, revision) : loaded
				};
			}
			setMemoryEnvelope(identity, envelope);
			if (defaultCloudflareCache()) {
				const persistence = persistLoadedEnvelope(edgeKey, edgePointerKey, cachePrefix, envelope);
				if (platform?.context?.waitUntil) platform.context.waitUntil(persistence);
				else await persistence;
			}
			return envelope.value;
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
	platform: App.Platform | undefined,
	envelope: CacheEnvelope<T>,
	error: unknown,
	reason: 'background refresh' | 'stale refresh',
	requestedRevision: string | undefined
): Promise<void> {
	const retryAfter = Date.now() + PUBLIC_DISCOVERY_RETRY_MS;
	const backedOff = {
		...envelope,
		retryAfter,
		retryRevision: requestedRevision ?? 'unversioned'
	};
	setMemoryEnvelope(identity, backedOff);
	// Retry markers are location-local; they must never mutate the immutable R2 LKG.
	await persistEnvelope(edgeKey, backedOff, platform);
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
	edgeRetryKey: Request,
	requestedRevision: string,
	localEnvelope: CacheEnvelope<T> | undefined,
	error: unknown,
	retiredRevisionFloors?: readonly number[]
): Promise<T> {
	const now = Date.now();
	const recovery = fallbackEnvelopeIsEligible(localEnvelope, retiredRevisionFloors)
		? localEnvelope
		: undefined;
	const recoveryIsUsable =
		recovery !== undefined && now - recovery.cachedAt <= PUBLIC_DISCOVERY_STALE_MS;

	// The requested immutable generation may already be present in a local edge
	// entry selected during this request. In that case recovery is complete;
	// warm the exact physical edge entry and do not install a failure marker.
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

	const marker: CacheEnvelope<null> = {
		cachedAt: recoveryIsUsable ? recovery.cachedAt : now,
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
	cachePrefix: string,
	platform: App.Platform | undefined,
	revision: string | undefined,
	r2Policy: 'none' | 'read-only',
	staleEnvelope: CacheEnvelope<T>,
	loader: () => Promise<T>,
	projectCachedValue?: CachedValueProjector<T>
): void {
	const refresh = loadAndCache(
		identity,
		edgeKey,
		edgePointerKey,
		cachePrefix,
		platform,
		revision,
		r2Policy,
		loader,
		projectCachedValue
	).catch((error) =>
		backOffEnvelope(
			identity,
			edgeKey,
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
async function resolveCachedPublicData<T>(
	logicalKey: string,
	context: CacheContext<T>,
	loader: () => Promise<T>
): Promise<T> {
	const freshForMs = context.freshForMs ?? PUBLIC_DISCOVERY_FRESH_MS;
	const forceRefresh = context.forceRefresh === true;
	const r2Policy = context.r2Policy ?? 'read-only';
	const now = Date.now();
	const revision = context.revision === undefined ? undefined : String(context.revision);
	if (context.retiredRevisionFloor !== undefined && context.retiredRevisionFloors !== undefined) {
		throw new Error('Public discovery requested floor configuration is ambiguous');
	}
	const retiredRevisionFloors = normalizedRetiredRevisionFloors(
		context.retiredRevisionFloor,
		context.retiredRevisionFloors
	);
	const requestedRevisionOrder = revisionOrder(revision ?? 'invalid');
	if (
		retiredRevisionFloors !== undefined &&
		(requestedRevisionOrder === null ||
			!revisionAdvancesFloors(requestedRevisionOrder, retiredRevisionFloors))
	) {
		throw new Error('Public discovery requested revision does not advance its withdrawal floors');
	}
	const identity = storageIdentity(logicalKey, context.url, context.platform);
	const failClosedRefreshBackoffMs =
		context.failClosedRefreshBackoffMs !== undefined &&
		Number.isSafeInteger(context.failClosedRefreshBackoffMs) &&
		context.failClosedRefreshBackoffMs > 0
			? Math.min(context.failClosedRefreshBackoffMs, PUBLIC_DISCOVERY_RETRY_MS)
			: undefined;
	const failClosedRefreshKey =
		failClosedRefreshBackoffMs === undefined
			? undefined
			: edgeFailClosedRefreshRetryKey(logicalKey, context.url, context.platform);
	const requireRefreshPermission = async (): Promise<void> => {
		if (forceRefresh || !failClosedRefreshKey) return;
		const retryAt = await activeFailClosedRefreshRetry(identity, failClosedRefreshKey, Date.now());
		if (retryAt !== undefined) throw new PublicDiscoveryRefreshBackoffError(logicalKey, retryAt);
	};
	const rejectWithoutStale = async (error: unknown): Promise<never> => {
		if (failClosedRefreshKey && failClosedRefreshBackoffMs !== undefined) {
			await memoizeFailClosedRefreshFailure(
				identity,
				failClosedRefreshKey,
				failClosedRefreshBackoffMs
			);
		}
		throw error;
	};
	const edgeKey = edgeCacheKey(logicalKey, context.url, context.platform, revision);
	const edgePointerKey =
		revision === undefined
			? undefined
			: edgeLkgPointerKey(logicalKey, context.url, context.platform);
	const revisionRetryKey =
		revision === undefined
			? undefined
			: edgeRevisionRetryKey(logicalKey, context.url, context.platform, revision);
	const cachePrefix = r2CachePrefix(logicalKey, context.platform);
	observeRequestedRevision(cachePrefix, revision);

	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	// A cold concurrent miss can coalesce before paying either shared-layer read.
	// Keep stale-memory behavior unchanged: those requests may still serve stale
	// immediately while a background refresh is in flight.
	if (!inMemory) {
		const activeFlight = inFlight.get(`${identity}@${revision ?? 'unversioned'}`) as
			| Promise<T>
			| undefined;
		if (activeFlight) return activeFlight;
	}
	const inMemoryAge = inMemory ? now - inMemory.cachedAt : Number.POSITIVE_INFINITY;
	const inMemoryRevisionMatches = inMemory?.revision === revision;
	if (
		!forceRefresh &&
		failClosedRefreshBackoffMs === undefined &&
		inMemory &&
		fallbackEnvelopeIsEligible(inMemory, retiredRevisionFloors) &&
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
		cachePrefix,
		context.platform,
		refreshSharedLayers,
		revision,
		now,
		freshForMs,
		context.projectCachedValue
	);
	const transitionMarker =
		revision !== undefined && revisionRetryKey && envelope?.revision !== revision
			? await readEdge<null>(revisionRetryKey)
			: null;
	if (revision !== undefined && revisionRetryKey && envelope?.revision !== revision) {
		if (
			transitionMarker?.retryRevision === revision &&
			transitionMarker.revision &&
			transitionMarker.revision !== revision
		) {
			const markerFallback = await readEdge<T>(
				edgeCacheKey(logicalKey, context.url, context.platform, transitionMarker.revision),
				context.projectCachedValue
			);
			envelope = newestEnvelope(envelope, markerFallback);
		}

		if (
			!forceRefresh &&
			transitionMarker &&
			revisionRetryIsActive(transitionMarker, revision, now)
		) {
			if (
				fallbackEnvelopeIsEligible(envelope, retiredRevisionFloors) &&
				now - envelope.cachedAt <= PUBLIC_DISCOVERY_STALE_MS
			) {
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
				if (fallbackEnvelopeIsEligible(envelope, retiredRevisionFloors)) {
					return envelope.value;
				}
				throw new Error(
					`Public discovery revision ${revision ?? 'unversioned'} refresh is temporarily backed off`
				);
			}

			if (!revisionMatches) {
				await requireRefreshPermission();
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						edgePointerKey,
						cachePrefix,
						context.platform,
						revision,
						r2Policy,
						loader,
						context.projectCachedValue
					);
				} catch (error) {
					if (context.shouldFallbackToStale?.(error) === false) {
						return rejectWithoutStale(error);
					}
					return recoverFailedRevision(
						identity,
						logicalKey,
						context.url,
						context.platform,
						revisionRetryKey!,
						revision!,
						envelope,
						error,
						retiredRevisionFloors
					);
				}
			}

			if (forceRefresh || context.refreshMode === 'blocking') {
				await requireRefreshPermission();
				try {
					return await loadAndCache(
						identity,
						edgeKey,
						edgePointerKey,
						cachePrefix,
						context.platform,
						revision,
						r2Policy,
						loader,
						context.projectCachedValue
					);
				} catch (error) {
					if (context.shouldFallbackToStale?.(error) === false) {
						return rejectWithoutStale(error);
					}
					await backOffEnvelope(
						identity,
						edgeKey,
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
				cachePrefix,
				context.platform,
				revision,
				r2Policy,
				envelope,
				loader,
				context.projectCachedValue
			);
			return envelope.value;
		}

		memoryCache.delete(identity);
	}

	await requireRefreshPermission();
	try {
		return await loadAndCache(
			identity,
			edgeKey,
			edgePointerKey,
			cachePrefix,
			context.platform,
			revision,
			r2Policy,
			loader,
			context.projectCachedValue
		);
	} catch (error) {
		if (context.shouldFallbackToStale?.(error) === false) {
			return rejectWithoutStale(error);
		}
		if (revision === undefined || !revisionRetryKey) throw error;
		return recoverFailedRevision(
			identity,
			logicalKey,
			context.url,
			context.platform,
			revisionRetryKey,
			revision,
			envelope,
			error,
			retiredRevisionFloors
		);
	}
}

/**
 * Return cached anonymous data while coalescing the complete resolution path.
 *
 * Installing this promise before invoking `resolveCachedPublicData` is
 * load-bearing: that function's first asynchronous work may be a Cache API or
 * R2 lookup, so publishing the flight afterward would still let sibling SSR
 * consumers duplicate those reads.
 */
export function getCachedPublicData<T>(
	logicalKey: string,
	context: CacheContext<T>,
	loader: () => Promise<T>
): Promise<T> {
	const revision = context.revision === undefined ? undefined : String(context.revision);
	const identity = storageIdentity(logicalKey, context.url, context.platform);
	const r2Policy = context.r2Policy ?? 'read-only';
	const freshness = context.freshForMs ?? PUBLIC_DISCOVERY_FRESH_MS;
	const refreshMode = context.refreshMode ?? 'background';
	const failClosedRefreshBackoffMs =
		context.failClosedRefreshBackoffMs !== undefined &&
		Number.isSafeInteger(context.failClosedRefreshBackoffMs) &&
		context.failClosedRefreshBackoffMs > 0
			? Math.min(context.failClosedRefreshBackoffMs, PUBLIC_DISCOVERY_RETRY_MS)
			: undefined;
	const retirementScope =
		context.retiredRevisionFloors?.join(',') ?? context.retiredRevisionFloor ?? 'none';
	const resolutionKey = `${identity}@${revision ?? 'unversioned'}@${context.forceRefresh === true ? 'force' : 'normal'}@fresh=${freshness}@mode=${refreshMode}@r2=${r2Policy}@fail-closed=${failClosedRefreshBackoffMs ?? 'none'}@retired-revisions=${retirementScope}`;
	const existing = resolutionFlights.get(resolutionKey) as Promise<T> | undefined;
	if (existing) return existing;

	// Defer invocation by one microtask so the map entry is visible before the
	// resolver can initiate its first shared-layer read.
	const pending = Promise.resolve()
		.then(() => resolveCachedPublicData(logicalKey, context, loader))
		.finally(() => {
			// A bounded-map eviction may allow a newer same-key resolution to start.
			// Never let the older completion erase that newer coordinator.
			if (resolutionFlights.get(resolutionKey) === pending) {
				resolutionFlights.delete(resolutionKey);
			}
		});
	setBoundedMap(
		resolutionFlights,
		resolutionKey,
		pending,
		PUBLIC_DISCOVERY_COORDINATION_MAX_ENTRIES
	);
	return pending;
}

/**
 * Read a still-valid payload without consulting its manifest or origin loader.
 *
 * This is intentionally a recovery-only path: callers use it when the tiny
 * manifest query itself fails, never when an authoritative manifest says a
 * family is not ready. Revision-qualified R2 objects make the selected LKG
 * monotonic even when old requests finish in other Worker isolates.
 */
async function resolveCachedPublicDataLastKnownGood<T>(
	logicalKey: string,
	context: Pick<CacheContext<T>, 'platform' | 'projectCachedValue' | 'url'>
): Promise<T | undefined> {
	const now = Date.now();
	const identity = storageIdentity(logicalKey, context.url, context.platform);
	const inMemory = memoryCache.get(identity) as CacheEnvelope<T> | undefined;
	const pointerKey = edgeLkgPointerKey(logicalKey, context.url, context.platform);
	const pointer = await readEdge<null>(pointerKey);
	const edge = pointer?.revision
		? await readEdge<T>(
				edgeCacheKey(logicalKey, context.url, context.platform, pointer.revision),
				context.projectCachedValue
			)
		: null;
	const local = newestEnvelope(inMemory, edge);
	const localIsUsable = local !== undefined && now - local.cachedAt <= PUBLIC_DISCOVERY_STALE_MS;
	if (!localIsUsable) return undefined;
	setMemoryEnvelope(identity, local);
	return local.value;
}

/**
 * Recover only an isolate/POP-local payload. This function is structurally
 * incapable of R2 access: without fresh manifest coordinates there is no exact
 * globally authoritative payload key to read, and LIST is forbidden on the
 * anonymous path.
 */
export function getCachedPublicDataLastKnownGood<T>(
	logicalKey: string,
	context: Pick<CacheContext<T>, 'platform' | 'projectCachedValue' | 'url'>
): Promise<T | undefined> {
	return resolveCachedPublicDataLastKnownGood(logicalKey, context);
}

/** Test-only reset for module-local state. */
export function clearPublicDiscoveryCache(): void {
	memoryCache.clear();
	resolutionFlights.clear();
	inFlight.clear();
	latestRequestedRevision.clear();
	failClosedRefreshRetryAfter.clear();
	publicTemplateOgImageFlights.clear();
	clearPublicDiscoveryManifestShield();
}
