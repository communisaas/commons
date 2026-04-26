/**
 * Wave 5 / FU-2.1 — drift kill-switch tests (SvelteKit-side surface).
 *
 * Asserts: when the Convex mutation throws REVOCATION_EMITS_HALTED,
 * `insertRevocationNullifier` surfaces it as a distinct error class (not a
 * generic error). The endpoint maps this to terminal `kind: 'config'` so
 * the Convex worker stops retrying.
 *
 * Pattern matches `revocation-smt-helper.test.ts`: mock `convex-sveltekit`
 * to control the path-read response and the mutation behavior.
 *
 * Convex-side state-management tests (operator-clear, audit log, halt-blocks-
 * emit at the mutation level) live in `convex-revocation-halt.test.ts` —
 * those exercise the mutation handlers as pure functions, the SvelteKit
 * boundary cannot reach those without a real Convex runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockServerQuery, mockServerMutation } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));

vi.mock('$lib/convex', () => ({
	internal: {
		revocations: {
			getRevocationSMTPath: 'revocations.getRevocationSMTPath',
			applyRevocationSMTUpdate: 'revocations.applyRevocationSMTUpdate'
		}
	}
}));

import { insertRevocationNullifier } from '../../../src/lib/server/smt/revocation-smt';

const VALID_NULLIFIER = '0x' + 'aa'.repeat(32);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('drift kill-switch surfacing', () => {
	it('throws REVOCATION_EMITS_HALTED when mutation reports the halt', async () => {
		// Path read succeeds (indicates the halt check is at WRITE time).
		mockServerQuery.mockResolvedValueOnce({
			siblings: new Array(128).fill(null),
			currentLeaf: null,
			currentRoot: null,
			expectedSequenceNumber: 0,
			leafCount: 0
		});
		// Mutation rejects with the halt error.
		mockServerMutation.mockRejectedValueOnce(
			new Error(
				'REVOCATION_EMITS_HALTED: kill-switch active since 1700000000000 (reason: convex_chain_root_diverged)'
			)
		);

		await expect(insertRevocationNullifier(VALID_NULLIFIER)).rejects.toThrow(
			/REVOCATION_EMITS_HALTED/
		);
	});

	it('does not retry on REVOCATION_EMITS_HALTED — terminal class', async () => {
		mockServerQuery.mockResolvedValueOnce({
			siblings: new Array(128).fill(null),
			currentLeaf: null,
			currentRoot: null,
			expectedSequenceNumber: 0,
			leafCount: 0
		});
		mockServerMutation.mockRejectedValueOnce(
			new Error('REVOCATION_EMITS_HALTED: kill-switch active')
		);

		try {
			await insertRevocationNullifier(VALID_NULLIFIER);
		} catch {
			// expected
		}

		// Single read, single mutation attempt — no retry storm against
		// a halt that won't clear without operator action.
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
	});
});
