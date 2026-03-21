/**
 * Passkey Registration Endpoint (Graduated Trust)
 *
 * Two-step WebAuthn registration flow:
 *
 *   Step 1 (POST, no body.response):
 *     - Requires existing auth session (user must be logged in via OAuth first)
 *     - Generates registration options via @simplewebauthn/server
 *     - Stores challenge in VerificationSession (5-minute TTL)
 *     - Returns options JSON for navigator.credentials.create()
 *
 *   Step 2 (POST, with body.response):
 *     - Receives attestation response from browser
 *     - Verifies registration against stored challenge
 *     - Saves credential to user record
 *     - Upgrades trust_tier from 0 to 1
 *
 * Security:
 *   - Requires authenticated session for both steps (upgrade flow only)
 *   - Challenge tied to specific user via VerificationSession
 *   - 5-minute challenge expiry prevents replay
 *   - One-time challenge use (status transitions: pending -> verified/failed/expired)
 */

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	generatePasskeyRegistrationOptions,
	verifyPasskeyRegistration
} from '$lib/core/identity/passkey-registration';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

const PasskeyVerifySchema = z.object({
	response: z.object({
		id: z.string().min(1),
		rawId: z.string().min(1),
		response: z.record(z.unknown()),
		type: z.literal('public-key'),
		clientExtensionResults: z.record(z.unknown()).optional(),
		authenticatorAttachment: z.string().optional()
	}),
	sessionId: z.string().min(1).max(128)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	// Both steps require an authenticated session
	if (!locals.user) {
		throw error(401, 'Authentication required. Log in with OAuth first, then register a passkey.');
	}

	const body = await request.json();

	// Step 2: Verify registration (body contains response + sessionId)
	if (body.response && body.sessionId) {
		let input;
		try {
			input = PasskeyVerifySchema.parse(body);
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid registration: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
		return handleVerification(locals.user.id, input.response as unknown as RegistrationResponseJSON, input.sessionId);
	}

	// Step 1: Generate registration options (no response in body)
	return handleOptionsGeneration(locals.user);
};

// ---------------------------------------------------------------------------
// Step 1: Generate options
// ---------------------------------------------------------------------------

async function handleOptionsGeneration(
	user: NonNullable<App.Locals['user']>
): Promise<Response> {
	try {
		// Check if user already has a passkey
		// (We still generate options — excludeCredentials will prevent re-registration
		// of the same authenticator, but the user might want to register a different one)

		const { options, sessionId } = await generatePasskeyRegistrationOptions({
			id: user.id,
			email: user.email
		});

		return json({
			success: true,
			options,
			sessionId
		});
	} catch (err) {
		console.error('[passkey/register] Options generation failed:', err);

		if (err instanceof Error) {
			throw error(500, `Failed to generate registration options: ${err.message}`);
		}
		throw error(500, 'Failed to generate registration options');
	}
}

// ---------------------------------------------------------------------------
// Step 2: Verify registration
// ---------------------------------------------------------------------------

async function handleVerification(
	userId: string,
	response: RegistrationResponseJSON,
	sessionId: string
): Promise<Response> {
	try {
		const result = await verifyPasskeyRegistration(userId, response, sessionId);

		return json({
			success: true,
			credentialId: result.credentialId,
			credentialDeviceType: result.credentialDeviceType,
			credentialBackedUp: result.credentialBackedUp
		});
	} catch (err) {
		console.error('[passkey/register] Verification failed:', err);

		if (err instanceof Error) {
			// Map known error types to appropriate HTTP status codes
			const message = err.message;

			if (message.includes('session not found')) {
				throw error(404, 'Registration session not found');
			}
			if (message.includes('does not belong to this user')) {
				throw error(403, 'Session does not belong to this user');
			}
			if (message.includes('already used or expired')) {
				throw error(409, 'Registration session already used');
			}
			if (message.includes('expired')) {
				throw error(410, 'Registration session expired');
			}
			if (message.includes('verification failed')) {
				throw error(400, 'WebAuthn registration verification failed');
			}

			throw error(400, message);
		}

		throw error(500, 'Registration verification failed');
	}
}
