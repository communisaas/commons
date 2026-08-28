/**
 * Frozen Barretenberg/Noir parity vectors for the pure-TypeScript Poseidon2
 * backend. These outputs were captured from @aztec/bb.js 4.2.0 before the
 * hashing-only runtime migrated to @zkpassport/poseidon2 0.6.2.
 *
 * Keep these as literal external-reference vectors: deriving expected values
 * with the implementation under test would not detect a backend divergence.
 */

import { describe, expect, it } from 'vitest';
import {
	computeMerkleRoot,
	computeNullifier,
	computeRevocationNullifier,
	poseidon2Hash1,
	poseidon2Hash2,
	poseidon2Hash3,
	poseidon2Hash4,
	poseidon2Sponge24,
	poseidonHash
} from '$lib/core/crypto/poseidon';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

const field = (value: bigint | number): string =>
	'0x' + BigInt(value).toString(16).padStart(64, '0');

const MODULUS_HEX = field(BN254_MODULUS);

describe('pure-TypeScript Poseidon2 — frozen Barretenberg/Noir parity', () => {
	it.each([
		{
			name: 'H1(0)',
			actual: () => poseidon2Hash1(field(0)),
			expected: '0x2c09bab3f027b96b79772553c8f16f3570efa9d6fe6099eae7102d5eb0b4f2f1'
		},
		{
			name: 'H1(p - 1)',
			actual: () => poseidon2Hash1(field(BN254_MODULUS - 1n)),
			expected: '0x11b79acdb88e839c016e6ad9187eddf20c59496a1ada1e7f7d1309fdecb206e3'
		},
		{
			name: 'H2(1, 2)',
			actual: () => poseidon2Hash2(field(1), field(2)),
			expected: '0x0c9a26601b600d914201d0ac18d389e99890db063c82600edf080bb4f0c25d24'
		},
		{
			name: 'H2(p - 1, p - 2)',
			actual: () => poseidon2Hash2(field(BN254_MODULUS - 1n), field(BN254_MODULUS - 2n)),
			expected: '0x2ce2dc94007d31c6d1206496d41b4d01d6db7debfd35978692a10ae6db210b9d'
		},
		{
			name: 'H3(1, 2, 3)',
			actual: () => poseidon2Hash3(field(1), field(2), field(3)),
			expected: '0x01b5e178866f013ba2c2be9520db1754ca9de9498ede5bccbc6ca23857ef247b'
		},
		{
			name: 'H3(p - 1, p - 2, p - 3)',
			actual: () =>
				poseidon2Hash3(
					field(BN254_MODULUS - 1n),
					field(BN254_MODULUS - 2n),
					field(BN254_MODULUS - 3n)
				),
			expected: '0x1f443d86ae5a224d4bf2594894be745c85c97dbfad7c9f2561fd7ffbcc3015ab'
		},
		{
			name: 'H4(1, 2, 3, 4)',
			actual: () => poseidon2Hash4(field(1), field(2), field(3), field(4)),
			expected: '0x01ec7e6ac13a29e15dc0c32154612142118ca43e5bcab165a81b1ccb5b167fff'
		},
		{
			name: 'H4(p - 1, p - 2, p - 3, p - 4)',
			actual: () =>
				poseidon2Hash4(
					field(BN254_MODULUS - 1n),
					field(BN254_MODULUS - 2n),
					field(BN254_MODULUS - 3n),
					field(BN254_MODULUS - 4n)
				),
			expected: '0x0090fe0430f4af29cd1089573aa5dd2e11ca6bc4a8b414e4bb00ac0f5d0cb4a5'
		}
	])('$name', async ({ actual, expected }) => {
		expect(await actual()).toBe(expected);
	});

	it('matches the 24-field sponge vector', async () => {
		const inputs = Array.from({ length: 24 }, (_, index) => field(index + 1));
		expect(await poseidon2Sponge24(inputs)).toBe(
			'0x1eb9814051a7f9240024e2c50b233e8b57047d263e3cfb783c0b36ca63be645b'
		);
	});

	it('matches the sponge boundary vector', async () => {
		const inputs = Array.from({ length: 24 }, (_, index) =>
			field(index % 2 === 0 ? 0n : BN254_MODULUS - 1n)
		);
		expect(await poseidon2Sponge24(inputs)).toBe(
			'0x2507478faa0e389be15d4ab85107ec43dbac1edfc8e2a0df08ece187c3113fde'
		);
	});

	it('matches the action nullifier vector', async () => {
		expect(await computeNullifier(field(0xabcdef), field(0x123456))).toBe(
			'0x0cec42371c8b41c1a08159e8975c9cc8e83e9adfcd5fd1f3a01acfcbbcba1e47'
		);
	});

	it('matches the revocation nullifier vector', async () => {
		expect(await computeRevocationNullifier(field(0x123456789abcdefn))).toBe(
			'0x0f6e2d1ab0197ff2d2a3f05381ce7c6d964e4213065115bf4d50a8afcca19fcf'
		);
	});

	it('matches the ordered Merkle path vector', async () => {
		expect(
			await computeMerkleRoot(field(0x42), [field(1), field(2), field(3), field(4)], 0b1010)
		).toBe('0x1e732406eef7438220e2647eb670aac14cf6a65506635d638e13ec7ad7b51716');
	});

	it.each([
		['empty string', '', '0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732e'],
		['ASCII', 'commons', '0x140ae909cb479c8ecf9bfecb54da5557d8db39913e0f8fcca5ec89448c76a1aa'],
		['UTF-8', '投票🗳️', '0x102c9a099f0f9fe2b7fd53753f5b414eadc2e4df7c4a92fbc29205cbb356180f'],
		[
			'historical 124-byte truncation',
			'x'.repeat(160),
			'0x2d86f29f3e97dd312eeb91061ec94d74dc5768858846babd16ee009a42eda20a'
		]
	])('preserves poseidonHash %s construction', async (_name, input, expected) => {
		expect(await poseidonHash(input)).toBe(expected);
	});
});

describe('pure-TypeScript Poseidon2 — BN254 input rejection', () => {
	it.each([
		['H1', () => poseidon2Hash1(MODULUS_HEX)],
		['H2 right', () => poseidon2Hash2(field(0), MODULUS_HEX)],
		['H3 third', () => poseidon2Hash3(field(0), field(0), MODULUS_HEX)],
		['H4 fourth', () => poseidon2Hash4(field(0), field(0), field(0), MODULUS_HEX)],
		[
			'sponge element',
			() => poseidon2Sponge24(Array.from({ length: 24 }, (_, index) => (index === 17 ? MODULUS_HEX : field(0))))
		],
		['action nullifier', () => computeNullifier(field(0), MODULUS_HEX)],
		['revocation nullifier', () => computeRevocationNullifier(MODULUS_HEX)],
		['Merkle sibling', () => computeMerkleRoot(field(0), [MODULUS_HEX], 0)]
	])('rejects out-of-field input through %s', async (_name, operation) => {
		await expect(operation()).rejects.toThrow('exceeds BN254 field modulus');
	});

	it.each([
		['empty', ''],
		['bare prefix', '0x'],
		['non-hex', '0xnot-hex'],
		['negative', '-1'],
		['upper-case prefix', '0X01']
	])('rejects %s encodings', async (_name, invalid) => {
		await expect(poseidon2Hash2(field(0), invalid)).rejects.toThrow(/hex string/);
	});

	it('rejects overlong field encodings before unbounded BigInt parsing', async () => {
		await expect(poseidon2Hash2(field(0), `0x${'0'.repeat(65)}`)).rejects.toThrow(
			'Invalid field element length'
		);
	});

	it('normalizes accepted short, unprefixed, upper-case, and zero-padded field encodings', async () => {
		const canonical = await poseidon2Hash2(field(0xabcd), field(1));
		await expect(poseidon2Hash2('ABCD', '0001')).resolves.toBe(canonical);
		await expect(poseidon2Hash2('000000000000abcd', '1')).resolves.toBe(canonical);
		expect(canonical).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it.each([
		{ inputs: [] },
		{ inputs: Array.from({ length: 23 }, () => field(0)) },
		{ inputs: Array.from({ length: 25 }, () => field(0)) }
	])('rejects sponge arity $inputs.length', async ({ inputs }) => {
			await expect(poseidon2Sponge24(inputs)).rejects.toThrow('requires exactly 24 inputs');
		});
});
