/**
 * Verification Handler
 *
 * Orchestrates the complete verification → encryption → storage flow.
 *
 * Progressive Verification Paradigm:
 * 1. User completes identity verification (Digital Credentials API / mDL)
 * 2. Extract verified address data
 * 3. Encrypt address blob with TEE public key (XChaCha20-Poly1305)
 * 4. Store encrypted blob in Postgres
 * 5. Cache session credential in IndexedDB
 * 6. Return session data for future use
 *
 * Privacy Flow:
 * - Address encrypted in browser before leaving device
 * - Platform stores only encrypted blob (cannot decrypt)
 * - TEE decrypts only during message delivery
 * - Session credential allows skip re-verification for 3-6 months
 */

import {
	encryptIdentityBlob,
	fetchTEEPublicKey,
	getBlobStorage,
	type IdentityBlob,
	type EncryptedBlob
} from './blob-encryption';
import type { SessionCredential } from './session-cache';
import { storeSessionCredential } from './session-cache';

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
	/** Encrypted blob ID */
	blobId?: string;
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
	try {
		// Validate verification result
		if (!verificationResult.verified) {
			return {
				success: false,
				error: 'Verification failed'
			};
		}

		// If no address data, we can't proceed with encryption
		// This might happen with some verification methods
		if (!verificationResult.address) {
			console.warn('[Verification] No address data in verification result');
			return {
				success: false,
				error: 'Address data not available from verification provider'
			};
		}

		// Step 1: Fetch TEE public key
		const teePublicKey = await fetchTEEPublicKey();

		// Step 2: Build identity blob
		const identityBlob: IdentityBlob = {
			address: {
				street: verificationResult.address.street,
				city: verificationResult.address.city,
				state: verificationResult.address.state,
				zip: verificationResult.address.zip
			},
			verificationCredential: verificationResult.providerData,
			district: verificationResult.district,
			templateData: {
				// Optional: Add template personalization data if needed
			}
		};

		// Step 3: Encrypt blob with TEE public key
		const encryptedBlob = await encryptIdentityBlob(identityBlob, teePublicKey);

		// Step 4: Store encrypted blob in Postgres
		const blobStorage = getBlobStorage();
		const blobId = await blobStorage.store(userId, encryptedBlob);

		// Step 5: Create session credential
		const sessionCredential: SessionCredential = {
			userId,
			isVerified: true,
			verificationMethod: verificationResult.method,
			congressionalDistrict: verificationResult.district?.congressional,
			blobId,
			encryptedAt: new Date().toISOString(),
			expiresAt: calculateExpirationDate()
		};

		// Step 6: Cache session credential in IndexedDB
		await storeSessionCredential(sessionCredential);

		console.debug('[Verification] Complete flow successful:', {
			userId,
			method: verificationResult.method,
			blobId,
			district: verificationResult.district?.congressional
		});

		return {
			success: true,
			sessionCredential,
			blobId
		};
	} catch (error) {
		console.error('[Verification] Handler failed:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error during verification processing'
		};
	}
}

/**
 * Calculate session expiration (3-6 months from now)
 */
function calculateExpirationDate(): string {
	const now = new Date();
	// Default: 6 months
	now.setMonth(now.getMonth() + 6);
	return now.toISOString();
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
