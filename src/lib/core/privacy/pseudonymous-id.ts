/**
 * Pseudonymous ID Generation
 *
 * Computes a deterministic pseudonymous identifier from a user ID,
 * breaking the direct link between authenticated identity and on-chain
 * proof submissions.
 *
 * Uses HMAC-SHA256 (keyed hash) rather than plain SHA-256 for:
 * - Cryptographic strength: HMAC is designed for keyed hashing
 * - Side-channel resistance: Constant-time comparison possible
 * - Standard compliance: NIST SP 800-107 approved
 *
 * Threat model:
 * - Protects against: DB dump without environment variables
 * - Protects against: Subpoena of Submission table alone
 * - Does NOT protect against: Insider with both DB + salt access
 *   (this is pseudonymization, not anonymization — by design,
 *    reputation tracking requires stable pseudonymous identity)
 */

import { createHmac } from 'crypto';
import { env } from '$env/dynamic/private';

/**
 * Compute a deterministic pseudonymous ID from a user ID.
 *
 * Reads `PSEUDONYMOUS_ID_SALT` (canonical name; mirrored on the Convex side
 * at `convex/submissions.ts:computePseudonymousId`) with a fallback to
 * the legacy `SUBMISSION_ANONYMIZATION_SALT` for operators still on the
 * old name. Both are HMAC-SHA256 with the SAME salt — this MUST agree
 * across SvelteKit + Convex or the same user produces two different
 * pseudonymousIds across platforms (status checks fail, deliveries
 * mismatch, reputation breaks). (cure shipped).
 *
 * @param userId - Authenticated user ID from session
 * @returns 64-character hex string (HMAC-SHA256 output)
 * @throws Error if neither salt env var is configured or salt is too short
 */
export function computePseudonymousId(userId: string): string {
	const salt = env.PSEUDONYMOUS_ID_SALT || env.SUBMISSION_ANONYMIZATION_SALT;
	if (!salt || salt.length < 32) {
		throw new Error(
			'PSEUDONYMOUS_ID_SALT (or legacy SUBMISSION_ANONYMIZATION_SALT) must be configured and at least 32 characters. ' +
				'Generate with: openssl rand -hex 32. ' +
				'The same value MUST be set on both SvelteKit (env var) and Convex (env var PSEUDONYMOUS_ID_SALT).'
		);
	}

	return createHmac('sha256', salt).update(userId).digest('hex');
}
