import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type AuthenticationResponseJSON,
	type WebAuthnCredential
} from '@simplewebauthn/server';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$convex/_generated/api';
import { base64urlDecode } from '$lib/core/encoding/base64url';
import { getPasskeyRPConfig } from '$lib/core/identity/passkey-rp-config';
import { createServerProof, createSessionCreationProof } from '$lib/server/auth/session-proof';

const CEREMONY_TTL_MS = 5 * 60 * 1000;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function sessionSecret(): string {
	const secret = process.env.SESSION_CREATION_SECRET;
	if (!secret) throw error(503, 'SESSION_CREATION_SECRET not configured');
	return secret;
}

function normalizeEmail(value: unknown): string {
	// cap email at RFC 5321 max (254) before normalize.
	if (typeof value !== 'string' || !value.trim() || value.length > 254) {
		throw error(400, 'Email is required (max 254 characters)');
	}
	return value.trim().toLowerCase();
}

function parseAuthenticationResponse(value: unknown): AuthenticationResponseJSON {
	if (!value || typeof value !== 'object') {
		throw error(400, 'Authentication response is required');
	}
	return value as AuthenticationResponseJSON;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const secret = sessionSecret();
	const { rpID, origin } = getPasskeyRPConfig();

	if (body?.action === 'options') {
		const email = normalizeEmail(body.email);
		const issuedAt = Date.now();
		const lookupProof = await createServerProof(['passkey-email', email, issuedAt], secret);
		const material = await serverQuery(api.passkeys.getAuthMaterialByEmail, {
			email,
			issuedAt,
			proof: lookupProof
		});

		if (!material) throw error(404, 'No account found');
		if (!material.hasPasskey || !material.credentialId) {
			throw error(400, 'no registered passkey');
		}
		if (!material.publicKey) {
			throw error(400, 'Passkey needs to be registered again');
		}

		const options = await generateAuthenticationOptions({
			rpID,
			timeout: 60_000,
			userVerification: 'required',
			allowCredentials: [
				{
					id: material.credentialId,
					transports: material.transports as WebAuthnCredential['transports']
				}
			]
		});

		const expiresAt = Date.now() + CEREMONY_TTL_MS;
		const ceremonyProof = await createServerProof(
			[
				'passkey-create-authentication',
				material.userId,
				material.credentialId,
				options.challenge,
				expiresAt
			],
			secret
		);
		const sessionId = await serverMutation(api.passkeys.createAuthenticationCeremony, {
			userId: material.userId,
			email,
			passkeyCredentialId: material.credentialId,
			challenge: options.challenge,
			expiresAt,
			proof: ceremonyProof
		});

		return json({ options, sessionId });
	}

	if (body?.action === 'verify') {
		// bound sessionId (Convex doc id; cap at 64).
		if (typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 64) {
			throw error(400, 'Passkey session is required');
		}
		const response = parseAuthenticationResponse(body.response);
		const consumeProof = await createServerProof(
			['passkey-consume-authentication', body.sessionId],
			secret
		);
		const ceremony = await serverMutation(api.passkeys.consumeAuthenticationCeremony, {
			sessionId: body.sessionId,
			proof: consumeProof
		});

		if (response.id !== ceremony.credentialId) {
			throw error(400, 'Passkey credential mismatch');
		}

		const credential: WebAuthnCredential = {
			id: ceremony.credentialId,
			publicKey: base64urlDecode(ceremony.publicKey),
			counter: ceremony.counter,
			transports: ceremony.transports as WebAuthnCredential['transports']
		};
		const verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			credential,
			requireUserVerification: true
		});

		if (!verification.verified) {
			throw error(400, 'Passkey authentication failed');
		}

		const updateProof = await createServerProof(
			[
				'passkey-authenticated',
				ceremony.userId,
				ceremony.credentialId,
				verification.authenticationInfo.newCounter
			],
			secret
		);
		await serverMutation(api.passkeys.updatePasskeyAfterAuthentication, {
			userId: ceremony.userId,
			credentialId: ceremony.credentialId,
			newCounter: verification.authenticationInfo.newCounter,
			deviceType: verification.authenticationInfo.credentialDeviceType,
			backedUp: verification.authenticationInfo.credentialBackedUp,
			proof: updateProof
		});

		const expiresAt = Date.now() + SESSION_DURATION_MS;
		const sessionProof = await createSessionCreationProof(ceremony.userId, expiresAt, secret);
		const session = await serverMutation(api.authOps.createSession, {
			userId: ceremony.userId,
			expiresAt,
			proof: sessionProof
		});

		cookies.set('auth-session', session.sessionId, {
			path: '/',
			secure: !dev,
			httpOnly: true,
			maxAge: SESSION_DURATION_MS / 1000,
			sameSite: 'lax'
		});

		return json({ success: true });
	}

	throw error(400, 'Invalid passkey authentication action');
};
