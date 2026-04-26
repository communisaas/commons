/**
 * Cell-data authenticity verification (F-1.1, partial closure).
 *
 * What this closes: chunk *fabrication*. An attacker controlling R2 / a public
 * IPFS gateway cannot invent a `(cellId, districts)` pair whose SMT path
 * resolves to the externally-pinned Tree 2 root without breaking Poseidon2
 * collision-resistance.
 *
 * What this does NOT close (residual F-1.1b — leaf-encoding gap):
 * the chunk format keys cells by `h3Cell` (or `cellId`), but the leaf
 * encoding does not bind that key into the digest. An attacker controlling the
 * transport can take a *legitimate* leaf — e.g., a real TX-21 entry from the
 * published atlas — and serve it under Alice's `h3Cell` key (by rewriting
 * `chunk.h3Index[h3_alice]` or renaming `chunk.cells[h3_alice]`). The
 * SMT verification still passes (the leaf IS in the tree), so the server
 * agrees with the client's poisoned commitment and routes Alice's commitment
 * to TX-21's district set.
 *
 * The structural fix requires changing the leaf to include `h3Cell`:
 *   leaf = H3(h3Cell, cellId, sponge24(districts))
 * which is a circuit-signature change deferred to the next atlas-builder
 * cycle. See F-1.1b in BRUTALIST-AUDIT-2026-04-25.md.
 *
 * Pre-fix the server had no authenticity gate at all, so this still cuts the
 * attacker's options materially: chunk *substitution* requires having
 * compromised an atlas-publish (so the leaves you swap in are real), where
 * pre-fix even un-published leaves were forgeable.
 *
 * Tree 2 leaf encoding (mirrors `compute_cell_map_leaf` in
 * `voter-protocol/.../three_tree_membership/src/main.nr`):
 *
 *   district_commitment = poseidon2_sponge_24(districts)
 *   cell_map_leaf       = poseidon2_hash2(cell_id, district_commitment)
 *
 * Path walk (mirrors `compute_smt_root` in the same circuit): at each level,
 * if `bits[i] == 0` the running node is the LEFT input, else the RIGHT input;
 * sibling occupies the other side. Walks `siblings.length` levels.
 */

import { poseidon2Hash2, poseidon2Sponge24 } from '$lib/core/crypto/poseidon';

/**
 * Compute the Tree 2 leaf for a cell.
 *
 * @param cellId    0x-prefixed hex BN254 field element (GEOID encoded as field).
 * @param districts 24 0x-prefixed hex BN254 field elements (one per slot, null
 *                  slots use the field zero).
 * @returns         0x-prefixed hex leaf digest.
 */
export async function computeCellMapLeaf(
	cellId: string,
	districts: string[]
): Promise<string> {
	if (!Array.isArray(districts) || districts.length !== 24) {
		throw new Error(
			`CELL_AUTHENTICITY_BAD_DISTRICT_COUNT: expected 24 districts, got ${districts?.length ?? 'undefined'}`
		);
	}
	const districtCommitment = await poseidon2Sponge24(districts);
	return poseidon2Hash2(cellId, districtCommitment);
}

/**
 * Walk an SMT path from leaf to root using explicit direction bits.
 *
 * Direction bit semantics MUST match the circuit:
 *   bits[i] == 0 → running node is LEFT child, sibling is RIGHT
 *   bits[i] == 1 → running node is RIGHT child, sibling is LEFT
 *
 * @param leaf     0x-prefixed hex starting node.
 * @param siblings sibling hashes ordered leaf→root (length == depth).
 * @param bits     direction bits ordered leaf→root (length == siblings.length).
 * @returns        0x-prefixed hex computed root.
 */
export async function computeCellMapRootFromPath(
	leaf: string,
	siblings: string[],
	bits: number[]
): Promise<string> {
	if (siblings.length !== bits.length) {
		throw new Error(
			`CELL_AUTHENTICITY_PATH_LENGTH_MISMATCH: ${siblings.length} siblings vs ${bits.length} bits`
		);
	}
	let node = leaf;
	for (let i = 0; i < siblings.length; i++) {
		const bit = bits[i];
		if (bit !== 0 && bit !== 1) {
			throw new Error(`CELL_AUTHENTICITY_BAD_BIT: bits[${i}] = ${bit}`);
		}
		const sibling = siblings[i];
		node = bit === 0 ? await poseidon2Hash2(node, sibling) : await poseidon2Hash2(sibling, node);
	}
	return node;
}

/** Strict 0x-hex shape guard. BigInt() also accepts decimals/whitespace and
 *  silently parses them — the gate must not. */
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;

/**
 * Verify that a fetched cell's SMT path resolves to the externally-pinned
 * Tree 2 root. Throws a typed error on any failure so callers can map to HTTP
 * status codes deterministically.
 *
 * @param args.expectedDepth Optional pinned depth. When set, `siblings.length`
 *   must equal it — defends against a chunk that returns `[]`/`[]` and lets
 *   the leaf-as-root coincidence become the verifier (theoretical Poseidon2
 *   collision required, but defense-in-depth: don't outsource invariants to
 *   crypto when an explicit length check is free).
 *
 * @throws Error('CELL_AUTHENTICITY_BAD_DISTRICT_COUNT')
 * @throws Error('CELL_AUTHENTICITY_PATH_LENGTH_MISMATCH')
 * @throws Error('CELL_AUTHENTICITY_BAD_BIT')
 * @throws Error('CELL_AUTHENTICITY_BAD_DEPTH') when expectedDepth supplied and not met
 * @throws Error('CELL_AUTHENTICITY_BAD_HEX') when expectedRoot is not 0x-hex
 * @throws Error('CELL_AUTHENTICITY_ROOT_MISMATCH') with hex of computed vs expected
 */
export async function verifyCellMapMembership(args: {
	cellId: string;
	districts: string[];
	siblings: string[];
	bits: number[];
	expectedRoot: string;
	expectedDepth?: number;
}): Promise<void> {
	if (typeof args.expectedRoot !== 'string' || !HEX_PATTERN.test(args.expectedRoot)) {
		throw new Error(
			`CELL_AUTHENTICITY_BAD_HEX: expectedRoot must be 0x-prefixed hex, got "${String(args.expectedRoot).slice(0, 40)}"`
		);
	}
	if (typeof args.expectedDepth === 'number') {
		if (args.expectedDepth < 1 || args.expectedDepth > 64) {
			throw new Error(`CELL_AUTHENTICITY_BAD_DEPTH: expectedDepth=${args.expectedDepth} out of range`);
		}
		if (args.siblings.length !== args.expectedDepth) {
			throw new Error(
				`CELL_AUTHENTICITY_BAD_DEPTH: got ${args.siblings.length} siblings, expected ${args.expectedDepth}`
			);
		}
	} else if (args.siblings.length === 0) {
		// Without an explicit depth pin, refuse depth-0 paths — they reduce to
		// "leaf == root", which an attacker who controls the chunk's stated
		// root would forge by setting cellMapRoot in the chunk to the leaf's
		// digest. The pin guards against that, but only if the path is non-trivial.
		throw new Error('CELL_AUTHENTICITY_BAD_DEPTH: zero-length path is not accepted without explicit expectedDepth');
	}

	const leaf = await computeCellMapLeaf(args.cellId, args.districts);
	const computedRoot = await computeCellMapRootFromPath(leaf, args.siblings, args.bits);

	// Normalize via BigInt so leading-zero / case differences don't false-fail,
	// but only after both sides have passed the strict hex guard.
	const computedBig = BigInt(computedRoot);
	const expectedBig = BigInt(args.expectedRoot);
	if (computedBig !== expectedBig) {
		throw new Error(
			`CELL_AUTHENTICITY_ROOT_MISMATCH: computed=${computedRoot} expected=${args.expectedRoot}`
		);
	}
}
