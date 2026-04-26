import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import {
	OPENID4VP_DC_API_PROTOCOL,
	isAnyMdlProtocolEnabled,
	isMdlProtocolEnabled
} from '$lib/config/features';
import { normalizeDcApiWebOrigin } from '$lib/core/identity/oid4vp-dc-api-handover';
import { devSessionStore } from '../_dev-session-store';

/**
 * mDL Verification Start Endpoint
 *
 * Generates an ephemeral ECDH key pair and builds dual-protocol
 * request configurations for the Digital Credentials API.
 *
 * The private key is stored in Workers KV with 5-min TTL.
 * The public key + request configs are returned to the client.
 *
 * Android-first launch gate: returns only protocols that are safe to operate.
 * OpenID4VP is enabled for Android. Raw org-iso-mdoc stays off until T3
 * DeviceAuth verification ships.
 */
export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!isAnyMdlProtocolEnabled()) {
		throw error(404, 'Not found');
	}

	// Authentication check
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const canonicalOrigin = platform?.env?.PUBLIC_APP_URL;
	if (!dev && !canonicalOrigin) {
		console.error('[mDL Start] PUBLIC_APP_URL not configured in production');
		throw error(500, 'mDL verifier misconfigured');
	}
	const verifierOrigin = normalizeDcApiWebOrigin(canonicalOrigin ?? url.origin, {
		allowLocalhostHttp: dev
	});

	try {
		// Generate ephemeral ECDH key pair for session encryption
		const keyPair = await crypto.subtle.generateKey(
			{ name: 'ECDH', namedCurve: 'P-256' },
			true, // extractable (need to store private key in KV)
			['deriveKey', 'deriveBits']
		);

		// Generate unique nonce for this verification session
		const nonceBytes = new Uint8Array(32);
		crypto.getRandomValues(nonceBytes);
		const nonce = Array.from(nonceBytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// Export private key for KV storage (used by verify endpoint for HPKE decryption)
		const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

		// Store private key in Workers KV with 5-min TTL
		const kvKey = `mdl-session:${nonce}`;
		const sessionData = JSON.stringify({
			privateKeyJwk,
			userId: session.userId,
			origin: verifierOrigin,
			createdAt: Date.now()
		});

		const kv = platform?.env?.DC_SESSION_KV;
		if (kv) {
			await kv.put(kvKey, sessionData, { expirationTtl: 300 }); // 5 minutes
		} else {
			// Dev fallback: use in-memory store
			// In production, KV is required
			console.warn('[mDL Start] DC_SESSION_KV not available -- using dev fallback');
			devSessionStore.set(kvKey, { data: sessionData, expires: Date.now() + 300_000 });
		}

		const requests: Array<{ protocol: string; data: unknown }> = [];

		if (isMdlProtocolEnabled('org-iso-mdoc')) {
			// org-iso-mdoc: CBOR-encoded DeviceRequest per ISO 18013-5 §8.3.2.1.2
			const cborModule = await import('cbor-web');
			const cbor = cborModule.default ?? cborModule;
			const { encode, Tagged } = cbor;

			// ItemsRequest: what we're asking the wallet to disclose.
			const itemsRequest = new Map<string, unknown>([
				['docType', 'org.iso.18013.5.1.mDL'],
				[
					'nameSpaces',
					new Map([
						[
							'org.iso.18013.5.1',
							new Map<string, boolean>([
								['resident_postal_code', false],
								['resident_city', false],
								['resident_state', false],
								['birth_date', false],
								['document_number', false]
							])
						]
					])
				]
			]);

			const itemsRequestBytes = encode(itemsRequest);
			const taggedItemsRequest = new Tagged(24, new Uint8Array(itemsRequestBytes));
			const docRequest = new Map<string, unknown>([['itemsRequest', taggedItemsRequest]]);
			const deviceRequest = new Map<string, unknown>([
				['version', '1.0'],
				['docRequests', [docRequest]]
			]);

			const deviceRequestBytes = encode(deviceRequest);
			const deviceRequestB64 = btoa(String.fromCharCode(...new Uint8Array(deviceRequestBytes)));
			requests.push({ protocol: 'org-iso-mdoc', data: deviceRequestB64 });
		}

		if (isMdlProtocolEnabled(OPENID4VP_DC_API_PROTOCOL)) {
			requests.push({
				protocol: OPENID4VP_DC_API_PROTOCOL,
				data: {
					response_type: 'vp_token',
					response_mode: 'dc_api',
					nonce,
					dcql_query: {
						credentials: [
							{
								id: 'mdl',
								format: 'mso_mdoc',
								meta: { doctype_value: 'org.iso.18013.5.1.mDL' },
								claims: [
									{
										id: 'resident_postal_code',
										path: ['org.iso.18013.5.1', 'resident_postal_code'],
										intent_to_retain: false
									},
									{
										id: 'resident_city',
										path: ['org.iso.18013.5.1', 'resident_city'],
										intent_to_retain: false
									},
									{
										id: 'resident_state',
										path: ['org.iso.18013.5.1', 'resident_state'],
										intent_to_retain: false
									},
									{
										id: 'birth_date',
										path: ['org.iso.18013.5.1', 'birth_date'],
										intent_to_retain: false
									},
									{
										id: 'document_number',
										path: ['org.iso.18013.5.1', 'document_number'],
										intent_to_retain: false
									}
								]
							}
						]
					}
				}
			});
		}

		return json({
			requests,
			nonce,
			expiresAt: Date.now() + 300_000 // 5 min TTL matches KV
		});
	} catch (err) {
		console.error('[mDL Start] Error:', err);
		throw error(500, 'Failed to initialize mDL verification');
	}
};
