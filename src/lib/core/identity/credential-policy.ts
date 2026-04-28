/**
 * Credential Policy Service
 *
 * Defines and enforces TTL (time-to-live) policies for session credentials
 * based on the sensitivity of the action being performed.
 *
 * Higher-stakes actions require fresher credentials to prevent:
 * - Moved users voting in old districts
 * - Stale credentials being used for official communications
 *
 * Security Model (ISSUE-005):
 * - ~2% of population moves annually
 * - 6-month fixed TTL allows stale district credentials
 * - Action-based TTL reduces Sybil attack window
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Action types with associated TTL policies
 */
export type CredentialAction =
	| 'view_content' // Low stakes: read-only
	| 'community_discussion' // Medium stakes: comments/posts
	| 'constituent_message' // High stakes: message to rep
	| 'official_petition'; // Critical: legal petitions

/**
 * TTL configuration in milliseconds for each action type
 *
 * Rationale:
 * - view_content: 6 months - minimal risk, just viewing
 * - community_discussion: 6 months - community participation (aligned with tree state TTL)
 * - constituent_message: 90 days - aligned with address-attestation freshness
 * - official_petition: 30 days - legal documents require fresh credentials but 7d was too aggressive
 */
export const CREDENTIAL_TTL: Record<CredentialAction, number> = {
	view_content: 180 * 24 * 60 * 60 * 1000, // 6 months
	community_discussion: 180 * 24 * 60 * 60 * 1000, // 6 months
	constituent_message: 90 * 24 * 60 * 60 * 1000, // 90 days
	official_petition: 30 * 24 * 60 * 60 * 1000 // 30 days
} as const;

/**
 * Human-readable TTL names for UI
 */
export const CREDENTIAL_TTL_DISPLAY: Record<CredentialAction, string> = {
	view_content: '6 months',
	community_discussion: '6 months',
	constituent_message: '90 days',
	official_petition: '30 days'
};

/**
 * Action descriptions for user-facing messages
 */
export const ACTION_DESCRIPTIONS: Record<CredentialAction, string> = {
	view_content: 'viewing content',
	community_discussion: 'community discussions',
	constituent_message: 'contacting your representatives',
	official_petition: 'signing official petitions'
};

/**
 * Minimum trust tier required for each action.
 *
 * Authoritative source — components (TrustTierIndicator, etc.) import
 * this instead of hardcoding tier gates. Keeps tier policy in one place.
 */
export const ACTION_REQUIRED_TIER: Record<CredentialAction, number> = {
	view_content: 0,
	community_discussion: 1,
	constituent_message: 2,
	official_petition: 2
};

/**
 * Session credential for TTL validation
 * Compatible with existing SessionCredential types
 */
export interface SessionCredentialForPolicy {
	userId: string;
	createdAt: Date | string;
	expiresAt?: Date | string;
	congressionalDistrict?: string;
}

/**
 * Result of credential validation
 */
export interface CredentialValidation {
	/** Is the credential valid for the requested action? */
	valid: boolean;
	/** The action being validated */
	action: CredentialAction;
	/** Age of credential in milliseconds */
	age: number;
	/** Maximum allowed age for this action in milliseconds */
	maxAge: number;
	/** Days until credential expires for this action (0 if already expired) */
	daysUntilExpiry: number;
	/** Does the user need to re-verify? */
	requiresReverification: boolean;
	/** Human-readable message for the user */
	message?: string;
}

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Parse a date that could be a Date object or ISO string
 */
function parseDate(date: Date | string): number {
	if (date instanceof Date) {
		return date.getTime();
	}
	return new Date(date).getTime();
}

/**
 * Check if a credential is valid for a specific action
 *
 * @param credential - The session credential to validate
 * @param action - The action the user wants to perform
 * @returns Validation result with detailed information
 */
export function isCredentialValidForAction(
	credential: SessionCredentialForPolicy,
	action: CredentialAction
): CredentialValidation {
	const now = Date.now();
	const createdTime = parseDate(credential.createdAt);

	const age = now - createdTime;
	const maxAge = CREDENTIAL_TTL[action];
	const valid = age < maxAge;

	const daysUntilExpiry = Math.max(0, Math.floor((maxAge - age) / (24 * 60 * 60 * 1000)));
	const daysOld = Math.floor(age / (24 * 60 * 60 * 1000));

	return {
		valid,
		action,
		age,
		maxAge,
		daysUntilExpiry,
		requiresReverification: !valid,
		message: valid
			? undefined
			: `Your verification is ${daysOld} days old. ` +
				`${ACTION_DESCRIPTIONS[action]} requires verification within ${CREDENTIAL_TTL_DISPLAY[action]}. ` +
				`Please re-verify your address.`
	};
}

/**
 * Get the strictest (shortest) TTL for multiple actions
 *
 * Useful when a user flow requires multiple action types
 *
 * @param actions - Array of actions to check
 * @returns The minimum TTL in milliseconds
 */
export function getStrictestTTL(actions: CredentialAction[]): number {
	if (actions.length === 0) {
		return CREDENTIAL_TTL.view_content; // Default to least strict
	}
	return Math.min(...actions.map((a) => CREDENTIAL_TTL[a]));
}

/**
 * Get the most permissive (longest) TTL for multiple actions
 *
 * @param actions - Array of actions to check
 * @returns The maximum TTL in milliseconds
 */
export function getMostPermissiveTTL(actions: CredentialAction[]): number {
	if (actions.length === 0) {
		return CREDENTIAL_TTL.view_content;
	}
	return Math.max(...actions.map((a) => CREDENTIAL_TTL[a]));
}

// ============================================================================
// Re-verification Prompting
// ============================================================================

/**
 * Check if re-verification should be prompted (approaching expiry)
 *
 * Prompts when credential age approaches the action's TTL threshold,
 * giving users time to re-verify before their access is interrupted.
 *
 * @param credential - The session credential to check
 * @param upcomingAction - Optional action to check against (uses general threshold if not provided)
 * @returns True if user should be prompted to re-verify
 */
export function shouldPromptReverification(
	credential: SessionCredentialForPolicy,
	upcomingAction?: CredentialAction
): boolean {
	const now = Date.now();
	const createdTime = parseDate(credential.createdAt);
	const age = now - createdTime;

	// If checking for a specific action, prompt when approaching that action's threshold
	if (upcomingAction) {
		const threshold = CREDENTIAL_TTL[upcomingAction];
		// Prompt 7 days before expiry for that action
		const warningPeriod = 7 * 24 * 60 * 60 * 1000;
		return age > threshold - warningPeriod;
	}

	// General prompt: when credential is older than 30 days
	// This catches users who might need constituent_message or official_petition
	const thirtyDays = 30 * 24 * 60 * 60 * 1000;
	return age >= thirtyDays;
}

/**
 * Get the next action that will require re-verification
 *
 * @param credential - The session credential
 * @returns The action with the soonest expiry, or null if all are expired
 */
export function getNextExpiringAction(
	credential: SessionCredentialForPolicy
): CredentialAction | null {
	const now = Date.now();
	const createdTime = parseDate(credential.createdAt);
	const age = now - createdTime;

	// Sort actions by TTL (shortest first)
	const actions: CredentialAction[] = [
		'official_petition',
		'constituent_message',
		'community_discussion',
		'view_content'
	];

	for (const action of actions) {
		if (age < CREDENTIAL_TTL[action]) {
			return action;
		}
	}

	return null; // All actions expired
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate how many days until a credential expires for an action
 *
 * @param credential - The session credential
 * @param action - The action to check
 * @returns Number of days until expiry (negative if already expired)
 */
export function getDaysUntilExpiry(
	credential: SessionCredentialForPolicy,
	action: CredentialAction
): number {
	const now = Date.now();
	const createdTime = parseDate(credential.createdAt);
	const age = now - createdTime;
	const maxAge = CREDENTIAL_TTL[action];

	return Math.floor((maxAge - age) / (24 * 60 * 60 * 1000));
}

/**
 * Get the effective expiration date for an action
 *
 * @param credential - The session credential
 * @param action - The action to check
 * @returns Date when credential expires for this action
 */
export function getExpirationDateForAction(
	credential: SessionCredentialForPolicy,
	action: CredentialAction
): Date {
	const createdTime = parseDate(credential.createdAt);
	return new Date(createdTime + CREDENTIAL_TTL[action]);
}

/**
 * Check if a credential is valid for any action
 *
 * @param credential - The session credential
 * @returns True if valid for at least view_content
 */
export function isCredentialValid(credential: SessionCredentialForPolicy): boolean {
	return isCredentialValidForAction(credential, 'view_content').valid;
}

/**
 * Get all actions a credential is currently valid for
 *
 * @param credential - The session credential
 * @returns Array of valid actions (empty if all expired)
 */
export function getValidActionsForCredential(
	credential: SessionCredentialForPolicy
): CredentialAction[] {
	const actions: CredentialAction[] = [
		'view_content',
		'community_discussion',
		'constituent_message',
		'official_petition'
	];

	return actions.filter((action) => isCredentialValidForAction(credential, action).valid);
}

/**
 * Format a credential validation error for API responses
 *
 * @param validation - The validation result
 * @returns Formatted error object for JSON response
 */
export function formatValidationError(validation: CredentialValidation): {
	error: string;
	code: string;
	action: CredentialAction;
	message: string;
	requiresReverification: boolean;
	daysOld: number;
	maxDays: number;
} {
	return {
		error: 'credential_expired',
		code: 'CREDENTIAL_TTL_EXCEEDED',
		action: validation.action,
		message:
			validation.message ||
			`Credential expired for ${ACTION_DESCRIPTIONS[validation.action]}`,
		requiresReverification: true,
		daysOld: Math.floor(validation.age / (24 * 60 * 60 * 1000)),
		maxDays: Math.floor(validation.maxAge / (24 * 60 * 60 * 1000))
	};
}

// ============================================================================
// Tier-Aware Credential TTL (Graduated Trust)
// ============================================================================

/**
 * TTL configuration for credentials at each trust tier (in milliseconds)
 *
 * Rationale:
 * - Tier 0: Guest (no account, no credential)
 * - Tier 1: Authenticated (OAuth), 1 year TTL (session-based)
 * - Tier 2: Address attestation, 6 months (aligned with tree state TTL)
 * - Tier 3: Identity verification, 6 months (ID card / drivers license)
 * - Tier 4: Legacy passport provider tier, 6 months
 * - Tier 5: Government credential, 1 year (follows issuer TTL)
 *
 * Note: Action-based TTL applies ON TOP of tier TTL.
 * Example: Tier 2 user sending constituent_message needs credential < 90 days old,
 * even though the district credential itself is valid for 6 months.
 */
export const TIER_CREDENTIAL_TTL: Record<number, number> = {
	0: 0, // Guest: no credential
	1: 365 * 24 * 60 * 60 * 1000, // Authenticated (OAuth): 1 year
	2: 180 * 24 * 60 * 60 * 1000, // Address attestation: 6 months
	3: 180 * 24 * 60 * 60 * 1000, // Identity verification: 6 months
	4: 180 * 24 * 60 * 60 * 1000, // Passport verification: 6 months
	5: 365 * 24 * 60 * 60 * 1000 // Government credential: follows issuer TTL (typically 1-5 years)
};

/**
 * Check if a credential for a given tier is still fresh.
 *
 * This checks the tier's base TTL, NOT the action-based TTL.
 * For action-specific validation, use isCredentialValidForAction().
 *
 * @param tier - Trust tier (0-5)
 * @param verifiedAt - When the credential was issued/verified
 * @returns True if credential is within tier's TTL window
 */
export function isTierCredentialFresh(
	tier: number,
	verifiedAt: Date | string | null
): boolean {
	if (tier === 0 || !verifiedAt) {
		return false; // No credential or anonymous user
	}

	const ttl = TIER_CREDENTIAL_TTL[tier];
	if (!ttl) {
		return false; // Invalid tier
	}

	const now = Date.now();
	const verifiedTime = parseDate(verifiedAt);
	const age = now - verifiedTime;

	return age < ttl;
}
