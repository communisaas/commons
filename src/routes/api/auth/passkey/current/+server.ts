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
import { createServerProof } from '$lib/server/auth/session-proof';

const CEREMONY_TTL_MS = 5 * 60 * 1000;

function sessionSecret(): string {
	const secret = process.env.SESSION_CREATION_SECRET;
	if (!secret) throw error(503, 'SESSION_CREATION_SECRET not configured');
	return secret;
}

function parseAuthenticationResponse(value: unknown): AuthenticationResponseJSON {
	if (!value || typeof value !== 'object') {
		throw error(400, 'Authentication response is required');
	}
	return value as AuthenticationResponseJSON;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.id || !locals.user.email) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => ({}));
	const secret = sessionSecret();
	const { rpID, origin } = getPasskeyRPConfig();
	const email = locals.user.email.trim().toLowerCase();

	if (body?.action === 'options') {
		const issuedAt = Date.now();
		const lookupProof = await createServerProof(['passkey-email', email, issuedAt], secret);
		const material = await serverQuery(api.passkeys.getAuthMaterialByEmail, {
			email,
			issuedAt,
			proof: lookupProof
		});

		if (!material || material.userId !== locals.user.id) {
			throw error(404, 'No passkey found for this session');
		}
		if (!material.hasPasskey || !material.credentialId || !material.publicKey) {
			throw error(400, 'No registered passkey');
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
		if (typeof body.sessionId !== 'string' || !body.sessionId) {
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

		if (ceremony.userId !== locals.user.id || response.id !== ceremony.credentialId) {
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

		return json({ success: true });
	}

	throw error(400, 'Invalid passkey action');
};
