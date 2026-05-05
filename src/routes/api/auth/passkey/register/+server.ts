import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { base64urlEncode } from '$lib/core/encoding/base64url';
import { deriveDIDKey } from '$lib/core/identity/did-key-derivation';
import { getPasskeyRPConfig } from '$lib/core/identity/passkey-rp-config';

const CEREMONY_TTL_MS = 5 * 60 * 1000;

function parseRegistrationResponse(value: unknown): RegistrationResponseJSON {
	if (!value || typeof value !== 'object') {
		throw error(400, 'Registration response is required');
	}
	return value as RegistrationResponseJSON;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((item): item is string => typeof item === 'string');
	return strings.length > 0 ? strings : undefined;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => ({}));
	const { rpName, rpID, origin } = getPasskeyRPConfig();

	if (body?.response && body?.sessionId) {
		const ceremony = await serverMutation(api.passkeys.consumeRegistrationCeremony, {
			sessionId: body.sessionId
		});

		const verification = await verifyRegistrationResponse({
			response: parseRegistrationResponse(body.response),
			expectedChallenge: ceremony.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true
		});

		if (!verification.verified || !verification.registrationInfo) {
			throw error(400, 'Passkey registration could not be verified');
		}

		const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
			verification.registrationInfo;
		let didKey: string | undefined;
		try {
			didKey = deriveDIDKey(credential.publicKey);
		} catch {
			didKey = undefined;
		}

		await serverMutation(api.users.storePasskey, {
			userId: locals.user.id as Id<'users'>,
			credentialId: credential.id,
			publicKey: base64urlEncode(credential.publicKey),
			counter: credential.counter,
			transports: stringArray((body.response as RegistrationResponseJSON).response?.transports),
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			aaguid,
			didKey
		});

		return json({ success: true, credentialId: credential.id });
	}

	const userName = locals.user.email ?? locals.user.id;
	const options = await generateRegistrationOptions({
		rpName,
		rpID,
		userName,
		userID: new TextEncoder().encode(locals.user.id),
		userDisplayName: locals.user.name ?? userName,
		attestationType: 'none',
		timeout: 60_000,
		excludeCredentials: locals.user.passkey_credential_id
			? [{ id: locals.user.passkey_credential_id }]
			: undefined,
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'required'
		}
	});

	const sessionId = await serverMutation(api.passkeys.createRegistrationCeremony, {
		challenge: options.challenge,
		expiresAt: Date.now() + CEREMONY_TTL_MS
	});

	return json({ options, sessionId });
};
