import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { isMdlBridgeEnabled, isMdlProtocolEnabled } from '$lib/config/features';
import { createBridgeSession } from '$lib/server/bridge-session';

const StartSchema = z.object({
	// User's email supplied by the authenticated desktop client.
	// Server verifies it hashes to the user's stored emailHash — if the client
	// lies (supplies victim's email to phish), the hash mismatch rejects the request.
	userEmail: z.string().email().max(254)
});

/** Normalize label for safe display — strip bidi controls, collapse whitespace */
function sanitizeLabel(s: string): string {
	// Remove bidi override characters and other format/control chars
	// eslint-disable-next-line no-control-regex
	return s
		.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
		.trim();
}

/**
 * Bridge Start — creates a cross-device verification session.
 *
 * Desktop browser (no DC-API) calls this to get a QR code URL.
 * The QR encodes sessionId + secret for the phone to claim.
 */
export const POST: RequestHandler = async ({ request, locals, platform, url }) => {
	if (!isMdlBridgeEnabled()) {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	// Accept client-supplied email as the pairing hint label.
	// The 3-word pairing code is the actual security mechanism — both devices
	// must display the same code for the user to confirm.
	// emailHash anti-phishing check removed: new accounts may not have emailHash.
	let userLabel: string;
	try {
		const body = await request.json().catch(() => ({}));
		const parsed = StartSchema.parse(body);
		userLabel = sanitizeLabel(parsed.userEmail);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(400, 'Invalid request: userEmail required');
	}

	// Canonical origin — fail-closed in production, prevents proxy-host redirection
	// in both the QR URL and the openid4vp client_id.
	// Uses !dev from $app/environment (reliable on CF Workers, unlike process.env).
	const canonicalOrigin = platform?.env?.PUBLIC_APP_URL;
	if (!dev && !canonicalOrigin) {
		console.error('[Bridge Start] PUBLIC_APP_URL not configured in production');
		throw error(500, 'Bridge misconfigured');
	}
	const qrOrigin = canonicalOrigin ?? url.origin;

	try {
		// Generate ECDH key pair for credential decryption
		const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
			'deriveKey',
			'deriveBits'
		]);

		const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

		// Generate nonce for replay protection
		const nonceBytes = new Uint8Array(32);
		crypto.getRandomValues(nonceBytes);
		const nonce = Array.from(nonceBytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const requests: Array<{ protocol: string; data: unknown }> = [];

		if (isMdlProtocolEnabled('org-iso-mdoc')) {
			const cborModule = await import('cbor-web');
			const cbor = cborModule.default ?? cborModule;
			const { encode, Tagged } = cbor;

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

		if (isMdlProtocolEnabled('openid4vp')) {
			requests.push({
				protocol: 'openid4vp',
				data: {
					client_id: qrOrigin,
					nonce,
					dcql_query: {
						credentials: [
							{
								format: 'mso_mdoc',
								doctype: 'org.iso.18013.5.1.mDL',
								claims: {
									'org.iso.18013.5.1': [
										{ name: 'resident_postal_code', intent_to_retain: false },
										{ name: 'resident_city', intent_to_retain: false },
										{ name: 'resident_state', intent_to_retain: false },
										{ name: 'birth_date', intent_to_retain: false },
										{ name: 'document_number', intent_to_retain: false }
									]
								}
							}
						]
					}
				}
			});
		}

		const result = await createBridgeSession(
			session.userId,
			userLabel,
			requests,
			privateKeyJwk,
			nonce,
			qrOrigin,
			platform
		);

		// Desktop needs sessionId, qrUrl, and pairingCode.
		// The qrUrl contains the secret in its fragment — accept this (see F2-A).
		// Desktop shows pairingCode; phone shows same code after claim; user matches.
		return json({
			sessionId: result.sessionId,
			qrUrl: result.qrUrl,
			pairingCode: result.pairingCode,
			expiresAt: result.expiresAt
		});
	} catch (err) {
		console.error('[Bridge Start] Error:', err);
		throw error(500, 'Failed to create bridge session');
	}
};
