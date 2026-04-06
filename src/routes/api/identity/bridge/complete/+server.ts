import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	getBridgeSession,
	completeBridgeSession,
	failBridgeSession,
	verifyHmac
} from '$lib/server/bridge-session';
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';

const CompleteSchema = z.object({
	sessionId: z.string().uuid(),
	protocol: z.string().min(1).max(64),
	// mDL credentials are typically 2-8KB. 64KB is a generous cap that prevents
	// memory DoS via unbounded payloads while accommodating all legitimate responses.
	data: z.string().min(1).max(65536),
	hmac: z.string().min(32).max(128)
});

/**
 * Bridge Complete — phone submits verified credential.
 *
 * No cookie auth — sessionId + secret + HMAC IS the authorization.
 * Processes credential through privacy boundary, stores derived facts,
 * updates user record. Desktop SSE stream picks up the status change.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	let sessionId: string | undefined;
	let hmacVerified = false; // Only fail session if caller proved possession

	try {
		const body = await request.json();
		let input;
		try {
			input = CompleteSchema.parse(body);
		} catch (e) {
			if (e instanceof z.ZodError)
				throw error(400, `Invalid request: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}

		sessionId = input.sessionId;

		// Retrieve bridge session — secret comes from KV, never from client
		const session = await getBridgeSession(input.sessionId, platform);
		if (!session) {
			throw error(410, 'Bridge session expired or not found');
		}
		if (session.status !== 'claimed') {
			throw error(409, `Session is ${session.status}, expected claimed`);
		}
		if (!session.secret) {
			throw error(410, 'Session secret no longer available');
		}

		// Verify HMAC using secret from KV
		const hmacValid = await verifyHmac(
			session.secret,
			input.hmac,
			input.sessionId,
			input.protocol,
			input.data
		);
		if (!hmacValid) {
			throw error(403, 'Invalid HMAC — request integrity check failed');
		}
		hmacVerified = true;

		// Import ephemeral private key for credential decryption
		const ephemeralPrivateKey = await crypto.subtle.importKey(
			'jwk',
			session.ephemeralPrivateKeyJwk,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			['deriveKey', 'deriveBits']
		);

		// Process through privacy boundary
		const result = await processCredentialResponse(
			input.data,
			input.protocol,
			ephemeralPrivateKey,
			session.nonce,
			{ vicalKv: platform?.env?.VICAL_KV }
		);

		if (!result.success) {
			await failBridgeSession(input.sessionId, result.message ?? 'Verification failed', platform);
			return json(
				{ error: result.error, message: result.message },
				{ status: 422 }
			);
		}

		// Identity commitment is guaranteed present on success (missing fields = hard failure)
		if (!result.identityCommitment) {
			await failBridgeSession(input.sessionId, 'Identity fields not disclosed by wallet', platform);
			return json({ error: 'missing_identity_fields', message: 'Wallet must disclose birth date and document number' }, { status: 422 });
		}
		const identityCommitment = result.identityCommitment;

		// Bind identity commitment + update user
		const bindingResult = await serverMutation(api.users.bindIdentityCommitment, {
			userId: session.desktopUserId as any,
			identityCommitment
		});

		const canonicalUserId = bindingResult.userId;

		await serverMutation(api.users.updateMdlVerification, {
			userId: canonicalUserId as any,
			verifiedAt: Date.now(),
			addressVerificationMethod: 'mdl',
			documentType: 'mdl'
		});

		// Store derived facts in bridge session (SSE stream picks these up)
		await completeBridgeSession(
			input.sessionId,
			{
				district: result.district,
				state: result.state,
				credentialHash: result.credentialHash,
				cellId: result.cellId ?? undefined,
				identityCommitment,
				identityCommitmentBound: true
			},
			platform
		);

		console.log('[Bridge Complete] Success:', {
			sessionId: input.sessionId.slice(0, 8),
			userId: canonicalUserId,
			district: result.district
		});

		return json({ success: true, district: result.district, state: result.state });
	} catch (err) {
		// Only mark session failed if caller proved possession of the secret.
		// Otherwise anyone with the sessionId could DoS live sessions by POSTing garbage.
		if (sessionId && hmacVerified) {
			const msg = err instanceof Error ? err.message : 'Verification failed';
			await failBridgeSession(sessionId, msg, platform).catch(() => {});
		}

		if (err && typeof err === 'object' && 'status' in err) throw err;

		console.error('[Bridge Complete] Error:', err);
		throw error(500, 'Bridge verification failed');
	}
};
