/**
 * Delivery Confirmation
 *
 * Generates and validates HMAC-based confirmation tokens for mailto delivery.
 * Tokens are opaque (HMAC of payload + secret) rather than raw IDs to
 * prevent information leakage.
 *
 * Tokens include an embedded timestamp and expire after 7 days.
 *
 * Token format: base64url(submissionId:timestamp).base64url(hmac(submissionId:timestamp))
 *
 * Flow:
 * 1. generateConfirmationToken(submissionId) → opaque token
 * 2. User sends email, clicks confirmation link in footer
 * 3. validateConfirmationToken(token) → submissionId or null
 * 4. Update Submission.delivery_status = 'user_confirmed'
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';

const TOKEN_SEPARATOR = '.';
const PAYLOAD_SEPARATOR = ':';
/** Tokens expire after 7 days */
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
	const secret = env.JWT_SECRET;
	if (!secret) throw new Error('JWT_SECRET required for confirmation tokens');
	return secret;
}

/**
 * Generate an opaque confirmation token from a template ID.
 * Token format: base64url(id:timestamp).base64url(hmac(id:timestamp))
 */
export function generateConfirmationToken(id: string): string {
	const secret = getSecret();
	const payload = `${id}${PAYLOAD_SEPARATOR}${Date.now()}`;
	const payloadEncoded = Buffer.from(payload).toString('base64url');
	const hmac = createHmac('sha256', secret).update(payload).digest('base64url');
	return `${payloadEncoded}${TOKEN_SEPARATOR}${hmac}`;
}

/**
 * Validate a confirmation token and extract the original ID.
 * Returns null if token is invalid, tampered, or expired.
 */
export function validateConfirmationToken(token: string): string | null {
	const parts = token.split(TOKEN_SEPARATOR);
	if (parts.length !== 2) return null;

	const [payloadEncoded, providedHmac] = parts;

	let payload: string;
	try {
		payload = Buffer.from(payloadEncoded, 'base64url').toString('utf-8');
	} catch {
		return null;
	}

	const secret = getSecret();
	const expectedHmac = createHmac('sha256', secret).update(payload).digest('base64url');

	// Use Node.js native constant-time comparison
	const providedBuf = Buffer.from(providedHmac, 'utf-8');
	const expectedBuf = Buffer.from(expectedHmac, 'utf-8');
	if (providedBuf.length !== expectedBuf.length) return null;
	if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

	// Check expiration
	const sepIdx = payload.lastIndexOf(PAYLOAD_SEPARATOR);
	if (sepIdx === -1) return null;

	const id = payload.slice(0, sepIdx);
	const timestamp = parseInt(payload.slice(sepIdx + 1), 10);
	if (isNaN(timestamp)) return null;

	if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
		return null; // Token expired
	}

	return id;
}
