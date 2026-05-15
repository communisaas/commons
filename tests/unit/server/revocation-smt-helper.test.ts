/**
 * Follow-up: helper-level tests for `insertRevocationNullifier`.
 *
 * The existing tests in `revocation-smt.test.ts` exercise a reference SMT
 * implemented inline; they verify the hashing convention but not the helper's
 * Convex-facing behavior. This file mocks `convex-sveltekit` to assert the
 * three branches of `insertRevocationNullifier`:
 *
 *   1. `isFresh: true`  — empty leaf, mutation succeeds.
 *   2. `isFresh: false` — leaf already present, returns existing root WITHOUT
 *      calling the mutation. This is the idempotent-recovery path that lets
 *      a stuck "Convex ahead of chain" state retry the chain emit.
 *   3. SMT_SEQUENCE_CONFLICT — mutation throws, helper retries with backoff.
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
	api: {
		revocations: {
			getRevocationSMTPath: 'revocations.getRevocationSMTPath',
			applyRevocationSMTUpdate: 'revocations.applyRevocationSMTUpdate'
		}
	}
}));

import {
	insertRevocationNullifier,
	getEmptyTreeRoot
} from '../../../src/lib/server/smt/revocation-smt';

const VALID_NULLIFIER = '0x' + 'aa'.repeat(32);
const VALID_EXISTING_ROOT = '0x' + 'bb'.repeat(32);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('insertRevocationNullifier — helper branches', () => {
	it('isFresh: true on first insert (empty leaf)', async () => {
		// Convex returns "no leaf, all siblings null" → fresh insert path.
		// A SECOND query happens after the mutation for post-write read-back
		// verification. To make the test deterministic without orchestrating
		// real Poseidon math against a hand-rolled root, the post-write read
		// returns expectedSequenceNumber > our newSequenceNumber so the helper
		// takes the "concurrent emit advanced seq" branch and skips Poseidon
		// recomputation. This still exercises every helper code path EXCEPT
		// the recompute itself (which is covered by the integration tests that
		// run real Poseidon against the reference SMT in revocation-smt.test.ts).
		const expectedRoot = '0x' + 'cc'.repeat(32);
		mockServerQuery
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: 0,
				leafCount: 0
			})
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: '0x' + '0'.repeat(63) + '1',
				currentRoot: expectedRoot,
				expectedSequenceNumber: 99, // > newSequenceNumber=1 → skip recompute
				leafCount: 1
			});
		mockServerMutation.mockResolvedValueOnce({
			newRoot: expectedRoot,
			newSequenceNumber: 1
		});

		const result = await insertRevocationNullifier(VALID_NULLIFIER);
		expect(result.isFresh).toBe(true);
		expect(result.newRoot).toBe(expectedRoot);
		expect(result.leafCount).toBe(1);
		// 2 reads: initial path read + post-write verification read.
		// 1 mutation: the apply. No kill-switch flip because verification skipped.
		expect(mockServerQuery.mock.calls.length).toBe(2);
		expect(mockServerMutation.mock.calls.length).toBe(1);
	});

	it('isFresh: false when leaf already present (idempotent retry)', async () => {
		// Critical recovery path: prior emit committed the leaf in Convex but
		// the chain write may have failed. The helper must NOT throw and must
		// return the EXISTING root so the caller can retry the chain emit.
		mockServerQuery.mockResolvedValueOnce({
			siblings: new Array(128).fill(null),
			currentLeaf: '0x' + '0'.repeat(63) + '1', // marker
			currentRoot: VALID_EXISTING_ROOT,
			expectedSequenceNumber: 5,
			leafCount: 5
		});

		const result = await insertRevocationNullifier(VALID_NULLIFIER);

		expect(result.isFresh).toBe(false);
		expect(result.newRoot).toBe(VALID_EXISTING_ROOT);
		expect(result.leafCount).toBe(5);
		// CRUCIALLY: the mutation was NOT called (no fresh write).
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('isFresh: false uses computed empty-tree root when currentRoot is null', async () => {
		// Defensive: if Convex says "leaf present" but root was somehow not
		// persisted (shouldn't happen, but defense-in-depth), fall back to
		// the precomputed EMPTY_TREE_ROOT so the chain emit has a valid value.
		mockServerQuery.mockResolvedValueOnce({
			siblings: new Array(128).fill(null),
			currentLeaf: '0x' + '0'.repeat(63) + '1',
			currentRoot: null,
			expectedSequenceNumber: 0,
			leafCount: 0
		});

		const expectedFallback = await getEmptyTreeRoot();
		const result = await insertRevocationNullifier(VALID_NULLIFIER);

		expect(result.isFresh).toBe(false);
		expect(result.newRoot).toBe(expectedFallback);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('retries on SMT_SEQUENCE_CONFLICT with bounded backoff', async () => {
		// Two seq conflicts then success. Helper must retry transparently.
		// FU-2.2: the FOURTH query is the post-write verification.
		const expectedRoot = '0x' + 'dd'.repeat(32);
		mockServerQuery
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: 0,
				leafCount: 0
			})
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: 1,
				leafCount: 1
			})
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: 2,
				leafCount: 2
			})
			// Post-write verification on the successful third attempt.
			// expectedSequenceNumber > newSequenceNumber so the helper skips
			// Poseidon recompute (same deterministic-test pattern as the
			// "fresh insert" branch above).
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: '0x' + '0'.repeat(63) + '1',
				currentRoot: expectedRoot,
				expectedSequenceNumber: 99,
				leafCount: 3
			});

		mockServerMutation
			.mockRejectedValueOnce(new Error('SMT_SEQUENCE_CONFLICT: expected 0, found 1'))
			.mockRejectedValueOnce(new Error('SMT_SEQUENCE_CONFLICT: expected 1, found 2'))
			.mockResolvedValueOnce({
				newRoot: expectedRoot,
				newSequenceNumber: 3
			});

		const result = await insertRevocationNullifier(VALID_NULLIFIER);
		expect(result.isFresh).toBe(true);
		expect(result.newRoot).toBe(expectedRoot);
		// 4 reads: 3 retry path-reads + 1 post-write read. 3 mutations: 3 apply
		// attempts (first two reject, third succeeds). No halt mutation because
		// post-write verification was skipped via the seq-advanced branch.
		expect(mockServerQuery.mock.calls.length).toBe(4);
		expect(mockServerMutation.mock.calls.length).toBe(3);
	}, 10000);

	it('SMT_LEAF_OCCUPIED race: re-reads and returns isFresh=false', async () => {
		// Race: read says empty, mutation says occupied (another emit landed
		// between). Helper must re-read; second read sees the leaf, returns
		// isFresh=false with the existing root.
		mockServerQuery
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: 0,
				leafCount: 0
			})
			.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: '0x' + '0'.repeat(63) + '1',
				currentRoot: VALID_EXISTING_ROOT,
				expectedSequenceNumber: 1,
				leafCount: 1
			});

		mockServerMutation.mockRejectedValueOnce(
			new Error('SMT_LEAF_OCCUPIED: insert at this slot already exists')
		);

		const result = await insertRevocationNullifier(VALID_NULLIFIER);

		expect(result.isFresh).toBe(false);
		expect(result.newRoot).toBe(VALID_EXISTING_ROOT);
		expect(mockServerQuery).toHaveBeenCalledTimes(2);
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
	}, 10000);

	it('exhausts retry budget on persistent SMT_SEQUENCE_CONFLICT', async () => {
		// 7 seq conflicts (one read+mutation per attempt). Helper exhausts at
		// 6 retries (default maxRetries) and throws _EXHAUSTED.
		for (let i = 0; i < 7; i++) {
			mockServerQuery.mockResolvedValueOnce({
				siblings: new Array(128).fill(null),
				currentLeaf: null,
				currentRoot: null,
				expectedSequenceNumber: i,
				leafCount: i
			});
			mockServerMutation.mockRejectedValueOnce(
				new Error('SMT_SEQUENCE_CONFLICT: expected ' + i + ', found ' + (i + 1))
			);
		}

		await expect(insertRevocationNullifier(VALID_NULLIFIER)).rejects.toThrow(
			/SMT_SEQUENCE_CONFLICT_EXHAUSTED/
		);
	}, 30000);

	it('passes leafKey as low-128-bit hex (no 0x prefix) to Convex', async () => {
		// Sanity: the Convex-side canonicalization expects raw hex, not 0x-prefixed.
		// Verify the helper passes the right shape so the canonicalizePathKey on
		// the Convex side gets a clean input.
		// F-1.4 (2026-04-25): keyspace widened from 64 to 128 bits.
		mockServerQuery.mockResolvedValueOnce({
			siblings: new Array(128).fill(null),
			currentLeaf: null,
			currentRoot: null,
			expectedSequenceNumber: 0,
			leafCount: 0
		});
		mockServerMutation.mockResolvedValueOnce({
			newRoot: '0x' + 'ee'.repeat(32),
			newSequenceNumber: 1
		});

		// Use a nullifier whose low-128 are easy to verify (16 leading zero
		// bytes + 16 bytes of recognizable pattern = 32 hex chars).
		const nullifier = '0x' + '0'.repeat(32) + 'cafebabedeadbeefcafebabedeadbeef';
		await insertRevocationNullifier(nullifier);

		// First call's args: leafKey should be the low 128 bits as raw hex.
		const callArgs = mockServerQuery.mock.calls[0][1];
		expect(callArgs.leafKey).toBe('cafebabedeadbeefcafebabedeadbeef');
	});
});
