/**
 * Shadow Atlas Client
 *
 * IPFS-native architecture (Phase A3):
 * - READ operations use IPFS-cached data + client-side H3 resolution
 * - WRITE operations use HTTP to Shadow Atlas relay (Phase B1 moves to thin relay)
 * - Engagement operations remain HTTP (not in IPFS scope yet)
 *
 * Read path (no server required):
 *   h3-js: latLngToCell(lat, lng, 7) → H3 cell index (microseconds)
 *   IndexedDB: cached H3→district mapping from IPFS (~3-5 MB)
 *   Local lookup: cell → districts (hash table, microseconds)
 *
 * Write path (still requires server):
 *   HTTP → Shadow Atlas API → tree mutation + proof generation
 */

import { env } from '$env/dynamic/private';
import { latLngToCell } from 'h3-js';
import {
	getMerkleSnapshot,
	isIPFSConfigured,
	getChunkForCell,
	getOfficialsForDistrict,
	getManifestVintage,
	clearCache,
	ContentNotFoundError,
	type CellDistricts,
	type OfficialsFileIPFS,
} from './ipfs-store';
import type { ResolutionProvenance } from './provenance';
import { AddressIndexSchemaError } from './ipfs-store';
import { US_SLOT_NAMES, CONGRESSIONAL_SLOT_INDEX } from './district-format';
import { SERVED_SLOT_SET } from './coverage';
import {
	geocodeAddress,
	matchClassPrecision,
	ADDRESS_NOT_FOUND_MESSAGE,
	type GeocodeResult,
} from './geocoder';
import {
	deserializeCellTreeSnapshot,
	computeClientCellProof,
	validateSnapshotRoot,
	type CellTreeSnapshot,
	type CellTreeSnapshotWire,
} from './cell-tree-snapshot';
import { applyStalenessGuard } from './redraw-guard';

// Server config (used by engagement reads)
const SHADOW_ATLAS_URL = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';
const SHADOW_ATLAS_REGISTRATION_TOKEN = env.SHADOW_ATLAS_REGISTRATION_TOKEN || '';

if (SHADOW_ATLAS_URL.includes('localhost') && !import.meta.env.DEV) {
	console.warn(
		'[shadow-atlas] SHADOW_ATLAS_API_URL points to localhost in a non-dev environment. ' +
		'Set SHADOW_ATLAS_API_URL to the production Shadow Atlas endpoint.'
	);
}

// Write relay (Phase B1) — registration, replacement, engagement writes
const WRITE_RELAY_URL = env.WRITE_RELAY_URL || SHADOW_ATLAS_URL;
const WRITE_RELAY_TOKEN = env.WRITE_RELAY_TOKEN || SHADOW_ATLAS_REGISTRATION_TOKEN;

/**
 * Circuit depth (must match VITE_CIRCUIT_DEPTH used by prover-client.ts).
 * Valid values: 18, 20, 22, 24. Default: 20.
 */
const CIRCUIT_DEPTH: number = (() => {
	const d = env.VITE_CIRCUIT_DEPTH;
	if (!d) return 20;
	const p = parseInt(d, 10);
	return (p === 18 || p === 20 || p === 22 || p === 24) ? p : 20;
})();

import { BN254_MODULUS } from '$lib/core/crypto/bn254';

/**
 * BR5-009: All hex field elements from Shadow Atlas must be validated
 * against this modulus before being stored in SessionCredential or
 * passed to the prover. A compromised Shadow Atlas could return values
 * >= modulus, causing circuit failures or field aliasing attacks.
 */

/**
 * Validate a hex string is a canonical 0x-prefixed BN254 field element.
 *
 * @throws {Error} If format is invalid or value >= BN254_MODULUS
 */
export function validateBN254Hex(value: string, label: string): void {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
		throw new Error(
			`BR5-009: Invalid ${label} from Shadow Atlas: expected 0x-hex, got "${String(value).slice(0, 20)}"`
		);
	}
	const bigVal = BigInt(value);
	if (bigVal >= BN254_MODULUS) {
		throw new Error(
			`BR5-009: ${label} from Shadow Atlas exceeds BN254 field modulus`
		);
	}
}

/**
 * Validate an array of hex strings are all valid BN254 field elements.
 */
export function validateBN254HexArray(values: string[], label: string): void {
	if (!Array.isArray(values)) {
		throw new Error(`BR5-009: ${label} from Shadow Atlas must be an array`);
	}
	for (let i = 0; i < values.length; i++) {
		validateBN254Hex(values[i], `${label}[${i}]`);
	}
}

// ============================================================================
// FIPS → State Code Conversion
// ============================================================================

/**
 * FIPS state codes → two-letter postal abbreviations.
 * Used to convert substrate's district ID format (cd-0601) to commons' (CA-01).
 */
const FIPS_TO_STATE: Record<string, string> = {
	'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
	'08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
	'13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
	'19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
	'24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
	'29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
	'34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
	'39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
	'45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
	'50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
	'56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
	'78': 'VI',
};

/**
 * Convert substrate's district ID format to commons' format.
 * "cd-0601" → "CA-01", "cd-5000" → "VT-AL"
 */
function convertDistrictId(substrateId: string): string {
	// Parse: "cd-{2-digit state FIPS}{2-digit district}"
	const match = substrateId.match(/^cd-(\d{2})(\d{2})$/);
	if (!match) return substrateId; // Fallback: return as-is

	const stateFips = match[1];
	const districtNum = match[2];
	const stateCode = FIPS_TO_STATE[stateFips];
	if (!stateCode) return substrateId;

	// At-large districts: 00 (single-district states) and 98 (non-voting delegates: DC, AS, GU, MP, PR, VI) → AL
	const district = (districtNum === '00' || districtNum === '98') ? 'AL' : districtNum;
	return `${stateCode}-${district}`;
}

/**
 * Build a human-readable district name from a district code.
 * "CA-12" → "California's 12th Congressional District"
 * "VT-AL" → "Vermont At-Large Congressional District"
 */
function buildDistrictName(districtCode: string): string {
	const STATE_NAMES: Record<string, string> = {
		AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
		CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
		DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
		ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
		KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
		MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
		MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
		NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
		NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
		OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
		SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
		UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
		WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
		AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
		PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
	};

	const parts = districtCode.split('-');
	if (parts.length !== 2) return `Congressional District ${districtCode}`;

	const stateName = STATE_NAMES[parts[0]] || parts[0];
	if (parts[1] === 'AL') return `${stateName} At-Large Congressional District`;

	const num = parseInt(parts[1], 10);
	const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
	return `${stateName}'s ${num}${suffix} Congressional District`;
}

// ============================================================================
// Interfaces (unchanged — preserve backward compatibility)
// ============================================================================

/**
 * District information returned from Shadow Atlas
 */
export interface District {
	id: string; // e.g., "CA-12"
	name: string; // e.g., "California's 12th Congressional District"
	jurisdiction: string; // e.g., "congressional"
	districtType: string; // e.g., "congressional"
}

/**
 * Merkle proof for ZK district membership verification
 * Depth-20 trees supporting up to 2^20 = 1,048,576 leaves
 */
export interface MerkleProof {
	root: string; // bigint as hex (e.g., "0x1234...")
	leaf: string; // bigint as hex (e.g., "0x5678...")
	siblings: string[]; // Array of 20 hex strings for depth-20
	pathIndices: number[]; // Array of 20 binary indices (0 or 1)
	depth: number; // Always 20 for production trees
}

/**
 * Combined district lookup and Merkle proof response
 */
export interface DistrictLookupResult {
	district: District;
	merkleProof: MerkleProof | null;
	/** H3 cell index used for spatial lookup — serves as cell_id for ZK eligibility */
	cell_id: string | null;
}

/**
 * Shadow Atlas API error response
 */
export interface ShadowAtlasError {
	success: false;
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
}

/**
 * Shadow Atlas API success response
 */
export interface ShadowAtlasResponse {
	success: true;
	data: DistrictLookupResult;
}

// ============================================================================
// 24-Slot Jurisdiction Taxonomy
// ============================================================================

/**
 * Slot index → jurisdiction metadata: US_SLOT_NAMES, imported from
 * ./district-format (shared server/browser module) alongside
 * CONGRESSIONAL_SLOT_INDEX. The served-slot allowlist gating which slots
 * reach the public wire lives in ./coverage (SERVED_SLOT_SET).
 */

/**
 * Result of a multi-district lookup across all 24 jurisdiction slots.
 */
export interface MultiDistrictResult {
	/** All populated districts across all slots */
	districts: District[];
	/** Slot 0 (congressional) for backward compatibility — null if unpopulated */
	primary: District | null;
}

// ============================================================================
// District Lookup (IPFS + H3 — no server call)
// ============================================================================

/** H3 resolution for district mapping (matches substrate's build pipeline) */
const H3_RESOLUTION = 7;

/**
 * Build a District object from a slot value and index.
 */
function slotToDistrict(slotValue: string, slotIndex: number): District {
	const meta = US_SLOT_NAMES[slotIndex];
	const jurisdiction = meta?.jurisdiction ?? `slot-${slotIndex}`;

	// Congressional district (slot 0): convert substrate ID format
	if (slotIndex === CONGRESSIONAL_SLOT_INDEX) {
		const districtCode = convertDistrictId(slotValue);
		return {
			id: districtCode,
			name: buildDistrictName(districtCode),
			jurisdiction,
			districtType: jurisdiction,
		};
	}

	// Other slots: use raw ID with jurisdiction label
	return {
		id: slotValue,
		name: `${meta?.label ?? jurisdiction}: ${slotValue}`,
		jurisdiction,
		districtType: jurisdiction,
	};
}

/**
 * Extract all populated districts from a cell's 24-slot array.
 */
function cellDistrictsToMulti(cellDistricts: CellDistricts): MultiDistrictResult {
	const districts: District[] = [];
	let primary: District | null = null;

	for (let i = 0; i < cellDistricts.slots.length; i++) {
		const val = cellDistricts.slots[i];
		if (val) {
			const district = slotToDistrict(val, i);
			districts.push(district);
			if (i === 0) primary = district;
		}
	}

	return { districts, primary };
}

/**
 * Build a District object from H3 cell districts data (backward compat).
 * Returns the congressional district (slot 0).
 */
function cellDistrictsToDistrict(cellDistricts: CellDistricts): District {
	const cdRaw = cellDistricts.slots[CONGRESSIONAL_SLOT_INDEX];
	if (!cdRaw) {
		throw new Error('Cell has no congressional district assignment');
	}

	const districtCode = convertDistrictId(cdRaw);
	return {
		id: districtCode,
		name: buildDistrictName(districtCode),
		jurisdiction: 'congressional',
		districtType: 'congressional',
	};
}

/**
 * One resolved boundary entry in the multi-type districts array.
 * Wire-shape (snake_case district_type) for parity with the legacy district field.
 */
export interface ResolvedDistrictEntry {
	/**
	 * Stable district identifier.
	 * - congressional: display code "MN-08" / "VT-AL" (identical to the legacy district.id)
	 * - all other types: atlas id "{type-alias}-{TIGER GEOID}", e.g. "sldu-27011"
	 */
	id: string;
	/** Raw TIGER/Census GEOID with the alias prefix stripped, e.g. "27011", "2711B", "2708". */
	geoid: string;
	/** Human-readable name, e.g. "Minnesota's 8th Congressional District", "State Senate 27011". */
	name: string;
	/** Public district-type slug (see US_SLOT_NAMES) — same value as district_type. */
	jurisdiction: string;
	/** Public district-type slug, e.g. "congressional", "state-senate", "county". */
	district_type: string;
}

/**
 * Project a cell's slot array onto the public multi-type wire shape.
 * Emits ONLY slots in the served allowlist (SERVED_SLOT_SET) — a type never
 * reaches the wire unless the coverage disclosure describes it. Ordered by
 * canonical slot index ascending.
 */
function slotsToResolvedDistricts(slots: (string | null)[]): ResolvedDistrictEntry[] {
	const out: ResolvedDistrictEntry[] = [];
	for (let i = 0; i < slots.length; i++) {
		const raw = slots[i];
		// typeof guard: a malformed publish putting a non-string in ANY served
		// slot must skip that slot, never take down the whole resolution.
		if (!raw || typeof raw !== 'string' || !SERVED_SLOT_SET.has(i)) continue;
		const meta = US_SLOT_NAMES[i];
		const jurisdiction = meta?.jurisdiction ?? `slot-${i}`;
		const geoid = raw.replace(/^[a-z]+-/, '');
		if (i === CONGRESSIONAL_SLOT_INDEX) {
			const code = convertDistrictId(raw);
			out.push({
				id: code,
				geoid,
				name: buildDistrictName(code),
				jurisdiction,
				district_type: jurisdiction,
			});
		} else {
			out.push({
				id: raw,
				geoid,
				name: `${meta?.label ?? jurisdiction} ${geoid}`,
				jurisdiction,
				district_type: jurisdiction,
			});
		}
	}
	return out;
}

/**
 * Infrastructure fault in the atlas content store (R2/IPFS 5xx, timeout, DNS, …).
 *
 * Distinct from a genuine coverage miss (clean all-404 → null chunk): an infra fault
 * means the store could not answer, so the caller must NOT record a district miss —
 * and in metered contexts must never bill the lookup as a served resolution. Extends
 * Error, so existing generic `catch` sites keep catching it unchanged.
 */
export class AtlasInfraError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'AtlasInfraError';
	}
}

/**
 * Fetch the 24-slot district array for a coordinate. Single source of the
 * chunk-fetch + infra-classification logic shared by the single- and
 * multi-type views (lookupDistrict and resolveAddress).
 *
 * @throws AtlasInfraError on a store infrastructure fault (never a coverage miss)
 * @throws Error('No district data…') on an honest outside-coverage miss
 * @throws Error on invalid coordinates
 */
async function lookupCellSlots(
	lat: number,
	lng: number,
): Promise<{ cellIndex: string; slots: (string | null)[] }> {
	if (lat < -90 || lat > 90) {
		throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
	}
	if (lng < -180 || lng > 180) {
		throw new Error(`Invalid longitude: ${lng}. Must be between -180 and 180.`);
	}

	const cellIndex = latLngToCell(lat, lng, H3_RESOLUTION);

	// Fetch only the ~8 KB chunk for this cell's H3 res-3 parent.
	// getChunkForCell already converts a clean all-404 (ContentNotFoundError) to null —
	// the honest coverage miss handled below. Any other rejection is an infrastructure
	// fault (5xx, timeout, DNS), classified as AtlasInfraError so callers never convert
	// an outage into a district miss.
	let slots: (string | null)[] | null;
	try {
		slots = await getChunkForCell(cellIndex);
	} catch (err) {
		if (err instanceof ContentNotFoundError) {
			slots = null;
		} else {
			throw new AtlasInfraError(
				`Atlas chunk fetch failed for cell ${cellIndex}: ` +
					(err instanceof Error ? err.message : String(err)),
				{ cause: err },
			);
		}
	}

	if (!slots) {
		throw new Error(
			`No district data for H3 cell ${cellIndex} at (${lat.toFixed(4)}, ${lng.toFixed(4)}). ` +
			'Location may be outside US coverage area.'
		);
	}

	return { cellIndex, slots };
}

/**
 * Lookup district and Merkle proof for a given latitude/longitude.
 *
 * IPFS-native: resolves district locally via H3 cell index + cached mapping.
 * No Shadow Atlas server call required.
 *
 * @param lat - Latitude (-90 to 90)
 * @param lng - Longitude (-180 to 180)
 * @returns District information and Merkle proof (proof is null until cipher integrates)
 * @throws AtlasInfraError when the chunk store fails for infrastructure reasons
 * @throws Error if lookup otherwise fails or coordinates are invalid
 */
export async function lookupDistrict(lat: number, lng: number): Promise<DistrictLookupResult> {
	if (lat < -90 || lat > 90) {
		throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
	}
	if (lng < -180 || lng > 180) {
		throw new Error(`Invalid longitude: ${lng}. Must be between -180 and 180.`);
	}

	try {
		const { cellIndex, slots } = await lookupCellSlots(lat, lng);

		return {
			district: cellDistrictsToDistrict({ slots }),
			// Merkle proof: null until cipher integrates client-side path computation.
			// Callers already handle null proof (serve-only mode).
			merkleProof: null,
			cell_id: cellIndex,
		};
	} catch (error) {
		// Infra faults propagate unwrapped so callers can discriminate them from misses.
		if (error instanceof AtlasInfraError) {
			throw error;
		}
		if (error instanceof Error) {
			throw new Error(`District lookup failed: ${error.message}`);
		}
		throw new Error('District lookup failed with unknown error');
	}
}

/**
 * Lookup ALL districts for a given latitude/longitude across all 24 jurisdiction slots.
 *
 * Returns congressional + state senate + state house + county + city + school + special
 * districts — everything the H3 cell maps to.
 *
 * @param lat - Latitude (-90 to 90)
 * @param lng - Longitude (-180 to 180)
 * @returns Multi-district result with all populated slots + primary (congressional)
 * @throws Error if lookup fails or coordinates are invalid
 */
export async function lookupAllDistricts(lat: number, lng: number): Promise<MultiDistrictResult> {
	if (lat < -90 || lat > 90) {
		throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
	}
	if (lng < -180 || lng > 180) {
		throw new Error(`Invalid longitude: ${lng}. Must be between -180 and 180.`);
	}

	try {
		const cellIndex = latLngToCell(lat, lng, H3_RESOLUTION);

		let cellDistricts: CellDistricts | undefined;

		// Fetch only the ~8 KB chunk for this cell's H3 res-3 parent
		const slots = await getChunkForCell(cellIndex);
		if (slots) {
			cellDistricts = { slots };
		}

		if (!cellDistricts) {
			throw new Error(
				`No district data for H3 cell ${cellIndex} at (${lat.toFixed(4)}, ${lng.toFixed(4)}). ` +
				'Location may be outside US coverage area.'
			);
		}

		return cellDistrictsToMulti(cellDistricts);
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Multi-district lookup failed: ${error.message}`);
		}
		throw new Error('Multi-district lookup failed with unknown error');
	}
}

// ============================================================================
// Registration (Tree 1) — WRITE, stays HTTP
// ============================================================================

/**
 * Registration response from Shadow Atlas POST /v1/register
 */
export interface RegistrationResult {
	leafIndex: number;
	userRoot: string;
	userPath: string[];
	pathIndices: number[];
	/** Ed25519 signed receipt from the operator (anti-censorship proof) */
	receipt?: { data: string; sig: string };
}

/**
 * Register a precomputed leaf hash in Tree 1.
 *
 * The leaf is Poseidon2_H4(user_secret, cell_id, registration_salt, authority_level),
 * computed client-side. The operator sees ONLY the leaf hash.
 *
 * @param leaf - Hex-encoded leaf hash (with 0x prefix)
 * @param options - Optional metadata for attestation binding
 * @param options.attestationHash - Identity attestation hash (binds insertion to verification event)
 * @returns Registration result with Merkle proof + optional signed receipt
 * @throws Error if registration fails
 */
export async function registerLeaf(leaf: string, options?: { attestationHash?: string; idempotencyKey?: string }): Promise<RegistrationResult> {
	const url = `${WRITE_RELAY_URL}/v1/register`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Client-Version': 'voter-protocol-v1',
	};
	if (WRITE_RELAY_TOKEN) {
		headers['Authorization'] = `Bearer ${WRITE_RELAY_TOKEN}`;
	}
	if (options?.idempotencyKey) {
		headers['X-Idempotency-Key'] = options.idempotencyKey;
	}

	const requestBody: Record<string, unknown> = { leaf };
	if (options?.attestationHash) {
		requestBody.attestationHash = options.attestationHash;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(requestBody),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));

		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas registration failed [${code}]: ${msg}`);
	}

	const result = await response.json();

	if (!result.success || !result.data) {
		throw new Error('Shadow Atlas returned invalid registration response');
	}

	const { leafIndex, userRoot, userPath, pathIndices, receipt } = result.data;

	if (leafIndex === undefined || !userRoot || !userPath || !pathIndices) {
		throw new Error('Shadow Atlas registration response missing required fields');
	}

	if (userPath.length !== CIRCUIT_DEPTH || pathIndices.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`Invalid proof length: userPath=${userPath.length}, pathIndices=${pathIndices.length}. Expected ${CIRCUIT_DEPTH}.`
		);
	}

	// BR5-009: Validate all field elements are within BN254 scalar field
	validateBN254Hex(userRoot, 'userRoot');
	validateBN254HexArray(userPath, 'userPath');

	return { leafIndex, userRoot, userPath, pathIndices, receipt };
}

/**
 * Replace a leaf in Tree 1 (credential recovery).
 *
 * Zeroes the old leaf at oldLeafIndex and inserts newLeaf at the next
 * available position. Used when a user needs to re-register after
 * browser clear / device loss.
 *
 * Authorization boundary: Shadow Atlas validates API access (Bearer token).
 * Per-leaf ownership is enforced by commons (OAuth session + Convex).
 *
 * @param newLeaf - Hex-encoded new leaf hash (with 0x prefix)
 * @param oldLeafIndex - Index of the old leaf to zero
 * @returns Registration result with new Merkle proof
 * @throws Error if replacement fails
 */
export async function replaceLeaf(
	newLeaf: string,
	oldLeafIndex: number,
	options?: { idempotencyKey?: string },
): Promise<RegistrationResult> {
	const url = `${WRITE_RELAY_URL}/v1/register/replace`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Client-Version': 'voter-protocol-v1',
	};
	if (WRITE_RELAY_TOKEN) {
		headers['Authorization'] = `Bearer ${WRITE_RELAY_TOKEN}`;
	}
	if (options?.idempotencyKey) {
		headers['X-Idempotency-Key'] = options.idempotencyKey;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ newLeaf, oldLeafIndex }),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));

		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas leaf replacement failed [${code}]: ${msg}`);
	}

	const result = await response.json();

	if (!result.success || !result.data) {
		throw new Error('Shadow Atlas returned invalid replacement response');
	}

	const { leafIndex, userRoot, userPath, pathIndices } = result.data;

	if (leafIndex === undefined || !userRoot || !userPath || !pathIndices) {
		throw new Error('Shadow Atlas replacement response missing required fields');
	}

	if (userPath.length !== CIRCUIT_DEPTH || pathIndices.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`Invalid proof length: userPath=${userPath.length}, pathIndices=${pathIndices.length}. Expected ${CIRCUIT_DEPTH}.`
		);
	}

	// BR5-009: Validate all field elements are within BN254 scalar field
	validateBN254Hex(userRoot, 'userRoot');
	validateBN254HexArray(userPath, 'userPath');

	return { leafIndex, userRoot, userPath, pathIndices };
}

// ============================================================================
// Cell Proof (Tree 2) — IPFS snapshot + cipher's path computation
// ============================================================================

/**
 * Cell proof response from Shadow Atlas GET /v1/cell-proof
 */
export interface CellProofResult {
	cellMapRoot: string;
	cellMapPath: string[];
	cellMapPathBits: number[];
	districts: string[];
}

/**
 * Deserialized cell tree snapshot — cached per session.
 * Survives page navigations in SPA. Cleared on tab close/reload.
 * Cleared by clearCachedTree() during quarterly CID rotation.
 */
let cachedTree: CellTreeSnapshot | null = null;

/**
 * Clear the cached cell tree snapshot.
 * Called from ipfs-store.ts clearCache() to ensure quarterly CID rotation
 * doesn't leave a stale snapshot in memory.
 */
export function clearCachedTree(): void {
	cachedTree = null;
}

/**
 * Get the Tree 2 SMT proof for a cell_id.
 *
 * IPFS-native: fetches Merkle snapshot from IPFS, deserializes via cipher's
 * cell-tree-snapshot module, then computes path locally. No server call.
 *
 * LATENT (2026-07-03): zero external callers — the only consumer is
 * cell-tree-snapshot.ts validateSnapshotRoot's no-trustedRoot fallback, which
 * dynamically imports THIS function (a self-referential validation loop), and
 * merkle-snapshot.json is not published on the live atlas (the fetch 404s).
 * Going live requires publishing merkle-snapshot.json and anchoring an
 * on-chain trustedRoot for validateSnapshotRoot. Kept: exported client API
 * surface.
 *
 * @param cellId - Census tract FIPS code (numeric string or hex)
 * @returns Cell proof with districts
 * @throws Error if cell not found or snapshot unavailable
 */
export async function getCellProof(cellId: string): Promise<CellProofResult> {
	if (!cachedTree) {
		const snapshot = await getMerkleSnapshot();
		cachedTree = deserializeCellTreeSnapshot(snapshot.snapshot as CellTreeSnapshotWire);

		const valid = await validateSnapshotRoot(cachedTree);
		if (!valid) {
			await clearCache();
			cachedTree = null;
			throw new Error('Snapshot root mismatch — stale data, retry');
		}
	}

	return computeClientCellProof(cachedTree, cellId);
}

// ============================================================================
// Engagement Registration (Tree 3) — WRITE, stays HTTP
// ============================================================================

/**
 * Register an identity for engagement tracking (Tree 3).
 *
 * Creates a tier-0 leaf in the engagement tree, enabling participation
 * metrics to be tracked for this identity.
 *
 * Idempotent: returns { alreadyRegistered: true } if the identity or signer
 * is already registered (catches 400 from oracle-resistant duplicate handling).
 *
 * @param signerAddress - Ethereum address (from User.wallet_address)
 * @param identityCommitment - Hex-encoded identity commitment (from User.identity_commitment)
 * @returns Leaf index and engagement root, or alreadyRegistered flag
 */
export async function registerEngagement(
	signerAddress: string,
	identityCommitment: string,
): Promise<{ leafIndex: number; engagementRoot: string } | { alreadyRegistered: true }> {
	const url = `${WRITE_RELAY_URL}/v1/engagement/register`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Client-Version': 'voter-protocol-v1',
	};
	if (WRITE_RELAY_TOKEN) {
		headers['Authorization'] = `Bearer ${WRITE_RELAY_TOKEN}`;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ signerAddress, identityCommitment }),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		// The engagement endpoint returns 400 INVALID_PARAMETERS for duplicates
		// (oracle-resistant — identical to other validation errors).
		// Treat any 400 as "already registered" since we validated inputs before calling.
		if (response.status === 400) {
			return { alreadyRegistered: true };
		}

		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));

		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas engagement registration failed [${code}]: ${msg}`);
	}

	const result = await response.json();

	if (!result.success || !result.data) {
		throw new Error('Shadow Atlas returned invalid engagement registration response');
	}

	return {
		leafIndex: result.data.leafIndex,
		engagementRoot: result.data.engagementRoot,
	};
}

// ============================================================================
// Engagement Proof & Metrics (Tree 3) — READ, stays HTTP (not in IPFS scope)
// ============================================================================

/**
 * Engagement Merkle proof response from Shadow Atlas GET /v1/engagement-path/:leafIndex
 */
export interface EngagementPathResult {
	engagementRoot: string;
	engagementPath: string[];
	pathIndices: number[];
	tier: number;
	actionCount: number;
	diversityScore: number;
}

/**
 * Engagement metrics response from Shadow Atlas GET /v1/engagement-metrics/:identityCommitment
 */
export interface EngagementMetricsResult {
	identityCommitment: string;
	tier: number;
	actionCount: number;
	diversityScore: number;
	tenureMonths: number;
	leafIndex: number;
}

/**
 * Get the Tree 3 Merkle proof for a leaf by index.
 *
 * @param leafIndex - Position in the engagement tree
 * @returns Engagement proof with root, path, and metrics
 * @throws Error if leaf not found or request fails
 */
export async function getEngagementPath(leafIndex: number): Promise<EngagementPathResult> {
	const url = `${SHADOW_ATLAS_URL}/v1/engagement-path/${leafIndex}`;

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'X-Client-Version': 'voter-protocol-v1',
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));

		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas engagement path failed [${code}]: ${msg}`);
	}

	const result = await response.json();

	if (!result.success || !result.data) {
		throw new Error('Shadow Atlas returned invalid engagement path response');
	}

	const { engagementRoot, engagementPath, pathIndices, tier, actionCount, diversityScore } = result.data;

	if (!engagementRoot || !engagementPath || !pathIndices) {
		throw new Error('Shadow Atlas engagement path response missing required fields');
	}

	if (engagementPath.length !== CIRCUIT_DEPTH || pathIndices.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`Invalid engagement proof length: engagementPath=${engagementPath.length}, ` +
			`pathIndices=${pathIndices.length}. Expected ${CIRCUIT_DEPTH}.`
		);
	}

	// BR5-009: Validate all field elements are within BN254 scalar field
	validateBN254Hex(engagementRoot, 'engagementRoot');
	validateBN254HexArray(engagementPath, 'engagementPath');

	return { engagementRoot, engagementPath, pathIndices, tier, actionCount, diversityScore };
}

/**
 * Get engagement metrics for an identity.
 *
 * @param identityCommitment - Hex-encoded identity commitment (with 0x prefix)
 * @returns Engagement metrics including tier, action count, diversity score, and leaf index
 * @throws Error if identity not found or request fails
 */
export async function getEngagementMetrics(identityCommitment: string): Promise<EngagementMetricsResult> {
	// Ensure 0x prefix for URL path
	const icForUrl = identityCommitment.startsWith('0x') ? identityCommitment : '0x' + identityCommitment;
	const url = `${SHADOW_ATLAS_URL}/v1/engagement-metrics/${icForUrl}`;

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'X-Client-Version': 'voter-protocol-v1',
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));

		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas engagement metrics failed [${code}]: ${msg}`);
	}

	const result = await response.json();

	if (!result.success || !result.data) {
		throw new Error('Shadow Atlas returned invalid engagement metrics response');
	}

	return result.data;
}

/**
 * Detailed engagement breakdown result from Shadow Atlas.
 */
export interface EngagementBreakdownResult {
	identityCommitment: string;
	currentTier: number;
	compositeScore: number;
	metrics: {
		actionCount: number;
		diversityScore: number;
		shannonH: number;
		tenureMonths: number;
		adoptionCount: number;
	};
	factors: {
		action: number;
		diversity: number;
		tenure: number;
		adoption: number;
	};
	tierBoundaries: Array<{ tier: number; label: string; minScore: number }>;
	leafIndex: number;
}

/**
 * Get detailed engagement breakdown for an identity.
 * Includes composite score factors, tier progression, and boundaries.
 *
 * @param identityCommitment - Hex-encoded identity commitment (with 0x prefix)
 * @returns Detailed breakdown or null if identity not found
 */
export async function getEngagementBreakdown(identityCommitment: string): Promise<EngagementBreakdownResult | null> {
	const icForUrl = identityCommitment.startsWith('0x') ? identityCommitment : '0x' + identityCommitment;
	const url = `${SHADOW_ATLAS_URL}/v1/engagement-breakdown/${icForUrl}`;

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'X-Client-Version': 'voter-protocol-v1',
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		if (response.status === 404) return null;
		const errorData = await response.json().catch(() => ({
			error: { code: 'NETWORK_ERROR', message: response.statusText },
		}));
		const code = errorData.error?.code || 'UNKNOWN';
		const msg = errorData.error?.message || response.statusText;
		throw new Error(`Shadow Atlas engagement breakdown failed [${code}]: ${msg}`);
	}

	const result = await response.json();
	if (!result.success || !result.data) return null;
	return result.data;
}

// ============================================================================
// Officials (IPFS primary, Shadow Atlas HTTP fallback)
// ============================================================================

/**
 * Federal official from pre-ingested congress-legislators data.
 * Now served from IPFS-cached dataset — no runtime server calls.
 */
export interface Official {
	bioguide_id: string;
	name: string;
	party: string;
	chamber: 'house' | 'senate';
	state: string;
	district: string | null;
	office: string;
	phone: string | null;
	contact_form_url: string | null;
	website_url: string | null;
	cwc_code: string | null;
	is_voting: boolean;
	delegate_type: string | null;
}

export interface OfficialsSpecialStatus {
	type: 'dc' | 'territory';
	message: string;
	has_senators: boolean;
	has_voting_representative: boolean;
}

export interface OfficialsResponse {
	officials: Official[];
	district_code: string;
	state: string;
	special_status: OfficialsSpecialStatus | null;
	source: 'congress-legislators';
	cached: boolean;
}

/**
 * Get federal officials for a congressional district.
 *
 * Single-path: the chunked content source (R2/IPFS) serves a per-district
 * officials file (~2-5 KB), zero runtime server calls. There is deliberately
 * no HTTP fallback — the officials path fails loud when no content source is
 * configured or the lookup fails, never silently degrading.
 *
 * @param districtCode - District code like "CA-12", "VT-AL", "DC-00"
 * @returns Officials response with house rep + senators
 * @throws Error if no content source is configured, district not found, or data unavailable
 */
export async function getOfficials(districtCode: string): Promise<OfficialsResponse> {
	if (!isIPFSConfigured()) {
		throw new Error(
			'Officials lookup failed: no atlas content source configured (atlasBaseUrl or ipfsCid)'
		);
	}

	try {
		const officialsFile = await getOfficialsForDistrict(districtCode);
		if (!officialsFile) {
			throw new Error(`No officials data for district ${districtCode}`);
		}

		return {
			officials: officialsFile.officials.map(o => ({
				bioguide_id: o.id,
				name: o.name,
				party: o.party,
				chamber: o.chamber as 'house' | 'senate',
				state: o.state,
				district: o.district,
				office: `${o.chamber === 'senate' ? 'Senator' : 'Representative'}, ${o.state}`,
				phone: o.phone,
				contact_form_url: o.contact_form_url,
				website_url: o.website_url,
				cwc_code: null,
				is_voting: o.is_voting,
				delegate_type: o.delegate_type,
			})),
			district_code: districtCode,
			state: districtCode.split('-')[0],
			special_status: null,
			source: 'congress-legislators',
			cached: true,
		};
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Officials lookup failed [IPFS]: ${error.message}`);
		}
		throw new Error('Officials lookup failed with unknown error');
	}
}

// ============================================================================
// Composite Resolve (IPFS + H3 — no server call)
// ============================================================================

/**
 * Composite resolve: lookup + officials in one call.
 *
 * IPFS-native: both district resolution and officials lookup are local.
 * No Shadow Atlas server call required.
 *
 * @param lat - Latitude (-90 to 90)
 * @param lng - Longitude (-180 to 180)
 * @param includeOfficials - Whether to include officials in response (default: true)
 * @returns District lookup result and officials (null if unavailable)
 * @throws Error if the composite call fails
 */
export async function resolveLocation(
	lat: number,
	lng: number,
	includeOfficials = true,
): Promise<{ district: DistrictLookupResult; officials: OfficialsResponse | null }> {
	const districtResult = await lookupDistrict(lat, lng);

	let officials: OfficialsResponse | null = null;
	if (includeOfficials) {
		try {
			officials = await getOfficials(districtResult.district.id);
		} catch {
			// Officials unavailable — non-fatal, return null
			officials = null;
		}
	}

	return { district: districtResult, officials };
}

// ============================================================================
// Address Resolution — atlas-native geocoding + H3 district + officials
// ============================================================================

/**
 * Address resolution response.
 * Composite: geocode + district lookup + officials in one call.
 */
export interface AddressResolutionResult {
	geocode: {
		lat: number;
		lng: number;
		matched_address: string;
		confidence: number;
		country: 'US' | 'CA';
	};
	district: {
		id: string;
		name: string;
		jurisdiction: string;
		district_type: string;
	} | null;
	/**
	 * ALL populated, served boundary types for the resolved cell, ordered by canonical
	 * slot index ascending (congressional first when present). Includes the congressional
	 * entry (same id as `district`). [] when the cell is outside coverage. Only types in
	 * the served-slot allowlist are emitted — a type never appears here unless the
	 * coverage disclosure describes it.
	 */
	districts: ResolvedDistrictEntry[];
	officials: OfficialsResponse | null;
	cell_id: string | null;
	/** Resolution provenance — source + boundary-geometry vintage (mirrors upstream ProvenanceRecord). */
	provenance: ResolutionProvenance;
	/**
	 * Confidence in the resolved district. On a clean district hit: boundary-version
	 * confidence (1.0 enacted) capped by the geocode's matchClass precision (1.0
	 * exact point, 0.85 range interpolation, 0.6 ZIP centroid). 0 on a district miss
	 * (geocode-only, no district). Staleness guards may lower it downstream.
	 */
	confidence: number;
	/**
	 * Boundary-geometry freshness clock (TIGER vintage's generated date).
	 * null = honestly-unknown — never a fabricated or borrowed timestamp.
	 */
	boundaryAsOf: string | null;
	/**
	 * Officials-data freshness clock — independent of boundaryAsOf (two clocks never
	 * collapsed into one asOf). null = honestly-unknown; never reuses the boundary clock.
	 */
	officialsAsOf: string | null;
	/**
	 * Loud staleness/miss signal layered by the redraw-staleness guard. null when the
	 * district is a fresh, confident hit; a human-readable string when the boundary
	 * vintage is unknown, the controlling map was redrawn after the atlas vintage, or
	 * the district lookup missed. Confidence is lowered in lockstep — the warning never
	 * stands alone over a confidence-1.0 result.
	 */
	warning: string | null;
}

/**
 * Boundary-version status, mirrored locally from the upstream temporal-versioning
 * BoundaryVersionStatus (NO cross-repo import — coordinated via the R2 manifest).
 */
type BoundaryVersionStatus = 'enacted' | 'challenged' | 'enjoined' | 'superseded';

/**
 * Confidence for a resolved district given its boundary-version status.
 *
 * Mirrors voter-protocol's getVersionConfidence semantics (coordinated, never imported):
 * a clean/enacted boundary is fully trusted (1.0), an actively-challenged map is degraded
 * (0.4), and an enjoined or superseded boundary is not effective (0.0).
 *
 * The manifest currently carries no challenge state, so a clean district hit defaults to
 * 'enacted' → 1.0. The helper exists so downstream staleness guards can lower confidence
 * once the manifest surfaces a version status.
 */
function districtConfidence(status: BoundaryVersionStatus = 'enacted'): number {
	switch (status) {
		case 'enacted':
			return 1.0;
		case 'challenged':
			return 0.4;
		case 'enjoined':
		case 'superseded':
			return 0.0;
		default:
			return 1.0;
	}
}

/**
 * Resolve a structured address to coordinates + district + officials.
 *
 * Fully sovereign pipeline — the address never leaves infrastructure we control:
 *   1. Atlas address index (R2): normalize street (§3) → ZIP5 chunk →
 *      point/range/centroid match ladder (§2) → coordinates
 *   2. H3 + atlas chunks: coordinates → district (local, no server call)
 *   3. Atlas officials dataset: district → representatives (local)
 *
 * Zero external government API calls, zero third-party geocoding calls.
 *
 * Geocode precision is honest: an exact house-number point is 1.0, a
 * parity-matched range interpolation 0.85, a ZIP-centroid fallback 0.6 — and
 * a miss THROWS ('Address not found…'), never a fabricated coordinate.
 *
 * @param address - Structured address with street, city, state, zip
 * @returns Geocode + district + officials + cell_id
 * @throws Error with the exact 'Address not found…' message on a geocode miss
 * @throws AtlasInfraError when the atlas content store fails for infrastructure reasons
 * @throws AddressIndexSchemaError (plain Error) fail-closed on an address-index schema mismatch
 */
export async function resolveAddress(address: {
	street: string;
	city: string;
	state: string;
	zip: string;
	country?: 'US' | 'CA';
}): Promise<AddressResolutionResult> {
	const { street, city, state, zip, country } = address;
	const countryCode = country ?? 'US';

	// Step 1: Geocode from the atlas address index (normalize → ZIP5 chunk →
	// §2 match ladder). The error taxonomy mirrors the district-chunk path:
	//   - the EXACT 'Address not found…' miss message propagates untouched
	//     (API layers key their 404 GEOCODE_MISS on it);
	//   - a fail-closed schema mismatch (AddressIndexSchemaError) propagates
	//     as a plain Error — a producer bug is never an outage and NEVER a
	//     silent fallback;
	//   - anything else from the store is an infrastructure fault (5xx,
	//     timeout, DNS), classified as AtlasInfraError so callers never
	//     convert an outage into a billable miss.
	let geocoded: GeocodeResult;
	try {
		geocoded = await geocodeAddress({ street, city, state, zip, country: countryCode });
	} catch (err) {
		if (err instanceof AddressIndexSchemaError) throw err;
		if (err instanceof Error && err.message === ADDRESS_NOT_FOUND_MESSAGE) throw err;
		throw new AtlasInfraError(
			`Atlas address-index fetch failed: ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err },
		);
	}

	const { lat, lng, matchedAddress } = geocoded;
	const precisionFactor = matchClassPrecision(geocoded.matchClass);

	// Step 2: District lookup via H3 + atlas chunk (local, no server call).
	// ONE chunk fetch feeds both views: the legacy slot-0 district (back-compat,
	// confidence semantics unchanged) and the multi-type districts array.
	let district: AddressResolutionResult['district'] = null;
	let districts: ResolvedDistrictEntry[] = [];
	let cellId: string | null = null;
	let districtMissed = false;

	try {
		const { cellIndex, slots } = await lookupCellSlots(lat, lng);
		cellId = cellIndex;
		districts = slotsToResolvedDistricts(slots);
		const primary = districts.find((d) => d.district_type === 'congressional') ?? null;
		if (primary) {
			district = {
				id: primary.id,
				name: primary.name,
				jurisdiction: primary.jurisdiction,
				district_type: primary.district_type,
			};
		} else {
			// Chunk exists but carries no congressional assignment: the PRIMARY miss
			// semantics stay keyed to slot 0 exactly as before (confidence 0 + warning),
			// while any populated non-congressional boundaries still surface honestly.
			districtMissed = true;
		}
	} catch (err) {
		// An atlas infrastructure fault (R2/IPFS outage, timeout) is NOT a coverage miss —
		// it must never be converted into a districtMissed (billable) result. Propagate it.
		if (err instanceof AtlasInfraError) throw err;
		// District lookup failed — coordinates may be outside coverage.
		// Return geocode result without district (non-fatal, but a loud miss:
		// confidence drops to 0 below — this is not a confident geocode-only success).
		districtMissed = true;
	}

	// Step 3: Officials via IPFS dataset (local, no server call)
	let officials: OfficialsResponse | null = null;
	if (district) {
		try {
			officials = await getOfficials(district.id);
		} catch {
			// Officials unavailable — non-fatal
		}
	}

	// Step 4: Provenance + freshness clocks from the R2 manifest.
	// Two clocks stay distinct — boundary geometry and officials sync move on different
	// cadences and are never collapsed into one asOf.
	// Best-effort: a transient R2/IPFS manifest failure DEGRADES the freshness clocks to
	// null (boundaryAsOf/officialsAsOf null, tigerVintage 'unknown') — it must NEVER throw.
	// Only geocoding failure throws; a fully-resolved address is not discarded over a clock.
	let manifest: Awaited<ReturnType<typeof getManifestVintage>> | null = null;
	try {
		manifest = await getManifestVintage(countryCode);
	} catch {
		manifest = null;
	}
	const tigerVintage = manifest?.tigerVintage ?? null;
	// boundaryAsOf is the boundary-geometry clock: present only when the manifest carries a
	// real TIGER vintage. null when tigerVintage is null/'unknown'/absent — never fabricated
	// or borrowed from another clock.
	const boundaryAsOf = tigerVintage ? (manifest?.generated ?? null) : null;
	// officialsAsOf is the officials-data clock, independent of boundaryAsOf. It reads the
	// producer-stamped manifest.officialsGenerated (degraded to null when absent/'unknown'),
	// stays honestly null when the manifest carries none — NEVER reuse boundaryAsOf for it.
	const officialsAsOf = manifest?.officialsGenerated ?? null;

	// source names the geocoder (the atlas address index); the boundary store is named
	// separately by tigerVintage. The old overloaded single-string vintage tag is retired —
	// provenance is structured, not a single conflated tag.
	const provenance: ResolutionProvenance = {
		source: 'atlas-address-index',
		tigerVintage: tigerVintage ?? 'unknown',
	};

	// A clean district hit is trusted to the geocode's PRECISION: boundary-version
	// confidence (1.0 enacted) capped by the matchClass precision factor — a range- or
	// ZIP-grade match can straddle a district line, so it never claims 1.0. A district
	// miss stays a loud, low-confidence (0) geocode-only result.
	const confidence = districtMissed
		? 0
		: Math.min(districtConfidence(), precisionFactor);

	const base: AddressResolutionResult = {
		geocode: {
			lat,
			lng,
			matched_address: matchedAddress,
			// The matchClass precision factor IS the geocode confidence — precision
			// of the placement, not prominence of the match.
			confidence: precisionFactor,
			country: countryCode,
		},
		district,
		districts,
		officials,
		cell_id: cellId,
		provenance,
		confidence,
		boundaryAsOf,
		officialsAsOf,
		warning: null,
	};

	// Redraw/staleness guard — layers a loud warning + lowers confidence when the atlas
	// boundary is stale (vintage unknown, or a controlling map redrawn after the vintage)
	// or the district lookup missed. Total/best-effort: it never throws and never discards
	// the resolved address. Reuses the already-fetched manifest (no second fetch).
	return applyStalenessGuard(base, manifest, { state });
}

