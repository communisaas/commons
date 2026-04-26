/**
 * Wave 3 — V2 three-tree proof input validation.
 *
 * The V2 circuit (post F1 closure) consumes two additional witness inputs:
 *   - revocationPath: 128 sibling hashes (BN254 field elements)
 *     (F-1.4 widened from 64 to 128 on 2026-04-25)
 *   - revocationPathBits: 128 direction bits
 *
 * The TS validator (`validateThreeTreeProofInputs`) must:
 *   1. Accept V1-only callers (both fields undefined).
 *   2. Reject partial callers (one field present, one undefined) — silent
 *      partial provision would generate against an inconsistent SMT view.
 *   3. Validate length/shape when both are present.
 *
 * This file exercises the validator directly without running the prover —
 * the prover requires bb.js init and the V2 npm package, neither of which
 * is on the test path. We test the boundary that catches caller bugs
 * BEFORE the prover sees them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the noir-prover-shim BEFORE the prover-client import so the V2
// capability-check test can simulate a V1 prover producing a 31-input result.
const mockGenerateProof = vi.fn();
vi.mock('../../../src/lib/core/crypto/noir-prover-shim', async () => {
	const actual = (await vi.importActual(
		'../../../src/lib/core/crypto/noir-prover-shim'
	)) as Record<string, unknown>;
	return {
		...actual,
		getThreeTreeProverForDepth: async () => ({
			generateProof: mockGenerateProof,
			verifyProof: vi.fn(),
			destroy: vi.fn()
		})
	};
});

import {
	generateThreeTreeProof,
	resetThreeTreeProver,
	type ThreeTreeProofInputs
} from '../../../src/lib/core/zkp/prover-client';

beforeEach(() => {
	resetThreeTreeProver();
	mockGenerateProof.mockReset();
});

const FIELD_VALUE = '0x' + '1'.repeat(64);

function makeBaseInputs(): ThreeTreeProofInputs {
	const path = Array.from({ length: 20 }, () => FIELD_VALUE);
	const bits = Array.from({ length: 20 }, () => 0);
	return {
		// Public
		userRoot: FIELD_VALUE,
		cellMapRoot: FIELD_VALUE,
		districts: Array.from({ length: 24 }, () => FIELD_VALUE),
		nullifier: FIELD_VALUE,
		actionDomain: FIELD_VALUE,
		authorityLevel: 3,
		engagementRoot: FIELD_VALUE,
		engagementTier: 2,

		// Private
		userSecret: FIELD_VALUE,
		cellId: FIELD_VALUE,
		registrationSalt: FIELD_VALUE,
		identityCommitment: FIELD_VALUE,
		userPath: path,
		userIndex: 7,
		cellMapPath: path,
		cellMapPathBits: bits,
		engagementPath: path,
		engagementIndex: 11,
		actionCount: '0x0a',
		diversityScore: '0x05'
		// V2 fields intentionally omitted — V1 mode.
	};
}

describe('three-tree V2 input validation (Wave 3 prover wiring)', () => {
	it('partial V2 fields are rejected: revocationPath without bits or root', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, () => FIELD_VALUE);
		// revocationPathBits + revocationRegistryRoot intentionally omitted.

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPath.*revocationPathBits.*revocationRegistryRoot.*together.*omitted/i
		);
	});

	it('partial V2 fields are rejected: revocationPathBits without path or root', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPathBits = Array.from({ length: 128 }, () => 0);

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPath.*revocationPathBits.*revocationRegistryRoot.*together.*omitted/i
		);
	});

	it('partial V2 fields are rejected: revocationRegistryRoot without path or bits', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationRegistryRoot = FIELD_VALUE;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPath.*revocationPathBits.*revocationRegistryRoot.*together.*omitted/i
		);
	});

	it('partial V2 fields are rejected: two-of-three present', async () => {
		// Path + Bits but no Root — would produce a proof with public input
		// [32] = undefined, prover would crash.
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, () => FIELD_VALUE);
		inputs.revocationPathBits = Array.from({ length: 128 }, () => 0);
		// revocationRegistryRoot omitted.

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPath.*revocationPathBits.*revocationRegistryRoot.*together.*omitted/i
		);
	});

	it('rejects revocationPath of wrong length', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 32 }, () => FIELD_VALUE);
		inputs.revocationPathBits = Array.from({ length: 128 }, () => 0);
		inputs.revocationRegistryRoot = FIELD_VALUE;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPath must have 128 siblings/i
		);
	});

	it('rejects revocationPathBits of wrong length', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, () => FIELD_VALUE);
		inputs.revocationPathBits = Array.from({ length: 32 }, () => 0);
		inputs.revocationRegistryRoot = FIELD_VALUE;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPathBits must have 128 bits/i
		);
	});

	it('rejects revocationPathBits with non-binary values', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, () => FIELD_VALUE);
		inputs.revocationPathBits = Array.from({ length: 128 }, (_, i) => (i === 5 ? 2 : 0));
		inputs.revocationRegistryRoot = FIELD_VALUE;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(
			/revocationPathBits\[5\] must be 0 or 1, got 2/i
		);
	});

	it('rejects revocationPath with malformed field elements', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, (_, i) =>
			i === 17 ? '0xnotahex' : FIELD_VALUE
		);
		inputs.revocationPathBits = Array.from({ length: 128 }, () => 0);
		inputs.revocationRegistryRoot = FIELD_VALUE;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(/revocationPath\[17\]/i);
	});

	it('rejects revocationRegistryRoot with malformed field element', async () => {
		const inputs = makeBaseInputs();
		inputs.revocationPath = Array.from({ length: 128 }, () => FIELD_VALUE);
		inputs.revocationPathBits = Array.from({ length: 128 }, () => 0);
		inputs.revocationRegistryRoot = '0xnotahex';

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(/revocationRegistryRoot/i);
	});
});

// =============================================================================
// FU-3.1 — Prover-version capability check
// =============================================================================
//
// The validator catches malformed V2 inputs at the boundary. But it cannot
// detect "V2 fields supplied to a V1 npm package, which silently discards
// them and returns a 31-input proof." Only the post-generation result shape
// can. These tests assert that mismatch surfaces as `V2_PROVER_NOT_INSTALLED`,
// not as a silent V1 proof.

describe('three-tree V2 prover capability check (FU-3.1)', () => {
	function makeV2Inputs(): ThreeTreeProofInputs {
		const path = Array.from({ length: 20 }, () => FIELD_VALUE);
		const bits = Array.from({ length: 20 }, () => 0);
		return {
			userRoot: FIELD_VALUE,
			cellMapRoot: FIELD_VALUE,
			districts: Array.from({ length: 24 }, () => FIELD_VALUE),
			nullifier: FIELD_VALUE,
			actionDomain: FIELD_VALUE,
			authorityLevel: 3,
			engagementRoot: FIELD_VALUE,
			engagementTier: 2,
			userSecret: FIELD_VALUE,
			cellId: FIELD_VALUE,
			registrationSalt: FIELD_VALUE,
			identityCommitment: FIELD_VALUE,
			userPath: path,
			userIndex: 7,
			cellMapPath: path,
			cellMapPathBits: bits,
			engagementPath: path,
			engagementIndex: 11,
			actionCount: '0x0a',
			diversityScore: '0x05',
			// V2 inputs supplied — caller intends a V2 proof.
			revocationPath: Array.from({ length: 128 }, () => FIELD_VALUE),
			revocationPathBits: Array.from({ length: 128 }, () => 0),
			revocationRegistryRoot: FIELD_VALUE
		};
	}

	it('throws V2_PROVER_NOT_INSTALLED when prover returns 31-input shape with V2 inputs supplied', async () => {
		// Simulate a V1 prover: ignores V2 fields, produces a 31-input proof.
		mockGenerateProof.mockResolvedValue({
			proof: new Uint8Array(2048),
			publicInputs: Array.from({ length: 31 }, () => '0x' + '1'.repeat(64))
		});

		await expect(generateThreeTreeProof(makeV2Inputs())).rejects.toThrow(
			/V2_PROVER_NOT_INSTALLED/
		);
		// Error message names the upgrade path so operators know what to fix.
		await expect(generateThreeTreeProof(makeV2Inputs())).rejects.toThrow(
			/@voter-protocol\/noir-prover/
		);
	});

	it('accepts V2 prover output (33 inputs) without firing the capability check', async () => {
		mockGenerateProof.mockResolvedValueOnce({
			proof: new Uint8Array(2048),
			publicInputs: Array.from({ length: 33 }, () => '0x' + '1'.repeat(64))
		});

		const result = await generateThreeTreeProof(makeV2Inputs());
		expect(result.publicInputsArray).toHaveLength(33);
		expect(result.publicInputs.revocationNullifier).toBeDefined();
		expect(result.publicInputs.revocationRegistryRoot).toBeDefined();
	});

	it('throws V2_PROVER_ROOT_MISMATCH when [32] disagrees with caller-supplied root (REVIEW 5-1)', async () => {
		// Buggy V2 prover: returns 33 inputs but [32] is NOT the caller's
		// supplied revocationRegistryRoot. The non-membership constraint was
		// built against a different root than the caller intended — silent
		// integrity loss if we shipped this proof.
		// Use field-element-valid hex (within BN254 modulus).
		const callerRoot = '0x0aaaaaaa' + '0'.repeat(56);
		const proverRoot = '0x0bbbbbbb' + '0'.repeat(56); // different
		mockGenerateProof.mockResolvedValue({
			proof: new Uint8Array(2048),
			publicInputs: [
				...Array.from({ length: 32 }, () => '0x' + '1'.repeat(64)),
				proverRoot
			]
		});

		const inputs = makeV2Inputs();
		inputs.revocationRegistryRoot = callerRoot;

		await expect(generateThreeTreeProof(inputs)).rejects.toThrow(/V2_PROVER_ROOT_MISMATCH/);
	});

	it('accepts V2 prover output when [32] equals caller-supplied root (case/leading-zero tolerant)', async () => {
		// Same numeric value, different representation: caller passes
		// "0x0000...01" and prover returns "0x1" — must not falsely trigger
		// the mismatch check.
		const root = '0x0000000000000000000000000000000000000000000000000000000000000001';
		mockGenerateProof.mockResolvedValueOnce({
			proof: new Uint8Array(2048),
			publicInputs: [
				...Array.from({ length: 32 }, () => '0x' + '1'.repeat(64)),
				'0x1' // numerically equal to root
			]
		});

		const inputs = makeV2Inputs();
		inputs.revocationRegistryRoot = root;

		// Should NOT throw — bigint equality.
		await generateThreeTreeProof(inputs);
	});

	it('does not fire the capability check when V1 inputs produce a 31-input proof (V1 happy path)', async () => {
		mockGenerateProof.mockResolvedValueOnce({
			proof: new Uint8Array(2048),
			publicInputs: Array.from({ length: 31 }, () => '0x' + '1'.repeat(64))
		});

		// V1 inputs (no V2 fields) — capability check should NOT trigger.
		const v1Inputs: ThreeTreeProofInputs = {
			userRoot: FIELD_VALUE,
			cellMapRoot: FIELD_VALUE,
			districts: Array.from({ length: 24 }, () => FIELD_VALUE),
			nullifier: FIELD_VALUE,
			actionDomain: FIELD_VALUE,
			authorityLevel: 3,
			engagementRoot: FIELD_VALUE,
			engagementTier: 2,
			userSecret: FIELD_VALUE,
			cellId: FIELD_VALUE,
			registrationSalt: FIELD_VALUE,
			identityCommitment: FIELD_VALUE,
			userPath: Array.from({ length: 20 }, () => FIELD_VALUE),
			userIndex: 7,
			cellMapPath: Array.from({ length: 20 }, () => FIELD_VALUE),
			cellMapPathBits: Array.from({ length: 20 }, () => 0),
			engagementPath: Array.from({ length: 20 }, () => FIELD_VALUE),
			engagementIndex: 11,
			actionCount: '0x0a',
			diversityScore: '0x05'
		};

		const result = await generateThreeTreeProof(v1Inputs);
		expect(result.publicInputsArray).toHaveLength(31);
	});
});
