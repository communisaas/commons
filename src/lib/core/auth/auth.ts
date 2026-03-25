import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { db } from '$lib/core/db';
import { decryptUserPii } from '$lib/core/crypto/user-pii-encryption';


const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-session';

// Type definitions for session management
export interface Session {
	id: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

/**
 * User type from authentication - matches Prisma User model
 * NO PII stored per CYPHERPUNK-ARCHITECTURE.md
 * Address data stored in EncryptedDeliveryData, provided at send time
 */
export interface User {
	id: string;
	email: string;
	name: string | null;
	avatar: string | null;
	createdAt: Date;
	updatedAt: Date;
	// Verification status
	is_verified: boolean;
	verification_method: string | null;
	verified_at: Date | null;
	// Graduated trust
	passkey_credential_id: string | null;
	did_key: string | null;
	address_verified_at: Date | null;
	identity_commitment: string | null;
	document_type: string | null;
	// Privacy-preserving district (HMAC hash only, no plaintext)
	district_hash: string | null;
	district_verified: boolean;
	// Wallet integration
	wallet_address: string | null;
	wallet_type: string | null;
	near_account_id: string | null;
	near_derived_scroll_address: string | null;
	// Reputation
	trust_score: number;
	reputation_tier: string;
	// Profile fields (general, non-PII)
	role: string | null;
	organization: string | null;
	location: string | null; // General location description (city-level, not full address)
	connection: string | null;
	profile_completed_at: Date | null;
	profile_visibility: string;
}

export interface SessionValidationSuccess {
	session: Session;
	user: User;
	/** True when the session expiry was extended (cookie needs refresh) */
	renewed: boolean;
}

export interface SessionValidationFailure {
	session: null;
	user: null;
	renewed: false;
}

function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	const token = encodeBase32LowerCaseNoPadding(bytes);
	return token;
}

/**
 * BA-020: Session token security — the raw token is generated, then immediately
 * SHA-256 hashed to produce the sessionId. Only the hash is stored in the database
 * and set as the cookie value. The raw token is never persisted anywhere.
 * This means cookie value === DB value === SHA-256(random token), which is the
 * correct pattern. No TODO needed — token hashing before DB storage is already
 * implemented.
 */
export async function createSession(userId: string, extended = false): Promise<Session> {
	const token = generateSessionToken();
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

	// Extended sessions for social media acquisition funnel (90 days)
	const expiryDays = extended ? 90 : 30;

	const session = await db.session.create({
		data: {
			id: sessionId,
			userId,
			expiresAt: new Date(Date.now() + DAY_IN_MS * expiryDays)
		}
	});
	return session;
}

export async function invalidateSession(sessionId: string): Promise<void> {
	try {
		await db.session.delete({ where: { id: sessionId } });
	} catch (error) {
		// Handle case where session doesn't exist (already deleted)
		if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
			return; // Silently handle - session was already deleted
		}
		throw error; // Re-throw other errors
	}
}

export async function validateSession(
	sessionId: string
): Promise<SessionValidationSuccess | SessionValidationFailure> {
	const result = await db.session.findUnique({
		where: { id: sessionId },
		include: { user: true }
	});

	if (!result) {
		return { session: null, user: null, renewed: false };
	}
	const { user, ...session } = result;

	const sessionExpired = Date.now() >= session.expiresAt.getTime();
	if (sessionExpired) {
		await db.session.delete({ where: { id: session.id } });
		return { session: null, user: null, renewed: false };
	}

	// F-R4B-02: Absolute session lifetime cap — prevents indefinite renewal of stolen tokens
	const MAX_SESSION_LIFETIME_MS = 90 * DAY_IN_MS; // 90 days
	const sessionAge = Date.now() - session.createdAt.getTime();
	if (sessionAge > MAX_SESSION_LIFETIME_MS) {
		await db.session.delete({ where: { id: session.id } });
		return { session: null, user: null, renewed: false };
	}

	const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
	if (renewSession) {
		session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
		await db.session.update({
			where: { id: session.id },
			data: { expiresAt: session.expiresAt }
		});
	}

	// C-3: Decrypt PII if encrypted columns exist, fallback to plaintext during transition.
	// CRITICAL: Decryption failure must NOT invalidate the session. The user is authenticated
	// (session token is valid) — PII is cosmetic. Failing here would silently null out
	// locals.user in hooks.server.ts, breaking district lookup and recipient resolution.
	let pii: { email: string; name: string | null };
	try {
		pii = await decryptUserPii(user);
	} catch (err) {
		console.error('[Auth] PII decryption failed — session preserved with masked PII:', {
			userId: user.id,
			hasEncryptedEmail: !!user.encrypted_email,
			error: err instanceof Error ? err.message : String(err)
		});
		pii = { email: `user-${user.id.slice(0, 8)}@encrypted.local`, name: null };
	}

	return {
		session,
		renewed: renewSession,
		user: {
			...user,
			// C-3: Use decrypted PII (or masked fallback on decryption failure)
			email: pii.email,
			name: pii.name,
			// Ensure all new fields are explicitly included for type safety
			passkey_credential_id: user.passkey_credential_id ?? null,
			did_key: user.did_key ?? null,
			address_verified_at: user.address_verified_at ?? null,
			identity_commitment: user.identity_commitment ?? null,
			document_type: user.document_type ?? null
		}
	};
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSession>>;
