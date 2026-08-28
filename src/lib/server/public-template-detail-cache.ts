import {
	MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES,
	readPublicTemplateDetailProjection,
	type PublicTemplateDetailProjection
} from '$convex/lib/publicTemplateDiscoverySource';
import { isValidPublicTemplateSlug } from './public-template-detail-path';

const CACHE_SCHEMA_VERSION = 'v1';
export const PUBLIC_TEMPLATE_DETAIL_CACHE_TTL_MS = 60_000;
export const PUBLIC_TEMPLATE_OG_CACHE_TTL_MS = 60_000;
export const PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_ENTRIES = 128;
export const PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES =
	MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES + 16 * 1024;
export const PUBLIC_TEMPLATE_OG_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const PUBLIC_TEMPLATE_OG_MEMORY_MAX_ENTRIES = 4;

type PublicTemplateAuthor = { name: string | null; avatar: string | null } | null;
export type CachedPublicTemplateDetail = PublicTemplateDetailProjection & {
	author: PublicTemplateAuthor;
};

type DetailCacheEnvelope = {
	version: 1;
	cachedAt: number;
	value: CachedPublicTemplateDetail | null;
};

type DetailCacheContext = {
	slug: string;
	url: URL;
	platform?: App.Platform;
	/** Legacy test seam only. Production page routes use immutable R2 artifacts. */
	load?: () => Promise<unknown>;
};

type OgCacheContext = {
	slug: string;
	url: URL;
	platform?: App.Platform;
	/** Bind a render to the exact detail-cache epoch that supplied its content. */
	sourceDetail?: CachedPublicTemplateDetail;
	render: () => Promise<Uint8Array>;
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

type CacheEpoch = object;
type DetailFlight = {
	epoch: CacheEpoch;
	promise: Promise<CachedPublicTemplateDetail | null>;
};
type OgFlight = {
	epoch: CacheEpoch;
	promise: Promise<Response>;
	sourceEpoch: CacheEpoch | null | undefined;
	sourceCachedAt: number | null | undefined;
};

type DetailProvenance = {
	identity: string;
	epoch: CacheEpoch;
	cachedAt: number;
};

type OgMemoryEntry = {
	cachedAt: number;
	expiresAt: number;
	sourceCachedAt: number | undefined;
	bytes: Uint8Array;
};

const detailMemory = new Map<string, DetailCacheEnvelope>();
const detailFlights = new Map<string, DetailFlight>();
const ogMemory = new Map<string, OgMemoryEntry>();
const ogFlights = new Map<string, OgFlight>();
// Every fill captures an opaque epoch. Invalidation rotates it before detaching
// active work, so an older caller may still receive its result without allowing
// that result to repopulate shared memory or Cache API state afterward.
const cacheEpochs = new Map<string, CacheEpoch>();
// Invalidations are rare, trusted authoring events. Keep their barriers active
// until old fills settle and the final delete completes; new readers await the
// barrier rather than racing a delete with an old Cache API hit.
const invalidationBarriers = new Map<string, Promise<void>>();
let detailProvenance = new WeakMap<CachedPublicTemplateDetail, DetailProvenance>();
const PUBLIC_TEMPLATE_CACHE_EPOCH_MAX_ENTRIES = 256;
const PUBLIC_TEMPLATE_CACHE_INVALIDATION_MAX_ENTRIES = 128;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, maximum: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > maximum) {
		const oldest = map.keys().next();
		if (oldest.done) break;
		map.delete(oldest.value);
	}
}

function cacheEpoch(identity: string): CacheEpoch {
	const existing = cacheEpochs.get(identity);
	if (existing) return existing;
	const epoch = {};
	boundedMapSet(cacheEpochs, identity, epoch, PUBLIC_TEMPLATE_CACHE_EPOCH_MAX_ENTRIES);
	return epoch;
}

function rotateCacheEpoch(identity: string): CacheEpoch {
	const epoch = {};
	boundedMapSet(cacheEpochs, identity, epoch, PUBLIC_TEMPLATE_CACHE_EPOCH_MAX_ENTRIES);
	return epoch;
}

function epochIsCurrent(identity: string, epoch: CacheEpoch): boolean {
	return cacheEpochs.get(identity) === epoch;
}

function stampDetailProvenance(
	value: CachedPublicTemplateDetail | null,
	identity: string,
	epoch: CacheEpoch,
	cachedAt: number
): CachedPublicTemplateDetail | null {
	if (value) detailProvenance.set(value, { identity, epoch, cachedAt });
	return value;
}

function sourceDetailProvenance(
	identity: string,
	sourceDetail: CachedPublicTemplateDetail | undefined
): DetailProvenance | null | undefined {
	if (sourceDetail === undefined) return undefined;
	const provenance = detailProvenance.get(sourceDetail);
	return provenance?.identity === identity ? provenance : null;
}

function ogPublicationIsCurrent(
	identity: string,
	epoch: CacheEpoch,
	source: DetailProvenance | null | undefined
): boolean {
	return epochIsCurrent(identity, epoch) && (source === undefined || source?.epoch === epoch);
}

function ogEntryMatchesSource(
	entry: Pick<OgMemoryEntry, 'sourceCachedAt'>,
	source: DetailProvenance | null | undefined
): boolean {
	if (source === null) return false;
	return source === undefined || entry.sourceCachedAt === source.cachedAt;
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
	const origin = url.origin.toLowerCase();
	const backend = configuredBackend(platform);
	return backend ? `origin=${origin}|backend=${backend}` : `origin=${origin}`;
}

function cacheIdentity(slug: string, url: URL, platform?: App.Platform): string {
	return `${CACHE_SCHEMA_VERSION}|${cacheScope(url, platform)}|${slug}`;
}

function cacheKey(
	family: 'detail' | 'og-image',
	slug: string,
	url: URL,
	platform?: App.Platform
): Request {
	const key = new URL(url.origin);
	key.pathname = `/.internal-cache/public-template/${CACHE_SCHEMA_VERSION}/${encodeURIComponent(cacheScope(url, platform))}/${family}/${encodeURIComponent(slug)}`;
	return new Request(key, { method: 'GET' });
}

function defaultCache(): Cache | undefined {
	if (typeof caches === 'undefined') return undefined;
	return (caches as CloudflareCacheStorage).default;
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function readAuthor(value: unknown): PublicTemplateAuthor {
	if (value === null) return null;
	if (!isPlainRecord(value) || !hasOnlyKeys(value, ['name', 'avatar'])) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:author');
	}
	const name = value.name;
	const avatar = value.avatar;
	if (
		(name !== null && (typeof name !== 'string' || utf8Bytes(name) > 2_048)) ||
		(avatar !== null && (typeof avatar !== 'string' || utf8Bytes(avatar) > 8_192))
	) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:author-shape');
	}
	return { name, avatar } as PublicTemplateAuthor;
}

function projectDetail(value: unknown, expectedSlug: string): CachedPublicTemplateDetail {
	if (!isPlainRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'author')) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:container');
	}
	const { author, ...rawDetail } = value;
	const detail = readPublicTemplateDetailProjection(rawDetail);
	if (detail.slug !== expectedSlug) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:slug');
	}
	const projected = { ...detail, author: readAuthor(author) };
	if (utf8Bytes(JSON.stringify(projected)) > PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:oversize');
	}
	return projected;
}

/** Exhaustive reconstruction shared by producer-published page artifacts. */
export function readCachedPublicTemplateDetail(
	value: unknown,
	expectedSlug: string
): CachedPublicTemplateDetail {
	return projectDetail(value, expectedSlug);
}

/**
 * Bind an immutable producer artifact to the existing OG provenance fence.
 * The artifact reader returns the same reconstructed object for the lifetime
 * of its memory/Cache API entry, so the first stamp gives OG rendering a stable
 * 60-second source lease without reintroducing a detail-origin query.
 */
export function stampProducerPublishedTemplateDetail(input: {
	detail: CachedPublicTemplateDetail;
	slug: string;
	url: URL;
	platform?: App.Platform;
}): CachedPublicTemplateDetail {
	const identity = cacheIdentity(input.slug, input.url, input.platform);
	const epoch = cacheEpoch(identity);
	const existing = detailProvenance.get(input.detail);
	if (existing?.identity === identity && existing.epoch === epoch) return input.detail;
	return stampDetailProvenance(input.detail, identity, epoch, Date.now())!;
}

function envelopeIsFresh(envelope: DetailCacheEnvelope, now: number): boolean {
	return (
		Number.isSafeInteger(envelope.cachedAt) &&
		envelope.cachedAt <= now &&
		now - envelope.cachedAt <= PUBLIC_TEMPLATE_DETAIL_CACHE_TTL_MS
	);
}

function parseEnvelope(value: unknown, expectedSlug: string, now: number): DetailCacheEnvelope {
	if (
		!isPlainRecord(value) ||
		!hasOnlyKeys(value, ['version', 'cachedAt', 'value']) ||
		value.version !== 1 ||
		typeof value.cachedAt !== 'number'
	) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:envelope');
	}
	const envelope: DetailCacheEnvelope = {
		version: 1,
		cachedAt: value.cachedAt,
		value: value.value === null ? null : projectDetail(value.value, expectedSlug)
	};
	if (!envelopeIsFresh(envelope, now)) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:expired');
	}
	return envelope;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^\d+$/.test(declared) || Number(declared) > maximumBytes) {
			throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:content-length');
		}
	}
	if (!response.body) throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:body');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let body = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maximumBytes) {
				await reader.cancel('cache payload exceeds byte ceiling').catch(() => undefined);
				throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:oversize-body');
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		return body + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

async function readDetailEdge(
	cache: Cache,
	key: Request,
	slug: string,
	now: number
): Promise<DetailCacheEnvelope | null> {
	const response = await cache.match(key);
	if (!response) return null;
	try {
		const body = await boundedResponseText(response, PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES);
		return parseEnvelope(JSON.parse(body), slug, now);
	} catch {
		await cache.delete(key).catch(() => false);
		return null;
	}
}

async function persistDetailEdge(
	cache: Cache,
	key: Request,
	envelope: DetailCacheEnvelope,
	platform: App.Platform | undefined,
	isCurrent: () => boolean
): Promise<void> {
	const body = JSON.stringify(envelope);
	if (utf8Bytes(body) > PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_CACHE_INVALID:serialized-oversize');
	}
	const write = cache
		.put(
			key,
			new Response(body, {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `public, max-age=${PUBLIC_TEMPLATE_DETAIL_CACHE_TTL_MS / 1_000}`,
					'Content-Length': String(utf8Bytes(body))
				}
			})
		)
		.then(async () => {
			// `waitUntil` can let an invalidation finish before an older PUT lands.
			// Compensate after the write so that ordering cannot resurrect the entry.
			if (!isCurrent()) await cache.delete(key).catch(() => false);
		});
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(
			write.catch((error) =>
				console.warn('[public-template-cache] Detail cache write failed', error)
			)
		);
		return;
	}
	await write;
}

async function resolveDetail(
	context: DetailCacheContext,
	identity: string,
	epoch: CacheEpoch
): Promise<CachedPublicTemplateDetail | null> {
	const { slug, url, platform } = context;
	if (!isValidPublicTemplateSlug(slug)) {
		throw new Error('PUBLIC_TEMPLATE_SLUG_INVALID');
	}
	const now = Date.now();
	const memory = detailMemory.get(identity);
	if (memory && envelopeIsFresh(memory, now)) {
		return stampDetailProvenance(memory.value, identity, epoch, memory.cachedAt);
	}
	if (memory) detailMemory.delete(identity);

	const cache = defaultCache();
	const key = cacheKey('detail', slug, url, platform);
	if (cache) {
		const edge = await readDetailEdge(cache, key, slug, now);
		if (edge) {
			if (epochIsCurrent(identity, epoch)) {
				boundedMapSet(detailMemory, identity, edge, PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_ENTRIES);
			}
			return stampDetailProvenance(edge.value, identity, epoch, edge.cachedAt);
		}
	}

	if (!context.load) {
		throw new Error('PUBLIC_TEMPLATE_DETAIL_ORIGIN_FALLBACK_RETIRED');
	}
	const raw = await context.load();
	const envelope: DetailCacheEnvelope = {
		version: 1,
		cachedAt: Date.now(),
		value: raw === null ? null : projectDetail(raw, slug)
	};
	if (epochIsCurrent(identity, epoch)) {
		boundedMapSet(detailMemory, identity, envelope, PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_ENTRIES);
		if (cache) {
			await persistDetailEdge(cache, key, envelope, platform, () =>
				epochIsCurrent(identity, epoch)
			);
		}
	}
	return stampDetailProvenance(envelope.value, identity, epoch, envelope.cachedAt);
}

/**
 * Resolve the complete memory -> Cache API -> one bounded Convex query path
 * under a per-isolate single flight. Null is a first-class 60-second negative
 * entry, so repeated probes for the same nonexistent slug cost no extra I/O.
 */
export function getCachedPublicTemplateDetail(
	context: DetailCacheContext
): Promise<CachedPublicTemplateDetail | null> {
	if (!isValidPublicTemplateSlug(context.slug)) {
		return Promise.reject(new Error('PUBLIC_TEMPLATE_SLUG_INVALID'));
	}
	const identity = cacheIdentity(context.slug, context.url, context.platform);
	const barrier = invalidationBarriers.get(identity);
	if (barrier) return barrier.then(() => getCachedPublicTemplateDetail(context));
	const epoch = cacheEpoch(identity);
	const existing = detailFlights.get(identity);
	if (existing?.epoch === epoch) return existing.promise;
	const pending = Promise.resolve()
		.then(() => resolveDetail(context, identity, epoch))
		.finally(() => {
			if (detailFlights.get(identity)?.promise === pending) detailFlights.delete(identity);
		});
	boundedMapSet(
		detailFlights,
		identity,
		{ epoch, promise: pending },
		PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_ENTRIES
	);
	return pending;
}

function ogHeaders(expiresAt: number, now = Date.now()): HeadersInit {
	const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - now) / 1_000));
	return {
		'Content-Type': 'image/png',
		'Cache-Control': `public, max-age=${maxAgeSeconds}, must-revalidate`,
		'Cloudflare-CDN-Cache-Control': `public, max-age=${maxAgeSeconds}, must-revalidate`
	};
}

function ogResponse(bytes: Uint8Array, expiresAt: number): Response {
	return new Response(bytes.slice(), { headers: ogHeaders(expiresAt) });
}

async function readOgEdge(
	cache: Cache,
	key: Request,
	now: number,
	source: DetailProvenance | null | undefined
): Promise<OgMemoryEntry | null> {
	const response = await cache.match(key);
	if (!response || response.headers.get('content-type') !== 'image/png') return null;
	const cachedAt = Number(response.headers.get('x-commons-cached-at'));
	const expiresAt = Number(response.headers.get('x-commons-expires-at'));
	const sourceHeader = response.headers.get('x-commons-source-cached-at');
	const sourceCachedAt = sourceHeader === null ? undefined : Number(sourceHeader);
	const declared = Number(response.headers.get('content-length'));
	if (
		!Number.isSafeInteger(cachedAt) ||
		cachedAt > now ||
		!Number.isSafeInteger(expiresAt) ||
		expiresAt < now ||
		expiresAt < cachedAt ||
		expiresAt > cachedAt + PUBLIC_TEMPLATE_OG_CACHE_TTL_MS ||
		(sourceHeader !== null && !Number.isSafeInteger(sourceCachedAt)) ||
		!ogEntryMatchesSource({ sourceCachedAt }, source) ||
		(source !== undefined &&
			source !== null &&
			expiresAt > source.cachedAt + PUBLIC_TEMPLATE_DETAIL_CACHE_TTL_MS) ||
		!Number.isSafeInteger(declared) ||
		declared < 0 ||
		declared > PUBLIC_TEMPLATE_OG_CACHE_MAX_BYTES
	) {
		await cache.delete(key).catch(() => false);
		return null;
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength !== declared || bytes.byteLength > PUBLIC_TEMPLATE_OG_CACHE_MAX_BYTES) {
		await cache.delete(key).catch(() => false);
		return null;
	}
	return { bytes, cachedAt, expiresAt, sourceCachedAt };
}

async function resolveOg(
	context: OgCacheContext,
	identity: string,
	epoch: CacheEpoch,
	source: DetailProvenance | null | undefined
): Promise<Response> {
	const { slug, url, platform } = context;
	if (!isValidPublicTemplateSlug(slug)) throw new Error('PUBLIC_TEMPLATE_SLUG_INVALID');
	const now = Date.now();
	const sourceIsCurrent = ogPublicationIsCurrent(identity, epoch, source);
	const memory = ogMemory.get(identity);
	if (
		sourceIsCurrent &&
		memory &&
		memory.cachedAt <= now &&
		memory.expiresAt >= now &&
		ogEntryMatchesSource(memory, source)
	) {
		return ogResponse(memory.bytes, memory.expiresAt);
	}
	if (memory) ogMemory.delete(identity);

	const cache = defaultCache();
	const key = cacheKey('og-image', slug, url, platform);
	if (cache && sourceIsCurrent) {
		const edge = await readOgEdge(cache, key, now, source);
		if (edge) {
			if (ogPublicationIsCurrent(identity, epoch, source)) {
				boundedMapSet(ogMemory, identity, edge, PUBLIC_TEMPLATE_OG_MEMORY_MAX_ENTRIES);
			}
			return ogResponse(edge.bytes, edge.expiresAt);
		}
	}

	const rendered = await context.render();
	const bytes = new Uint8Array(rendered);
	if (bytes.byteLength === 0 || bytes.byteLength > PUBLIC_TEMPLATE_OG_CACHE_MAX_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_OG_CACHE_INVALID:render-size');
	}
	const cachedAt = Date.now();
	const expiresAt = Math.min(
		cachedAt + PUBLIC_TEMPLATE_OG_CACHE_TTL_MS,
		source === undefined
			? Number.POSITIVE_INFINITY
			: source === null
				? cachedAt
				: source.cachedAt + PUBLIC_TEMPLATE_DETAIL_CACHE_TTL_MS
	);
	const sourceCachedAt = source?.cachedAt;
	if (expiresAt >= cachedAt && ogPublicationIsCurrent(identity, epoch, source)) {
		const entry = { cachedAt, expiresAt, sourceCachedAt, bytes };
		boundedMapSet(ogMemory, identity, entry, PUBLIC_TEMPLATE_OG_MEMORY_MAX_ENTRIES);
		if (cache) {
			const edgeMaxAgeSeconds = Math.max(0, Math.floor((expiresAt - cachedAt) / 1_000));
			const write = cache
				.put(
					key,
					new Response(bytes.slice(), {
						headers: {
							'Content-Type': 'image/png',
							'Cache-Control': `public, max-age=${edgeMaxAgeSeconds}`,
							'Content-Length': String(bytes.byteLength),
							'X-Commons-Cached-At': String(cachedAt),
							'X-Commons-Expires-At': String(expiresAt),
							...(sourceCachedAt === undefined
								? {}
								: { 'X-Commons-Source-Cached-At': String(sourceCachedAt) })
						}
					})
				)
				.then(async () => {
					if (!ogPublicationIsCurrent(identity, epoch, source)) {
						await cache.delete(key).catch(() => false);
					}
				});
			if (platform?.context?.waitUntil) {
				platform.context.waitUntil(
					write.catch((error) =>
						console.warn('[public-template-cache] OG cache write failed', error)
					)
				);
			} else {
				await write;
			}
		}
	}
	return ogResponse(bytes, expiresAt);
}

/** Coalesce both the Cache API miss and the expensive Satori/Sharp render. */
export function getCachedPublicTemplateOgImage(context: OgCacheContext): Promise<Response> {
	if (!isValidPublicTemplateSlug(context.slug)) {
		return Promise.reject(new Error('PUBLIC_TEMPLATE_SLUG_INVALID'));
	}
	const identity = cacheIdentity(context.slug, context.url, context.platform);
	const barrier = invalidationBarriers.get(identity);
	if (barrier) return barrier.then(() => getCachedPublicTemplateOgImage(context));
	const epoch = cacheEpoch(identity);
	const source = sourceDetailProvenance(identity, context.sourceDetail);
	const sourceEpoch = source === null ? null : source?.epoch;
	const sourceCachedAt = source === null ? null : source?.cachedAt;
	const existing = ogFlights.get(identity);
	if (
		existing?.epoch === epoch &&
		existing.sourceEpoch === sourceEpoch &&
		existing.sourceCachedAt === sourceCachedAt
	) {
		return existing.promise.then((response) => response.clone());
	}
	const pending = Promise.resolve()
		.then(() => resolveOg(context, identity, epoch, source))
		.finally(() => {
			if (ogFlights.get(identity)?.promise === pending) ogFlights.delete(identity);
		});
	boundedMapSet(
		ogFlights,
		identity,
		{ epoch, promise: pending, sourceEpoch, sourceCachedAt },
		PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_ENTRIES
	);
	return pending.then((response) => response.clone());
}

/** Explicitly evict current detail, negative, and rendered-image entries. */
export async function invalidatePublicTemplateCaches(input: {
	slug: string;
	url: URL;
	platform?: App.Platform;
}): Promise<void> {
	if (!isValidPublicTemplateSlug(input.slug)) return;
	const identity = cacheIdentity(input.slug, input.url, input.platform);
	const priorBarrier = invalidationBarriers.get(identity);
	if (
		!priorBarrier &&
		!invalidationBarriers.has(identity) &&
		invalidationBarriers.size >= PUBLIC_TEMPLATE_CACHE_INVALIDATION_MAX_ENTRIES
	) {
		throw new Error('PUBLIC_TEMPLATE_CACHE_INVALIDATION_CAPACITY_EXCEEDED');
	}

	const barrier = (async () => {
		if (priorBarrier) await priorBarrier;

		rotateCacheEpoch(identity);
		const detailFlight = detailFlights.get(identity)?.promise;
		const ogFlight = ogFlights.get(identity)?.promise;
		// Detach before waiting. Requests arriving after this point see the barrier,
		// and no post-invalidation caller can join one of these old promises.
		detailFlights.delete(identity);
		ogFlights.delete(identity);
		detailMemory.delete(identity);
		ogMemory.delete(identity);

		try {
			await Promise.allSettled([detailFlight, ogFlight].filter((flight) => flight !== undefined));
			const cache = defaultCache();
			if (cache) {
				await Promise.all([
					cache.delete(cacheKey('detail', input.slug, input.url, input.platform)),
					cache.delete(cacheKey('og-image', input.slug, input.url, input.platform))
				]);
			}
		} finally {
			// Fence any delayed `waitUntil` PUT and clear a promotion that raced the
			// first deletion. Delayed writers perform their own compensating delete.
			rotateCacheEpoch(identity);
			detailMemory.delete(identity);
			ogMemory.delete(identity);
		}
	})();
	invalidationBarriers.set(identity, barrier);
	try {
		await barrier;
	} finally {
		if (invalidationBarriers.get(identity) === barrier) invalidationBarriers.delete(identity);
	}
}

/** Test-only isolate reset. Cache API state remains independently observable. */
export function clearPublicTemplateCachesForTest(): void {
	detailMemory.clear();
	detailFlights.clear();
	ogMemory.clear();
	ogFlights.clear();
	cacheEpochs.clear();
	invalidationBarriers.clear();
	detailProvenance = new WeakMap();
}
