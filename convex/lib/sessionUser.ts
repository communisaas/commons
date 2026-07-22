import type { Doc } from '../_generated/dataModel';

export const SESSION_USER_FIELDS = [
	'_id',
	'_creationTime',
	'updatedAt',
	'email',
	'name',
	'avatar',
	'emailHash',
	'tokenIdentifier',
	'isVerified',
	'verificationMethod',
	'verifiedAt',
	'passkeyCredentialId',
	'didKey',
	'identityCommitment',
	'documentType',
	'districtHash',
	'districtVerified',
	'addressVerifiedAt',
	'trustScore',
	'reputationTier',
	'role',
	'organization',
	'location',
	'connection',
	'profileCompletedAt',
	'profileVisibility',
	'walletAddress',
	'walletType',
	'nearAccountId',
	'nearDerivedScrollAddress'
] as const satisfies readonly (keyof Doc<'users'>)[];

export type SessionUser = Pick<Doc<'users'>, (typeof SESSION_USER_FIELDS)[number]>;

type SessionUserField = (typeof SESSION_USER_FIELDS)[number];

/**
 * This allowlist keeps encrypted profile material, key material, Stripe ids,
 * and reputation counters off every cookie-bearing request.
 */
export function projectSessionUser(user: Doc<'users'>): SessionUser {
	const projected: Partial<SessionUser> = {};

	for (const field of SESSION_USER_FIELDS) {
		const value = user[field];
		if (value !== undefined) {
			(projected as Record<SessionUserField, Doc<'users'>[SessionUserField]>)[field] = value;
		}
	}

	return projected as SessionUser;
}
