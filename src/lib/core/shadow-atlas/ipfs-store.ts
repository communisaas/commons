/**
 * IPFS Data Store for Shadow Atlas
 *
 * Fetches and caches content-addressed data from IPFS gateways.
 * Chunked district mapping, per-district officials, and Merkle snapshots
 * are pinned to IPFS quarterly and cached in-memory with 7-day TTL.
 *
 * Server-only: runs in CF Workers (in-memory Map per-isolate).
 * Browser never downloads the full datasets — server-side API routes
 * resolve districts and officials, returning only the user's data.
 *
 * This module has NO server-only imports ($env/dynamic/private).
 */

import { validateBN254Hex, validateBN254HexArray } from './client';

// ============================================================================
// Configuration
// ============================================================================

/** Local IPFS gateway for development (Docker commons-ipfs container) */
const LOCAL_IPFS_GATEWAY = 'http://localhost:8080/ipfs';

/** Primary IPFS gateway (Storacha — our pinning provider) */
const IPFS_GATEWAY = 'https://storacha.link/ipfs';

/** Fallback gateway (w3s.link is Storacha's CDN alias) */
const FALLBACK_GATEWAYS = [
	'https://w3s.link/ipfs',
];

/** Cache TTL: 7 days (quarterly updates with comfortable margin) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** IPFS fetch timeout (first fetch can be slow — gateway may need to find content) */
const IPFS_FETCH_TIMEOUT_MS = 30_000;

/**
 * Content identifiers for pinned IPFS data.
 * Updated quarterly by the shadow-atlas pipeline.
 *
 * Single `root` CID covers a UnixFS directory DAG.
 * Files are addressed as `{root}/US/manifest.json`, `{root}/US/districts/{parent}.json`, etc.
 *
 * Defaults are overridden at runtime by setCIDs() from env vars
 * (hooks.server.ts reads IPFS_CID_ROOT on startup).
 */
export const IPFS_CIDS = {
	/** Root CID for chunked UnixFS directory DAG */
	root: '',
	/** Quarterly Merkle tree snapshot (~15-25 MB compressed) */
	merkleSnapshot: '',
} as const;

/**
 * Override CIDs at runtime (e.g., from env vars or on-chain registry).
 * Called from hooks.server.ts on app startup.
 */
export function setCIDs(cids: Partial<Record<keyof typeof IPFS_CIDS, string>>): void {
	if (cids.root) (IPFS_CIDS as Record<string, string>).root = cids.root;
	if (cids.merkleSnapshot) (IPFS_CIDS as Record<string, string>).merkleSnapshot = cids.merkleSnapshot;
}

// ============================================================================
// Path Sanitization
// ============================================================================

/**
 * Validate and return an IPFS path segment (country code, parentKey, districtCode, etc.).
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

/** Manifest for a country's chunked IPFS data */
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
 * Published at `{rootCID}/{country}/cells/{parentCell}.json`.
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
}

/**
 * Per-cell entry: circuit-ready districts + SMT proof.
 * Keyed by H3 cell index (what the browser knows from latLngToCell).
 * Single-letter keys minimize JSON size on IPFS.
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
 * Published at `{rootCID}/{country}/district-index.json`.
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

/** Cell chunk cache (districts + SMT proofs): ~70 KB gzipped per chunk, max 10 = ~700 KB */
const cellChunkCache = new LRUCache<CellChunkFile>(10, CACHE_TTL_MS);

/** District index cache — one per country, ~50-200 KB */
const districtIndexCache = new LRUCache<DistrictIndex>(5, CACHE_TTL_MS);

/** Manifest cache — keyed by country code, refreshed when root CID changes */
const manifestCacheMap = new Map<string, { rootCid: string; data: ChunkManifest; fetchedAt: number }>();

// ============================================================================
// IPFS Fetch
// ============================================================================

/**
 * Fetch data from IPFS by CID, trying multiple gateways.
 * Supports both JSON and binary (ArrayBuffer) responses.
 * Throws if all gateways fail.
 */
async function fetchFromIPFS<T>(cid: string, mode: 'json' | 'binary' = 'json'): Promise<T> {
	if (!cid) {
		throw new Error(
			'IPFS CID not configured. District data not yet published — ' +
			'substrate must run the quarterly pipeline (Phase A1/A2) first.'
		);
	}

	// In dev, try local Docker IPFS node first (fast, no rate limits)
	const gateways = typeof globalThis.process !== 'undefined' && globalThis.process.env?.NODE_ENV !== 'production'
		? [LOCAL_IPFS_GATEWAY, IPFS_GATEWAY, ...FALLBACK_GATEWAYS]
		: [IPFS_GATEWAY, ...FALLBACK_GATEWAYS];
	let lastError: Error | null = null;

	for (const gateway of gateways) {
		try {
			const url = `${gateway}/${cid}`;
			const accept = mode === 'binary' ? 'application/octet-stream' : 'application/json';
			const response = await fetch(url, {
				headers: { Accept: accept },
				signal: AbortSignal.timeout(IPFS_FETCH_TIMEOUT_MS),
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
			console.warn(`[IPFS Store] Gateway ${gateway} failed for ${cid}: ${lastError.message}`);
		}
	}

	throw new Error(
		`All IPFS gateways failed for CID ${cid}: ${lastError?.message}`
	);
}

/** Sentinel error class for "file not found in IPFS DAG" (all gateways returned 404). */
class IPFSNotFoundError extends Error {
	constructor(path: string) {
		super(`IPFS file not found: ${path}`);
		this.name = 'IPFSNotFoundError';
	}
}

/**
 * Fetch a file from within the root CID's UnixFS directory.
 * Uses gateway failover just like fetchFromIPFS.
 *
 * Path is relative to the root CID, e.g. "US/manifest.json".
 *
 * Throws IPFSNotFoundError when all gateways return 404 (file doesn't exist in DAG).
 * Throws generic Error on network/gateway failures (timeout, DNS, 5xx, etc.).
 */
async function fetchFromRootCID<T>(path: string): Promise<T> {
	const rootCid = IPFS_CIDS.root;
	if (!rootCid) {
		throw new Error('IPFS root CID not configured');
	}

	// In dev, try local Docker IPFS node first (fast, no rate limits)
	const gateways = typeof globalThis.process !== 'undefined' && globalThis.process.env?.NODE_ENV !== 'production'
		? [LOCAL_IPFS_GATEWAY, IPFS_GATEWAY, ...FALLBACK_GATEWAYS]
		: [IPFS_GATEWAY, ...FALLBACK_GATEWAYS];
	let lastError: Error | null = null;
	let all404 = true;

	for (const gateway of gateways) {
		try {
			const url = `${gateway}/${rootCid}/${path}`;
			const response = await fetch(url, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(IPFS_FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				if (response.status !== 404) all404 = false;
				throw new Error(`${gateway} returned ${response.status} for ${path}`);
			}

			return (await response.json()) as T;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			// Network errors (timeout, DNS, etc.) are not 404s
			if (!(err instanceof Error && err.message.includes('returned 404'))) {
				all404 = false;
			}
			console.warn(`[IPFS Store] Gateway ${gateway} failed for ${rootCid}/${path}: ${lastError.message}`);
		}
	}

	// All gateways returned 404 → file genuinely doesn't exist in the DAG
	if (all404) {
		throw new IPFSNotFoundError(path);
	}

	throw new Error(`All IPFS gateways failed for ${path}: ${lastError?.message}`);
}

// ============================================================================
// Cache-Through Fetch
// ============================================================================

/**
 * Fetch data with cache-through semantics:
 * 1. Check in-memory cache (return if valid: same CID + within TTL)
 * 2. Fetch from IPFS gateways
 * 3. Store in memory cache
 */
async function getCached<T>(key: string, cid: string, mode: 'json' | 'binary' = 'json'): Promise<T> {
	const cached = memoryStore.get(key) as CacheEntry<T> | undefined;

	if (cached && cached.cid === cid && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
		return cached.data;
	}

	const data = await fetchFromIPFS<T>(cid, mode);
	memoryStore.set(key, { data, cid, fetchedAt: Date.now() } as CacheEntry<unknown>);
	return data;
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
 * The returned MerkleSnapshotData.snapshot is the CellTreeSnapshotWire
 * JSON object — cipher's deserializeCellTreeSnapshot() consumes it.
 */
export async function getMerkleSnapshot(): Promise<MerkleSnapshotData> {
	return getCached<MerkleSnapshotData>('merkle-snapshot', IPFS_CIDS.merkleSnapshot);
}

// ============================================================================
// Chunked Pipeline API (root CID mode)
// ============================================================================

/**
 * Check if chunked (root CID) mode is active.
 */
export function isChunkedMode(): boolean {
	return !!IPFS_CIDS.root;
}

/**
 * Fetch the manifest for a country.
 * Cached in memory — refreshed when root CID changes or TTL expires.
 */
export async function getManifest(country = 'US'): Promise<ChunkManifest> {
	const safeCountry = sanitizePathSegment(country);
	const rootCid = IPFS_CIDS.root;
	if (!rootCid) throw new Error('Root CID not configured — chunked mode not available');

	const cached = manifestCacheMap.get(safeCountry);
	if (
		cached &&
		cached.rootCid === rootCid &&
		(Date.now() - cached.fetchedAt) < CACHE_TTL_MS
	) {
		return cached.data;
	}

	const data = await fetchFromRootCID<ChunkManifest>(`${safeCountry}/manifest.json`);
	manifestCacheMap.set(safeCountry, { rootCid, data, fetchedAt: Date.now() });
	return data;
}

/**
 * Fetch district data for a specific H3 cell from the chunked IPFS store.
 *
 * 1. Compute cellToParent(cellIndex, 3) to find the parent cell
 * 2. Check LRU cache for the chunk
 * 3. Fetch chunk from IPFS: {root}/{country}/districts/{parentCell}.json
 * 4. Return the 24-slot array for this cell, or null if not found
 *
 * Memory: ~8 KB per chunk, max 100 chunks = ~800 KB.
 * Compare: monolithic approach = 355 MB.
 */
export async function getChunkForCell(
	cellIndex: string,
	country = 'US',
): Promise<(string | null)[] | null> {
	const safeCountry = sanitizePathSegment(country);

	// Dynamic import keeps h3-js out of this module's static dependency graph.
	// client.ts imports h3-js directly; ipfs-store stays lean.
	const { cellToParent } = await import('h3-js');
	const parentCell = sanitizePathSegment(cellToParent(cellIndex, 3));

	const cacheKey = `${safeCountry}/${parentCell}`;
	const cached = chunkCache.get(cacheKey);
	if (cached) {
		return cached.cells[cellIndex] ?? null;
	}

	try {
		const chunk = await fetchFromRootCID<ChunkFile>(
			`${safeCountry}/districts/${parentCell}.json`,
		);
		chunkCache.set(cacheKey, chunk);
		return chunk.cells[cellIndex] ?? null;
	} catch (err) {
		// Chunk genuinely doesn't exist (cell in ocean / outside coverage) → return null
		if (err instanceof IPFSNotFoundError) return null;
		// Network / gateway errors → propagate so callers don't confuse with "no data"
		throw err;
	}
}

/**
 * Fetch officials for a specific district from the chunked IPFS store.
 *
 * Fetches: {root}/{country}/officials/{districtCode}.json
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
		const data = await fetchFromRootCID<OfficialsFileIPFS>(
			`${safeCountry}/officials/${safeDistrict}.json`,
		);
		officialsFileCache.set(cacheKey, data);
		return data;
	} catch (err) {
		// District file genuinely doesn't exist (unpopulated district) → return null
		if (err instanceof IPFSNotFoundError) return null;
		// Network / gateway errors → propagate
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
	if (!IPFS_CIDS.root) return null;
	const safeCountry = sanitizePathSegment(country);

	const cacheKey = `district-index:${safeCountry}`;
	const cached = districtIndexCache.get(cacheKey);
	if (cached) return cached;

	try {
		const index = await fetchFromRootCID<DistrictIndex>(
			`${safeCountry}/district-index.json`,
		);
		districtIndexCache.set(cacheKey, index);
		return index;
	} catch (err) {
		if (err instanceof IPFSNotFoundError) return null;
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
	if (!IPFS_CIDS.root) return null;
	const safeCountry = sanitizePathSegment(country);
	const safeParent = sanitizePathSegment(parentKey);

	const cacheKey = `cell:${safeCountry}/${safeParent}`;
	const cached = cellChunkCache.get(cacheKey);
	if (cached) return cached;

	try {
		const chunk = await fetchFromRootCID<CellChunkFile>(
			`${safeCountry}/cells/${safeParent}.json`,
		);

		// BR5-009: Validate all BN254 field elements before caching.
		// A compromised IPFS gateway could serve values >= BN254_MODULUS,
		// causing circuit failures or field aliasing attacks.
		validateBN254Hex(chunk.cellMapRoot, 'cellMapRoot');
		for (const [cellKey, entry] of Object.entries(chunk.cells)) {
			validateBN254Hex(entry.c, `cells[${cellKey}].c`);
			validateBN254HexArray(entry.d, `cells[${cellKey}].d`);
			validateBN254HexArray(entry.p, `cells[${cellKey}].p`);
		}

		cellChunkCache.set(cacheKey, chunk);
		return chunk;
	} catch (err) {
		if (err instanceof IPFSNotFoundError) return null;
		throw err;
	}
}

// ============================================================================
// Health & Maintenance
// ============================================================================

/**
 * Check IPFS gateway reachability.
 * Uses a lightweight HEAD request to the primary gateway.
 */
export async function checkIPFSHealth(): Promise<boolean> {
	try {
		// Attempt to reach the gateway root — lightweight check
		const response = await fetch(IPFS_GATEWAY, {
			method: 'HEAD',
			signal: AbortSignal.timeout(5_000),
		});
		return response.ok || response.status === 400; // 400 = gateway up but no CID specified
	} catch {
		return false;
	}
}

/**
 * Clear all cached data. Forces re-fetch from IPFS on next access.
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
 * Check if data is available (CIDs configured and cached or fetchable).
 * Use this before calling read functions to determine if IPFS mode is active.
 */
export function isIPFSConfigured(): boolean {
	return !!IPFS_CIDS.root;
}
