import { describe, expect, it } from 'vitest';

import type { Doc } from '../../../convex/_generated/dataModel';
import { SESSION_USER_FIELDS, projectSessionUser } from '../../../convex/lib/sessionUser';
import { buildLocalsUser } from '$lib/server/auth/session-user';

const CREATED_AT = 1_700_000_000_000;
const UPDATED_AT = 1_700_000_001_000;
const ADDRESS_VERIFIED_AT = 1_700_000_002_000;
const PROFILE_COMPLETED_AT = 1_700_000_003_000;
const VERIFIED_AT = 1_700_000_004_000;

const sensitiveExtras = {
	encryptedEntropy: 'encrypted-entropy',
	encryptedNearPrivateKey: 'encrypted-near-private-key',
	stripeCustomerId: 'cus_test_123',
	passkeyPublicKey: 'passkey-public-key',
	identityHash: 'identity-hash',
	birthYear: 1984,
	nearRecoveryPublicKey: 'near-recovery-public-key',
	actionCount: 42
} satisfies Partial<Doc<'users'>>;

function fullUser(overrides: Partial<Doc<'users'>> = {}): Doc<'users'> {
	return {
		_id: 'user_123' as Doc<'users'>['_id'],
		_creationTime: CREATED_AT,
		updatedAt: UPDATED_AT,
		isVerified: false,
		authorityLevel: 1,
		trustTier: 1,
		trustScore: 50,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private',
		...overrides
	};
}

describe('session user authority projection', () => {
	it('projection returns only allowlisted fields', () => {
		const user = fullUser({
			...sensitiveExtras,
			email: 'person@example.com',
			name: 'Person Example',
			avatar: 'https://example.com/avatar.png',
			emailHash: 'email-hash',
			tokenIdentifier: 'https://commons.example|user_123',
			isVerified: true,
			verificationMethod: 'oauth',
			verifiedAt: VERIFIED_AT,
			passkeyCredentialId: 'passkey-credential-id',
			didKey: 'did:key:z6Mk',
			identityCommitment: 'identity-commitment',
			documentType: 'drivers_license',
			districtHash: 'district-hash',
			districtVerified: true,
			addressVerifiedAt: ADDRESS_VERIFIED_AT,
			trustScore: 125,
			reputationTier: 'trusted',
			role: 'Organizer',
			organization: 'Commons',
			location: 'Austin, TX',
			connection: 'neighbor',
			profileCompletedAt: PROFILE_COMPLETED_AT,
			profileVisibility: 'public',
			walletAddress: '0x123',
			walletType: 'evm',
			nearAccountId: 'person.near',
			nearDerivedScrollAddress: '0x456'
		});

		const projected = projectSessionUser(user);

		expect(Object.keys(projected).sort()).toEqual([...SESSION_USER_FIELDS].sort());
		expect(projected).not.toHaveProperty('encryptedEntropy');
		expect(projected).not.toHaveProperty('encryptedNearPrivateKey');
		expect(projected).not.toHaveProperty('stripeCustomerId');
		expect(projected).not.toHaveProperty('passkeyPublicKey');
		expect(projected).not.toHaveProperty('identityHash');
		expect(projected).not.toHaveProperty('birthYear');
		expect(projected).not.toHaveProperty('nearRecoveryPublicKey');
		expect(projected).not.toHaveProperty('actionCount');
	});

	it('absent optionals stay absent', () => {
		const projected = projectSessionUser(fullUser());

		expect(Object.prototype.hasOwnProperty.call(projected, 'email')).toBe(false);
	});

	it('hooks populates locals identically for a normal session', () => {
		const minimal = fullUser({
			email: 'fresh@example.com',
			reputationTier: 'novice'
		});
		const verified = fullUser({
			email: 'verified@example.com',
			name: 'Verified Person',
			avatar: 'https://example.com/verified.png',
			emailHash: 'verified-email-hash',
			tokenIdentifier: 'https://commons.example|user_verified',
			isVerified: true,
			verificationMethod: 'address',
			verifiedAt: VERIFIED_AT,
			passkeyCredentialId: 'verified-passkey-credential-id',
			didKey: 'did:key:z6Verified',
			identityCommitment: 'verified-identity-commitment',
			documentType: 'drivers_license',
			districtHash: 'verified-district-hash',
			districtVerified: true,
			addressVerifiedAt: ADDRESS_VERIFIED_AT,
			trustScore: 225,
			reputationTier: 'trusted',
			role: 'Advocate',
			organization: 'Commons',
			location: 'Los Angeles, CA',
			connection: 'member',
			profileCompletedAt: PROFILE_COMPLETED_AT,
			profileVisibility: 'public',
			walletAddress: '0xabc',
			walletType: 'evm',
			nearAccountId: 'verified.near',
			nearDerivedScrollAddress: '0xdef'
		});

		const projectedMinimal = projectSessionUser(minimal);
		const projectedVerified = projectSessionUser(verified);

		expect(buildLocalsUser(projectedMinimal, minimal.email!)).toEqual(
			buildLocalsUser(minimal, minimal.email!)
		);
		expect(buildLocalsUser(projectedVerified, verified.email!)).toEqual(
			buildLocalsUser(verified, verified.email!)
		);
		expect(buildLocalsUser(projectedVerified, verified.email!).trust_tier).toBe(2);
		expect(buildLocalsUser(projectedMinimal, minimal.email!).reputation_tier).toBe('novice');
		expect(buildLocalsUser(projectedMinimal, minimal.email!).createdAt).toEqual(
			new Date(minimal._creationTime)
		);
	});
});
