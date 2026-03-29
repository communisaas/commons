/**
 * Credential → Proof Input Mapping Integration Tests (CR-009)
 *
 * Verifies the full SessionCredential → ThreeTreeProofInputs mapping chain
 * with realistic BN254 field elements, validating output shape, specific
 * field mappings, and edge cases (missing Tree 3 data, missing authorityLevel,
 * empty districts).
 */

import { describe, it, expect } from 'vitest';
import {
	mapCredentialToProofInputs,
	type ProofContext
} from '$lib/core/identity/proof-input-mapper';
import type { SessionCredential } from '$lib/core/identity/session-credentials';

// ============================================================================
// BN254 Constants
// ============================================================================

const BN254_MODULUS =
	21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Generate a valid BN254 field element hex string (0x-prefixed, 64 hex chars, < modulus) */
function fieldElement(seed: number): string {
	// Deterministic field elements below modulus. Use seed to vary values.
	const base = BigInt(seed) * 0x0123456789abcdef0123456789abcdefn + BigInt(seed * 7919);
	const value = base % BN254_MODULUS;
	return '0x' + value.toString(16).padStart(64, '0');
}

const ZERO_HASH = '0x' + '0'.repeat(64);

// ============================================================================
// Realistic Credential Builder
// ============================================================================

function makeRealisticCredential(overrides: Partial<SessionCredential> = {}): SessionCredential {
	// 24 district slots: first 6 non-zero (realistic multi-district cell), rest zero
	const districts: string[] = [];
	for (let i = 0; i < 6; i++) {
		districts.push(fieldElement(300 + i));
	}
	for (let i = 6; i < 24; i++) {
		districts.push('0x' + '0'.repeat(64));
	}

	// 20 SMT siblings for cellMapPath (depth-20 tree)
	const cellMapPath: string[] = [];
	for (let i = 0; i < 20; i++) {
		cellMapPath.push(fieldElement(200 + i));
	}

	// 20 path bits (mix of 0s and 1s — simulates real tree traversal)
	const cellMapPathBits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1];

	// Tree 1 merkle path (depth 20)
	const merklePath: string[] = [];
	for (let i = 0; i < 20; i++) {
		merklePath.push(fieldElement(100 + i));
	}

	// Tree 3 engagement path (depth 20)
	const engagementPath: string[] = [];
	for (let i = 0; i < 20; i++) {
		engagementPath.push(fieldElement(400 + i));
	}

	return {
		userId: 'usr_realistic_test_001',
		identityCommitment: fieldElement(1),
		leafIndex: 42,
		merklePath,
		merkleRoot: fieldElement(10),
		congressionalDistrict: 'CA-12',
		credentialType: 'three-tree',
		cellId: fieldElement(20),
		cellMapRoot: fieldElement(30),
		cellMapPath,
		cellMapPathBits,
		districts,
		userSecret: fieldElement(50),
		registrationSalt: fieldElement(60),
		authorityLevel: 5,
		engagementRoot: fieldElement(70),
		engagementPath,
		engagementIndex: 7,
		engagementTier: 2,
		actionCount: fieldElement(80),
		diversityScore: fieldElement(90),
		verificationMethod: 'digital-credentials-api',
		createdAt: new Date('2026-03-01'),
		expiresAt: new Date('2026-09-01'),
		...overrides
	};
}

function makeRealisticContext(overrides: Partial<ProofContext> = {}): ProofContext {
	return {
		actionDomain: fieldElement(500),
		nullifier: fieldElement(600),
		...overrides
	};
}

// ============================================================================
// Helpers
// ============================================================================

function isValidBN254Hex(value: string): boolean {
	try {
		const n = BigInt(value);
		return n >= 0n && n < BN254_MODULUS;
	} catch {
		return false;
	}
}

// ============================================================================
// Integration: Full Credential → Proof Input Chain
// ============================================================================

describe('credential → proof input mapping (integration)', () => {
	describe('full chain with realistic data', () => {
		it('maps a complete mDL credential to valid ThreeTreeProofInputs', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			// All required ThreeTreeProofInputs fields exist
			const requiredFields = [
				'userRoot', 'cellMapRoot', 'districts', 'nullifier', 'actionDomain',
				'authorityLevel', 'engagementRoot', 'engagementTier',
				'userSecret', 'cellId', 'registrationSalt', 'identityCommitment',
				'userPath', 'userIndex', 'cellMapPath', 'cellMapPathBits',
				'engagementPath', 'engagementIndex', 'actionCount', 'diversityScore'
			];
			for (const field of requiredFields) {
				expect(inputs).toHaveProperty(field);
			}
		});

		it('districts array is exactly 24 elements', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.districts).toHaveLength(24);
		});

		it('userPath length matches credential merklePath depth (20)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.userPath).toHaveLength(20);
		});

		it('cellMapPath length matches depth (20)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.cellMapPath).toHaveLength(20);
		});

		it('cellMapPathBits are all 0 or 1', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.cellMapPathBits).toHaveLength(20);
			for (const bit of inputs.cellMapPathBits) {
				expect(bit === 0 || bit === 1).toBe(true);
			}
		});

		it('engagementPath length matches merklePath depth (20)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementPath).toHaveLength(20);
		});

		it('authorityLevel is in [1, 5]', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.authorityLevel).toBeGreaterThanOrEqual(1);
			expect(inputs.authorityLevel).toBeLessThanOrEqual(5);
		});

		it('engagementTier is in [0, 4]', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementTier).toBeGreaterThanOrEqual(0);
			expect(inputs.engagementTier).toBeLessThanOrEqual(4);
		});

		it('all hex string fields are valid BN254 field elements', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			// Scalar fields
			expect(isValidBN254Hex(inputs.userRoot)).toBe(true);
			expect(isValidBN254Hex(inputs.cellMapRoot)).toBe(true);
			expect(isValidBN254Hex(inputs.nullifier)).toBe(true);
			expect(isValidBN254Hex(inputs.actionDomain)).toBe(true);
			expect(isValidBN254Hex(inputs.engagementRoot)).toBe(true);
			expect(isValidBN254Hex(inputs.userSecret)).toBe(true);
			expect(isValidBN254Hex(inputs.cellId)).toBe(true);
			expect(isValidBN254Hex(inputs.registrationSalt)).toBe(true);
			expect(isValidBN254Hex(inputs.identityCommitment)).toBe(true);
			expect(isValidBN254Hex(inputs.actionCount)).toBe(true);
			expect(isValidBN254Hex(inputs.diversityScore)).toBe(true);

			// Array fields
			for (const d of inputs.districts) {
				expect(isValidBN254Hex(d)).toBe(true);
			}
			for (const s of inputs.userPath) {
				expect(isValidBN254Hex(s)).toBe(true);
			}
			for (const s of inputs.cellMapPath) {
				expect(isValidBN254Hex(s)).toBe(true);
			}
			for (const s of inputs.engagementPath) {
				expect(isValidBN254Hex(s)).toBe(true);
			}
		});

		it('nullifier is non-empty (computed from context)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.nullifier).toBeTruthy();
			expect(BigInt(inputs.nullifier)).not.toBe(0n);
		});
	});

	// ============================================================================
	// Specific Field Mappings
	// ============================================================================

	describe('specific field mappings', () => {
		it('output.userRoot === credential.merkleRoot', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.userRoot).toBe(credential.merkleRoot);
		});

		it('output.cellMapRoot === credential.cellMapRoot', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.cellMapRoot).toBe(credential.cellMapRoot);
		});

		it('output.districts === credential.districts (same reference)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.districts).toBe(credential.districts);
		});

		it('output.userPath === credential.merklePath (same reference)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.userPath).toBe(credential.merklePath);
		});

		it('output.userIndex === credential.leafIndex', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.userIndex).toBe(credential.leafIndex);
		});

		it('output.cellMapPath === credential.cellMapPath (same reference)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.cellMapPath).toBe(credential.cellMapPath);
		});

		it('output.cellMapPathBits === credential.cellMapPathBits (same reference)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.cellMapPathBits).toBe(credential.cellMapPathBits);
		});

		it('output.authorityLevel matches credential (5 for mDL)', () => {
			const credential = makeRealisticCredential({ authorityLevel: 5 });
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.authorityLevel).toBe(5);
		});

		it('output.engagementRoot === credential.engagementRoot', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementRoot).toBe(credential.engagementRoot);
		});

		it('output.engagementPath === credential.engagementPath (same reference)', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementPath).toBe(credential.engagementPath);
		});

		it('output.engagementIndex === credential.engagementIndex', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementIndex).toBe(credential.engagementIndex);
		});

		it('output.engagementTier === credential.engagementTier', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementTier).toBe(credential.engagementTier);
		});

		it('output.actionCount === credential.actionCount', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.actionCount).toBe(credential.actionCount);
		});

		it('output.diversityScore === credential.diversityScore', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.diversityScore).toBe(credential.diversityScore);
		});

		it('output.identityCommitment === credential.identityCommitment', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.identityCommitment).toBe(credential.identityCommitment);
		});

		it('output.nullifier === context.nullifier', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.nullifier).toBe(context.nullifier);
		});

		it('output.actionDomain === context.actionDomain', () => {
			const credential = makeRealisticCredential();
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.actionDomain).toBe(context.actionDomain);
		});
	});

	// ============================================================================
	// Edge Cases
	// ============================================================================

	describe('edge cases', () => {
		it('missing Tree 3 data uses zero defaults', () => {
			const credential = makeRealisticCredential({
				engagementRoot: undefined,
				engagementPath: undefined,
				engagementIndex: undefined,
				engagementTier: undefined,
				actionCount: undefined,
				diversityScore: undefined
			});
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			// engagementRoot falls back to zero hash
			expect(inputs.engagementRoot).toBe(ZERO_HASH);

			// engagementPath fills with zero hashes to match Tree 1 depth
			expect(inputs.engagementPath).toHaveLength(credential.merklePath.length);
			for (const sibling of inputs.engagementPath) {
				expect(sibling).toBe(ZERO_HASH);
			}

			// engagementIndex defaults to 0
			expect(inputs.engagementIndex).toBe(0);

			// engagementTier defaults to 0
			expect(inputs.engagementTier).toBe(0);

			// actionCount and diversityScore default to '0'
			expect(inputs.actionCount).toBe('0');
			expect(inputs.diversityScore).toBe('0');
		});

		it('empty engagementPath array uses zero-filled fallback', () => {
			const credential = makeRealisticCredential({
				engagementPath: [] // explicitly empty
			});
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.engagementPath).toHaveLength(credential.merklePath.length);
			for (const sibling of inputs.engagementPath) {
				expect(sibling).toBe(ZERO_HASH);
			}
		});

		it('missing authorityLevel on credential falls back to context', () => {
			const credential = makeRealisticCredential({ authorityLevel: undefined });
			const context = makeRealisticContext({ authorityLevel: 4 });
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.authorityLevel).toBe(4);
		});

		it('missing authorityLevel on both credential and context uses conservative fallback', () => {
			const credential = makeRealisticCredential({ authorityLevel: undefined });
			const context = makeRealisticContext({ authorityLevel: undefined });
			const inputs = mapCredentialToProofInputs(credential, context);

			// identityCommitment is non-zero → conservative fallback is 3
			expect(inputs.authorityLevel).toBe(3);
		});

		it('zero identityCommitment with no authorityLevel falls back to 1', () => {
			// identityCommitment is zero → unverified → authority level 1
			// But this will throw because identityCommitment is required to be non-empty.
			// The fallbackAuthorityLevel logic for level 1 applies when identityCommitment
			// is present but evaluates to 0n. We need a non-empty string that parses to 0.
			// However, the mapper requires identityCommitment to be truthy (non-empty).
			// So this edge case only applies if identityCommitment is "0x0" (truthy string, zero value).
			const credential = makeRealisticCredential({
				authorityLevel: undefined,
				identityCommitment: '0x0000' // truthy string but BigInt === 0n
			});
			const context = makeRealisticContext({ authorityLevel: undefined });

			// This actually throws because the mapper validates identityCommitment is truthy
			// and the string "0x0000" IS truthy. The fallbackAuthorityLevel function checks
			// BigInt(ic) !== 0n. So with zero value → returns 1.
			const inputs = mapCredentialToProofInputs(credential, context);
			expect(inputs.authorityLevel).toBe(1);
		});

		it('districts with all zeros still produces 24-element array', () => {
			const zeroDistricts = Array(24).fill(ZERO_HASH);
			const credential = makeRealisticCredential({ districts: zeroDistricts });
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			expect(inputs.districts).toHaveLength(24);
			for (const d of inputs.districts) {
				expect(d).toBe(ZERO_HASH);
			}
		});

		it('credential with partial engagement data preserves non-default values', () => {
			const credential = makeRealisticCredential({
				engagementRoot: fieldElement(999),
				engagementPath: undefined, // missing path but root present
				engagementTier: 3,
				actionCount: fieldElement(888),
				diversityScore: undefined // missing
			});
			const context = makeRealisticContext();
			const inputs = mapCredentialToProofInputs(credential, context);

			// Root is preserved
			expect(inputs.engagementRoot).toBe(fieldElement(999));

			// Path falls back to zeros (since undefined)
			expect(inputs.engagementPath).toHaveLength(credential.merklePath.length);
			for (const s of inputs.engagementPath) {
				expect(s).toBe(ZERO_HASH);
			}

			// Tier is preserved
			expect(inputs.engagementTier).toBe(3);

			// actionCount preserved, diversityScore falls back to '0'
			expect(inputs.actionCount).toBe(fieldElement(888));
			expect(inputs.diversityScore).toBe('0');
		});

		it('all authority levels 1-5 pass through from credential', () => {
			for (const level of [1, 2, 3, 4, 5] as const) {
				const credential = makeRealisticCredential({ authorityLevel: level });
				const context = makeRealisticContext();
				const inputs = mapCredentialToProofInputs(credential, context);

				expect(inputs.authorityLevel).toBe(level);
			}
		});

		it('all engagement tiers 0-4 pass through from credential', () => {
			for (const tier of [0, 1, 2, 3, 4] as const) {
				const credential = makeRealisticCredential({ engagementTier: tier });
				const context = makeRealisticContext();
				const inputs = mapCredentialToProofInputs(credential, context);

				expect(inputs.engagementTier).toBe(tier);
			}
		});
	});
});
