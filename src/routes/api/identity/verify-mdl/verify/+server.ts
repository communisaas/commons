import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import {
	bindIdentityCommitment
} from '$lib/core/identity/identity-binding';

const VerifyMdlSchema = z.object({
	protocol: z.string().min(1),
	data: z.string().min(1),
	nonce: z.string().min(1).max(128)
});

/**
 * mDL Verification Verify Endpoint
 *
 * Receives the credential response from the client, retrieves the
 * ephemeral private key from KV, and processes the response through
 * the privacy boundary function.
 *
 * The ephemeral key is deleted after use (one-time use).
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	// Authentication check
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	try {
		const body = await request.json();
		let input;
		try {
			input = VerifyMdlSchema.parse(body);
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid request: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
		const { protocol, data, nonce } = input;

		// Retrieve ephemeral private key from KV (one-time use)
		const kvKey = `mdl-session:${nonce}`;
		let sessionData: string | null = null;

		const kv = platform?.env?.DC_SESSION_KV;
		if (kv) {
			sessionData = await kv.get(kvKey);
			// Delete immediately -- one-time use
			await kv.delete(kvKey);
		} else {
			// Dev fallback: use shared in-memory store
			const { devSessionStore } = await import('../_dev-session-store');
			const stored = devSessionStore.get(kvKey);
			if (stored && stored.expires > Date.now()) {
				sessionData = stored.data;
			}
			devSessionStore.delete(kvKey);
		}

		if (!sessionData) {
			throw error(410, 'Verification session expired or already used');
		}

		const { privateKeyJwk, userId: sessionUserId } = JSON.parse(sessionData);

		// Verify the session belongs to this user
		if (sessionUserId !== session.userId) {
			throw error(403, 'Session user mismatch');
		}

		// Import the ephemeral private key
		const ephemeralPrivateKey = await crypto.subtle.importKey(
			'jwk',
			privateKeyJwk,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			['deriveKey', 'deriveBits']
		);

		// Process through privacy boundary
		const result = await processCredentialResponse(data, protocol, ephemeralPrivateKey, nonce, {
			vicalKv: platform?.env?.VICAL_KV
		});

		if (!result.success) {
			console.error('[mDL Verify] Verification failed:', result.error, result.message);
			return json({
				error: result.error,
				message: result.message,
				...(result.supportedStates && { supportedStates: result.supportedStates })
			}, { status: 422 });
		}

		// Identity commitment was computed INSIDE the privacy boundary
		// (mdl-verification.ts). Raw document_number and birth_date never reach this endpoint.
		let identityCommitment: string;
		if (result.identityCommitment) {
			identityCommitment = result.identityCommitment;
		} else {
			// Wallet did not disclose birth_date / document_number — derive from credentialHash
			// Reduce mod BN254 to ensure valid field element (~25% of raw SHA-256 exceed modulus)
			const BN254_MODULUS =
				21888242871839275222246405745257275088548364400416034343698204186575808495617n;
			const hashValue = BigInt('0x' + result.credentialHash);
			const reduced = hashValue % BN254_MODULUS;
			identityCommitment = reduced.toString(16).padStart(64, '0');
			console.warn(
				'[mDL Verify] Identity fields not disclosed — using reduced credentialHash as fallback commitment'
			);
		}

		// Bind identity commitment for Sybil detection and account merging
		// If this commitment already exists on another user, accounts are merged
		const bindingResult = await bindIdentityCommitment(session.userId, identityCommitment);

		// Use the canonical userId after potential merge
		const canonicalUserId = bindingResult.userId;

		if (bindingResult.linkedToExisting) {
			console.log('[mDL Verify] Account merged:', {
				from: session.userId,
				to: canonicalUserId,
				accountsMoved: bindingResult.mergeDetails?.accountsMoved
			});
		}

		// Update user record with mDL verification
		// Always set verification metadata; only upgrade trust_tier (never downgrade)
		const now = Date.now();
		await serverMutation(api.users.updateMdlVerification, {
			userId: canonicalUserId as any,
			verifiedAt: now,
			addressVerificationMethod: 'mdl',
			documentType: 'mdl',
		});

		console.log('[mDL Verify] Success:', {
			userId: canonicalUserId,
			district: result.district,
			state: result.state,
			commitmentFingerprint: identityCommitment.slice(0, 16) + '...',
			identityFieldsAvailable: !!result.identityCommitment
		});

		return json({
			success: true,
			district: result.district,
			state: result.state,
			credentialHash: result.credentialHash,
			// Census tract GEOID for Shadow Atlas Tree 2 registration
			cellId: result.cellId ?? null,
			// Signal to client whether Shadow Atlas registration can proceed
			identityCommitmentBound: true,
			// F-R3-13: Signal client to re-authenticate when session references deleted user
			requireReauth: bindingResult.requireReauth ?? false
		});
	} catch (err) {
		console.error('[mDL Verify] Error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		throw error(500, 'mDL verification failed');
	}
};
