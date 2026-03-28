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
	getManifest,
	setCIDs,
	isIPFSConfigured,
	type CellDistricts,
	type CellEntry,
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
 * Fetch full cell data (districts + Tree 2 SMT proof) entirely from IPFS.
 *
 * This is the privacy-critical function that replaces the server-side
 * `GET /api/shadow-atlas/cell-proof?cell_id=X` call. The server never
 * learns which cell the user belongs to.
 *
 * Flow:
 *   1. Browser has lat/lng from geolocation or map pin
 *   2. Compute H3 cell index → H3 res-3 parent
 *   3. Fetch cell chunk from IPFS by parent key (~60 KB gzipped)
 *   4. Look up the H3 cell → get GEOID (cell_id), districts, SMT proof
 *   5. Return circuit-ready data
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param country - ISO 3166-1 alpha-2 country code (default: "US")
 * @returns ClientCellProofResult with circuit-ready data, or null if not found
 */
export async function getFullCellDataFromBrowser(
	lat: number,
	lng: number,
	country = 'US',
): Promise<ClientCellProofResult | null> {
	if (!isIPFSConfigured()) {
		console.warn('[browser-client] IPFS not configured — cannot fetch cell proof');
		return null;
	}

	// Step 1: Compute H3 cell and parent chunk key
	const h3Cell = latLngToCell(lat, lng, H3_RESOLUTION);
	const parentKey = cellToParent(h3Cell, 3);

	// Step 2: Fetch the chunk from IPFS
	const chunk = await getCellChunkByParent(parentKey, country);
	if (!chunk) return null;

	// Step 3: Look up by H3 cell index (chunks are keyed by H3, not GEOID)
	const entry = chunk.cells[h3Cell];
	if (!entry) {
		// H3 cell not in this chunk — might be at a boundary. Try neighboring cells.
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
