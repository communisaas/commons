/**
 * Passkey Authentication (Graduated Trust Architecture)
 *
 * Server-side WebAuthn authentication logic using @simplewebauthn/server.
 *
 * Flow:
 *   1. Client requests authentication options via generatePasskeyAuthOptions()
 *   2. Options + challenge stored in VerificationSession (5-minute TTL)
 *   3. Browser calls navigator.credentials.get() with those options
 *   4. Browser posts assertion response to verifyPasskeyAuth()
 *   5. Server verifies assertion, finds user by credential ID, creates session
 *
 * Supports two modes:
 *   - Email-specified: allowCredentials limited to the user's registered credential
 *   - Usernameless (discoverable): empty allowCredentials, authenticator picks credential
 *
 * Cloudflare Workers constraints:
 *   - No Buffer — Uint8Array everywhere
 *   - No persistent in-memory state — challenges in DB (VerificationSession)
 */

import {
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/server';
import { db } from '$lib/core/db';
import { createSession } from '$lib/core/auth/auth';
import type { Session } from '$lib/core/auth/auth';
import { getPasskeyRPConfig } from './passkey-rp-config';
import { uint8ArrayToBase64url, base64urlToUint8Array } from './passkey-registration';
import { computeEmailHash } from '$lib/core/crypto/user-pii-encryption';

// ---------------------------------------------------------------------------
// Authentication: Step 1 — Generate options
// ---------------------------------------------------------------------------

/**
 * Generate WebAuthn authentication options.
 *
 * Requires an email to look up the user and their registered passkey.
 * Usernameless (discoverable credential) flow deferred to Phase 2 —
 * VerificationSession.user_id has a foreign key to User.id, so we
 * can't store a challenge without a valid user reference.
 *
 * Stores the challenge in a VerificationSession record (5-minute TTL).
 *
 * @param email User's email to look up their passkey
 * @returns Authentication options JSON + session ID for challenge lookup
 * @throws Error if user not found or has no passkey
 */
export async function generatePasskeyAuthOptions(email: string): Promise<{
	options: PublicKeyCredentialRequestOptionsJSON;
	sessionId: string;
}> {
	const { rpID } = getPasskeyRPConfig();

	// C-3: Look up user by email_hash first, fallback to plaintext during transition
	const emailHash = await computeEmailHash(email);
	let user = emailHash
		? await db.user.findUnique({
				where: { email_hash: emailHash },
				select: { id: true, passkey_credential_id: true }
			})
		: null;
	if (!user) {
		user = await db.user.findUnique({
			where: { email },
			select: { id: true, passkey_credential_id: true }
		});
	}

	if (!user) {
		throw new Error('User not found');
	}

	if (!user.passkey_credential_id) {
		throw new Error('User has no registered passkey');
	}

	const allowCredentials = [{ id: user.passkey_credential_id }];

	const options = await generateAuthenticationOptions({
		rpID,
		allowCredentials,
		userVerification: 'preferred'
	});

	// Generate nonce for the session record
	const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
	const nonce = uint8ArrayToBase64url(nonceBytes);

	// Store challenge in VerificationSession with valid user reference
	const session = await db.verificationSession.create({
		data: {
			user_id: user.id,
			nonce,
			challenge: JSON.stringify({
				challenge: options.challenge,
				rpID
			}),
			expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
			status: 'pending',
			method: 'webauthn-auth'
		}
	});

	return { options, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Authentication: Step 2 — Verify assertion response
// ---------------------------------------------------------------------------

export interface PasskeyAuthResult {
	session: Session;
	user: {
		id: string;
		email: string;
		name: string | null;
		trust_tier: number;
	};
}

/**
 * Verify a WebAuthn authentication response and create a session.
 *
 * Looks up the user by the credential ID in the assertion response,
 * verifies the assertion against the stored public key, creates a
 * new session, and updates passkey_last_used_at.
 *
 * @param response The assertion response JSON from the browser
 * @param verificationSessionId The VerificationSession ID from step 1
 * @returns Session + user info on success
 * @throws Error if verification fails
 */
export async function verifyPasskeyAuth(
	response: AuthenticationResponseJSON,
	verificationSessionId: string
): Promise<PasskeyAuthResult> {
	// Look up the VerificationSession
	const verificationSession = await db.verificationSession.findUnique({
		where: { id: verificationSessionId }
	});

	if (!verificationSession) {
		throw new Error('Verification session not found');
	}

	if (verificationSession.status !== 'pending') {
		throw new Error('Verification session already used or expired');
	}

	if (new Date() > verificationSession.expires_at) {
		await db.verificationSession.update({
			where: { id: verificationSessionId },
			data: { status: 'expired' }
		});
		throw new Error('Verification session expired');
	}

	if (verificationSession.method !== 'webauthn-auth') {
		throw new Error('Invalid session method');
	}

	// Parse stored challenge data
	const challengeData = JSON.parse(verificationSession.challenge) as {
		challenge: string;
		rpID: string;
	};

	// The credential ID from the response tells us which user is authenticating.
	// response.id is the base64url-encoded credential ID.
	const credentialId = response.id;

	// Look up the user by credential ID
	const user = await db.user.findUnique({
		where: { passkey_credential_id: credentialId },
		select: {
			id: true,
			email: true,
			name: true,
			trust_tier: true,
			passkey_credential_id: true,
			passkey_public_key_jwk: true
		}
	});

	if (!user) {
		await db.verificationSession.update({
			where: { id: verificationSessionId },
			data: { status: 'failed' }
		});
		throw new Error('No user found for this passkey credential');
	}

	if (!user.passkey_public_key_jwk) {
		throw new Error('User has no stored public key');
	}

	// Restore the public key from base64url storage to Uint8Array
	// passkey_public_key_jwk stores the base64url-encoded raw public key bytes
	const publicKeyBase64url =
		typeof user.passkey_public_key_jwk === 'string'
			? user.passkey_public_key_jwk
			: // Handle legacy JWK object format (shouldn't happen but be defensive)
				JSON.stringify(user.passkey_public_key_jwk);

	const publicKeyBytes = base64urlToUint8Array(publicKeyBase64url);

	const { origin } = getPasskeyRPConfig();

	// Verify the authentication response
	// Note: explicit cast to Uint8Array<ArrayBuffer> required because
	// base64urlToUint8Array returns Uint8Array<ArrayBufferLike> and
	// SimpleWebAuthn's types expect the narrower Uint8Array<ArrayBuffer>.
	// The underlying buffer IS an ArrayBuffer (from `new Uint8Array(n)`).
	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge: challengeData.challenge,
		expectedOrigin: origin,
		expectedRPID: challengeData.rpID,
		credential: {
			id: credentialId,
			publicKey: new Uint8Array(publicKeyBytes.buffer) as Uint8Array<ArrayBuffer>,
			counter: 0, // We don't store counter separately; start at 0
			transports: undefined
		}
	});

	if (!verification.verified) {
		await db.verificationSession.update({
			where: { id: verificationSessionId },
			data: { status: 'failed' }
		});
		throw new Error('WebAuthn authentication verification failed');
	}

	// Verification succeeded — create session and update last-used timestamp
	const [session] = await Promise.all([
		createSession(user.id),
		db.user.update({
			where: { id: user.id },
			data: { passkey_last_used_at: new Date() }
		}),
		db.verificationSession.update({
			where: { id: verificationSessionId },
			data: { status: 'verified' }
		})
	]);

	return {
		session,
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			trust_tier: user.trust_tier
		}
	};
}
