import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { isMdlBridgeEnabled } from '$lib/config/features';
import {
	getBridgeSession,
	claimBridgeSessionBestEffort,
	verifyHmac
} from '$lib/server/bridge-session';

const ClaimSchema = z.object({
	sessionId: z.string().uuid(),
	hmac: z.string().min(32).max(128)
});

/**
 * Bridge Claim — phone claims a bridge session.
 *
 * HMAC proves possession of the QR secret without transmitting it.
 * Server retrieves secret from KV, verifies HMAC, transitions
 * status pending → claimed (best-effort; KV is eventually consistent).
 * Returns nothing sensitive.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	if (!isMdlBridgeEnabled()) {
		throw error(404, 'Not found');
	}

	try {
		const body = await request.json();
		let input;
		try {
			input = ClaimSchema.parse(body);
		} catch (e) {
			if (e instanceof z.ZodError)
				throw error(400, `Invalid request: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}

		const session = await getBridgeSession(input.sessionId, platform);
		if (!session) {
			throw error(410, 'Bridge session expired or not found');
		}

		// Verify HMAC using secret from KV (never from client)
		const hmacValid = await verifyHmac(session.secret, input.hmac, input.sessionId, 'claim');
		if (!hmacValid) {
			throw error(403, 'Invalid HMAC — request integrity check failed');
		}

		// Best-effort transition (returns false if already claimed)
		const claimed = await claimBridgeSessionBestEffort(input.sessionId, platform);
		if (!claimed) {
			throw error(409, 'This link has already been used.');
		}

		// Return everything sensitive only after HMAC proof:
		// - mDL request configs + nonce (for wallet request)
		// - pairing code (for visual match with desktop)
		// - desktop user label/email (for anti-phishing confirmation)
		return json({
			success: true,
			requests: session.requests,
			nonce: session.nonce,
			pairingCode: session.pairingCode,
			desktopUserLabel: session.desktopUserLabel
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Bridge Claim] Error:', err);
		throw error(500, 'Failed to claim bridge session');
	}
};
