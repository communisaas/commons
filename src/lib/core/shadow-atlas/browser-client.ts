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
	cellMapRoot: string;
	cellMapPath: string[];
	cellMapPathBits: number[];
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
 *   1. Compute H3 res-3 parent from the user's H3 cell (or GEOID)
 *   2. Fetch the combined cell chunk from IPFS (~60 KB gzipped)
 *   3. Extract the user's cell entry (districts + SMT proof)
 *   4. Return circuit-ready data
 *
 * @param cellId - Cell identifier (GEOID as string, matching tree's cellId.toString())
 * @param h3CellIndex - Optional H3 cell index for parent grouping. If provided,
 *   used to compute the H3 res-3 parent for chunk lookup. If omitted, falls back
 *   to the manifest-based lookup.
 * @param country - ISO 3166-1 alpha-2 country code (default: "US")
 * @returns ClientCellProofResult with circuit-ready data, or null if not found
 */
export async function getFullCellDataFromBrowser(
	cellId: string,
	h3CellIndex?: string,
	country = 'US',
): Promise<ClientCellProofResult | null> {
	if (!isIPFSConfigured()) {
		console.warn('[browser-client] IPFS not configured — cannot fetch cell proof');
		return null;
	}

	// Determine the parent chunk key
	let parentKey: string | undefined;
	if (h3CellIndex) {
		parentKey = cellToParent(h3CellIndex, 3);
	}

	// Fetch the cell chunk
	let entry: CellEntry | undefined;
	let cellMapRoot: string | undefined;

	if (parentKey) {
		// Fast path: we know the parent key from H3
		const chunk = await getCellChunkByParent(parentKey, country);
		if (chunk) {
			entry = chunk.cells[cellId];
			cellMapRoot = chunk.cellMapRoot;
		}
	}

	if (!entry) {
		// Slow path: try manifest-based lookup
		const { getCellProofFromIPFS } = await import('./ipfs-store');
		const result = await getCellProofFromIPFS(cellId, country);
		if (result) {
			entry = result.entry;
			cellMapRoot = result.cellMapRoot;
		}
	}

	if (!entry || !cellMapRoot) return null;

	return {
		cellMapRoot,
		cellMapPath: [...entry.p],
		cellMapPathBits: [...entry.b],
		districts: [...entry.d],
	};
}
