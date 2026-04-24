/**
 * Ephemeral address data for congressional delivery
 * This is NOT stored on the User model (privacy-preserving)
 * Provided at send time from guest state or TEE-decrypted EncryptedDeliveryData
 */
export interface DeliveryAddress {
	street?: string;
	city?: string;
	state?: string;
	zip?: string;
	phone?: string;
	congressional_district?: string;
}

export interface UserProfile {
	id: string;
	name?: string;
	email: string;
	avatar?: string;
	created_at: Date;
	updated_at: Date;
}

// NOTE: UserLocation interface removed - coordinates data now part of enhanced User model
// All location data (latitude, longitude, political_embedding, community_sheaves)
// is now directly accessible on the User object after Phase 2 consolidation

export interface Representative {
	id: string;
	bioguide_id: string;
	name: string;
	party: string;
	state: string;
	district: string;
	congressional_district?: string; // Alias for district (format: "CA-12")
	chamber: string;
	office_code: string;
	phone?: string;
	email?: string;

	// Enhanced office information (from Phase 5 consolidation)
	member_name?: string; // May differ from name field
	office_address?: string;
	office_city?: string;
	office_state?: string;
	office_zip?: string;

	// Enhanced term information
	term_start?: Date;
	term_end?: Date;
	current_term?: number;

	// Status and metadata
	is_active: boolean;
	last_updated: Date;
	data_source?: string; // 'congress_api', 'bioguide', 'manual'
	source_updated_at?: Date;

	// User-_representative relationship fields (for joined queries)
	relationship?: string;
	assigned_at?: Date;
	last_validated?: Date | null;
}

/**
 * UNIFIED EMAIL SERVICE USER INTERFACE
 *
 * User context for template resolution and congressional delivery.
 *
 * PRIVACY-PRESERVING DESIGN (per CYPHERPUNK-ARCHITECTURE.md):
 * - User model stores NO PII (no address, no phone)
 * - Address data comes from DeliveryAddress at send time
 * - District stored as hash only on User model
 */
export interface EmailServiceUser {
	/** Unique user identifier */
	id: string;

	/** User's display name for template personalization */
	name?: string | null;

	/** User's email address (required for authenticated users) */
	email: string;

	/**
	 * Ephemeral address data for congressional routing
	 * NOT stored on User model - provided at send time from:
	 * - Guest state (unverified users)
	 * - TEE-decrypted EncryptedDeliveryData (verified users)
	 */
	street?: string | null;
	city?: string | null;
	state?: string | null;
	zip?: string | null;
	phone?: string | null;
	congressional_district?: string | null;

	/** Legacy address field for backward compatibility */
	address?: string | null;

	/** Congressional representatives / decision makers for template variable resolution */
	representatives?: Array<{
		name: string;
		party: string;
		chamber: string;
		state: string;
		district: string;
		/** DecisionMaker title — used to derive chamber when coming from DM model */
		title?: string;
		/** DecisionMaker jurisdiction — maps to state in legacy shape */
		jurisdiction?: string;
	}>;

	/** Identity verification status for enhanced delivery */
	is_verified?: boolean;
	verification_method?: string | null;
	verified_at?: Date | null;

	/** District credential hash for verify URL in email footer */
	credentialHash?: string | null;

	/** VOTER Protocol integration */
	wallet_address?: string | null;
	trust_score?: number;
	reputation_tier?: string;
}

/**
 * User fields relevant for email services.
 * NOTE: NO PII fields - address data comes from DeliveryAddress at send time
 */
export type UserForEmail = {
	id: string;
	email: string;
	name: string | null;
	is_verified: boolean;
	verification_method: string | null;
	verified_at: Date | null;
	district_hash: string | null;
	trust_score: number;
	reputation_tier: string;
	// Additional fields that might be present
	[key: string]: unknown;
};

/**
 * Convert a user object to EmailServiceUser interface
 *
 * IMPORTANT: Address fields (street, city, state, zip, congressional_district)
 * are NOT stored on the User model per CYPHERPUNK-ARCHITECTURE.md.
 * They must be provided separately from:
 * - Guest state (for unverified users)
 * - TEE-decrypted EncryptedDeliveryData (for verified users)
 *
 * @param user - User object or partial user object (can be null)
 * @param deliveryAddress - Optional ephemeral address data for congressional routing
 * @returns EmailServiceUser compatible object or null
 */
export function toEmailServiceUser(
	user: Record<string, unknown> | null,
	deliveryAddress?: DeliveryAddress | null
): EmailServiceUser | null {
	if (!user) {
		return null;
	}

	// For partial user objects (like in AppHeader), provide fallback email
	const email = (user.email as string) || 'guest@example.com';

	return {
		id: user.id as string,
		email: email,
		name: (user.name as string | null) || null,

		// Address data from separate source (NOT from User model)
		street: deliveryAddress?.street || null,
		city: deliveryAddress?.city || null,
		state: deliveryAddress?.state || null,
		zip: deliveryAddress?.zip || null,
		phone: deliveryAddress?.phone || null,
		congressional_district: deliveryAddress?.congressional_district || null,

		// Congressional representatives for template variable resolution
		representatives:
			(user.representatives as Array<{
				name: string;
				party: string;
				chamber: string;
				state: string;
				district: string;
				title?: string;
				jurisdiction?: string;
			}>) || [],

		// Identity verification
		is_verified: (user.is_verified as boolean) || false,
		verification_method: (user.verification_method as string | null) || null,
		verified_at: (user.verified_at as Date | null) || null,

		// VOTER Protocol integration
		wallet_address: (user.wallet_address as string | null) || null,
		trust_score: (user.trust_score as number) || 0,
		reputation_tier: (user.reputation_tier as string) || 'novice'
	};
}
