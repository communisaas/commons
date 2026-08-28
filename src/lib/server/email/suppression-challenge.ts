import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * The mailbox-control challenge behind the do-not-contact route.
 *
 * A suppression link rides a message the SENDER composed and sent from their own
 * mail client, so holding that link says nothing about controlling the mailbox it
 * names. The link therefore only ever ASKS. The authority to perform the
 * terminal, global, permanent write is a random nonce that is mailed TO the
 * address and nowhere else.
 *
 * The nonce IS the secret: it is 32 bytes of CSPRNG output, and only its SHA-256
 * is persisted. There is no HMAC and no key here, so nothing in this module
 * enters the shared-secret rotation map — a stolen database yields no usable
 * confirmation link.
 *
 * The URL shape mirrors `recipient-suppression.ts`: `PUBLIC_BASE_URL` when set,
 * the canonical host otherwise, and no plaintext address in any component.
 */

/** A challenge is good for a day. Long enough to read mail, short enough to expire. */
export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Issuances per contact hash per day. The bound is per TARGET, not per caller:
 * the thing being rationed is mail arriving at one mailbox, and the caller is
 * anonymous by design. Enforcement lives in Convex because the isolate-local
 * rate limiter cannot hold a durable per-target count.
 */
export const CHALLENGE_MAX_PER_CONTACT_24H = 3;

/** 32 random bytes, base64url — 43 characters, no padding, URL- and mail-safe. */
const CHALLENGE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Mint a fresh challenge nonce. The only copy that should ever leave here goes to the mailbox. */
export function mintChallengeNonce(): string {
	return randomBytes(32).toString('base64url');
}

/** The stored form of a nonce. Never store, log, or index the nonce itself. */
export function hashChallengeNonce(nonce: string): string {
	return createHash('sha256').update(nonce).digest('hex');
}

/**
 * Whether a value is a well-formed challenge nonce. Checked before hashing so an
 * adversarial path segment never becomes a database lookup.
 */
export function isChallengeNonce(value: string): boolean {
	return CHALLENGE_NONCE_PATTERN.test(value);
}

/** The confirmation URL that travels in the challenge message, and only there. */
export function buildChallengeConfirmUrl(nonce: string): string {
	const baseUrl = env.PUBLIC_BASE_URL || 'https://commons.email';
	return `${baseUrl}/do-not-contact/confirm/${nonce}`;
}

export const CHALLENGE_FROM_EMAIL = 'noreply@commons.email';
export const CHALLENGE_FROM_NAME = 'Commons';
export const CHALLENGE_SUBJECT = 'Confirm removal of this address from Commons';

/**
 * The challenge message. It names no sender, no template and no organization:
 * the mailbox is being asked to confirm one decision about itself, and anything
 * else here would turn a routine message into a disclosure about who is writing
 * to whom.
 */
export function buildChallengeEmailBody(confirmUrl: string): string {
	return [
		'<p>Someone asked Commons to stop showing this email address and to stop including it in messages.</p>',
		'<p>If that was you, confirm it here:</p>',
		`<p><a href="${confirmUrl}">${confirmUrl}</a></p>`,
		'<p>This is permanent and applies to every organization on the platform. The link expires in 24 hours.</p>',
		'<p>If it was not you, ignore this message. Nothing changes unless the link above is used.</p>'
	].join('\n');
}
