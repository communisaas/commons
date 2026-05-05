/**
 * Verification Handler
 *
 * Retired encrypted-blob verification handler. Ground Vault PRF now owns
 * address custody and delivery readiness.
 *
 * Progressive Verification Paradigm:
 * 1. User completes identity verification (Digital Credentials API / mDL)
 * 2. Extract verified address data
 * 3. Persist encrypted Ground Vault ciphertext and disclosed cell metadata
 * 4. Add passkey PRF wrapper where supported; use address re-entry otherwise
 * 5. Cache session credential in IndexedDB
 * 6. Return session data for future use
 *
 * Privacy Flow:
 * - Address persisted as encrypted ground-vault material
 * - Plaintext address may be handled during verification or official delivery
 * - Session credential allows skip re-verification for 3-6 months
 */

import type { SessionCredential } from './session-cache';

// ============================================================================
// Types
// ============================================================================

export interface VerificationResult {
	/** Verification method used */
	method: 'digital-credentials-api';
	/** Verification status */
	verified: boolean;
	/** Provider-specific data */
	providerData: {
		provider: 'digital-credentials-api';
		credentialHash: string;
		issuedAt: number;
		expiresAt?: number;
	};
	/** Verified address (if available) */
	address?: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};
	/** Congressional district (if resolved) */
	district?: {
		congressional: string; // e.g., "CA-12"
		stateSenate?: string;
		stateHouse?: string;
	};
}

export interface VerificationHandlerResult {
	/** Was verification successful? */
	success: boolean;
	/** Session credential for future use */
	sessionCredential?: SessionCredential;
	/** Legacy encrypted blob ID, no longer issued */
	blobId?: never;
	/** Error message if failed */
	error?: string;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle complete verification flow
 *
 * @param userId - User identifier
 * @param verificationResult - Result from verification provider
 * @returns Session credential and storage confirmation
 */
export async function handleVerificationComplete(
	userId: string,
	verificationResult: VerificationResult
): Promise<VerificationHandlerResult> {
	void userId;
	void verificationResult;
	throw new Error('DEPRECATED_IDENTITY_BLOB_PATH');
}

// ============================================================================
// Verification Status Check
// ============================================================================

/**
 * Check if user has valid verification session
 *
 * @param userId - User identifier
 * @returns Session credential if valid, null otherwise
 */
export async function checkVerificationStatus(userId: string): Promise<SessionCredential | null> {
	try {
		const { getSessionCredential } = await import('./session-cache');
		const credential = await getSessionCredential(userId);

		// Check if credential exists and hasn't expired
		if (!credential) {
			return null;
		}

		const expiresAt = new Date(credential.expiresAt);
		const now = new Date();

		if (expiresAt < now) {
			console.debug('[Verification] Session expired for user:', userId.slice(0, 8));
			return null;
		}

		return credential;
	} catch (error) {
		console.error('[Verification] Status check failed:', error);
		return null;
	}
}

/**
 * Clear verification session (logout or re-verification)
 *
 * @param userId - User identifier
 */
export async function clearVerificationSession(userId: string): Promise<void> {
	try {
		const { deleteSessionCredential } = await import('./session-cache');
		await deleteSessionCredential(userId);
		console.debug('[Verification] Session cleared for user:', userId.slice(0, 8));
	} catch (error) {
		console.error('[Verification] Session clear failed:', error);
		throw error;
	}
}
