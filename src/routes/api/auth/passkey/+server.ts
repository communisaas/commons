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
import { serverMutation } from 'convex-sveltekit';
import { api } from '$convex/_generated/api';

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	try {
		await serverMutation(api.users.clearPasskey, { userId: locals.user.id });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('No passkey registered')) {
			throw error(404, 'No passkey registered');
		}
		throw error(500, 'Failed to remove passkey');
	}

	return json({ success: true });
};
