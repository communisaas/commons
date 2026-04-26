/**
 * Wave 7 / FU-1.2 — pure helper for the commitment-downgrade guard.
 *
 * Extracted from `verifyAddress` so it can be tested directly without the
 * MockConvex mirror in `regrounding-attack-sims.test.ts`. The mirror was a
 * maintenance tax: every change to the real mutation required a parallel
 * change in the test mock, with no enforcement that they stayed aligned.
 *
 * Pure function — no Convex types, no DB access. Takes the existing
 * credential rows + the incoming commitment and decides whether to allow
 * the verify-address mutation to proceed.
 *
 * Semantics:
 *   - If the user has EVER held a credential with `districtCommitment` set,
 *     subsequent calls MUST supply one (the v2 protection holds).
 *   - Legacy users (never any commitment) can still re-verify via
 *     civic_api/postal without a commitment during the transition.
 *   - Returns `null` on accept, an error code string on reject.
 */

interface DowngradeGuardCredentialRow {
	districtCommitment?: string;
}

export type DowngradeGuardResult = null | 'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE';

/**
 * Determine whether to reject a verify-address attempt as a commitment
 * downgrade. Caller throws the returned code if non-null.
 *
 * @param existing - all credential rows for this user (any state — active,
 *                   revoked, expired). The guard scans full history.
 * @param incomingCommitment - the client-supplied districtCommitment for
 *                              the new credential, or undefined.
 */
export function applyDowngradeGuard(
	existing: readonly DowngradeGuardCredentialRow[],
	incomingCommitment: string | undefined
): DowngradeGuardResult {
	const hasEverHeldCommitment = existing.some((c) => !!c.districtCommitment);
	if (hasEverHeldCommitment && !incomingCommitment) {
		return 'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE';
	}
	return null;
}
