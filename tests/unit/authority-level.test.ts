import { describe, it, expect } from 'vitest';
import {
	deriveAuthorityLevel,
	deriveTrustTier,
	trustTierToAuthorityLevel
} from '$lib/core/identity/authority-level';

describe('deriveAuthorityLevel', () => {
	it('should return 5 for government credential (mDL with identity commitment)', () => {
		const user = {
			document_type: 'mdl',
			identity_commitment: '0xabc',
			trust_score: 0
		};
		expect(deriveAuthorityLevel(user)).toBe(5);
	});

	// Legacy backward compatibility: 'didit' values still exist in the database
	it('should return 4 for passport-verified via Didit (legacy db records)', () => {
		const user = {
			verification_method: 'didit',
			document_type: 'passport',
			identity_commitment: '0xabc',
			trust_score: 0
		};
		expect(deriveAuthorityLevel(user)).toBe(4);
	});

	// Legacy backward compatibility: 'self.xyz' values still exist in the database
	it('should return 4 for passport-verified via self.xyz (legacy db records)', () => {
		const user = {
			verification_method: 'self.xyz',
			document_type: 'passport',
			identity_commitment: '0xabc',
			trust_score: 0
		};
		expect(deriveAuthorityLevel(user)).toBe(4);
	});

	it('should return 5 for mDL-verified via digital-credentials-api', () => {
		const user = {
			verification_method: 'digital-credentials-api',
			document_type: 'mdl',
			identity_commitment: '0xabc',
			trust_score: 0
		};
		expect(deriveAuthorityLevel(user)).toBe(5);
	});

	it('should return 3 for identity commitment with trust_tier >= 3', () => {
		const user = {
			identity_commitment: '0xabc',
			trust_score: 0,
			trust_tier: 3
		};
		expect(deriveAuthorityLevel(user)).toBe(3);
	});

	it('should NOT return 3 for address-verified user (trust_tier=2) with identity_commitment', () => {
		const user = {
			identity_commitment: '0xabc',
			trust_score: 0,
			trust_tier: 2
		};
		// Address-verified users set identity_commitment but should only get level 2 (via trust_score)
		// or level 1 (if trust_score < 100)
		expect(deriveAuthorityLevel(user)).toBe(1);
	});

	it('should return 2 for email verified (trust_score >= 100)', () => {
		const user = { trust_score: 100 };
		expect(deriveAuthorityLevel(user)).toBe(2);
	});

	it('should return 1 for trust_score below 100', () => {
		const user = { trust_score: 50 };
		expect(deriveAuthorityLevel(user)).toBe(1);
	});

	it('should return 1 for minimal user (trust_score 0)', () => {
		const user = { trust_score: 0 };
		expect(deriveAuthorityLevel(user)).toBe(1);
	});
});

describe('deriveTrustTier', () => {
	it('should return 5 for government credential (mDL with identity commitment)', () => {
		const user = {
			document_type: 'mdl',
			identity_commitment: '0xabc'
		};
		expect(deriveTrustTier(user)).toBe(5);
	});

	// Legacy backward compatibility: 'self.xyz' values still exist in the database
	it('should return 4 for passport-verified (passport via self.xyz, legacy db records)', () => {
		const user = {
			identity_commitment: '0xabc',
			verification_method: 'self.xyz',
			document_type: 'passport'
		};
		expect(deriveTrustTier(user)).toBe(4);
	});

	// Legacy backward compatibility: 'didit' values still exist in the database
	it('should return 4 for passport-verified (passport via didit, legacy db records)', () => {
		const user = {
			identity_commitment: '0xabc',
			verification_method: 'didit',
			document_type: 'passport'
		};
		expect(deriveTrustTier(user)).toBe(4);
	});

	it('should return 5 for mDL-verified via digital-credentials-api', () => {
		const user = {
			identity_commitment: '0xabc',
			verification_method: 'digital-credentials-api',
			document_type: 'mdl'
		};
		expect(deriveTrustTier(user)).toBe(5);
	});

	it('should return 3 for identity-verified (ID card / license) with trust_tier >= 3', () => {
		const user = {
			identity_commitment: '0xabc',
			trust_tier: 3
		};
		expect(deriveTrustTier(user)).toBe(3);
	});

	it('should return 1 for identity_commitment without trust_tier >= 3', () => {
		const user = {
			identity_commitment: '0xabc'
		};
		expect(deriveTrustTier(user)).toBe(1);
	});

	it('should return 2 for address-attested (district verified with timestamp)', () => {
		const user = {
			district_verified: true,
			address_verified_at: new Date()
		};
		expect(deriveTrustTier(user)).toBe(2);
	});

	it('should return 1 for district_verified without address_verified_at', () => {
		const user = {
			district_verified: true
		};
		expect(deriveTrustTier(user)).toBe(1);
	});

	it('should return 1 for user with passkey (passkey is upgrade within tier 1)', () => {
		const user = {
			passkey_credential_id: 'pk_abc'
		};
		expect(deriveTrustTier(user)).toBe(1);
	});

	it('should return 1 for authenticated user (empty object)', () => {
		const user = {};
		expect(deriveTrustTier(user)).toBe(1);
	});
});

describe('trustTierToAuthorityLevel', () => {
	it('should map tier 0 to authority level 1', () => {
		expect(trustTierToAuthorityLevel(0)).toBe(1);
	});

	it('should map tier 1 to authority level 1', () => {
		expect(trustTierToAuthorityLevel(1)).toBe(1);
	});

	it('should map tier 2 to authority level 2', () => {
		expect(trustTierToAuthorityLevel(2)).toBe(2);
	});

	it('should map tier 3 to authority level 3', () => {
		expect(trustTierToAuthorityLevel(3)).toBe(3);
	});

	it('should map tier 4 to authority level 4', () => {
		expect(trustTierToAuthorityLevel(4)).toBe(4);
	});

	it('should map tier 5 to authority level 5', () => {
		expect(trustTierToAuthorityLevel(5)).toBe(5);
	});
});
