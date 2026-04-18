/**
 * Shadow Atlas Content Store
 *
 * Fetches and caches shadow atlas data from content sources.
 * R2 is the primary production source (fast, reliable, Cloudflare-native).
 * IPFS gateways are a pluggable secondary source — activate by setting
 * IPFS_CID_ROOT + IPFS_GATEWAYS env vars when the ecosystem matures.
 *
 * Source priority: Local IPFS (dev) → R2 → IPFS gateways
 *
 * Chunked district mapping, per-district officials, and Merkle snapshots
 * are published quarterly and cached in-memory with 7-day TTL.
 *
 * This module has NO server-only imports ($env/dynamic/private).
 */

// BN254 validation — inlined here to keep this module browser-safe.
// client.ts imports $env/dynamic/private and cannot be imported from browser code.
const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function validateBN254Hex(value: string, label: string): void {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
		throw new Error(`Invalid ${label}: expected 0x-hex, got "${String(value).slice(0, 20)}"`);
	}
	if (BigInt(value) >= BN254_MODULUS) {
		throw new Error(`${label} exceeds BN254 field modulus`);
	}
}

function validateBN254HexArray(values: string[], label: string): void {
	if (!Array.isArray(values)) {
		throw new Error(`${label} must be an array`);
	}
	for (let i = 0; i < values.length; i++) {
		validateBN254Hex(values[i], `${label}[${i}]`);
	}
}

// ============================================================================
// Content Source Abstraction
// ============================================================================

/** A source that can resolve atlas content by relative path. */
interface ContentSource {
	readonly name: string;
	/** Construct a fetchable URL for a path (e.g., "US/cells/832a.json"). */
	url(path: string): string;
}

/** Local IPFS gateway for development (Docker commons-ipfs container) */
const LOCAL_IPFS_GATEWAY = 'http://localhost:8080/ipfs';

/** Cache TTL: 7 days (quarterly updates with comfortable margin) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Content fetch timeout */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Content source configuration.
 * Set at startup via configure() from env vars.
 *
 * R2 is the reliable floor — set atlasBaseUrl for production reads.
 * IPFS is the aspirational ceiling — set ipfsCid + ipfsGateways to activate.
 */
const CONTENT_CONFIG = {
	/** R2 or CDN base URL for direct HTTP reads (no CID in path). */
	atlasBaseUrl: '',
	/** IPFS root CID for content-addressed reads (when IPFS is active). */
	ipfsCid: '',
	/** Separate CID for Merkle snapshot (legacy IPFS — separate pin). */
	merkleSnapshotCid: '',
	/** IPFS gateway URLs, tried in order when ipfsCid is set. */
	ipfsGateways: [] as string[],
};

/**
 * Configure content sources at startup.
 * Called from hooks.server.ts (server) and browser-client.ts (browser).
 */
export function configure(opts: {
	atlasBaseUrl?: string;
	ipfsCid?: string;
	merkleSnapshotCid?: string;
	ipfsGateways?: string[];
}): void {
	if (opts.atlasBaseUrl != null) CONTENT_CONFIG.atlasBaseUrl = opts.atlasBaseUrl.replace(/\/$/, '');
	if (opts.ipfsCid != null) CONTENT_CONFIG.ipfsCid = opts.ipfsCid;
	if (opts.merkleSnapshotCid != null) CONTENT_CONFIG.merkleSnapshotCid = opts.merkleSnapshotCid;
	if (opts.ipfsGateways) CONTENT_CONFIG.ipfsGateways = opts.ipfsGateways;
}

/**
 * Backward-compat alias for configure().
 * @deprecated Use configure() instead.
 */
export function setCIDs(cids: Partial<{ root: string; merkleSnapshot: string }>): void {
	configure({ ipfsCid: cids.root, merkleSnapshotCid: cids.merkleSnapshot });
}

/**
 * Backward-compat read-only view of IPFS CIDs.
 * @deprecated Read from CONTENT_CONFIG directly in new code.
 */
export const IPFS_CIDS = {
	get root(): string { return CONTENT_CONFIG.ipfsCid; },
	get merkleSnapshot(): string { return CONTENT_CONFIG.merkleSnapshotCid; },
};

const isProduction = typeof globalThis.process === 'undefined' || globalThis.process.env?.NODE_ENV === 'production';

/**
 * Build ordered content source list. First success wins.
 *
 * Priority:
 *   1. Local IPFS gateway (dev only — Docker commons-ipfs, fast, no rate limits)
 *   2. R2 / CDN (production floor — reliable, free, Cloudflare-native)
 *   3. IPFS gateways (aspirational ceiling — content-addressed, decentralized)
 */
function getSources(): ContentSource[] {
	const sources: ContentSource[] = [];

	// Dev: local IPFS node
	if (!isProduction && CONTENT_CONFIG.ipfsCid) {
		sources.push({
			name: 'local-ipfs',
			url: (path) => `${LOCAL_IPFS_GATEWAY}/${CONTENT_CONFIG.ipfsCid}/${path}`,
		});
	}

	// R2 / CDN: primary production reads
	if (CONTENT_CONFIG.atlasBaseUrl) {
		sources.push({
			name: 'r2',
			url: (path) => `${CONTENT_CONFIG.atlasBaseUrl}/${path}`,
		});
	}

	// IPFS gateways: content-addressed verification / future primary
	if (CONTENT_CONFIG.ipfsCid) {
		for (const gw of CONTENT_CONFIG.ipfsGateways) {
			sources.push({
				name: `ipfs:${gw}`,
				url: (path) => `${gw}/${CONTENT_CONFIG.ipfsCid}/${path}`,
			});
		}
	}

	return sources;
}

// ============================================================================
// Path Sanitization
// ============================================================================

/**
 * Validate and return a path segment (country code, parentKey, districtCode, etc.).
 * Rejects traversal attacks and empty strings.
 *
 * @throws {Error} if segment contains `..`, `/`, `\`, or is empty
 */
export function sanitizePathSegment(s: string): string {
	if (!s || typeof s !== 'string') {
		throw new Error('IPFS path segment must be a non-empty string');
	}
	if (s.includes('..') || s.includes('/') || s.includes('\\')) {
		throw new Error(`IPFS path segment contains illegal characters: "${s}"`);
	}
	return s;
}

// ============================================================================
// Data Types (shared with substrate's build pipeline)
// ============================================================================

/**
 * District codes for a single H3 cell.
 *
 * Version 2: 24-element slot-indexed array matching the protocol's jurisdiction taxonomy.
 * Each slot is a district identifier string or null (unpopulated).
 *
 * Slot index → jurisdiction type (from voter-protocol jurisdiction.ts):
 *   0: Congressional District    1: Federal Senate          2: State Senate
 *   3: State House/Assembly      4: County                  5: City/Municipality
 *   6: City Council Ward         7: Unified School District 8: Elementary School District
 *   9: Secondary School District 10: Community College      11-18: Special districts
 *   19: Judicial District        20: Township/MCD           21: Voting Precinct
 *   22-23: Overflow
 *
 */
export interface CellDistricts {
	/** 24-element slot-indexed array. null for unpopulated slots. */
	slots: (string | null)[];
}

/**
 * Merkle tree snapshot (structure TBD — cipher owns path computation).
 * The `snapshot` field is opaque to this module; cipher defines and consumes it.
 */
export interface MerkleSnapshotData {
	version: number;
	vintage: string;
	/** Tree root as hex string (BN254 field element) */
	root: string;
	/** Tree depth (20 for production) */
	depth: number;
	/** Number of non-empty leaves */
	treeSize: number;
	/** Raw snapshot data — cipher's merkle-builder.ts consumes this */
	snapshot: unknown;
}

// ============================================================================
// Chunked Pipeline Types (complement to substrate's build pipeline)
// ============================================================================

/** Manifest for a country's chunked data */
export interface ChunkManifest {
	version: number;
	generated: string;
	country: string;
	totalCells: number;
	totalChunks: number;
	resolution: number;
	slotNames: Record<number, string>;
	chunks: Record<string, { path: string; cellCount: number; sha256: string }>;
	officials?: unknown;
	/** Cell chunks: combined districts + SMT proofs for client-side ZKP */
	cells?: {
		depth: number;
		cellMapRoot: string;
		totalChunks: number;
		chunks: Record<string, { path: string; cellCount: number }>;
	};
}

/** A single chunk file from the chunked pipeline */
export interface ChunkFile {
	version: number;
	country: string;
	layer: string;
	parentCell: string;
	resolution: number;
	cells: Record<string, (string | null)[]>;
}

/** Officials file from the chunked pipeline (per-district granularity) */
export interface OfficialsFileIPFS {
	version: number;
	country: string;
	district_code: string;
	officials: Array<{
		id: string;
		name: string;
		party: string;
		chamber: string;
		state: string;
		district: string | null;
		phone: string | null;
		office_address: string | null;
		contact_form_url: string | null;
		website_url: string | null;
		is_voting: boolean;
		delegate_type: string | null;
	}>;
	generated: string;
}

// ============================================================================
// Cell Chunk Types (Client-Side ZKP — combined districts + SMT proofs)
// ============================================================================

/**
 * Combined cell chunk: districts + Tree 2 SMT proofs per H3 parent group.
 * Published at `{source}/{country}/cells/{parentCell}.json`.
 * One fetch gives the client everything needed for ZK proof generation.
 */
export interface CellChunkFile {
	version: 1;
	country: string;
	parentCell: string;
	/** Tree 2 SMT root (0x-hex BN254) — same for all cells in this epoch */
	cellMapRoot: string;
	depth: number;
	generated: string;
	cells: Record<string, CellEntry>;
	cellCount: number;
	/** Optional H3 res-7 → cellId reverse index for lat/lng lookups */
	h3Index?: Record<string, string>;
}

/**
 * Per-cell entry: circuit-ready districts + SMT proof.
 * Keyed by cellId (GEOID string). H3 → cellId reverse lookup via h3Index.
 * Single-letter keys minimize JSON size.
 */
export interface CellEntry {
	/** cell_id as 0x-hex BN254 field element (GEOID encoded — circuit private input) */
	c: string;
	/** districts[24] as 0x-hex BN254 field elements */
	d: string[];
	/** SMT siblings from leaf to root (length = depth) */
	p: string[];
	/** SMT direction bits: 0=left, 1=right (length = depth) */
	b: number[];
	/** SMT collision attempt counter */
	a: number;
}

// ============================================================================
// District Index Types
// ============================================================================

/**
 * District index: maps (slot, fieldElementHex) → chunk keys.
 * One fetch replaces the O(n) chunk scan.
 * Published at `{source}/{country}/district-index.json`.
 */
export interface DistrictIndex {
	version: 1;
	generated: string;
	/** slot number (string) → { fieldElementHex → chunkKey[] } */
	slots: Record<string, Record<string, string[]>>;
	/** fieldElementHex → raw GEOID string (for display/matching) */
	labels: Record<string, string>;
}

// ============================================================================
// In-Memory Cache (CF Workers — per-isolate, cleared on redeploy)
// ============================================================================

interface CacheEntry<T> {
	data: T;
	cid: string;
	fetchedAt: number;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();

// ============================================================================
// LRU Cache (chunked pipeline — lightweight per-isolate caches)
// ============================================================================

class LRUCache<V> {
	private cache = new Map<string, { value: V; fetchedAt: number }>();
	constructor(private maxSize: number, private ttlMs: number) {}

	get(key: string): V | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.fetchedAt > this.ttlMs) {
			this.cache.delete(key);
			return undefined;
		}
		// Move to end (most recently used)
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V): void {
		if (this.cache.size >= this.maxSize) {
			// Evict oldest (first key in insertion order)
			const first = this.cache.keys().next().value;
			if (first !== undefined) this.cache.delete(first);
		}
		this.cache.set(key, { value, fetchedAt: Date.now() });
	}

	clear(): void {
		this.cache.clear();
	}
}

/** Chunk cache: ~8 KB per chunk, max 100 = ~800 KB */
const chunkCache = new LRUCache<ChunkFile>(100, CACHE_TTL_MS);

/** Officials file cache: ~2 KB per file, max 50 = ~100 KB */
const officialsFileCache = new LRUCache<OfficialsFileIPFS>(50, CACHE_TTL_MS);

/** Cell chunk cache (districts + SMT proofs): ~70 KB gzipped per chunk, max 50 = ~3.5 MB */
const cellChunkCache = new LRUCache<CellChunkFile>(50, CACHE_TTL_MS);

/** District index cache — one per country, ~50-200 KB */
const districtIndexCache = new LRUCache<DistrictIndex>(5, CACHE_TTL_MS);

/** Manifest cache — keyed by country code, refreshed when config changes or TTL expires */
const manifestCacheMap = new Map<string, { configKey: string; data: ChunkManifest; fetchedAt: number }>();

/**
 * Cache invalidation key — changes when the underlying data source changes.
 *
 * With IPFS (ipfsCid set): CID changes each quarterly upload → automatic invalidation.
 * With R2 only (atlasBaseUrl): URL is stable across updates → caches rely on 7-day TTL
 * and Worker isolate recycling. For explicit invalidation after quarterly uploads,
 * use versioned R2 paths (e.g., /v2026Q2/) or call clearCache() at deploy time.
 */
function getConfigKey(): string {
	return CONTENT_CONFIG.ipfsCid || CONTENT_CONFIG.atlasBaseUrl || '';
}

// ============================================================================
// Content Fetch
// ============================================================================

/** Sentinel error class for "file not found" (all sources returned 404). */
class ContentNotFoundError extends Error {
	constructor(path: string) {
		super(`Content not found: ${path}`);
		this.name = 'ContentNotFoundError';
	}
}

/**
 * Fetch a file by relative path, trying content sources in priority order.
 *
 * Path is relative to the content root, e.g. "US/manifest.json".
 *
 * Throws ContentNotFoundError when all sources return 404 (file doesn't exist).
 * Throws generic Error on network failures (timeout, DNS, 5xx, etc.).
 */
async function fetchContent<T>(path: string): Promise<T> {
	const sources = getSources();
	if (sources.length === 0) {
		throw new Error(
			'No content sources configured. Set ATLAS_BASE_URL (R2) or ' +
			'IPFS_CID_ROOT + IPFS_GATEWAYS (IPFS) to enable shadow atlas data.'
		);
	}

	let lastError: Error | null = null;
	let all404 = true;

	for (const source of sources) {
		try {
			const response = await fetch(source.url(path), {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				if (response.status !== 404) all404 = false;
				throw new Error(`${source.name} returned ${response.status} for ${path}`);
			}

			return (await response.json()) as T;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			// Network errors (timeout, DNS, etc.) are not 404s
			if (!(err instanceof Error && err.message.includes('returned 404'))) {
				all404 = false;
			}
			console.warn(`[Atlas Store] ${source.name} failed for ${path}: ${lastError.message}`);
		}
	}

	if (all404) {
		throw new ContentNotFoundError(path);
	}

	throw new Error(`All content sources failed for ${path}: ${lastError?.message}`);
}

/**
 * Fetch data by direct IPFS CID (not path-based).
 * Used for legacy Merkle snapshot fetch when only a separate CID is available.
 * Only activates when IPFS gateways are configured.
 */
async function fetchDirectCID<T>(cid: string, mode: 'json' | 'binary' = 'json'): Promise<T> {
	if (!cid) {
		throw new Error('CID not provided for direct fetch');
	}

	const gateways = !isProduction && CONTENT_CONFIG.ipfsCid
		? [LOCAL_IPFS_GATEWAY, ...CONTENT_CONFIG.ipfsGateways]
		: [...CONTENT_CONFIG.ipfsGateways];

	if (gateways.length === 0) {
		throw new Error('No IPFS gateways configured for direct CID fetch');
	}

	let lastError: Error | null = null;

	for (const gateway of gateways) {
		try {
			const url = `${gateway}/${cid}`;
			const accept = mode === 'binary' ? 'application/octet-stream' : 'application/json';
			const response = await fetch(url, {
				headers: { Accept: accept },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				throw new Error(`${gateway} returned ${response.status}`);
			}

			if (mode === 'binary') {
				return (await response.arrayBuffer()) as T;
			}
			return (await response.json()) as T;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`[Atlas Store] Gateway ${gateway} failed for CID ${cid}: ${lastError.message}`);
		}
	}

	throw new Error(`All gateways failed for CID ${cid}: ${lastError?.message}`);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch Merkle tree snapshot.
 * ~15-25 MB compressed (brotli).
 * Cipher's cell-tree-snapshot.ts deserializes + computes paths from this.
 * Cached in Worker memory for 7 days.
 *
 * Tries path-based fetch first (R2 or IPFS-in-DAG), then falls back
 * to direct CID fetch (legacy IPFS separate pin).
 */
export async function getMerkleSnapshot(): Promise<MerkleSnapshotData> {
	const cacheKey = 'merkle-snapshot';
	const configKey = getConfigKey();
	const cached = memoryStore.get(cacheKey) as CacheEntry<MerkleSnapshotData> | undefined;
	if (cached && cached.cid === configKey && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
		return cached.data;
	}

	// Path-based fetch (works with R2 and future IPFS-in-DAG)
	if (CONTENT_CONFIG.atlasBaseUrl || CONTENT_CONFIG.ipfsCid) {
		try {
			const data = await fetchContent<MerkleSnapshotData>('merkle-snapshot.json');
			memoryStore.set(cacheKey, { data, cid: configKey, fetchedAt: Date.now() });
			return data;
		} catch (err) {
			// Path-based fetch failed — fall through to legacy direct CID fetch.
			// Log so operators can diagnose R2 issues during migration.
			console.warn(
				'[Atlas Store] Path-based Merkle snapshot fetch failed, trying legacy CID:',
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	// Legacy: direct CID fetch for separate Merkle snapshot pin
	if (CONTENT_CONFIG.merkleSnapshotCid && CONTENT_CONFIG.ipfsGateways.length > 0) {
		const data = await fetchDirectCID<MerkleSnapshotData>(CONTENT_CONFIG.merkleSnapshotCid);
		memoryStore.set(cacheKey, { data, cid: configKey, fetchedAt: Date.now() });
		return data;
	}

	throw new Error(
		'Merkle snapshot not available: configure ATLAS_BASE_URL or ' +
		'IPFS_CID_ROOT + IPFS_GATEWAYS + IPFS_CID_MERKLE_SNAPSHOT'
	);
}

// ============================================================================
// Chunked Pipeline API
// ============================================================================

/**
 * Fetch the manifest for a country.
 * Cached in memory — refreshed when content config changes or TTL expires.
 */
export async function getManifest(country = 'US'): Promise<ChunkManifest> {
	const safeCountry = sanitizePathSegment(country);
	const configKey = getConfigKey();
	if (!configKey) throw new Error('No content source configured');

	const cached = manifestCacheMap.get(safeCountry);
	if (
		cached &&
		cached.configKey === configKey &&
		(Date.now() - cached.fetchedAt) < CACHE_TTL_MS
	) {
		return cached.data;
	}

	const data = await fetchContent<ChunkManifest>(`${safeCountry}/manifest.json`);
	manifestCacheMap.set(safeCountry, { configKey, data, fetchedAt: Date.now() });
	return data;
}

/**
 * Fetch district data for a specific H3 cell from the chunked store.
 *
 * 1. Compute cellToParent(cellIndex, 3) to find the parent cell
 * 2. Check LRU cache for the chunk
 * 3. Fetch chunk: {source}/{country}/districts/{parentCell}.json
 * 4. Return the 24-slot array for this cell, or null if not found
 *
 * Memory: ~8 KB per chunk, max 100 chunks = ~800 KB.
 */
export async function getChunkForCell(
	cellIndex: string,
	country = 'US',
): Promise<(string | null)[] | null> {
	const safeCountry = sanitizePathSegment(country);

	// Dynamic import keeps h3-js out of this module's static dependency graph.
	const { cellToParent } = await import('h3-js');
	const parentCell = sanitizePathSegment(cellToParent(cellIndex, 3));

	const cacheKey = `${safeCountry}/${parentCell}`;
	const cached = chunkCache.get(cacheKey);
	if (cached) {
		return cached.cells[cellIndex] ?? null;
	}

	try {
		const chunk = await fetchContent<ChunkFile>(
			`${safeCountry}/districts/${parentCell}.json`,
		);
		chunkCache.set(cacheKey, chunk);
		return chunk.cells[cellIndex] ?? null;
	} catch (err) {
		if (err instanceof ContentNotFoundError) return null;
		throw err;
	}
}

/**
 * Fetch officials for a specific district from the chunked store.
 *
 * Fetches: {source}/{country}/officials/{districtCode}.json
 * Returns null if the file doesn't exist (e.g., unpopulated district).
 */
export async function getOfficialsForDistrict(
	districtCode: string,
	country = 'US',
): Promise<OfficialsFileIPFS | null> {
	const safeCountry = sanitizePathSegment(country);
	const safeDistrict = sanitizePathSegment(districtCode);

	const cacheKey = `${safeCountry}/${safeDistrict}`;
	const cached = officialsFileCache.get(cacheKey);
	if (cached) return cached;

	try {
		const data = await fetchContent<OfficialsFileIPFS>(
			`${safeCountry}/officials/${safeDistrict}.json`,
		);
		officialsFileCache.set(cacheKey, data);
		return data;
	} catch (err) {
		if (err instanceof ContentNotFoundError) return null;
		throw err;
	}
}

// ============================================================================
// District Index API (O(1) district → chunk lookup)
// ============================================================================

/**
 * Fetch the district index for a country.
 * One fetch gives the browser a map from every district value (across all 24 slots)
 * to the chunk keys containing cells for that district.
 *
 * Cached per country. ~50-200 KB gzipped.
 */
export async function getDistrictIndex(country = 'US'): Promise<DistrictIndex | null> {
	if (!isConfigured()) return null;
	const safeCountry = sanitizePathSegment(country);

	const cacheKey = `district-index:${safeCountry}`;
	const cached = districtIndexCache.get(cacheKey);
	if (cached) return cached;

	try {
		const index = await fetchContent<DistrictIndex>(
			`${safeCountry}/district-index.json`,
		);
		districtIndexCache.set(cacheKey, index);
		return index;
	} catch (err) {
		if (err instanceof ContentNotFoundError) return null;
		throw err;
	}
}

// ============================================================================
// Cell Chunk API (client-side ZKP — districts + SMT proofs)
// ============================================================================

/**
 * Fetch a cell chunk by its known parent key (H3 res-3 parent or GEOID prefix).
 *
 * This is the preferred API when the caller already knows the parent key
 * (e.g., from H3 cellToParent). Avoids manifest lookup.
 */
export async function getCellChunkByParent(
	parentKey: string,
	country = 'US',
): Promise<CellChunkFile | null> {
	if (!isConfigured()) return null;
	const safeCountry = sanitizePathSegment(country);
	const safeParent = sanitizePathSegment(parentKey);

	const cacheKey = `cell:${safeCountry}/${safeParent}`;
	const cached = cellChunkCache.get(cacheKey);
	if (cached) return cached;

	try {
		const chunk = await fetchContent<CellChunkFile>(
			`${safeCountry}/cells/${safeParent}.json`,
		);

		// BR5-009: Validate all BN254 field elements before caching.
		// A compromised source could serve values >= BN254_MODULUS,
		// causing circuit failures or field aliasing attacks.
		validateBN254Hex(chunk.cellMapRoot, 'cellMapRoot');
		for (const [cellKey, entry] of Object.entries(chunk.cells)) {
			validateBN254Hex(entry.c, `cells[${cellKey}].c`);
			validateBN254HexArray(entry.d, `cells[${cellKey}].d`);
			validateBN254HexArray(entry.p, `cells[${cellKey}].p`);

			// Structural validation: catch malformed responses at fetch boundary
			if (entry.d.length !== 24) {
				throw new Error(`cells[${cellKey}].d has ${entry.d.length} slots, expected 24`);
			}
			if (entry.p.length !== chunk.depth) {
				throw new Error(`cells[${cellKey}].p has ${entry.p.length} siblings, expected ${chunk.depth}`);
			}
			if (entry.b.length !== chunk.depth) {
				throw new Error(`cells[${cellKey}].b has ${entry.b.length} bits, expected ${chunk.depth}`);
			}
			if (!entry.b.every((bit) => bit === 0 || bit === 1)) {
				throw new Error(`cells[${cellKey}].b contains non-binary values`);
			}
		}

		cellChunkCache.set(cacheKey, chunk);
		return chunk;
	} catch (err) {
		if (err instanceof ContentNotFoundError) return null;
		throw err;
	}
}

// ============================================================================
// Health & Maintenance
// ============================================================================

/**
 * Check primary content source reachability.
 * Uses a lightweight HEAD request.
 */
export async function checkHealth(): Promise<boolean> {
	try {
		const url = CONTENT_CONFIG.atlasBaseUrl || (
			CONTENT_CONFIG.ipfsGateways.length > 0 ? CONTENT_CONFIG.ipfsGateways[0] : null
		);
		if (!url) return false;

		const response = await fetch(url, {
			method: 'HEAD',
			signal: AbortSignal.timeout(5_000),
		});
		return response.ok || response.status === 400;
	} catch {
		return false;
	}
}

/** @deprecated Use checkHealth() instead. */
export const checkIPFSHealth = checkHealth;

/**
 * Clear all cached data. Forces re-fetch on next access.
 */
export async function clearCache(): Promise<void> {
	memoryStore.delete('merkle-snapshot');
	chunkCache.clear();
	officialsFileCache.clear();
	cellChunkCache.clear();
	districtIndexCache.clear();
	manifestCacheMap.clear();
}

/**
 * Check if any content source is configured (R2 or IPFS).
 * Use this before calling read functions.
 */
export function isConfigured(): boolean {
	return !!CONTENT_CONFIG.atlasBaseUrl || !!CONTENT_CONFIG.ipfsCid;
}

/** @deprecated Use isConfigured() instead. */
export const isIPFSConfigured = isConfigured;

/** @deprecated Use isConfigured() instead. */
export const isChunkedMode = isConfigured;
