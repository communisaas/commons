/**
 * Wave 6 / FU-1.1 — Issuance-time district-commitment authenticity check.
 *
 * The downgrade guard (Wave 1b, `convex/users.ts`) ensures any user who has
 * held a v2 credential MUST supply a `district_commitment` on every
 * subsequent verify-address. But the guard checks PRESENCE, not CONTENT —
 * a malicious client could submit a valid 64-hex string that doesn't
 * correspond to any actual district set.
 *
 * This module closes that gap: given the geocoded coordinates of the user's
 * address, it fetches the same H3 cell data the client used and recomputes
 * the expected commitment. The verify-address handler compares the recomputed
 * value to the client-supplied one and rejects on mismatch.
 *
 * Privacy framing:
 *   The server already learns lat/lng during the geocoding step
 *   (`/api/location/resolve-address`). Sending coordinates back to
 *   verify-address does not leak more than the server already saw.
 *   The "server doesn't store the district mapping per user" property is
 *   preserved — the only on-disk artifact is the opaque commitment.
 *
 * Failure modes:
 *   - IPFS gateway slow/unavailable → throw COMMITMENT_VERIFY_IPFS_UNAVAILABLE.
 *     Caller (verify-address handler) decides whether to fail-closed (prod)
 *     or fall through with a warning (staging).
 *   - Coordinates resolve to a cell with !== 24 districts → throw
 *     COMMITMENT_VERIFY_BAD_CELL_DATA. Indicates IPFS data corruption or
 *     unsupported region (US territories where Census Block data is missing).
 *   - Recomputed commitment !== client-supplied → throw
 *     COMMITMENT_AUTHENTICITY_MISMATCH. Surface to user as 400 with a
 *     retry-able error code.
 */

import { getFullCellDataFromBrowser } from '$lib/core/shadow-atlas/browser-client';
import { poseidon2Sponge24 } from '$lib/core/crypto/poseidon';
import {
	getExpectedCellMapRoot,
	getExpectedCellMapDepth
} from '$lib/core/shadow-atlas/ipfs-store';
import { verifyCellMapMembership } from '$lib/core/shadow-atlas/cell-authenticity';

interface VerifyCommitmentArgs {
	lat: number;
	lng: number;
	clientCommitment: string;
	country?: string;
	/** IPFS fetch timeout in ms (default 8000). Cloudflare Workers cap at
	 *  30s end-to-end, so 8s leaves room for Poseidon + downstream Convex
	 *  calls. SELF-REVIEW B fix: explicit timeout prevents hung verify
	 *  requests when IPFS is slow but not down. */
	timeoutMs?: number;
}

interface VerifyCommitmentResult {
	matches: boolean;
	expectedCommitment: string;
}

/**
 * SELF-REVIEW B fix — race the IPFS fetch against a timer so a slow gateway
 * surfaces as `COMMITMENT_VERIFY_IPFS_TIMEOUT` (mapped to 503 retry by the
 * caller) instead of a 30s platform-edge timeout that abandons the request
 * mid-flight.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timerId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timerId = setTimeout(() => {
			reject(new Error(`COMMITMENT_VERIFY_IPFS_TIMEOUT: deadline ${timeoutMs}ms exceeded`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timerId !== undefined) clearTimeout(timerId);
	}
}

/**
 * Compute the expected districtCommitment for a coordinate pair and compare
 * to the client-supplied value. Returns matches=true on agreement; throws
 * with a typed error code otherwise.
 *
 * @throws Error('COMMITMENT_VERIFY_IPFS_UNAVAILABLE') if cell data can't be fetched
 * @throws Error('COMMITMENT_VERIFY_BAD_CELL_DATA') if districts.length !== 24
 * @throws Error('COMMITMENT_AUTHENTICITY_MISMATCH') if recomputed != client value
 */
export async function verifyDistrictCommitment(
	args: VerifyCommitmentArgs
): Promise<VerifyCommitmentResult> {
	let cellData: Awaited<ReturnType<typeof getFullCellDataFromBrowser>>;
	const timeoutMs = args.timeoutMs ?? 8000;
	try {
		cellData = await withTimeout(
			getFullCellDataFromBrowser({
				lat: args.lat,
				lng: args.lng,
				country: args.country ?? 'US'
			}),
			timeoutMs
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// Preserve the typed timeout error; wrap others as IPFS_UNAVAILABLE.
		if (msg.includes('COMMITMENT_VERIFY_IPFS_TIMEOUT')) throw err;
		throw new Error(`COMMITMENT_VERIFY_IPFS_UNAVAILABLE: ${msg}`);
	}

	if (!cellData) {
		throw new Error(
			'COMMITMENT_VERIFY_IPFS_UNAVAILABLE: cell data fetch returned null'
		);
	}
	if (!Array.isArray(cellData.districts) || cellData.districts.length !== 24) {
		throw new Error(
			`COMMITMENT_VERIFY_BAD_CELL_DATA: expected 24 districts, got ${cellData.districts?.length ?? 'undefined'}`
		);
	}

	// F-1.1 (partial): SMT-path authenticity gate. Closes chunk *fabrication*
	// (forging an unpublished `(cellId, districts)` pair) by requiring the
	// chunk's SMT path to resolve to the externally-pinned Tree 2 root.
	// Does NOT close chunk *substitution* (attacker swaps in a different
	// real leaf under the user's h3 key) — that's F-1.1b, deferred to the
	// circuit-signature change that binds h3Cell into the leaf encoding.
	const expectedRoot = getExpectedCellMapRoot();
	const expectedDepth = getExpectedCellMapDepth();
	const isProduction =
		typeof globalThis.process !== 'undefined' &&
		globalThis.process.env?.NODE_ENV === 'production';
	const allowUnpinned =
		typeof globalThis.process !== 'undefined' &&
		globalThis.process.env?.ATLAS_AUTHENTICITY_ALLOW_UNPINNED === '1';

	if (expectedRoot) {
		const requiredFields = ['cellMapPath', 'cellMapPathBits', 'cellId'] as const;
		for (const field of requiredFields) {
			if (
				cellData[field as keyof typeof cellData] === undefined ||
				cellData[field as keyof typeof cellData] === null
			) {
				throw new Error(
					`COMMITMENT_VERIFY_BAD_CELL_DATA: missing ${field} required for authenticity check`
				);
			}
		}
		try {
			await verifyCellMapMembership({
				cellId: cellData.cellId,
				districts: cellData.districts,
				siblings: cellData.cellMapPath,
				bits: cellData.cellMapPathBits,
				expectedRoot,
				expectedDepth: expectedDepth > 0 ? expectedDepth : undefined
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn('[verify-commitment] cell-map authenticity failed', {
				lat: args.lat,
				lng: args.lng,
				detail: msg
			});
			// Surface as a typed error the caller maps to 400 (the chunk we
			// fetched isn't who it claims to be — refusing the verification
			// is the only safe response).
			throw new Error(`COMMITMENT_VERIFY_CELL_MAP_ROOT_MISMATCH: ${msg}`);
		}
	} else if (isProduction && !allowUnpinned) {
		// Fail-closed in production when no pin is configured. The atlas-
		// authenticity gate is load-bearing for F-1.1 — operating without it
		// re-opens the poisoned-gateway forgery primitive. The escape hatch
		// (ATLAS_AUTHENTICITY_ALLOW_UNPINNED=1) exists for the brief rotation
		// window where the new atlas is published but the env var hasn't
		// propagated; ops sets it deliberately and then unsets it.
		throw new Error(
			'COMMITMENT_VERIFY_CELL_MAP_ROOT_NOT_PINNED: EXPECTED_CELL_MAP_ROOT not configured'
		);
	} else if (isProduction && allowUnpinned) {
		// Bypass active in production. Emit structured warn on EVERY request so
		// monitoring picks up a stale `1` left in a terraform plan / k8s
		// ConfigMap. Logged at warn level (not info) so log-routing rules
		// notice and operators get paged on volume.
		console.warn(
			'[verify-commitment] ATLAS_AUTHENTICITY_GATE_BYPASSED: production request served without pin (review-finding bypass)',
			{
				lat: args.lat,
				lng: args.lng,
				bypass: 'ATLAS_AUTHENTICITY_ALLOW_UNPINNED'
			}
		);
	} else {
		console.warn(
			'[verify-commitment] EXPECTED_CELL_MAP_ROOT not set — running without atlas authenticity gate (dev only)'
		);
	}

	const expectedCommitment = await poseidon2Sponge24(cellData.districts);

	// Normalize both sides — caller may send 0x-prefixed or not, with leading
	// zeros or not. BigInt comparison handles both.
	const expectedBig = BigInt(expectedCommitment);
	const clientBig = (() => {
		try {
			return BigInt(args.clientCommitment);
		} catch {
			throw new Error(
				'COMMITMENT_AUTHENTICITY_MISMATCH: clientCommitment is not valid hex'
			);
		}
	})();

	if (expectedBig !== clientBig) {
		// SELF-REVIEW C: surface the active CID in failure logs so when this
		// fires, ops can compare server-side `IPFS_CID_ROOT` to client-side
		// `VITE_IPFS_CID_ROOT` (build-time embedded). Mismatch between the
		// two is the most common cause of legitimate-user rejections during
		// shadow-atlas rollout windows.
		try {
			const { IPFS_CIDS } = await import('$lib/core/shadow-atlas/ipfs-store');
			console.warn('[verify-commitment] authenticity mismatch — server CID', {
				ipfsCidRoot: IPFS_CIDS.root || '(unset)',
				lat: args.lat,
				lng: args.lng
			});
		} catch {
			/* IPFS_CIDS not exported in this build */
		}
		throw new Error(
			`COMMITMENT_AUTHENTICITY_MISMATCH: expected ${expectedCommitment}, client supplied ${args.clientCommitment}`
		);
	}

	return { matches: true, expectedCommitment };
}
