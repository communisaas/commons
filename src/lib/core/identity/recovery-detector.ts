/**
 * Credential Recovery Detector
 *
 * Determines whether a user needs full credential recovery (re-verification
 * + re-registration) versus a simpler tree state refresh.
 *
 * Decision matrix:
 *   trustTier < 5          → false (never registered via mDL)
 *   valid credential       → false (nothing to recover)
 *   secrets + expired tree → false (tree state refresh, not full recovery)
 *   no credential & no secrets → true (full recovery needed)
 */

import { getSessionCredential, getIdentitySecrets } from './session-credentials';

/**
 * Check whether a user needs full credential recovery.
 *
 * "Full recovery" means the user was previously mDL-verified (trustTier >= 5)
 * but has lost both their session credential AND their identity secrets
 * (e.g., browser data cleared, device switch). This requires re-verification
 * through the Digital Credentials API to re-establish their Shadow Atlas leaf.
 *
 * @param userId - User ID to check
 * @param trustTier - Current trust tier (0-5)
 * @returns true if full credential recovery is needed
 */
export async function needsCredentialRecovery(
	userId: string,
	trustTier: number
): Promise<boolean> {
	// Never registered via mDL — nothing to recover
	if (trustTier < 5) {
		return false;
	}

	// Check for a valid, non-expired session credential
	const credential = await getSessionCredential(userId);
	if (credential) {
		return false;
	}

	// Check for identity secrets (permanent, survive tree state expiry)
	const secrets = await getIdentitySecrets(userId);
	if (secrets) {
		// Secrets exist but tree state is expired — this is a tree state
		// refresh, not full recovery. The caller should re-fetch tree state
		// from the Shadow Atlas rather than triggering re-verification.
		return false;
	}

	// Neither credential nor secrets exist for a tier-5 user.
	// Full recovery (re-verification + re-registration) is required.
	return true;
}
