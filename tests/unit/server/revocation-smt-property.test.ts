/**
 * Wave 7 / FU-3.4 — property-based SMT correctness tests.
 *
 * The Wave 3 cross-impl byte-equality fixtures (slot 0, 1, 2^63, mixed-bit,
 * two-leaf) are hand-picked. A symmetric bug in the production helper that
 * also exists in the test reference would produce matching wrong roots, and
 * those fixtures wouldn't catch it.
 *
 * SCOPE — what this file does and does not test:
 *
 * This file tests algebraic invariants of the REFERENCE SMT
 * (`ReferenceSMT` below). The production helper `insertRevocationNullifier`
 * cannot be exercised here without setting up Convex serverQuery/serverMutation
 * mocks (see `revocation-smt-helper.test.ts` for that). The reference and
 * production share the same Poseidon2 primitive (`poseidon2Hash2`) and the
 * same shared ZERO_HASHES module (`getZeroHashes`), so a divergence in those
 * primitives WILL surface here. Divergence in the production helper's
 * Convex-coordination logic (OCC retry, isFresh handling) WILL NOT.
 *
 * The properties asserted are universal SMT laws — order-independence,
 * idempotent duplicate, distinct-slot distinct-root, permutation invariance,
 * collision handling. A bug in the reference's sibling-direction or
 * bit-decomposition would violate at least one law; the pattern catches
 * symmetric bugs the hand-picked fixtures cannot.
 *
 * For PRODUCTION-helper coverage of the Convex-coordination paths see
 * `tests/unit/server/revocation-smt-helper.test.ts` (isFresh / OCC retry).
 * For cross-impl byte-equality between the reference + Noir circuit see
 * `tests/unit/server/revocation-smt-cross-impl.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
	getEmptyTreeRoot,
	nullifierToLeafKey,
	SMT_OCCUPIED_LEAF_VALUE
} from '../../../src/lib/server/smt/revocation-smt';
import { poseidon2Hash2 } from '../../../src/lib/core/crypto/poseidon';
import { getZeroHashes } from '../../../src/lib/core/crypto/zero-hashes';

const SMT_DEPTH = 128;
const FIELD_ZERO = '0x' + '0'.repeat(64);

// ── Reference SMT mirroring the production helper's hashing convention ──

class ReferenceSMT {
	private nodes = new Map<string, string>(); // "depth:pathKey" → hash
	private zeros: string[] | null = null;

	private async ensureZeros() {
		if (!this.zeros) {
			this.zeros = await getZeroHashes(SMT_DEPTH);
		}
	}

	private nodeKey(depth: number, pathKey: bigint): string {
		return `${depth}:${pathKey.toString(16)}`;
	}

	private getNode(depth: number, pathKey: bigint): string {
		const stored = this.nodes.get(this.nodeKey(depth, pathKey));
		return stored ?? this.zeros![depth];
	}

	async getRoot(): Promise<string> {
		await this.ensureZeros();
		const stored = this.nodes.get(this.nodeKey(SMT_DEPTH, 0n));
		return stored ?? this.zeros![SMT_DEPTH];
	}

	async insert(nullifierHex: string): Promise<void> {
		await this.ensureZeros();
		const leafKey = nullifierToLeafKey(nullifierHex);
		// Idempotent: silently no-op if already present.
		if (this.nodes.has(this.nodeKey(0, leafKey))) return;
		this.nodes.set(this.nodeKey(0, leafKey), SMT_OCCUPIED_LEAF_VALUE);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		for (let d = 0; d < SMT_DEPTH; d++) {
			const currentPath = leafKey >> BigInt(d);
			const siblingPath = currentPath ^ 1n;
			const sibling = this.getNode(d, siblingPath);
			const bit = Number((leafKey >> BigInt(d)) & 1n);
			node =
				bit === 0
					? await poseidon2Hash2(node, sibling)
					: await poseidon2Hash2(sibling, node);
			const parentPath = leafKey >> BigInt(d + 1);
			this.nodes.set(this.nodeKey(d + 1, parentPath), node);
		}
	}
}

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomNullifier(rand: () => number): string {
	// Use a 64-bit value so collisions are rare but real coverage of low-64
	// truncation is exercised.
	const high = Math.floor(rand() * 0xffffffff) >>> 0;
	const low = Math.floor(rand() * 0xffffffff) >>> 0;
	return (
		'0x' +
		'0'.repeat(48) +
		high.toString(16).padStart(8, '0') +
		low.toString(16).padStart(8, '0')
	);
}

describe('SMT property-based correctness (FU-3.4)', () => {
	it('Property 1: empty-tree root is non-zero', async () => {
		const root = await getEmptyTreeRoot();
		expect(root).not.toBe(FIELD_ZERO);
	});

	it('Property 2: order-independence — {A, B} == {B, A} for any pair', async () => {
		const rand = mulberry32(42);
		const trials = 8;
		for (let i = 0; i < trials; i++) {
			let a = randomNullifier(rand);
			let b = randomNullifier(rand);
			// Ensure distinct low-64 (else they collapse to same slot).
			while (nullifierToLeafKey(a) === nullifierToLeafKey(b)) {
				b = randomNullifier(rand);
			}

			const refAB = new ReferenceSMT();
			await refAB.insert(a);
			await refAB.insert(b);
			const rootAB = await refAB.getRoot();

			const refBA = new ReferenceSMT();
			await refBA.insert(b);
			await refBA.insert(a);
			const rootBA = await refBA.getRoot();

			expect(rootAB).toBe(rootBA);
		}
	}, 60000);

	it('Property 3: duplicate insertion is a no-op (idempotent)', async () => {
		const rand = mulberry32(123);
		const ref = new ReferenceSMT();
		const n = randomNullifier(rand);
		await ref.insert(n);
		const root1 = await ref.getRoot();
		await ref.insert(n); // duplicate
		const root2 = await ref.getRoot();
		expect(root1).toBe(root2);
	}, 30000);

	it('Property 4: distinct slots produce distinct roots', async () => {
		// REVIEW W7 fix: the prior version had a stub do-while loop with
		// `some(() => false)` that never repeated, masking slot collisions.
		// Replaced with the same pattern Property 5 uses (`seenSlots`).
		const rand = mulberry32(7);
		const trials = 6;
		const seenRoots = new Set<string>();
		const seenSlots = new Set<bigint>();
		const empty = new ReferenceSMT();
		seenRoots.add(await empty.getRoot());
		for (let i = 0; i < trials; i++) {
			const ref = new ReferenceSMT();
			let n: string;
			let leafKey: bigint;
			do {
				n = randomNullifier(rand);
				leafKey = nullifierToLeafKey(n);
			} while (seenSlots.has(leafKey));
			seenSlots.add(leafKey);
			await ref.insert(n);
			const root = await ref.getRoot();
			expect(seenRoots.has(root)).toBe(false);
			seenRoots.add(root);
		}
	}, 60000);

	it('Property 5: 3-insert permutations all produce the same final root', async () => {
		// Stronger version of order-independence: any permutation of the
		// SAME 3 inserts must produce the SAME root.
		const rand = mulberry32(99);
		// Pick 3 distinct-slot nullifiers.
		const ns: string[] = [];
		const seenSlots = new Set<bigint>();
		while (ns.length < 3) {
			const n = randomNullifier(rand);
			const k = nullifierToLeafKey(n);
			if (seenSlots.has(k)) continue;
			seenSlots.add(k);
			ns.push(n);
		}
		const permutations: string[][] = [
			[ns[0], ns[1], ns[2]],
			[ns[0], ns[2], ns[1]],
			[ns[1], ns[0], ns[2]],
			[ns[1], ns[2], ns[0]],
			[ns[2], ns[0], ns[1]],
			[ns[2], ns[1], ns[0]]
		];
		const roots: string[] = [];
		for (const perm of permutations) {
			const ref = new ReferenceSMT();
			for (const n of perm) await ref.insert(n);
			roots.push(await ref.getRoot());
		}
		// All 6 must be identical.
		for (let i = 1; i < roots.length; i++) {
			expect(roots[i]).toBe(roots[0]);
		}
	}, 90000);

	it('Property 6: collision handling — same low-128-bit slot produces same final state', async () => {
		// F-1.4 (2026-04-25): keyspace widened to 128 bits. Two BN254 nullifiers
		// with identical low-128 bits collapse to the same SMT slot. The SMT
		// cannot distinguish them. Production helper rejects the second as
		// DUPLICATE_REVOCATION; reference here just no-ops. The point: ROOT
		// after inserting the first equals root after inserting both (because
		// second is silently a no-op at the reference level).
		// Low-128 = last 32 hex chars. Upper bits differ (= UPPER differs)
		// but lower 128 bits (= sharedLow padded to 32 hex chars) are identical.
		const sharedLowHex = 'cafebabedeadbeefcafebabedeadbeef'; // 32 hex = 128 bits
		const a = '0x' + 'aa'.repeat(16) + sharedLowHex; // 32 + 32 = 64 chars
		const b = '0x' + 'bb'.repeat(16) + sharedLowHex;

		expect(nullifierToLeafKey(a)).toBe(nullifierToLeafKey(b));

		const ref = new ReferenceSMT();
		await ref.insert(a);
		const rootA = await ref.getRoot();
		await ref.insert(b); // collision — reference no-ops, production rejects
		const rootAB = await ref.getRoot();
		expect(rootA).toBe(rootAB);
	}, 30000);
});
