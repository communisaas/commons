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
	setCIDs,
	isIPFSConfigured,
	type CellDistricts,
	type CellEntry,
	type DistrictIndex,
	type OfficialsFileIPFS,
} from './ipfs-store';

// Initialize CIDs from Vite public env var (available in browser)
const VITE_CID_ROOT = import.meta.env.VITE_IPFS_CID_ROOT as string | undefined;
if (VITE_CID_ROOT) {
	setCIDs({ root: VITE_CID_ROOT });
}

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
	if (!isIPFSConfigured()) {
		console.warn('[browser-client] IPFS not configured (VITE_IPFS_CID_ROOT missing)');
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
	if (!isIPFSConfigured()) return null;
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
 * Two paths:
 *
 * **District path (recommended, most private):**
 *   User already verified their district at Tier 2. Pass the district's field
 *   element hex (from the district index) and slot number. The function fetches
 *   exactly one chunk via the index — O(1), no scanning.
 *   User discloses nothing beyond their verified district type.
 *
 * **Lat/lng path (fallback):**
 *   Direct H3 cell lookup. Used when the caller has coordinates.
 *
 * @param options.districtHex - District field element hex (from district index). Use with `slot`.
 * @param options.slot - District slot number (0=congressional, 2=state senate, etc.)
 * @param options.lat - Latitude (alternative to district)
 * @param options.lng - Longitude (alternative to district)
 * @param options.country - ISO 3166-1 alpha-2 (default: "US")
 */
export async function getFullCellDataFromBrowser(options: {
	districtHex?: string;
	slot?: number;
	lat?: number;
	lng?: number;
	country?: string;
}): Promise<ClientCellProofResult | null> {
	if (!isIPFSConfigured()) {
		console.warn('[browser-client] IPFS not configured — cannot fetch cell proof');
		return null;
	}

	const country = options.country ?? 'US';

	// Path A: District hex + slot → O(1) index lookup → one chunk fetch
	if (options.districtHex != null && options.slot != null) {
		return findCellForDistrict(options.districtHex, options.slot, country);
	}

	// Path B: Lat/lng → specific H3 cell
	if (options.lat != null && options.lng != null) {
		return findCellByLocation(options.lat, options.lng, country);
	}

	console.warn('[browser-client] Neither district nor lat/lng provided');
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
 * Find cell by exact H3 location.
 *
 * Cell chunks are keyed by cellId (GEOID string). The optional `h3Index`
 * field provides O(1) H3 res-7 → cellId reverse lookup. Falls back to
 * direct key lookup for backwards compatibility with H3-keyed chunks.
 */
async function findCellByLocation(
	lat: number,
	lng: number,
	country: string,
): Promise<ClientCellProofResult | null> {
	const h3Cell = latLngToCell(lat, lng, H3_RESOLUTION);
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
