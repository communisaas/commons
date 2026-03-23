/**
 * Authority Level Derivation
 *
 * Maps verification method and document type to ZK circuit authority level (1-5).
 * Stored on User model and used during proof generation.
 *
 * Authority Levels:
 *   5 — Government credential (mDL / EUDIW via Digital Credentials API)
 *   4 — Passport-verified identity
 *   3 — ID card / drivers license verified
 *   2 — Verified email (trust_score >= 100)
 *   1 — OAuth-only (unverified, default)
 *
 * On-chain enforcement:
 *   Each action domain can require a minimum authority level via
 *   DistrictGate.actionDomainMinAuthority mapping.
 *
 * Trust Tiers (Graduated Trust - see docs/architecture/graduated-trust.md):
 *   0 — Guest (no account, conceptual — never returned by deriveTrustTier)
 *   1 — Authenticated (OAuth login, any logged-in user)
 *   2 — Address-attested (district verified via civic data)
 *   3 — Identity-verified (ID card / drivers license)
 *   4 — Passport-verified (NFC passport — legacy providers)
 *   5 — Government credential (mDL / EUDIW via Digital Credentials API)
 */

export type AuthorityLevel = 1 | 2 | 3 | 4 | 5;
export type TrustTier = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Derive authority level from user verification state.
 *
 * Now uses document_type to differentiate passport (L4) from ID card/license (L3).
 * Previously all Didit verifications were L4, which was inaccurate for non-passport documents.
 *
 * @param user - User verification fields
 * @returns Authority level (1-5)
 */
export function deriveAuthorityLevel(user: {
	identity_commitment?: string | null;
	trust_score: number;
	trust_tier?: number | null;
	verification_method?: string | null;
	document_type?: string | null;
}): AuthorityLevel {
	// Level 5: Government credential (mDL / EUDIW via Digital Credentials API)
	if (user.document_type === 'mdl' && user.identity_commitment) {
		return 5;
	}

	// Level 4: Passport-verified (legacy — users verified via removed providers Didit/self.xyz)
	// Kept for backward compatibility with existing database records
	if (
		user.identity_commitment &&
		(user.verification_method === 'didit' || user.verification_method === 'self.xyz') &&
		user.document_type === 'passport'
	) {
		return 4;
	}

	// Level 3: ID card / drivers license (verified identity, not just address)
	// identity_commitment is only set by Tier 3+ verification (mDL/passport),
	// never by Tier 2 (address-only). Guard on trust_tier >= 3 for defense in depth.
	if (user.identity_commitment && (user.trust_tier ?? 0) >= 3) {
		return 3;
	}

	// Level 2: Verified email (trust_score >= 100)
	if (user.trust_score >= 100) {
		return 2;
	}

	// Level 1: OAuth-only (default)
	return 1;
}

/**
 * Trust tier labels for UI display
 */
export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
	0: 'Guest',
	1: 'Authenticated',
	2: 'District Verified',
	3: 'Identity Verified',
	4: 'Passport Verified',
	5: 'Government Verified'
};

/**
 * Derive trust tier from user verification state.
 *
 * Tiers are cumulative - a user at Tier 3 has achieved all lower tiers.
 * Returns the HIGHEST tier achieved by the user.
 *
 *
 * @param user - User verification fields
 * @returns Trust tier (1-5) for authenticated users. Tier 0 (Guest) is conceptual only.
 */
export function deriveTrustTier(user: {
	passkey_credential_id?: string | null;
	district_verified?: boolean;
	address_verified_at?: Date | string | null;
	identity_commitment?: string | null;
	trust_tier?: number | null;
	verification_method?: string | null;
	document_type?: string | null;
	trust_score?: number;
}): TrustTier {
	// Tier 5: Government credential (mDL / EUDIW via Digital Credentials API)
	if (user.document_type === 'mdl' && user.identity_commitment) {
		return 5;
	}

	// Tier 4: Passport-verified (legacy — users verified via removed providers Didit/self.xyz)
	// Kept for backward compatibility with existing database records
	if (
		user.identity_commitment &&
		(user.verification_method === 'didit' || user.verification_method === 'self.xyz') &&
		user.document_type === 'passport'
	) {
		return 4;
	}

	// Tier 3: Identity-verified (ID card / drivers license)
	// identity_commitment is only set by Tier 3+ verification (mDL/passport),
	// never by Tier 2 (address-only). Guard on trust_tier >= 3 for defense in depth.
	if (user.identity_commitment && (user.trust_tier ?? 0) >= 3) {
		return 3;
	}

	// Tier 2: Address-attested (district verified via civic data)
	// Requires BOTH district_verified flag AND address_verified_at timestamp
	if (user.district_verified === true && user.address_verified_at) {
		return 2;
	}

	// Tier 1: Authenticated (any logged-in user)
	// Passkey is an upgrade within this tier, not a separate tier.
	// Tier 0 (Guest) is conceptual — means no user object at all.
	return 1;
}

/**
 * Map trust tier to authority level for backward compatibility.
 *
 * This mapping allows existing code using authority_level to continue working
 * while we transition to the graduated trust tier model.
 *
 * @param tier - Trust tier (0-5)
 * @returns Authority level (1-5)
 */
export function trustTierToAuthorityLevel(tier: TrustTier): AuthorityLevel {
	// Tiers 0 and 1 both map to authority level 1 (OAuth-only)
	if (tier <= 1) return 1;
	// Tiers 2-5 map directly to authority levels 2-5
	return tier as AuthorityLevel;
}
