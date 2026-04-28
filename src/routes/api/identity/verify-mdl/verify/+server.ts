import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { isAnyMdlProtocolEnabled, isMdlProtocolEnabled } from '$lib/config/features';
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import { readBoundedJson } from '$lib/server/bounded-json';

const MAX_VERIFY_BODY_BYTES = 80 * 1024;

const VerifyMdlSchema = z.object({
	protocol: z.string().min(1),
	// mDL credentials are typically 2-8KB. Keep a strict cap to avoid
	// memory/CPU DoS from oversized JSON/CBOR payloads.
	data: z.string().min(1).max(65536),
	nonce: z.string().min(1).max(128)
});

function isMdlCredentialReuseError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return (
		message.includes('MDL_CREDENTIAL_HASH_REUSED') || message.includes('MDL_SESSION_NONCE_REUSED')
	);
}

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
	if (!isAnyMdlProtocolEnabled()) {
		throw error(404, 'Not found');
	}

	// Authentication check
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	try {
		const body = await readBoundedJson(request, MAX_VERIFY_BODY_BYTES);
		let input;
		try {
			input = VerifyMdlSchema.parse(body);
		} catch (e) {
			if (e instanceof z.ZodError)
				throw error(400, `Invalid request: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
		const { protocol, data, nonce } = input;
		if (!isMdlProtocolEnabled(protocol)) {
			throw error(404, 'Not found');
		}

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

		const {
			privateKeyJwk,
			jwkThumbprint,
			userId: sessionUserId,
			origin: verifierOrigin,
			allowedProtocols
		} = JSON.parse(sessionData) as {
			privateKeyJwk: JsonWebKey;
			jwkThumbprint?: unknown;
			userId?: string;
			origin?: unknown;
			allowedProtocols?: unknown;
		};

		// Verify the session belongs to this user
		if (sessionUserId !== session.userId) {
			throw error(403, 'Session user mismatch');
		}
		if (
			!Array.isArray(allowedProtocols) ||
			!allowedProtocols.every((allowed): allowed is string => typeof allowed === 'string') ||
			!allowedProtocols.includes(protocol)
		) {
			throw error(404, 'Not found');
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
			vicalKv: platform?.env?.VICAL_KV,
			verifierOrigin: typeof verifierOrigin === 'string' ? verifierOrigin : undefined,
			dcApiJwkThumbprint:
				typeof jwkThumbprint === 'string' ? base64UrlDecode(jwkThumbprint) : undefined
		});

		if (!result.success) {
			console.error('[mDL Verify] Verification failed:', result.error, result.message);
			return json(
				{
					error: result.error,
					message: result.message,
					...(result.supportedStates && { supportedStates: result.supportedStates })
				},
				{ status: 422 }
			);
		}

		// Identity commitment is guaranteed present on success (missing fields = hard failure)
		if (!result.identityCommitment) {
			return json(
				{
					error: 'missing_identity_fields',
					message: 'Wallet must disclose birth date and document number'
				},
				{ status: 422 }
			);
		}
		const identityCommitment = result.identityCommitment;

		// Server-only finalizer: bind identity commitment for Sybil detection and
		// apply the mDL tier upgrade in the same internal Convex mutation. This
		// also handles account-merge flows where the canonical user differs from
		// the authenticated session user.
		const now = Date.now();
		let bindingResult;
		try {
			bindingResult = await serverMutation(internal.users.finalizeMdlVerification, {
				userId: session.userId as any,
				identityCommitment,
				credentialHash: result.credentialHash,
				nonce,
				protocol,
				sessionChannel: 'digital-credentials',
				verifiedAt: now,
				addressVerificationMethod: 'mdl',
				documentType: 'mdl'
			});
		} catch (err) {
			if (isMdlCredentialReuseError(err)) {
				return json(
					{
						error: 'credential_reuse_detected',
						message: 'This wallet presentation was already used. Start a new verification session.'
					},
					{ status: 409 }
				);
			}
			throw err;
		}

		// Use the canonical userId after potential merge
		const canonicalUserId = bindingResult.userId;

		if (bindingResult.linkedToExisting) {
			console.log('[mDL Verify] Account merged:', {
				from: session.userId,
				to: canonicalUserId,
				accountsMoved: bindingResult.mergeDetails?.accountsMoved
			});
		}

		console.log('[mDL Verify] Success:', {
			userId: canonicalUserId,
			district: result.district,
			state: result.state,
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

function base64UrlDecode(value: string): Uint8Array {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
