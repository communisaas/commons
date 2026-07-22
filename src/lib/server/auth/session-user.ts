import { deriveTrustTier } from '$lib/core/identity/authority-level';
import type { SessionUser } from '$convex/lib/sessionUser';

export function buildLocalsUser(
	user: SessionUser,
	email: string
): NonNullable<App.Locals['user']> {
	return {
		id: user._id as string,
		email,
		name: user.name ?? null,
		avatar: user.avatar ?? null,
		// PII custody
		email_hash: user.emailHash ?? null,
		// Verification status
		is_verified: user.isVerified,
		verification_method: user.verificationMethod ?? null,
		verified_at: user.verifiedAt ? new Date(user.verifiedAt) : null,
		// Graduated trust
		trust_tier: deriveTrustTier({
			passkey_credential_id: user.passkeyCredentialId ?? null,
			district_verified: user.districtVerified ?? false,
			address_verified_at: user.addressVerifiedAt ? new Date(user.addressVerifiedAt) : null,
			identity_commitment: user.identityCommitment ?? null,
			document_type: user.documentType ?? null,
			trust_score: user.trustScore ?? 0
		}),
		// Passkey
		passkey_credential_id: user.passkeyCredentialId ?? null,
		did_key: user.didKey ?? null,
		// ZK identity
		identity_commitment: user.identityCommitment ?? null,
		// District
		district_hash: user.districtHash ?? null,
		district_verified: user.districtVerified ?? false,
		address_verified_at: user.addressVerifiedAt ? new Date(user.addressVerifiedAt) : null,
		// Profile
		role: user.role ?? null,
		organization: user.organization ?? null,
		location: user.location ?? null,
		connection: user.connection ?? null,
		profile_completed_at: user.profileCompletedAt ? new Date(user.profileCompletedAt) : null,
		profile_visibility: user.profileVisibility ?? 'private',
		// Reputation
		trust_score: user.trustScore ?? 0,
		reputation_tier: user.reputationTier ?? 'novice',
		// Wallet
		wallet_address: user.walletAddress ?? null,
		wallet_type: user.walletType ?? null,
		near_account_id: user.nearAccountId ?? null,
		near_derived_scroll_address: user.nearDerivedScrollAddress ?? null,
		// Timestamps
		createdAt: new Date(user._creationTime),
		updatedAt: new Date(user.updatedAt)
	};
}
