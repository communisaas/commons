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

import { stableStreetShard } from './street-shard';

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
	/**
	 * F-1.1: pinned Tree 2 (cell-district map) root. Set per quarterly atlas
	 * release. When non-empty, callers MUST verify the SMT path embedded in
	 * each fetched cell entry resolves to this value before trusting the
	 * cell's districts. Empty disables the gate (dev-only).
	 *
	 * Future: replace with on-chain DistrictRegistry contract read.
	 */
	expectedCellMapRoot: '',
	/**
	 * F-1.1 (review): pinned Tree 2 depth. Manifest-supplied `cells.depth`
	 * is unauthenticated — pinning the depth out-of-band defends against a
	 * chunk that returns truncated paths (defense-in-depth). 0 disables.
	 */
	expectedCellMapDepth: 0,
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
	expectedCellMapRoot?: string;
	expectedCellMapDepth?: number;
}): void {
	if (opts.atlasBaseUrl != null) CONTENT_CONFIG.atlasBaseUrl = opts.atlasBaseUrl.replace(/\/$/, '');
	if (opts.ipfsCid != null) CONTENT_CONFIG.ipfsCid = opts.ipfsCid;
	if (opts.merkleSnapshotCid != null) CONTENT_CONFIG.merkleSnapshotCid = opts.merkleSnapshotCid;
	if (opts.ipfsGateways) CONTENT_CONFIG.ipfsGateways = opts.ipfsGateways;
	if (opts.expectedCellMapRoot != null) CONTENT_CONFIG.expectedCellMapRoot = opts.expectedCellMapRoot;
	if (opts.expectedCellMapDepth != null) CONTENT_CONFIG.expectedCellMapDepth = opts.expectedCellMapDepth;
}

/**
 * Read the pinned Tree 2 root configured at startup. Empty string when no
 * pin is set (dev only — production callers MUST treat this as fail-closed).
 */
export function getExpectedCellMapRoot(): string {
	return CONTENT_CONFIG.expectedCellMapRoot;
}

/**
 * Read the pinned Tree 2 depth. 0 when no pin is set.
 */
export function getExpectedCellMapDepth(): number {
	return CONTENT_CONFIG.expectedCellMapDepth;
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
	/**
	 * Boundary-geometry vintage string ("TIGER2024"), stamped producer-side.
	 * Optional: older R2 manifests predate this field. An absent or "unknown"
	 * vintage MUST map to a null asOf downstream, never a fabricated or borrowed timestamp.
	 */
	tigerVintage?: string;
	/**
	 * Officials-sync vintage (ISO-8601 string), stamped producer-side (A2) into US/manifest.json.
	 * Optional: older R2 manifests predate this field. An absent or "unknown"
	 * value MUST map to a null asOf downstream, never a fabricated or borrowed timestamp.
	 */
	officialsGenerated?: string;
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
	/**
	 * Address-index freshness clock (SEAM-CONTRACT §4) — a THIRD clock,
	 * distinct from `generated` (boundary) and `officialsGenerated`
	 * (officials); never collapsed, never borrowed. Same degrade-to-null
	 * discipline: absent / "" / "unknown" → null, never fabricated.
	 */
	addressIndexGenerated?: string;
	/** Address-index seam version (§4). Consumer hard-asserts === 1 on read. */
	addressIndexVersion?: number;
	/** Address-index section (§4). Absent = index not yet published (fail-closed). */
	addressIndex?: {
		/** 1 = all chunks unsplit; 2 = §1 v2 split scheme may be present. Consumer accepts both. */
		schemaVersion: number;
		normVersion: number;
		normTable: { path: string; sha256: string; bytes: number };
		nadVintage?: string;
		addrfeatVintage?: string;
		totalChunks: number;
		totalStreets: number;
		totalPoints: number;
		totalRanges: number;
		chunkIndex: { path: string; sha256: string; bytes: number };
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
// Address Index Types (SEAM-CONTRACT v2 — atlas-address-index)
// ============================================================================

/**
 * Fail-closed schema violation in the address index (SEAM-CONTRACT §4):
 * wrong chunk `version`/`schema`, wrong manifest `addressIndexVersion`/
 * `addressIndex.schemaVersion`/`normVersion`, or an addressIndex that is not
 * published at all. Deliberately a PLAIN Error subclass (never an infra
 * fault): callers surface it as a typed 502 RESOLVE_FAILED, never a silent
 * ZIP fallback and never an ATLAS_UNAVAILABLE outage.
 */
export class AddressIndexSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AddressIndexSchemaError';
	}
}

/**
 * Street record inside a ZIP5 address chunk (§2).
 * - `p`: house-number string key → [lat, lng, src] (src: 0 = NAD, 1 = TIGER)
 * - `r`: [fromHn, toHn, parity, fromLat, fromLng, toLat, toLng]
 */
export interface AddressStreetRecord {
	p?: Record<string, [number, number, number]>;
	r?: [number, number, 'E' | 'O' | 'B', number, number, number, number][];
}

/** ZIP5 address chunk published at `{country}/addresses/{zip5}.json` (§2, unsplit v1 shape). */
export interface AddressChunkFile {
	version: 1;
	schema: 'atlas-address-index';
	country: string;
	zip: string;
	state: string;
	zipCentroid: [number, number];
	streets: Record<string, AddressStreetRecord>;
}

/**
 * §1 v2: tiny stub published at `{country}/addresses/{zip5}.json` in place of
 * an oversized v1 chunk. `shards` streets subsets live in separate files at
 * `{country}/addresses/{zip5}.{shard}.json` — see `stableStreetShard` in
 * street-shard.ts (byte-identical to the producer's copy) for which shard a
 * given normalized street lives in.
 */
export interface AddressChunkStubV2 {
	v: 2;
	schema: 'atlas-address-index';
	country: string;
	zip: string;
	state: string;
	zipCentroid: [number, number];
	shards: number;
	/**
	 * Per-shard integrity pins, index-aligned with shard files 0..shards-1.
	 * The runtime reader validates SHAPE fail-closed (exactly `shards` entries,
	 * each a positive byte count + 64-hex sha256); byte-verification against
	 * these pins happens in the §6 source-population gate, same posture as the
	 * manifest's normTable/chunk pins.
	 */
	shardHashes: { bytes: number; sha256: string }[];
}

/** One shard file at `{country}/addresses/{zip5}.{shard}.json` (§1 v2). */
export interface AddressChunkShardV2 {
	v: 2;
	zip: string;
	shard: number;
	shards: number;
	streets: Record<string, AddressStreetRecord>;
}

/**
 * Normalization tables published at `{country}/addresses/normalization.json`
 * (§3): shipped DATA the consumer fetches — never a vendored copy. The
 * algorithm lives in geocoder.ts; `normVersion` is the handshake between the
 * two (table skew impossible by construction; algorithm skew fails loudly).
 */
export interface NormalizationTable {
	normVersion: number;
	directionals: Record<string, string>;
	suffixes: Record<string, string>;
	units: string[];
	unitsWithoutValue: string[];
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

/** Address chunk cache: ~100 KB raw per ZIP5 chunk, max 50 = ~5 MB/isolate */
const addressChunkCache = new LRUCache<AddressChunkFile>(50, CACHE_TTL_MS);

/** Normalization table cache — one table per artifact epoch, ~10 KB */
const normalizationTableCache = new LRUCache<NormalizationTable>(1, CACHE_TTL_MS);

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
export class ContentNotFoundError extends Error {
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
 * Read the manifest's freshness clocks without exposing the full payload.
 *
 * Two clocks stay distinct (never collapsed into one `asOf`): boundary-geometry
 * vintage moves quarterly, officials data on its own cadence. A daily officials
 * sync must not make a quarter-stale boundary look fresh.
 *
 * tigerVintage degrades to null when absent or "unknown" — null is honestly-unknown
 * (degraded), never a fabricated or borrowed timestamp. officialsGenerated now reads the
 * manifest's own officials clock (manifest.officialsGenerated) and degrades to null when
 * absent, "" or "unknown" exactly like tigerVintage — it is never sourced from or collapsed
 * into the boundary clock, preserving the boundary-vs-officials distinction (no single asOf).
 *
 * Rides the existing getManifest memory cache — no second manifest fetch path.
 */
export async function getManifestVintage(
	country = 'US',
): Promise<{ tigerVintage: string | null; generated: string | null; officialsGenerated: string | null }> {
	const manifest = await getManifest(country);

	const rawVintage = manifest.tigerVintage;
	const tigerVintage =
		typeof rawVintage === 'string' && rawVintage.trim() !== '' && rawVintage.trim() !== 'unknown'
			? rawVintage
			: null;

	const generated =
		typeof manifest.generated === 'string' && manifest.generated !== '' ? manifest.generated : null;

	const officialsGenerated =
		typeof manifest.officialsGenerated === 'string' &&
		manifest.officialsGenerated.trim() !== '' &&
		manifest.officialsGenerated.trim() !== 'unknown'
			? manifest.officialsGenerated
			: null;

	return { tigerVintage, generated, officialsGenerated };
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
// Address Index API (SEAM-CONTRACT v2 — normalize → ZIP5 stub/chunk → match)
// ============================================================================

/** Round-trip check for the contract's 5-decimal-place coordinate pin (§2). */
function isFiveDpNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && Math.round(v * 1e5) / 1e5 === v;
}

/** §1 v2 split scheme: addressIndex.schemaVersion values this consumer accepts. */
const SUPPORTED_ADDRESS_INDEX_SCHEMA_VERSIONS = new Set([1, 2]);

/**
 * Hard-assert the manifest's address-index seam version (§4). Fail-closed:
 * an absent addressIndex section, or an unrecognized version, throws
 * AddressIndexSchemaError — never a silent ZIP fallback, never treated as
 * a coverage miss. A 404 on the manifest itself means the atlas (and so the
 * index) is not published at this source: the same fail-closed path.
 *
 * `schemaVersion` accepts 1 (every chunk unsplit) AND 2 (the §1 v2 split
 * scheme may be present) — both shapes are handled by getAddressChunk below.
 */
async function assertAddressIndexPublished(
	country: string,
): Promise<NonNullable<ChunkManifest['addressIndex']>> {
	let manifest: ChunkManifest;
	try {
		manifest = await getManifest(country);
	} catch (err) {
		if (err instanceof ContentNotFoundError) {
			throw new AddressIndexSchemaError(
				`Atlas manifest not found for ${country} — address index unavailable`,
			);
		}
		throw err;
	}

	const section = manifest.addressIndex;
	if (!section) {
		throw new AddressIndexSchemaError(
			`Manifest for ${country} has no addressIndex — index not yet published`,
		);
	}
	if (manifest.addressIndexVersion !== 1) {
		throw new AddressIndexSchemaError(
			`Unsupported addressIndexVersion ${String(manifest.addressIndexVersion)} (expected 1)`,
		);
	}
	if (!SUPPORTED_ADDRESS_INDEX_SCHEMA_VERSIONS.has(section.schemaVersion)) {
		throw new AddressIndexSchemaError(
			`Unsupported addressIndex.schemaVersion ${String(section.schemaVersion)} (expected 1 or 2)`,
		);
	}
	if (section.normVersion !== 1) {
		throw new AddressIndexSchemaError(
			`Unsupported addressIndex.normVersion ${String(section.normVersion)} (expected 1)`,
		);
	}
	return section;
}

/**
 * Validate a `streets` map against the §2 record shape, shared by the v1
 * unsplit chunk and every v2 shard file. Fail-closed: any violation is an
 * AddressIndexSchemaError (producer bug / wrong artifact), never a silent
 * fallback.
 */
function validateStreetsMap(
	streets: unknown,
	zip5: string,
	label: string,
): asserts streets is Record<string, AddressStreetRecord> {
	if (typeof streets !== 'object' || streets === null || Array.isArray(streets)) {
		throw new AddressIndexSchemaError(`Address ${label} ${zip5} has an invalid streets map`);
	}
	for (const [street, rec] of Object.entries(streets as Record<string, AddressStreetRecord>)) {
		if (rec.p !== undefined) {
			for (const [hn, point] of Object.entries(rec.p)) {
				if (
					!Array.isArray(point) ||
					point.length !== 3 ||
					!isFiveDpNumber(point[0]) ||
					!isFiveDpNumber(point[1]) ||
					(point[2] !== 0 && point[2] !== 1)
				) {
					throw new AddressIndexSchemaError(
						`Address ${label} ${zip5} street "${street}" point "${hn}" violates §2`,
					);
				}
			}
		}
		if (rec.r !== undefined) {
			for (const range of rec.r) {
				const [fromHn, toHn, parity, fromLat, fromLng, toLat, toLng] = range;
				if (
					!Array.isArray(range) ||
					range.length !== 7 ||
					!Number.isInteger(fromHn) ||
					!Number.isInteger(toHn) ||
					fromHn > toHn ||
					(parity !== 'E' && parity !== 'O' && parity !== 'B') ||
					!isFiveDpNumber(fromLat) ||
					!isFiveDpNumber(fromLng) ||
					!isFiveDpNumber(toLat) ||
					!isFiveDpNumber(toLng)
				) {
					throw new AddressIndexSchemaError(
						`Address ${label} ${zip5} street "${street}" range violates §2`,
					);
				}
			}
		}
	}
}

/**
 * Validate an unsplit v1 address chunk against the §2 record shape.
 * Fail-closed: any violation is an AddressIndexSchemaError (producer bug /
 * wrong artifact), never a silent fallback. Runs once per fetch (cache hits
 * skip it).
 */
function validateAddressChunk(chunk: AddressChunkFile, zip5: string): void {
	if (chunk.version !== 1 || chunk.schema !== 'atlas-address-index') {
		throw new AddressIndexSchemaError(
			`Address chunk ${zip5} schema mismatch: version=${String(chunk.version)} schema=${String(chunk.schema)}`,
		);
	}
	if (chunk.zip !== zip5) {
		throw new AddressIndexSchemaError(
			`Address chunk key mismatch: requested ${zip5}, chunk says ${String(chunk.zip)}`,
		);
	}
	if (
		!Array.isArray(chunk.zipCentroid) ||
		chunk.zipCentroid.length !== 2 ||
		!isFiveDpNumber(chunk.zipCentroid[0]) ||
		!isFiveDpNumber(chunk.zipCentroid[1])
	) {
		throw new AddressIndexSchemaError(`Address chunk ${zip5} has an invalid zipCentroid`);
	}
	validateStreetsMap(chunk.streets, zip5, 'chunk');
}

/**
 * Validate a §1 v2 stub (`{v:2, shards:N, ...}`, no `streets`). Fail-closed:
 * any violation is an AddressIndexSchemaError.
 */
function validateAddressChunkStubV2(stub: AddressChunkStubV2, zip5: string): void {
	if (stub.v !== 2 || stub.schema !== 'atlas-address-index') {
		throw new AddressIndexSchemaError(
			`Address chunk stub ${zip5} schema mismatch: v=${String(stub.v)} schema=${String(stub.schema)}`,
		);
	}
	if (stub.zip !== zip5) {
		throw new AddressIndexSchemaError(
			`Address chunk stub key mismatch: requested ${zip5}, stub says ${String(stub.zip)}`,
		);
	}
	if (
		!Array.isArray(stub.zipCentroid) ||
		stub.zipCentroid.length !== 2 ||
		!isFiveDpNumber(stub.zipCentroid[0]) ||
		!isFiveDpNumber(stub.zipCentroid[1])
	) {
		throw new AddressIndexSchemaError(`Address chunk stub ${zip5} has an invalid zipCentroid`);
	}
	if (!Number.isInteger(stub.shards) || stub.shards < 1) {
		throw new AddressIndexSchemaError(
			`Address chunk stub ${zip5} has an invalid shards count: ${String(stub.shards)}`,
		);
	}
	if (!Array.isArray(stub.shardHashes) || stub.shardHashes.length !== stub.shards) {
		throw new AddressIndexSchemaError(
			`Address chunk stub ${zip5} must pin exactly ${String(stub.shards)} shards in shardHashes, got ${
				Array.isArray(stub.shardHashes) ? String(stub.shardHashes.length) : typeof stub.shardHashes
			}`,
		);
	}
	for (const [i, pin] of stub.shardHashes.entries()) {
		if (
			pin === null ||
			typeof pin !== 'object' ||
			!Number.isInteger(pin.bytes) ||
			pin.bytes < 1 ||
			typeof pin.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(pin.sha256)
		) {
			throw new AddressIndexSchemaError(
				`Address chunk stub ${zip5} shardHashes[${i}] is malformed: need a positive bytes count and a 64-hex sha256`,
			);
		}
	}
}

/** Validate a §1 v2 shard file against the shard the stub said to fetch. */
function validateAddressChunkShardV2(
	shard: AddressChunkShardV2,
	zip5: string,
	expectedShardIdx: number,
	expectedShards: number,
): void {
	if (shard.v !== 2 || shard.zip !== zip5) {
		throw new AddressIndexSchemaError(
			`Address chunk shard ${zip5}.${expectedShardIdx} schema mismatch: v=${String(shard.v)} zip=${String(shard.zip)}`,
		);
	}
	if (shard.shard !== expectedShardIdx || shard.shards !== expectedShards) {
		throw new AddressIndexSchemaError(
			`Address chunk shard ${zip5}.${expectedShardIdx} index mismatch: shard=${String(shard.shard)} shards=${String(shard.shards)} (expected ${expectedShardIdx}/${expectedShards})`,
		);
	}
	validateStreetsMap(shard.streets, zip5, `shard ${expectedShardIdx}`);
}

/** §1 v2 stubs: tiny (~100 B each), max 200 = ~20 KB/isolate. */
const addressChunkStubCache = new LRUCache<AddressChunkStubV2>(200, CACHE_TTL_MS);

/** §1 v2 shard files: ~same size budget as the p95 chunk target, max 100 = ~25 MB/isolate. */
const addressChunkShardCache = new LRUCache<AddressChunkShardV2>(100, CACHE_TTL_MS);

/** Fetch + validate the stub OR unsplit chunk at `{country}/addresses/{zip5}.json`, using its own cache. */
async function fetchAddressChunkOrStub(
	safeCountry: string,
	zip5: string,
): Promise<{ kind: 'chunk'; chunk: AddressChunkFile } | { kind: 'stub'; stub: AddressChunkStubV2 } | null> {
	const chunkCacheKey = `addr:${safeCountry}/${zip5}`;
	const cachedChunk = addressChunkCache.get(chunkCacheKey);
	if (cachedChunk) return { kind: 'chunk', chunk: cachedChunk };

	const stubCacheKey = `addr-stub:${safeCountry}/${zip5}`;
	const cachedStub = addressChunkStubCache.get(stubCacheKey);
	if (cachedStub) return { kind: 'stub', stub: cachedStub };

	let body: AddressChunkFile | AddressChunkStubV2;
	try {
		body = await fetchContent<AddressChunkFile | AddressChunkStubV2>(
			`${safeCountry}/addresses/${zip5}.json`,
		);
	} catch (err) {
		if (err instanceof ContentNotFoundError) return null;
		throw err;
	}

	if ((body as AddressChunkStubV2).v === 2) {
		const stub = body as AddressChunkStubV2;
		validateAddressChunkStubV2(stub, zip5);
		addressChunkStubCache.set(stubCacheKey, stub);
		return { kind: 'stub', stub };
	}
	const chunk = body as AddressChunkFile;
	validateAddressChunk(chunk, zip5);
	addressChunkCache.set(chunkCacheKey, chunk);
	return { kind: 'chunk', chunk };
}

/** Fetch + validate one §1 v2 shard file, using its own cache. */
async function fetchAddressChunkShard(
	safeCountry: string,
	zip5: string,
	shardIdx: number,
	shards: number,
): Promise<AddressChunkShardV2> {
	const shardCacheKey = `addr-shard:${safeCountry}/${zip5}/${shardIdx}`;
	const cached = addressChunkShardCache.get(shardCacheKey);
	if (cached) return cached;

	let shard: AddressChunkShardV2;
	try {
		shard = await fetchContent<AddressChunkShardV2>(`${safeCountry}/addresses/${zip5}.${shardIdx}.json`);
	} catch (err) {
		if (err instanceof ContentNotFoundError) {
			throw new AddressIndexSchemaError(
				`Address chunk stub ${zip5} names ${shards} shards but shard ${shardIdx} is missing`,
			);
		}
		throw err;
	}
	validateAddressChunkShardV2(shard, zip5, shardIdx, shards);
	addressChunkShardCache.set(shardCacheKey, shard);
	return shard;
}

/**
 * Fetch the ZIP5 address chunk at `{country}/addresses/{zip5}.json`.
 *
 * - zip5 is asserted against `^\d{5}$` BEFORE any path is built.
 * - HTTP 404 on the chunk → null (an honest coverage MISS signal, not infra).
 * - Schema violations (§4 manifest handshake, §2 chunk shape) → fail-closed
 *   AddressIndexSchemaError.
 * - Network/5xx/timeout → generic Error, exactly as existing chunk fetches;
 *   callers classify those as infrastructure faults, never as misses.
 *
 * §1 v2 split: when the fetched artifact is a stub (`v:2`), `normalizedStreet`
 * picks which shard to fetch via `stableStreetShard` — the SAME hash the
 * producer used to assign that street at emit time. This is the only extra
 * fetch the split scheme costs, and only for oversized ZIPs: an unsplit v1
 * chunk still resolves in one fetch (its own cache entry, never touching the
 * stub/shard caches). The returned shape is always the v1 `AddressChunkFile`
 * shape regardless of which path served it — `runMatchLadder` in geocoder.ts
 * needs no v2 awareness at all.
 */
export async function getAddressChunk(
	zip5: string,
	country = 'US',
	normalizedStreet = '',
): Promise<AddressChunkFile | null> {
	if (!/^\d{5}$/.test(zip5)) {
		throw new Error(`Address chunk key must be a 5-digit ZIP, got "${String(zip5).slice(0, 20)}"`);
	}
	const safeCountry = sanitizePathSegment(country);

	await assertAddressIndexPublished(safeCountry);

	const result = await fetchAddressChunkOrStub(safeCountry, zip5);
	if (result === null) return null;
	if (result.kind === 'chunk') return result.chunk;

	const { stub } = result;
	const shardIdx = stableStreetShard(normalizedStreet, stub.shards);
	const shard = await fetchAddressChunkShard(safeCountry, zip5, shardIdx, stub.shards);

	return {
		version: 1,
		schema: 'atlas-address-index',
		country: stub.country,
		zip: stub.zip,
		state: stub.state,
		zipCentroid: stub.zipCentroid,
		streets: shard.streets,
	};
}

/**
 * Fetch the shipped §3 normalization tables at
 * `{country}/addresses/normalization.json`.
 *
 * The consumer NEVER vendors its own copy — the tables are artifact data.
 * The manifest's `normTable.sha256`/`bytes` pins are PUBLISH/AUDIT artifacts:
 * this reader does NOT re-hash the fetched body per-fetch. Pin verification
 * happens in the §6 source-population gate (geocoder-sample-gate.test.ts
 * check 2), which byte-hashes the published table (and every chunk against
 * chunk-index.json) against the manifest pins. What IS enforced here per
 * fetch: `normVersion` is hard-asserted to 1 on both the manifest section and
 * the fetched table (the algorithm-version handshake) — skew fails loudly
 * with AddressIndexSchemaError. A 404 is also fail-closed — an index without
 * its tables is an unusable index, never a silent fallback.
 */
export async function getNormalizationTable(country = 'US'): Promise<NormalizationTable> {
	const safeCountry = sanitizePathSegment(country);

	await assertAddressIndexPublished(safeCountry);

	const cacheKey = `norm:${safeCountry}`;
	const cached = normalizationTableCache.get(cacheKey);
	if (cached) return cached;

	let table: NormalizationTable;
	try {
		table = await fetchContent<NormalizationTable>(`${safeCountry}/addresses/normalization.json`);
	} catch (err) {
		if (err instanceof ContentNotFoundError) {
			throw new AddressIndexSchemaError(
				`normalization.json not found for ${safeCountry} — address index unusable`,
			);
		}
		throw err;
	}

	if (table.normVersion !== 1) {
		throw new AddressIndexSchemaError(
			`Unsupported normVersion ${String(table.normVersion)} in normalization.json (expected 1)`,
		);
	}
	if (
		typeof table.directionals !== 'object' || table.directionals === null ||
		typeof table.suffixes !== 'object' || table.suffixes === null ||
		!Array.isArray(table.units) ||
		!Array.isArray(table.unitsWithoutValue)
	) {
		throw new AddressIndexSchemaError('normalization.json is missing required tables');
	}

	normalizationTableCache.set(cacheKey, table);
	return table;
}

// ============================================================================
// Maintenance
// ============================================================================

/**
 * Clear all cached data. Forces re-fetch on next access.
 */
export async function clearCache(): Promise<void> {
	memoryStore.delete('merkle-snapshot');
	chunkCache.clear();
	officialsFileCache.clear();
	cellChunkCache.clear();
	districtIndexCache.clear();
	addressChunkCache.clear();
	addressChunkStubCache.clear();
	addressChunkShardCache.clear();
	normalizationTableCache.clear();
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
