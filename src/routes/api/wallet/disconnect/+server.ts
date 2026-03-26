/**
// CONVEX: Keep SvelteKit
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
import { db } from '$lib/core/db';

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		// Read current user to verify they have a wallet bound
		const user = await db.user.findUnique({
			where: { id: locals.user.id },
			select: { wallet_address: true }
		});

		if (!user || !user.wallet_address) {
			return json({ error: 'No wallet connected' }, { status: 400 });
		}

		// Clear wallet fields — frees the unique constraint so the address
		// can be bound to another account later
		await db.user.update({
			where: { id: locals.user.id },
			data: {
				wallet_address: null,
				wallet_type: null
			}
		});

		return json({ success: true });
	} catch (err) {
		console.error('[wallet-disconnect] Database error:', err);
		return json({ error: 'Failed to disconnect wallet' }, { status: 500 });
	}
};
