/**
 * Poseidon2 Hash Function Tests
 *
 * Validates Barretenberg-compatible Poseidon2 primitives used for:
 * - Nullifier computation (CVE-002 fix)
 * - Leaf hash computation (three-tree registration)
 * - Merkle root computation (proof verification)
 *
 * CRITICAL: These functions must produce identical outputs to the Noir circuit.
 * Any divergence means proofs generated in-browser will fail on-chain verification.
 */

import { describe, it, expect } from 'vitest';

const BN254_MODULUS =
	21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Import lazily to exercise the same module boundary used by application code.

describe('hexToFr', () => {
	it('rejects empty hex string (M-05)', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		// hexToFr is called internally by poseidon2Hash2
		// Passing an empty string should trigger the M-05 validation
		await expect(poseidon2Hash2('', '0x01')).rejects.toThrow('Empty hex string');
	});

	it('rejects bare 0x prefix as empty', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		await expect(poseidon2Hash2('0x', '0x01')).rejects.toThrow('Empty hex string');
	});

	it('rejects invalid hex characters', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		await expect(poseidon2Hash2('0xGGGG', '0x01')).rejects.toThrow('Invalid hex string');
	});

	it('rejects values >= BN254 modulus', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		// BN254_MODULUS itself should be rejected
		const modulusHex = '0x' + BN254_MODULUS.toString(16).padStart(64, '0');
		await expect(poseidon2Hash2(modulusHex, '0x01')).rejects.toThrow('exceeds BN254');
	});

	it('accepts BN254 modulus - 1 (max valid field element)', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const maxValid = '0x' + (BN254_MODULUS - 1n).toString(16).padStart(64, '0');
		const result = await poseidon2Hash2(maxValid, '0x01');
		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it('accepts zero value', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const result = await poseidon2Hash2(
			'0x0000000000000000000000000000000000000000000000000000000000000000',
			'0x0000000000000000000000000000000000000000000000000000000000000001'
		);
		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
	});
});

describe('domain constants', () => {
	it('DOMAIN_HASH1 = 0x48314d ("H1M")', async () => {
		const { DOMAIN_HASH1 } = await import('$lib/core/crypto/poseidon');
		expect(BigInt(DOMAIN_HASH1)).toBe(0x48314dn);
	});

	it('DOMAIN_HASH2 = 0x48324d ("H2M")', async () => {
		const { DOMAIN_HASH2 } = await import('$lib/core/crypto/poseidon');
		expect(BigInt(DOMAIN_HASH2)).toBe(0x48324dn);
	});

	it('DOMAIN_HASH3 = 0x48334d ("H3M")', async () => {
		const { DOMAIN_HASH3 } = await import('$lib/core/crypto/poseidon');
		expect(BigInt(DOMAIN_HASH3)).toBe(0x48334dn);
	});

	it('DOMAIN_HASH4 = 0x48344d ("H4M")', async () => {
		const { DOMAIN_HASH4 } = await import('$lib/core/crypto/poseidon');
		expect(BigInt(DOMAIN_HASH4)).toBe(0x48344dn);
	});

	it('DOMAIN_SPONGE_24 = 0x534f4e47455f24 ("SONGE_$")', async () => {
		const { DOMAIN_SPONGE_24 } = await import('$lib/core/crypto/poseidon');
		expect(BigInt(DOMAIN_SPONGE_24)).toBe(0x534f4e47455f24n);
	});

	it('domain tags are sequential H{N}M pattern', async () => {
		const { DOMAIN_HASH1, DOMAIN_HASH2, DOMAIN_HASH3, DOMAIN_HASH4 } = await import(
			'$lib/core/crypto/poseidon'
		);
		const d1 = BigInt(DOMAIN_HASH1);
		const d2 = BigInt(DOMAIN_HASH2);
		const d3 = BigInt(DOMAIN_HASH3);
		const d4 = BigInt(DOMAIN_HASH4);
		// "H1M"=0x48314d, "H2M"=0x48324d, etc. — differ only in middle byte (0x31→0x32→0x33→0x34)
		expect(d2 - d1).toBe(0x100n); // 0x32 - 0x31 = 1, shifted left 8 bits
		expect(d3 - d2).toBe(0x100n);
		expect(d4 - d3).toBe(0x100n);
	});
});

describe('poseidon2Hash1 (hashSingle)', () => {
	it('produces a valid BN254 field element', async () => {
		const { poseidon2Hash1 } = await import('$lib/core/crypto/poseidon');
		const input = '0x0000000000000000000000000000000000000000000000000000000000000001';

		const result = await poseidon2Hash1(input);

		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(result)).toBeLessThan(BN254_MODULUS);
	});

	it('is deterministic', async () => {
		const { poseidon2Hash1 } = await import('$lib/core/crypto/poseidon');
		const input = '0x0000000000000000000000000000000000000000000000000000000000000042';

		const result1 = await poseidon2Hash1(input);
		const result2 = await poseidon2Hash1(input);

		expect(result1).toBe(result2);
	});

	it('differs from hash2(input, 0) due to domain separation', async () => {
		const { poseidon2Hash1, poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const input = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';

		const h1 = await poseidon2Hash1(input);
		const h2 = await poseidon2Hash2(input, zero);

		// hash1 = permute([input, DOMAIN_HASH1, 0, 0])
		// hash2 = permute([input, 0, DOMAIN_HASH2, 0])
		// Must differ — domain tags occupy different slots
		expect(h1).not.toBe(h2);
	});

	it('different inputs produce different hashes', async () => {
		const { poseidon2Hash1 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000002';

		const ha = await poseidon2Hash1(a);
		const hb = await poseidon2Hash1(b);

		expect(ha).not.toBe(hb);
	});

	it('hashing zero produces a non-zero result', async () => {
		const { poseidon2Hash1 } = await import('$lib/core/crypto/poseidon');
		const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';

		const result = await poseidon2Hash1(zero);

		expect(BigInt(result)).not.toBe(0n);
	});
});

describe('poseidon2Hash2', () => {
	it('produces a valid BN254 field element', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const left = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const right = '0x0000000000000000000000000000000000000000000000000000000000000002';

		const result = await poseidon2Hash2(left, right);

		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(result)).toBeLessThan(BN254_MODULUS);
		expect(BigInt(result)).toBeGreaterThanOrEqual(0n);
	});

	it('matches golden vector from Noir circuit — hash2(1, 2)', async () => {
		// Cross-language golden vector: must match voter-protocol/packages/crypto/test/golden-vectors.test.ts
		// Source: poseidon2_permutation([1, 2, DOMAIN_HASH2, 0], 4)[0] from Noir stdlib
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const left = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const right = '0x0000000000000000000000000000000000000000000000000000000000000002';

		const result = await poseidon2Hash2(left, right);

		const expected = 5700113488374071721540629675635551041370719088032104434910951352719804357924n;
		expect(BigInt(result)).toBe(expected);
	});

	it('matches golden vector — hash2(0, 0)', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';

		const result = await poseidon2Hash2(zero, zero);

		const expected = 7920904892182681660068699473082554335979114182301659186550863530220333250830n;
		expect(BigInt(result)).toBe(expected);
	});

	it('is deterministic', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000042';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000099';

		const result1 = await poseidon2Hash2(a, b);
		const result2 = await poseidon2Hash2(a, b);

		expect(result1).toBe(result2);
	});

	it('is non-commutative (order matters)', async () => {
		const { poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000002';

		const ab = await poseidon2Hash2(a, b);
		const ba = await poseidon2Hash2(b, a);

		// Poseidon2 is NOT commutative — left/right ordering matters for Merkle trees
		expect(ab).not.toBe(ba);
	});

	it('uses DOMAIN_HASH2 (0x48324d) for domain separation', async () => {
		const { poseidon2Hash2, poseidon2Hash4 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000002';

		const hash2 = await poseidon2Hash2(a, b);
		// hash4(a, b, 0, 0) should differ from hash2(a, b) due to domain separation
		const hash4 = await poseidon2Hash4(
			a,
			b,
			'0x0000000000000000000000000000000000000000000000000000000000000000',
			'0x0000000000000000000000000000000000000000000000000000000000000000'
		);

		expect(hash2).not.toBe(hash4);
	});
});

describe('poseidon2Hash3', () => {
	it('produces a valid BN254 field element', async () => {
		const { poseidon2Hash3 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000002';
		const c = '0x0000000000000000000000000000000000000000000000000000000000000003';

		const result = await poseidon2Hash3(a, b, c);

		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(result)).toBeLessThan(BN254_MODULUS);
	});

	it('is deterministic', async () => {
		const { poseidon2Hash3 } = await import('$lib/core/crypto/poseidon');
		const a = '0x0000000000000000000000000000000000000000000000000000000000000042';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000099';
		const c = '0x00000000000000000000000000000000000000000000000000000000000000ff';

		const result1 = await poseidon2Hash3(a, b, c);
		const result2 = await poseidon2Hash3(a, b, c);

		expect(result1).toBe(result2);
	});

	it('uses DOMAIN_HASH3 (0x48334d) — differs from hash2 and hash4', async () => {
		const { poseidon2Hash2, poseidon2Hash3, poseidon2Hash4 } = await import(
			'$lib/core/crypto/poseidon'
		);
		const a = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const b = '0x0000000000000000000000000000000000000000000000000000000000000002';
		const c = '0x0000000000000000000000000000000000000000000000000000000000000003';
		const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';

		const h3 = await poseidon2Hash3(a, b, c);
		const h4 = await poseidon2Hash4(a, b, c, zero);
		const h2 = await poseidon2Hash2(a, b);

		// All three must differ due to domain separation tags
		expect(h3).not.toBe(h4);
		expect(h3).not.toBe(h2);
		expect(h4).not.toBe(h2);
	});
});

describe('computeNullifier', () => {
	it('produces valid field element from userSecret + actionDomain', async () => {
		const { computeNullifier } = await import('$lib/core/crypto/poseidon');
		const userSecret = '0x0000000000000000000000000000000000000000000000000000000000abcdef';
		const actionDomain = '0x0000000000000000000000000000000000000000000000000000000000123456';

		const nullifier = await computeNullifier(userSecret, actionDomain);

		expect(nullifier).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(nullifier)).toBeLessThan(BN254_MODULUS);
	});

	it('equals poseidon2Hash2(userSecret, actionDomain) — CVE-002 formula', async () => {
		const { computeNullifier, poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const userSecret = '0x0000000000000000000000000000000000000000000000000000000000abcdef';
		const actionDomain = '0x0000000000000000000000000000000000000000000000000000000000123456';

		const nullifier = await computeNullifier(userSecret, actionDomain);
		const directHash = await poseidon2Hash2(userSecret, actionDomain);

		expect(nullifier).toBe(directHash);
	});

	it('different actionDomains produce different nullifiers (anti-reuse)', async () => {
		const { computeNullifier } = await import('$lib/core/crypto/poseidon');
		const userSecret = '0x0000000000000000000000000000000000000000000000000000000000abcdef';

		const nullifier1 = await computeNullifier(
			userSecret,
			'0x0000000000000000000000000000000000000000000000000000000000000001'
		);
		const nullifier2 = await computeNullifier(
			userSecret,
			'0x0000000000000000000000000000000000000000000000000000000000000002'
		);

		expect(nullifier1).not.toBe(nullifier2);
	});

	it('different userSecrets produce different nullifiers (identity binding)', async () => {
		const { computeNullifier } = await import('$lib/core/crypto/poseidon');
		const actionDomain = '0x0000000000000000000000000000000000000000000000000000000000123456';

		const nullifier1 = await computeNullifier(
			'0x0000000000000000000000000000000000000000000000000000000000000001',
			actionDomain
		);
		const nullifier2 = await computeNullifier(
			'0x0000000000000000000000000000000000000000000000000000000000000002',
			actionDomain
		);

		expect(nullifier1).not.toBe(nullifier2);
	});
});

describe('computeMerkleRoot', () => {
	it('single-leaf tree: root equals H2(leaf, sibling) with correct ordering', async () => {
		const { computeMerkleRoot, poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const leaf = '0x0000000000000000000000000000000000000000000000000000000000000042';
		const sibling = '0x0000000000000000000000000000000000000000000000000000000000000099';

		// leafIndex=0 means leaf is on the left
		const root = await computeMerkleRoot(leaf, [sibling], 0);
		const expected = await poseidon2Hash2(leaf, sibling);

		expect(root).toBe(expected);
	});

	it('leafIndex=1 means leaf is on the right', async () => {
		const { computeMerkleRoot, poseidon2Hash2 } = await import('$lib/core/crypto/poseidon');
		const leaf = '0x0000000000000000000000000000000000000000000000000000000000000042';
		const sibling = '0x0000000000000000000000000000000000000000000000000000000000000099';

		// leafIndex=1 means leaf is on the right
		const root = await computeMerkleRoot(leaf, [sibling], 1);
		const expected = await poseidon2Hash2(sibling, leaf);

		expect(root).toBe(expected);
	});

	it('is deterministic', async () => {
		const { computeMerkleRoot } = await import('$lib/core/crypto/poseidon');
		const leaf = '0x0000000000000000000000000000000000000000000000000000000000000042';
		const siblings = [
			'0x0000000000000000000000000000000000000000000000000000000000000001',
			'0x0000000000000000000000000000000000000000000000000000000000000002',
			'0x0000000000000000000000000000000000000000000000000000000000000003'
		];

		const root1 = await computeMerkleRoot(leaf, siblings, 3);
		const root2 = await computeMerkleRoot(leaf, siblings, 3);

		expect(root1).toBe(root2);
	});
});
