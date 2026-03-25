/**
 * Passkey Management Endpoint
 *
 * DELETE: Remove the user's registered passkey.
 *   - Requires authenticated session
 *   - Clears passkey_credential_id, passkey_public_key_jwk, passkey_created_at, passkey_last_used_at
 *   - Does NOT change trust_tier (trust tier is derived from multiple factors)
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const user = await db.user.findUnique({
		where: { id: locals.user.id },
		select: { passkey_credential_id: true }
	});

	if (!user?.passkey_credential_id) {
		throw error(404, 'No passkey registered');
	}

	await db.user.update({
		where: { id: locals.user.id },
		data: {
			passkey_credential_id: null,
			passkey_public_key_jwk: null,
			passkey_created_at: null,
			passkey_last_used_at: null,
			did_key: null
		}
	});

	return json({ success: true });
};
