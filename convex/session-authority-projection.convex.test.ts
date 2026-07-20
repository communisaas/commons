import { describe, expect, it } from 'vitest';
import type { Doc } from './_generated/dataModel';
import {
	projectSessionAuthority,
	SESSION_AUTHORITY_MAX_BYTES,
	SESSION_AUTHORITY_VERSION
} from './lib/sessionAuthority';

function user(overrides: Partial<Doc<'users'>> = {}): Doc<'users'> {
	return {
		_id: 'users:user-1',
		_creationTime: 1_700_000_000_000,
		updatedAt: 1_700_000_000_001,
		email: 'person@example.org',
		isVerified: false,
		authorityLevel: 1,
		trustTier: 0,
		trustScore: 0,
		reputationTier: 'novice',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private',
		...overrides
	} as Doc<'users'>;
}

describe('session authority projection', () => {
	it('reconstructs only request-boundary fields under the hard byte limit', () => {
		const projected = projectSessionAuthority(
			user({
				name: 'Ada',
				encryptedEntropy: 'secret-that-must-not-cross',
				nearRecoveryPublicKey: 'also-not-authority',
				templatesContributed: 999_999
			})
		);

		expect(projected.version).toBe(SESSION_AUTHORITY_VERSION);
		expect(projected.email).toBe('person@example.org');
		expect(projected).not.toHaveProperty('encryptedEntropy');
		expect(projected).not.toHaveProperty('nearRecoveryPublicKey');
		expect(projected).not.toHaveProperty('templatesContributed');
		expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(
			SESSION_AUTHORITY_MAX_BYTES
		);
	});

	it('rejects missing identity and oversized fields instead of truncating authority', () => {
		expect(() => projectSessionAuthority(user({ email: undefined }))).toThrow(
			'SESSION_AUTHORITY_INVALID:email:missing'
		);
		expect(() => projectSessionAuthority(user({ avatar: 'x'.repeat(2_049) }))).toThrow(
			'SESSION_AUTHORITY_INVALID:avatar:bytes'
		);
	});

	it('rejects non-finite trust values', () => {
		expect(() => projectSessionAuthority(user({ trustScore: Number.POSITIVE_INFINITY }))).toThrow(
			'SESSION_AUTHORITY_INVALID:trustScore:finite'
		);
	});
});
