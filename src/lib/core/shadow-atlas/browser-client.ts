/**
 * Browser-Safe Shadow Atlas Client
 *
 * Resolves districts from IPFS directly in the browser — no server calls.
 * Uses ipfs-store.ts (which has no $env/dynamic/private imports).
 *
 * Used by AddressVerificationFlow.svelte when SHADOW_ATLAS_VERIFICATION is enabled.
 */

import { latLngToCell } from 'h3-js';
import { cellToParent } from 'h3-js';
import {
	getChunkForCell,
	getOfficialsForDistrict,
	getCellChunkByParent,
	getDistrictIndex,
	configure,
	isConfigured,
	type CellDistricts,
	type CellEntry,
	type DistrictIndex,
	type OfficialsFileIPFS,
} from './ipfs-store';

// Initialize content sources from Vite public env vars (available in browser).
// R2 is primary; IPFS activates when CID is set.
const VITE_ATLAS_URL = import.meta.env.VITE_ATLAS_BASE_URL as string | undefined;
const VITE_CID_ROOT = import.meta.env.VITE_IPFS_CID_ROOT as string | undefined;
configure({
	atlasBaseUrl: VITE_ATLAS_URL || '',
	ipfsCid: VITE_CID_ROOT || '',
});

/** H3 resolution for Shadow Atlas cells */
const H3_RESOLUTION = 7;

/**
 * Look up all 24 district slots for a lat/lng from IPFS (browser-side).
 * Returns null if IPFS is not configured or cell has no data.
 */
export async function lookupDistrictsFromBrowser(
	lat: number,
	lng: number,
): Promise<CellDistricts | null> {
	if (!isConfigured()) {
		console.warn('[browser-client] Content source not configured (VITE_IPFS_CID_ROOT missing)');
		return null;
	}

	const cellId = latLngToCell(lat, lng, H3_RESOLUTION);
	const slots = await getChunkForCell(cellId);
	if (!slots) return null;

	return { slots };
}

/**
 * Get officials for a district code from IPFS (browser-side).
 */
export async function getOfficialsFromBrowser(
	districtCode: string,
): Promise<OfficialsFileIPFS | null> {
	if (!isConfigured()) return null;
	return getOfficialsForDistrict(districtCode);
}

// ============================================================================
// Client-Side Tree 2 Proof (Zero Server Leaks)
// ============================================================================

/**
 * Result of a full client-side cell data lookup.
 * Contains everything needed for ZK proof generation without any server contact.
 */
export interface ClientCellProofResult {
	/** Tree 2 SMT root (0x-hex BN254) */
	cellMapRoot: string;
	/** The cell_id field element for the circuit (GEOID encoded as 0x-hex BN254) */
	cellId: string;
	/** SMT siblings from leaf to root */
	cellMapPath: string[];
	/** SMT direction bits */
	cellMapPathBits: number[];
	/** All 24 district IDs as 0x-hex field elements */
	districts: string[];
}

/**
 * Fetch cell proof data entirely from IPFS — zero server contact.
 *
 * Three paths, in priority order if multiple are supplied:
 *
 * **CellId path (T3+ recommended, post-G1):**
 *   Caller already has the user's H3 cell — typically derived server-side from
 *   the mDL's postal+city+state via Nominatim and returned to the client. The
 *   leaf binds to the user's actual ZIP-derived cell, not a random one.
 *   See specs/CONSTITUENCY-PROOF-SEMANTICS.md §4 G1.
 *
 * **District path (T0 fallback):**
 *   User has no verified address. Pass the district's field element hex and
 *   slot number; we pick a random chunk to maximize anonymity. The leaf binds
 *   to a random cell of the right district — no constituency anchor, but no
 *   address disclosure either.
 *
 * **Lat/lng path:**
 *   Direct H3 cell lookup from coordinates. Used by paths that already have a
 *   geocoded point (boundary visualization, address-entry flows).
 *
 * @param options.cellId - H3 cell string at H3_RESOLUTION (e.g. "872830828ffffff").
 *                          Canonicalized to BN254 field hex internally via chunk.h3Index.
 * @param options.districtHex - District field element hex (from district index). Use with `slot`.
 * @param options.slot - District slot number (0=congressional, 2=state senate, etc.)
 * @param options.lat - Latitude (alternative to district / cellId)
 * @param options.lng - Longitude (alternative to district / cellId)
 * @param options.country - ISO 3166-1 alpha-2 (default: "US")
 */
export async function getFullCellDataFromBrowser(options: {
	cellId?: string;
	districtHex?: string;
	slot?: number;
	lat?: number;
	lng?: number;
	country?: string;
}): Promise<ClientCellProofResult | null> {
	if (!isConfigured()) {
		console.warn('[browser-client] Content source not configured — cannot fetch cell proof');
		return null;
	}

	const country = options.country ?? 'US';

	// Path C: H3 cellId → direct chunk fetch. Caller already knows the cell;
	// no random selection, no scanning. This is the T3+ path (G1).
	if (options.cellId != null) {
		return findCellByH3Index(options.cellId, country);
	}

	// Path A: District hex + slot → O(1) index lookup → random chunk fetch
	// (T0 fallback — preserves anonymity at the cost of a random cell anchor).
	if (options.districtHex != null && options.slot != null) {
		return findCellForDistrict(options.districtHex, options.slot, country);
	}

	// Path B: Lat/lng → specific H3 cell
	if (options.lat != null && options.lng != null) {
		return findCellByLocation(options.lat, options.lng, country);
	}

	console.warn('[browser-client] No lookup parameters provided');
	return null;
}

/**
 * Find a valid cell for a district using the district index.
 *
 * The district index maps (slot, fieldElementHex) → chunk keys.
 * One manifest fetch + one index fetch + one chunk fetch = O(1).
 *
 * @param districtHex - The field element hex from the district index
 * @param slot - The slot number (0=congressional, 2=state senate, etc.)
 */
async function findCellForDistrict(
	districtHex: string,
	slot: number,
	country: string,
): Promise<ClientCellProofResult | null> {
	const index = await getDistrictIndex(country);
	if (!index) {
		console.warn('[browser-client] District index not available');
		return null;
	}

	const slotIndex = index.slots[String(slot)];
	if (!slotIndex) {
		console.warn(`[browser-client] No index data for slot ${slot}`);
		return null;
	}

	const chunkKeys = slotIndex[districtHex];
	if (!chunkKeys || chunkKeys.length === 0) {
		console.warn(`[browser-client] No chunks for district ${districtHex} in slot ${slot}`);
		return null;
	}

	// Pick a random chunk to maximize anonymity
	const randomKey = chunkKeys[Math.floor(Math.random() * chunkKeys.length)];
	const chunk = await getCellChunkByParent(randomKey, country);
	if (!chunk) return null;

	// Find a cell with matching district in the specified slot
	for (const entry of Object.values(chunk.cells)) {
		if (entry.d[slot].toLowerCase() === districtHex.toLowerCase()) {
			return {
				cellMapRoot: chunk.cellMapRoot,
				cellId: entry.c,
				cellMapPath: [...entry.p],
				cellMapPathBits: [...entry.b],
				districts: [...entry.d],
			};
		}
	}

	console.warn(`[browser-client] Chunk ${randomKey} had no matching cell for slot ${slot}`);
	return null;
}

/**
 * Find cell entry by exact H3 cell index (string at H3_RESOLUTION).
 *
 * Cell chunks are keyed by cellId (GEOID-encoded BN254 field hex). The
 * optional `h3Index` field provides O(1) H3 → cellId reverse lookup.
 * Falls back to direct key lookup for backwards compatibility with
 * H3-keyed chunks.
 *
 * The G1 (T3+) entry point: callers pass the H3 string they received from
 * verify-mdl directly, without going through latLngToCell.
 *
 * G9 trust assumption: chunk.h3Index and chunk.cells are both UNAUTHENTICATED
 * server input. A compromised atlas operator could swap h3Index["872..."]
 * to point at a different cell's entry (cell-redirection attack). Defenses:
 *   - The atlas operator is already trusted to publish correct Tree 2 SMT
 *     data; trusting them to also publish correct h3Index → entry mappings
 *     is consistent with the existing trust tier.
 *   - G2 (boundary-cell mismatch) detects the attack visibly to the user:
 *     if h3Index points to a cell whose slot[0] disagrees with the verified
 *     district, the credential is marked cellStraddles=true. The user sees
 *     the divergence in the receipt UI (G5). Not silently exploitable.
 *   - G7r option-(c) routing reads from witness.districts[0] (cryptographically
 *     bound to cellId via SMT inclusion), so a redirected entry routes
 *     delivery to whatever district the atlas claimed — which the user is
 *     already informed of via cellStraddles.
 * Real fix (deferred): Merkle inclusion proofs over h3Index entries against
 * the chunk's cellMapRoot. Substantial schema + build-pipeline lift not
 * justified by the residual risk after G2+G7r.
 */
async function findCellByH3Index(
	h3Cell: string,
	country: string,
): Promise<ClientCellProofResult | null> {
	const parentKey = cellToParent(h3Cell, 3);

	const chunk = await getCellChunkByParent(parentKey, country);
	if (!chunk) return null;

	// Try h3Index reverse lookup (cellId-keyed chunks)
	const h3Idx = (chunk as { h3Index?: Record<string, string> }).h3Index;
	let entry: CellEntry | undefined;
	if (h3Idx) {
		const cellKey = h3Idx[h3Cell];
		if (cellKey) entry = chunk.cells[cellKey];
	}

	// Fall back to direct key lookup (backwards compat with H3-keyed chunks)
	if (!entry) {
		entry = chunk.cells[h3Cell];
	}

	if (!entry) {
		console.warn(`[browser-client] H3 cell ${h3Cell} not found in chunk ${parentKey}`);
		return null;
	}

	return {
		cellMapRoot: chunk.cellMapRoot,
		cellId: entry.c,
		cellMapPath: [...entry.p],
		cellMapPathBits: [...entry.b],
		districts: [...entry.d],
	};
}

/**
 * Find cell by exact lat/lng. Computes the H3 cell at H3_RESOLUTION,
 * then delegates to findCellByH3Index.
 */
async function findCellByLocation(
	lat: number,
	lng: number,
	country: string,
): Promise<ClientCellProofResult | null> {
	const h3Cell = latLngToCell(lat, lng, H3_RESOLUTION);
	return findCellByH3Index(h3Cell, country);
}

/**
 * Look up available districts for a given slot from the district index.
 * Returns a list of { hex, label } pairs the browser can display.
 *
 * @param slot - Slot number (0=congressional, 2=state senate, etc.)
 * @param country - ISO 3166-1 alpha-2 (default: "US")
 */
export async function getDistrictsForSlot(
	slot: number,
	country = 'US',
): Promise<{ hex: string; label: string }[] | null> {
	const index = await getDistrictIndex(country);
	if (!index) return null;

	const slotIndex = index.slots[String(slot)];
	if (!slotIndex) return null;

	return Object.keys(slotIndex).map(hex => ({
		hex,
		label: index.labels[hex] ?? hex,
	}));
}

/**
 * Find the field element hex for a verified district in display format (e.g. "CA-12").
 *
 * Converts the display format to raw GEOID, then searches the district index
 * labels to find the matching field element hex.
 *
 * @param verifiedDistrict - Display format district code (e.g. "CA-12", "VT-AL")
 * @param slot - Slot number (0=congressional, 2=state senate, etc.)
 * @param country - ISO 3166-1 alpha-2 (default: "US")
 * @returns The field element hex string, or null if not found
 */
export async function findDistrictHex(
	verifiedDistrict: string,
	slot = 0,
	country = 'US',
): Promise<string | null> {
	const { displayDistrictToGEOID } = await import('./district-format');
	const geoid = displayDistrictToGEOID(verifiedDistrict);
	if (!geoid) {
		console.warn(`[browser-client] Cannot convert district "${verifiedDistrict}" to GEOID`);
		return null;
	}

	const index = await getDistrictIndex(country);
	if (!index) {
		console.warn('[browser-client] District index not available');
		return null;
	}

	// Search labels: fieldElementHex → raw GEOID string
	for (const [hex, label] of Object.entries(index.labels)) {
		if (label.toLowerCase() === geoid.toLowerCase()) {
			// Verify this hex exists in the requested slot
			const slotIndex = index.slots[String(slot)];
			if (slotIndex && slotIndex[hex]) {
				return hex;
			}
		}
	}

	console.warn(`[browser-client] No district hex found for GEOID "${geoid}" in slot ${slot}`);
	return null;
}
