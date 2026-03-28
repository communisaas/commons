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

/**
 * Compute a district commitment from the 24 jurisdiction slots.
 * Uses Poseidon2 sponge hash if available, falls back to SHA-256.
 *
 * This is the privacy-preserving commitment that replaces sending
 * plaintext district codes to the server.
 */
export async function computeDistrictCommitment(
	slots: CellDistricts,
): Promise<{ commitment: string; slotCount: number }> {
	// Count non-empty slots
	const slotCount = slots.slots.filter(s => s !== '' && s !== null && s !== undefined).length;

	// Pad/truncate to exactly 24 elements for the sponge
	const padded: (string | null)[] = [...slots.slots];
	while (padded.length < 24) padded.push(null);

	// Try Poseidon2 sponge (crypto module — requires WASM, browser-only)
	try {
		const { poseidon2Sponge24 } = await import('../crypto/poseidon');
		// BN254 scalar field order
		const BN254_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
		// Convert district strings to hex field elements
		const hexInputs = padded.slice(0, 24).map(s => {
			if (!s) return '0x' + '0'.repeat(64);
			const bytes = new TextEncoder().encode(s);
			let val = 0n;
			for (const b of bytes) val = (val << 8n) | BigInt(b);
			val = val % BN254_ORDER;
			return '0x' + val.toString(16).padStart(64, '0');
		});
		const commitment = await poseidon2Sponge24(hexInputs);
		return { commitment, slotCount };
	} catch {
		// Fallback: SHA-256 of concatenated slots
		const data = new TextEncoder().encode(slots.slots.join('|'));
		const hash = await crypto.subtle.digest('SHA-256', data);
		const hex = Array.from(new Uint8Array(hash))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
		return { commitment: hex, slotCount };
	}
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
		if (entry.d[slot] === districtHex) {
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

	const entry = chunk.cells[h3Cell];
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
