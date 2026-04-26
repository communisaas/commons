/**
 * V2 prover witness fetcher (browser-side).
 *
 * Wave 3 — closes the V2 client glue gap. The V2 three-tree circuit consumes
 * three additional inputs at proof time:
 *   - revocationPath:   128 sibling hashes from leaf to root in the on-chain
 *                       RevocationRegistry SMT (F-1.4 widening 2026-04-25)
 *   - revocationPathBits: 128 direction bits (low-128 of revocation_nullifier)
 *   - revocationRegistryRoot: the SMT root the path was built against
 *
 * This function takes the user's `district_commitment` and an authenticated
 * `fetch` (typically the browser's, with the session cookie) and returns
 * the three values ready to pass into `ProofContext` /
 * `ThreeTreeProofInputs`.
 *
 * Sibling fill: the Convex query returns `null` for any sibling slot that
 * has no stored node (== the depth-d empty-subtree value). We compute
 * ZERO_HASHES locally via Poseidon2 and substitute. This keeps the server
 * stateless per-depth and matches what the Noir circuit expects when
 * walking through unoccupied subtrees.
 *
 * If the Convex SMT is empty (no revocations yet), `currentRoot` from the
 * endpoint is `null` — we substitute `computedEmptyRoot` so the prover and
 * the on-chain `EMPTY_TREE_ROOT` immutable agree.
 *
 * Privacy: the only network input is `revocation_nullifier`, which is the
 * Poseidon2 image of the user's `district_commitment` and is intended to be
 * public on-chain anyway. The server does not learn the underlying districts.
 */

import { computeRevocationNullifier } from '$lib/core/crypto/poseidon';
import { getZeroHashes } from '$lib/core/crypto/zero-hashes';

// F-1.4 (2026-04-25): widened from 64 to 128. MUST match
//   src/lib/server/smt/revocation-smt.ts `SMT_DEPTH` and
//   voter-protocol/.../three_tree_membership/src/main.nr `REVOCATION_SMT_DEPTH`.
const REVOCATION_SMT_DEPTH = 128;

interface RevocationWitnessResponse {
	path: (string | null)[];
	pathBits: number[];
	currentRoot: string | null;
	sequenceNumber: number;
	computedEmptyRoot: string;
}

export interface RevocationWitness {
	/** Already-public revocation_nullifier (input to the circuit). */
	revocationNullifier: string;
	/** 128 sibling hashes, with empty-subtree fill applied. */
	revocationPath: string[];
	/** 128 direction bits (low-128 of revocation_nullifier). */
	revocationPathBits: number[];
	/** The SMT root this path was built against (current or empty). */
	revocationRegistryRoot: string;
}

// Wave 3c — ZERO_HASHES come from the shared module so server, browser, and
// cross-impl test all derive from one source. Drift across boundaries is
// detectable by the byte-equality test against the Noir circuit.

/**
 * Fetch the V2 prover's non-membership witness for a user's district commitment.
 *
 * @param districtCommitment - 0x-prefixed BN254 hex Poseidon2 sponge-24 output
 * @param fetchFn - typically `fetch` from the browser
 * @throws if the endpoint is unreachable or returns non-200
 */
export async function fetchRevocationWitness(
	districtCommitment: string,
	fetchFn: typeof fetch = fetch
): Promise<RevocationWitness> {
	const revocationNullifier = await computeRevocationNullifier(districtCommitment);

	const response = await fetchFn('/api/proofs/revocation-witness', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ revocationNullifier }),
		credentials: 'same-origin'
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`revocation witness fetch failed: HTTP ${response.status} ${text.slice(0, 200)}`);
	}

	const data = (await response.json()) as RevocationWitnessResponse;

	if (!Array.isArray(data.path) || data.path.length !== REVOCATION_SMT_DEPTH) {
		throw new Error(
			`revocation witness response: expected path of length ${REVOCATION_SMT_DEPTH}, got ${data.path?.length}`
		);
	}
	if (!Array.isArray(data.pathBits) || data.pathBits.length !== REVOCATION_SMT_DEPTH) {
		throw new Error(
			`revocation witness response: expected pathBits of length ${REVOCATION_SMT_DEPTH}, got ${data.pathBits?.length}`
		);
	}

	// Fill null siblings with the depth-d empty-subtree value.
	const zeros = await getZeroHashes(REVOCATION_SMT_DEPTH);
	const filledPath: string[] = data.path.map((sib, d) => sib ?? zeros[d]);

	// If the SMT has no inserts yet (currentRoot null), use the precomputed
	// empty-tree root. This MUST match the contract's EMPTY_TREE_ROOT
	// constructor argument or the on-chain verification fails.
	const root = data.currentRoot ?? data.computedEmptyRoot;

	return {
		revocationNullifier,
		revocationPath: filledPath,
		revocationPathBits: data.pathBits,
		revocationRegistryRoot: root
	};
}
