/**
 * Browser-Safe Shadow Atlas Client
 *
 * Resolves districts from IPFS directly in the browser — no server calls.
 * Uses ipfs-store.ts (which has no $env/dynamic/private imports).
 *
 * Used by AddressVerificationFlow.svelte when SHADOW_ATLAS_VERIFICATION is enabled.
 */

import { latLngToCell } from 'h3-js';
import {
	getChunkForCell,
	getOfficialsForDistrict,
	setCIDs,
	isIPFSConfigured,
	type CellDistricts,
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
