/**
 * Wave 3 / FU-2.4 — Cross-implementation byte-equality between the TypeScript
 * SMT helper (`src/lib/server/smt/revocation-smt.ts`) and the Noir circuit
 * (`voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr`).
 *
 * F-1.4 (2026-04-25): widened from depth 64 to depth 128. All canonical roots
 * regenerated; slot 2^127 fixture added for top-of-tree coverage.
 *
 * The V2 prover's `compute_revocation_smt_root` walks 128 levels with the SAME
 * Poseidon2 primitive and the SAME bit-direction convention this helper uses.
 * If they ever drift, every V2 proof generated against the Convex-computed
 * root would be rejected by the on-chain verifier.
 *
 * The Noir side hardcodes these same values in
 *   src/main.nr :: test_smt_cross_impl_*
 *
 * Edit-protocol when these values must change (Poseidon2 round constants,
 * DOMAIN_HASH2, SMT depth, leaf-occupied marker, bit convention):
 *   1. Compute new values via this test's helpers.
 *   2. Update BOTH the constants below AND the corresponding `global`
 *      declarations in main.nr.
 *   3. Run `nargo test test_smt_cross_impl` AND this vitest file.
 *   4. Both must pass; CI gates the cutover.
 *
 * Why this test is the FU-2.4 closure: pure inspection of the helper vs the
 * circuit cannot catch off-by-one in the bit decomposition, sibling-direction
 * reversals, or domain-tag drift. A byte-equality assertion forces any change
 * to either side to be reflected on both, and surfaces silently-broken cutovers
 * before V2 proofs ever land on-chain.
 */

import { describe, it, expect } from 'vitest';
import {
	getEmptyTreeRoot,
	SMT_OCCUPIED_LEAF_VALUE
} from '../../../src/lib/server/smt/revocation-smt';
import { poseidon2Hash2 } from '../../../src/lib/core/crypto/poseidon';
import { getZeroHashes } from '../../../src/lib/core/crypto/zero-hashes';

const SMT_DEPTH = 128;

// === FROZEN canonical values (must match Noir global SMT_CROSS_IMPL_* in main.nr) ===
// Regenerated 2026-04-25 for F-1.4 depth-128 widening.
const CROSS_IMPL_EMPTY_ROOT =
	'0x267431d95e8d4953a753b3043807fd4ce1a65da3c4a76bde86e7e329c8729d79';
const CROSS_IMPL_SLOT0_ROOT =
	'0x0e5696069485f77036a2bc2322bdc12dd42dc619306d61ac2e813267866879d6';
const CROSS_IMPL_SLOT1_ROOT =
	'0x1ce446ae75075424cb286e08cefdcb34c81197384cc7c1ca9d6844fb2e8747d3';
// Mid-tree coverage retained from depth-64 era — exercises bit at position 63.
const CROSS_IMPL_SLOT_2POW63_ROOT =
	'0x2e05dc2632d7df52064dc0767e0903f346ce9fab9b3b37225a5016618380b0dd';
// F-1.4 new fixture — top-of-tree coverage at depth 128.
const CROSS_IMPL_SLOT_2POW127_ROOT =
	'0x1729a8e6fae2170f68cb27f9602bcc419c7b0b338d4d2d4730c18a827ddc21a9';
const CROSS_IMPL_SLOT_MIXED_A5_ROOT =
	'0x085c4d84b90354433f78e35e479043af61dd448d4d449307829d93bac8000150';
const CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT =
	'0x12cbb2bd70670646d2ea6c8a8ec136131605ced78c3f1a4b90fa64f19bec3426';
// F-1.4.fix R4 (2026-04-25) — closes the brutalist's coverage gap: existing
// fixtures only cross the d=63→d=64 boundary with EMPTY siblings. This
// fixture inserts slot 0, then walks slot 2^64 — slot 2^64's sibling at
// d=64 (pathKey=0) was written by slot 0's walk, forcing a non-empty
// sibling at the depth boundary. Catches bit-decomposition or array-shift
// bugs that emerge specifically at the 64-bit word boundary.
const CROSS_IMPL_SLOT_0_AND_2POW64_ROOT =
	'0x253cd6055d0b1f11495ca6be08bdb894cb860f2e275f2c4ffcacfba26290eda1';

const FIELD_ZERO = '0x' + '0'.repeat(64);

// Wave 3c: route through the shared module so the test exercises THE SAME
// recurrence the production helper and the browser fetcher use. If the
// shared module drifts, this test fails — closing the "fourth source of
// truth" gap REVIEW 2 flagged.
async function computeZeroHashes(depth: number): Promise<string[]> {
	return getZeroHashes(depth);
}

describe('Cross-impl SMT byte-equality (TS ↔ Noir circuit)', () => {
	it('empty-tree root matches the value asserted by the V2 circuit', async () => {
		const computed = await getEmptyTreeRoot();
		expect(computed).toBe(CROSS_IMPL_EMPTY_ROOT);
	});

	it('single-insert at slot 0 matches the value asserted by the V2 circuit', async () => {
		// Manual walk: leaf=1, all bits 0, sibling at depth d = ZERO_HASHES[d].
		// At each step: bit==0 → node = hash(node, sibling). The slot-0 case
		// exercises the simplest path through the SMT.
		const zeros = await computeZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			node = await poseidon2Hash2(node, zeros[d]);
		}
		expect(node).toBe(CROSS_IMPL_SLOT0_ROOT);
	});

	it('single-insert at slot 1 matches the value asserted by the V2 circuit', async () => {
		// Slot 1 = bit decomposition [1, 0, 0, ..., 0]: at depth 0 the current
		// node is the RIGHT child (bit=1 → hash(sibling, node)); the remaining
		// 127 levels behave like slot 0.
		const zeros = await computeZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		node = await poseidon2Hash2(zeros[0], node); // depth 0, bit 1
		for (let d = 1; d < SMT_DEPTH; d++) {
			node = await poseidon2Hash2(node, zeros[d]); // depth d, bit 0
		}
		expect(node).toBe(CROSS_IMPL_SLOT1_ROOT);
	});

	it('single-insert at slot 2^63 matches the value asserted by the V2 circuit', async () => {
		// Mid-tree coverage retained from depth-64 era — slot 2^63 has bit=1
		// ONLY at depth 63. At depth 128, this is now mid-tree (not top), but
		// remains a useful regression fixture against bit-direction bugs in
		// the d=63 walk position.
		const zeros = await computeZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		// Depths 0..62: bit=0 → hash(node, sibling)
		for (let d = 0; d < 63; d++) {
			node = await poseidon2Hash2(node, zeros[d]);
		}
		// Depth 63: bit=1 → hash(sibling, node)
		node = await poseidon2Hash2(zeros[63], node);
		// Depths 64..127: all bit=0 in slot 2^63
		for (let d = 64; d < SMT_DEPTH; d++) {
			node = await poseidon2Hash2(node, zeros[d]);
		}
		expect(node).toBe(CROSS_IMPL_SLOT_2POW63_ROOT);
	});

	it('single-insert at slot 2^127 matches the value asserted by the V2 circuit', async () => {
		// F-1.4 — top-of-tree coverage at depth 128. Bit=1 ONLY at depth 127.
		// Catches bit-direction bugs in the highest-depth walk that slot 2^63
		// (now mid-tree) cannot detect.
		const zeros = await computeZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		// Depths 0..126: bit=0 → hash(node, sibling)
		for (let d = 0; d < 127; d++) {
			node = await poseidon2Hash2(node, zeros[d]);
		}
		// Depth 127: bit=1 → hash(sibling, node)
		node = await poseidon2Hash2(zeros[127], node);
		expect(node).toBe(CROSS_IMPL_SLOT_2POW127_ROOT);
	});

	it('single-insert at mixed-bit slot 0xa5...a5 matches the V2 circuit', async () => {
		// 0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5 has alternating 1/0 bits across
		// all 128 positions (16 bytes). Forces the walk to alternate between
		// hash(node, sibling) and hash(sibling, node) at every depth. Catches
		// systemic bit-direction errors slot 0/1/2^63/2^127 cannot detect.
		const mixedKey = 0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5n;
		const zeros = await computeZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			const bit = Number((mixedKey >> BigInt(d)) & 1n);
			const sibling = zeros[d];
			node =
				bit === 0
					? await poseidon2Hash2(node, sibling)
					: await poseidon2Hash2(sibling, node);
		}
		expect(node).toBe(CROSS_IMPL_SLOT_MIXED_A5_ROOT);
	});

	it('two-leaf coexistence (slot 0 then slot 1) — non-empty siblings exercised', async () => {
		// REVIEW 1 finding: prior fixtures only exercise empty-subtree siblings.
		// This case inserts slot 0 first, then slot 1 — slot 1's walk encounters
		// a NON-EMPTY sibling at depth 0 (the OCCUPIED_LEAF_VALUE at slot 0).
		// Tests the prover correctness when at least one stored sibling is
		// returned by Convex (the actual production hot path).
		const zeros = await computeZeroHashes(SMT_DEPTH);
		// Build slot-0 SMT state in memory.
		const stored = new Map<string, string>();
		const key = (d: number, p: bigint) => `${d}:${p.toString(16)}`;
		stored.set(key(0, 0n), SMT_OCCUPIED_LEAF_VALUE);
		let nA = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			nA = await poseidon2Hash2(nA, zeros[d]);
			stored.set(key(d + 1, 0n >> BigInt(d + 1)), nA);
		}
		// Now insert slot 1, looking up siblings from the slot-0 state.
		const slot1Key = 1n;
		let node = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			const myPath = slot1Key >> BigInt(d);
			const siblingPath = myPath ^ 1n;
			const sibling = stored.get(key(d, siblingPath)) ?? zeros[d];
			const bit = Number((slot1Key >> BigInt(d)) & 1n);
			node =
				bit === 0
					? await poseidon2Hash2(node, sibling)
					: await poseidon2Hash2(sibling, node);
		}
		expect(node).toBe(CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT);
	});

	it('two-leaf coexistence (slot 0 then slot 2^64) — non-empty sibling at d=64 boundary', async () => {
		// F-1.4.fix R4: forces the d=63→d=64 boundary walk with a non-empty
		// sibling at d=64. The previous two-leaf fixture (slot 0 + slot 1)
		// only exercises d=0; this exercises the 64-bit word boundary which
		// is where bit-decomposition or array-shift bugs are most likely
		// to manifest.
		const zeros = await computeZeroHashes(SMT_DEPTH);
		const stored = new Map<string, string>();
		const key = (d: number, p: bigint) => `${d}:${p.toString(16)}`;
		// Build slot-0 SMT state.
		stored.set(key(0, 0n), SMT_OCCUPIED_LEAF_VALUE);
		let nA = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			nA = await poseidon2Hash2(nA, zeros[d]);
			stored.set(key(d + 1, 0n), nA);
		}
		// Walk slot 2^64; sibling at d=64 (pathKey=0) is non-empty (was set
		// by slot 0's walk). All other depths default to zeros[d].
		const slot = 1n << 64n;
		let node = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			const myPath = slot >> BigInt(d);
			const siblingPath = myPath ^ 1n;
			const sibling = stored.get(key(d, siblingPath)) ?? zeros[d];
			const bit = Number((slot >> BigInt(d)) & 1n);
			node =
				bit === 0
					? await poseidon2Hash2(node, sibling)
					: await poseidon2Hash2(sibling, node);
		}
		expect(node).toBe(CROSS_IMPL_SLOT_0_AND_2POW64_ROOT);
	});

	it('canonical values are non-trivial (sanity)', () => {
		// Defense against a refactor that accidentally sets the constants to 0.
		expect(CROSS_IMPL_EMPTY_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT0_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT1_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT_2POW63_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT_2POW127_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT_MIXED_A5_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT_0_AND_2POW64_ROOT).not.toBe(FIELD_ZERO);
		expect(CROSS_IMPL_SLOT_0_AND_2POW64_ROOT).not.toBe(CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT);
		expect(CROSS_IMPL_EMPTY_ROOT).not.toBe(CROSS_IMPL_SLOT0_ROOT);
		expect(CROSS_IMPL_SLOT0_ROOT).not.toBe(CROSS_IMPL_SLOT1_ROOT);
		expect(CROSS_IMPL_SLOT0_ROOT).not.toBe(CROSS_IMPL_SLOT_2POW63_ROOT);
		expect(CROSS_IMPL_SLOT_2POW63_ROOT).not.toBe(CROSS_IMPL_SLOT_2POW127_ROOT);
		expect(CROSS_IMPL_SLOT_MIXED_A5_ROOT).not.toBe(CROSS_IMPL_SLOT_2POW63_ROOT);
		expect(CROSS_IMPL_SLOT_MIXED_A5_ROOT).not.toBe(CROSS_IMPL_SLOT_2POW127_ROOT);
		// Two-leaf root must differ from any single-leaf root.
		expect(CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT).not.toBe(CROSS_IMPL_SLOT0_ROOT);
		expect(CROSS_IMPL_TWO_LEAF_SLOT0_THEN_SLOT1_ROOT).not.toBe(CROSS_IMPL_SLOT1_ROOT);
	});
});
