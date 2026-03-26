/**
 * Wallet Disconnect Endpoint
 *
 * Unbinds the EVM wallet from the authenticated user's account by clearing
 * wallet_address and wallet_type fields. Does NOT touch NEAR fields — the
 * NEAR account is auto-provisioned and should persist independently.
 *
 * DELETE /api/wallet/disconnect
 * Requires: authenticated session (locals.user)
 * Body: none (wallet to unbind is inferred from the authenticated user)
 * Returns: { success: true }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		await serverMutation(api.users.disconnectWallet, {});
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('No wallet connected')) {
			return json({ error: 'No wallet connected' }, { status: 400 });
		}
		console.error('[wallet-disconnect] Database error:', err);
		return json({ error: 'Failed to disconnect wallet' }, { status: 500 });
	}
};
