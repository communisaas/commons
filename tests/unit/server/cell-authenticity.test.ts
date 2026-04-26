/**
 * F-1.1 — Cell-data authenticity verification tests.
 *
 * Asserts that `verifyCellMapMembership` only accepts paths whose computed
 * Tree 2 root matches the externally-pinned root, and rejects every form of
 * tampering an unauthenticated transport can deliver.
 */

import { describe, it, expect } from 'vitest';
import {
	computeCellMapLeaf,
	computeCellMapRootFromPath,
	verifyCellMapMembership
} from '../../../src/lib/core/shadow-atlas/cell-authenticity';
import { poseidon2Hash2 } from '../../../src/lib/core/crypto/poseidon';

const FIELD_ZERO = '0x' + '0'.repeat(64);

function fieldOfIndex(i: number): string {
	return '0x' + i.toString(16).padStart(64, '0');
}

// BN254 modulus is ~2^254 — keep test fixtures well below by using small values
// padded to 64 hex chars. Anything starting with 0x0... is safe.
const VALID_CELL_ID = fieldOfIndex(0xC011); // arbitrary small distinguishable value
const VALID_DISTRICTS = Array.from({ length: 24 }, (_, i) => fieldOfIndex(i + 1));

async function buildSinglePathToRoot(
	leaf: string,
	bits: number[],
	siblings: string[]
): Promise<string> {
	if (bits.length !== siblings.length) {
		throw new Error('test fixture invariant: bits.length === siblings.length');
	}
	let node = leaf;
	for (let i = 0; i < bits.length; i++) {
		node = bits[i] === 0
			? await poseidon2Hash2(node, siblings[i])
			: await poseidon2Hash2(siblings[i], node);
	}
	return node;
}

describe('computeCellMapLeaf', () => {
	it('produces same leaf for same inputs (deterministic)', async () => {
		const a = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const b = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		expect(a).toBe(b);
	});

	it('changes leaf when any district changes', async () => {
		const districtsB = [...VALID_DISTRICTS];
		districtsB[7] = fieldOfIndex(999);
		const a = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const b = await computeCellMapLeaf(VALID_CELL_ID, districtsB);
		expect(a).not.toBe(b);
	});

	it('changes leaf when cellId changes (cellId is bound, not hashed-out)', async () => {
		const a = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const b = await computeCellMapLeaf(fieldOfIndex(7777), VALID_DISTRICTS);
		expect(a).not.toBe(b);
	});

	it('rejects districts != 24', async () => {
		await expect(
			computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS.slice(0, 12))
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_DISTRICT_COUNT/);
	});
});

describe('computeCellMapRootFromPath', () => {
	it('zero-length path returns leaf unchanged', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		expect(await computeCellMapRootFromPath(leaf, [], [])).toBe(leaf);
	});

	it('walks left-direction (bit=0) and right-direction (bit=1) consistently with reference walker', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [fieldOfIndex(11), fieldOfIndex(22), fieldOfIndex(33), fieldOfIndex(44)];
		const bits = [0, 1, 0, 1];
		const expected = await buildSinglePathToRoot(leaf, bits, siblings);
		const actual = await computeCellMapRootFromPath(leaf, siblings, bits);
		expect(actual).toBe(expected);
	});

	it('rejects mismatched siblings/bits length', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		await expect(
			computeCellMapRootFromPath(leaf, [fieldOfIndex(1)], [0, 0])
		).rejects.toThrow(/CELL_AUTHENTICITY_PATH_LENGTH_MISMATCH/);
	});

	it('rejects non-binary direction bits', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		await expect(
			computeCellMapRootFromPath(leaf, [fieldOfIndex(1)], [2])
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_BIT/);
	});
});

describe('verifyCellMapMembership', () => {
	it('accepts a path that resolves to the pinned root', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO, FIELD_ZERO, FIELD_ZERO];
		const bits = [0, 0, 0];
		const expectedRoot = await buildSinglePathToRoot(leaf, bits, siblings);

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot
			})
		).resolves.toBeUndefined();
	});

	it('rejects depth-0 path without explicit expectedDepth (defense-in-depth)', async () => {
		// Without a length pin, accepting a zero-depth path means the leaf
		// digest is the root. Refuse — keeps Poseidon collision-resistance from
		// being the load-bearing invariant for an obviously malformed shape.
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings: [],
				bits: [],
				expectedRoot: leaf
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_DEPTH/);
	});

	it('rejects path whose length does not match expectedDepth pin', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO, FIELD_ZERO];
		const bits = [0, 1];
		const expectedRoot = await buildSinglePathToRoot(leaf, bits, siblings);

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot,
				expectedDepth: 20 // pin 20 but only 2 siblings supplied
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_DEPTH.*got 2.*expected 20/);
	});

	it('accepts when length matches expectedDepth pin', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO, FIELD_ZERO, FIELD_ZERO];
		const bits = [0, 0, 0];
		const expectedRoot = await buildSinglePathToRoot(leaf, bits, siblings);

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot,
				expectedDepth: 3
			})
		).resolves.toBeUndefined();
	});

	it('rejects expectedRoot that BigInt would silently accept as decimal (e.g., "123")', async () => {
		// BigInt("123") returns 123n decimal — without a strict 0x-hex guard, the
		// gate would happily compare to a decimal-parsed pin. The strict guard
		// rejects at the boundary so operator typos don't mask config drift.
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO];
		const bits = [0];
		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot: '123' // not 0x-prefixed, but BigInt("123") would be valid
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_HEX/);
		// Sanity: leaf is still computed. We just reject the malformed pin.
		expect(typeof leaf).toBe('string');
	});

	it('rejects when districts are tampered (poisoned-gateway primitive)', async () => {
		// Build a legitimate path for the *real* districts, then swap districts[3]
		// to simulate a poisoned chunk. Sibling/bit material is unchanged.
		const realLeaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [fieldOfIndex(101), fieldOfIndex(202)];
		const bits = [1, 0];
		const expectedRoot = await buildSinglePathToRoot(realLeaf, bits, siblings);

		const tamperedDistricts = [...VALID_DISTRICTS];
		tamperedDistricts[3] = fieldOfIndex(0xc0ffee);

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: tamperedDistricts,
				siblings,
				bits,
				expectedRoot
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_ROOT_MISMATCH/);
	});

	it('rejects when cellId is tampered (cellId is bound to leaf)', async () => {
		const realLeaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [fieldOfIndex(7), fieldOfIndex(8)];
		const bits = [0, 1];
		const expectedRoot = await buildSinglePathToRoot(realLeaf, bits, siblings);

		await expect(
			verifyCellMapMembership({
				cellId: fieldOfIndex(0xdeadbeef),
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_ROOT_MISMATCH/);
	});

	it('rejects when sibling material is tampered', async () => {
		const realLeaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [fieldOfIndex(50), fieldOfIndex(60), fieldOfIndex(70)];
		const bits = [1, 0, 1];
		const expectedRoot = await buildSinglePathToRoot(realLeaf, bits, siblings);

		const tamperedSiblings = [...siblings];
		tamperedSiblings[1] = fieldOfIndex(99);

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings: tamperedSiblings,
				bits,
				expectedRoot
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_ROOT_MISMATCH/);
	});

	it('rejects when direction bits are tampered (wrong side at one level)', async () => {
		const realLeaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [fieldOfIndex(13), fieldOfIndex(14)];
		const bits = [0, 1];
		const expectedRoot = await buildSinglePathToRoot(realLeaf, bits, siblings);

		const flippedBits = [1, 1]; // first bit flipped → asymmetric Poseidon2 fails

		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits: flippedBits,
				expectedRoot
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_ROOT_MISMATCH/);
	});

	it('normalizes hex case / leading zeros via BigInt comparison', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO];
		const bits = [0];
		const computedRoot = await buildSinglePathToRoot(leaf, bits, siblings);

		// Strip leading zeros, force lowercase to upper — BigInt compare normalizes both.
		const numeric = BigInt(computedRoot);
		const compactExpected = '0x' + numeric.toString(16).toUpperCase();
		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot: compactExpected
			})
		).resolves.toBeUndefined();
	});

	it('rejects when expectedRoot is not valid hex (strict guard, not BigInt fallback)', async () => {
		const leaf = await computeCellMapLeaf(VALID_CELL_ID, VALID_DISTRICTS);
		const siblings = [FIELD_ZERO];
		const bits = [0];
		await expect(
			verifyCellMapMembership({
				cellId: VALID_CELL_ID,
				districts: VALID_DISTRICTS,
				siblings,
				bits,
				expectedRoot: 'not-hex'
			})
		).rejects.toThrow(/CELL_AUTHENTICITY_BAD_HEX/);

		// Sanity: leaf is still valid (didn't throw on its own).
		expect(typeof leaf).toBe('string');
	});
});
