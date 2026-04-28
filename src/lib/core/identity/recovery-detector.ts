/**
 * Credential Recovery Detector
 *
 * Determines whether a user needs proof credential recovery before a local
 * proof can be generated.
 *
 * Decision matrix:
 *   trustTier < 5          → false (never registered via mDL)
 *   valid credential       → false (nothing to recover)
 *   no local credential    → true (wallet re-verification restores proof state)
 */

import { getSessionCredential, type SessionCredential } from './session-credentials';

export function credentialMeetsMinimumTier(
	credential: SessionCredential,
	minimumTier: number
): boolean {
	return (
		typeof credential.authorityLevel === 'number' &&
		Number.isInteger(credential.authorityLevel) &&
		credential.authorityLevel >= minimumTier
	);
}

export function isUsableProofCredential(
	credential: SessionCredential | null
): credential is SessionCredential {
	return Boolean(
		credential &&
		credential.credentialType === 'three-tree' &&
		typeof credential.identityCommitment === 'string' &&
		Number.isInteger(credential.leafIndex) &&
		Array.isArray(credential.merklePath) &&
		credential.merklePath.length > 0 &&
		typeof credential.merkleRoot === 'string' &&
		typeof credential.congressionalDistrict === 'string' &&
		credential.congressionalDistrict.trim().length > 0 &&
		typeof credential.cellId === 'string' &&
		credential.cellId.length > 0 &&
		typeof credential.cellMapRoot === 'string' &&
		credential.cellMapRoot.length > 0 &&
		Array.isArray(credential.cellMapPath) &&
		credential.cellMapPath.length > 0 &&
		Array.isArray(credential.cellMapPathBits) &&
		credential.cellMapPathBits.length > 0 &&
		Array.isArray(credential.districts) &&
		credential.districts.length === 24 &&
		typeof credential.districtCommitment === 'string' &&
		typeof credential.userSecret === 'string' &&
		typeof credential.registrationSalt === 'string' &&
		credential.verificationMethod === 'digital-credentials-api' &&
		credentialMeetsMinimumTier(credential, 1)
	);
}

export async function getUsableProofCredential(userId: string): Promise<SessionCredential | null> {
	const credential = await getSessionCredential(userId);
	return isUsableProofCredential(credential) ? credential : null;
}

/**
 * Check whether a user needs full credential recovery.
 *
 * Recovery means the user was previously mDL-verified (trustTier >= 5) but
 * this browser cannot produce a current SessionCredential for ProofGenerator.
 * Until a tree-state refresh flow exists, every missing local proof credential
 * is fail-closed into wallet re-verification.
 *
 * @param userId - User ID to check
 * @param trustTier - Current trust tier (0-5)
 * @returns true if full credential recovery is needed
 */
export async function needsCredentialRecovery(userId: string, trustTier: number): Promise<boolean> {
	// Never registered via mDL — nothing to recover
	if (trustTier < 5) {
		return false;
	}

	// Check for a valid, non-expired proof credential with every field that
	// ProofGenerator requires.
	const credential = await getUsableProofCredential(userId);
	if (credential && credentialMeetsMinimumTier(credential, 5)) {
		return false;
	}

	// No current local proof credential for a tier-5 user. Do not trust server
	// tier alone; ProofGenerator needs this browser-local material.
	return true;
}
