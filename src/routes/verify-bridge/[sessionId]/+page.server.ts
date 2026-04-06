import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBridgeSession } from '$lib/server/bridge-session';

/**
 * Bridge Verification Page — server load.
 *
 * Minimal data exposed without auth. The secret is in the URL fragment
 * (client-side only). The mDL request configs and nonce are NOT returned
 * here — they come back from /api/identity/bridge/claim after HMAC proof.
 *
 * We only return pairingCode so the user can visually verify the session
 * matches the code on their desktop before touching their wallet.
 */
export const load: PageServerLoad = async ({ params, platform }) => {
	const { sessionId } = params;

	if (!sessionId) {
		throw error(400, 'Invalid verification link');
	}

	const session = await getBridgeSession(sessionId, platform);

	if (!session) {
		throw error(410, 'This verification link has expired. Scan a new QR code from your desktop.');
	}

	if (session.status !== 'pending' && session.status !== 'claimed') {
		throw error(409, 'This link has already been used.');
	}

	// Do NOT expose the user's email or pairing code here — they're PII and
	// should only be visible to someone who proves possession of the QR secret.
	// Both are returned in the HMAC-authenticated /bridge/claim response.
	return {
		sessionId
	};
};
