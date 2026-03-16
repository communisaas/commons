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

// ============================================================================
// Configuration
// ============================================================================

/** Primary IPFS gateway (Cloudflare — no rate limits, global CDN) */
const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs';

/** Fallback gateways (tried in order if primary fails) */
const FALLBACK_GATEWAYS = [
	'https://dweb.link/ipfs',
	'https://storacha.link/ipfs',
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

/** Manifest cache — one per root CID, refreshed when CID changes */
let manifestCache: { rootCid: string; data: ChunkManifest; fetchedAt: number } | null = null;

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

	const gateways = [IPFS_GATEWAY, ...FALLBACK_GATEWAYS];
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

	const gateways = [IPFS_GATEWAY, ...FALLBACK_GATEWAYS];
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
	const rootCid = IPFS_CIDS.root;
	if (!rootCid) throw new Error('Root CID not configured — chunked mode not available');

	if (
		manifestCache &&
		manifestCache.rootCid === rootCid &&
		(Date.now() - manifestCache.fetchedAt) < CACHE_TTL_MS
	) {
		return manifestCache.data;
	}

	const data = await fetchFromRootCID<ChunkManifest>(`${country}/manifest.json`);
	manifestCache = { rootCid, data, fetchedAt: Date.now() };
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
	// Dynamic import keeps h3-js out of this module's static dependency graph.
	// client.ts imports h3-js directly; ipfs-store stays lean.
	const { cellToParent } = await import('h3-js');
	const parentCell = cellToParent(cellIndex, 3);

	const cacheKey = `${country}/${parentCell}`;
	const cached = chunkCache.get(cacheKey);
	if (cached) {
		return cached.cells[cellIndex] ?? null;
	}

	try {
		const chunk = await fetchFromRootCID<ChunkFile>(
			`${country}/districts/${parentCell}.json`,
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
	const cacheKey = `${country}/${districtCode}`;
	const cached = officialsFileCache.get(cacheKey);
	if (cached) return cached;

	try {
		const data = await fetchFromRootCID<OfficialsFileIPFS>(
			`${country}/officials/${districtCode}.json`,
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
	manifestCache = null;
}

/**
 * Check if data is available (CIDs configured and cached or fetchable).
 * Use this before calling read functions to determine if IPFS mode is active.
 */
export function isIPFSConfigured(): boolean {
	return !!IPFS_CIDS.root;
}
