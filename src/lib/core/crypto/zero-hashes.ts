/**
 * Empty-subtree value recurrence for the revocation SMT.
 *
 * Step — single source of truth for the depth-d empty-subtree value used
 * by both the server-side SMT helper (`$lib/server/smt/revocation-smt.ts`)
 * and the browser-side V2 prover witness fetcher
 * (`$lib/core/zkp/revocation-witness.ts`). Previously each had its own
 * recurrence, creating a 4th drift surface that the cross-impl byte-equality
 * test against the Noir circuit could not detect.
 *
 * Recurrence:
 *   ZERO_HASHES[0]    = 0
 *   ZERO_HASHES[d+1]  = poseidon2_hash2(ZERO_HASHES[d], ZERO_HASHES[d])
 *
 * EMPTY_TREE_ROOT for depth N = ZERO_HASHES[N].
 *
 * Environment: `poseidon2Hash2` from `$lib/core/crypto/poseidon` uses a
 * zero-dependency, pure-TypeScript permutation and works in Node, workers,
 * and browsers without WASM or polyfills. This module has no server-only
 * imports and is safe to bundle for the client.
 *
 * Caching: a single in-flight Promise is reused so concurrent callers share
 * one recurrence. On rejection the cache is cleared so an exceptional hash
 * failure does not permanently poison the helper.
 */

import { poseidon2Hash2 } from './poseidon';

const FIELD_ZERO = '0x' + '0'.repeat(64);

let cache: Map<number, string[]> = new Map();
let inFlight: Map<number, Promise<string[]>> = new Map();

/**
 * Compute or retrieve the cached array of empty-subtree values for `depth + 1`
 * entries (indices 0..depth inclusive). The depth is parameterized so the
 * same module serves the revocation SMT (depth 128 post-F-1.4) and any
 * future SMT.
 *
 * @param depth - The maximum depth required (e.g., 128 for the revocation SMT).
 * @returns array `arr` such that `arr.length === depth + 1`, `arr[0] = 0`,
 *          and `arr[d+1] = poseidon2_hash2(arr[d], arr[d])`. `arr[depth]` is
 *          the EMPTY_TREE_ROOT for a tree of that depth.
 */
export async function getZeroHashes(depth: number): Promise<string[]> {
	if (!Number.isInteger(depth) || depth < 0 || depth > 256) {
		throw new Error(`zero-hashes depth must be 0..256, got ${depth}`);
	}
	const cached = cache.get(depth);
	if (cached) return cached;
	const flight = inFlight.get(depth);
	if (flight) return flight;
	const compute = (async () => {
		const arr: string[] = [FIELD_ZERO];
		for (let d = 0; d < depth; d++) {
			arr.push(await poseidon2Hash2(arr[d], arr[d]));
		}
		cache.set(depth, arr);
		return arr;
	})();
	compute.catch(() => {
		// Defensive: an exceptional hash failure must not poison the cache.
		inFlight.delete(depth);
	});
	inFlight.set(depth, compute);
	return compute;
}

/** @internal — exposed for tests that need to clear the cache between cases. */
export function _resetZeroHashesCache(): void {
	cache = new Map();
	inFlight = new Map();
}
