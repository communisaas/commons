/**
 * Wallet Status Endpoint
 *
 * GET /api/wallet/status
 *
 * Returns wallet address fields for the authenticated user.
 * Requires authentication — wallet addresses are PII that should not
 * be broadcast via the root layout to every page.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const user = await db.user.findUnique({
		where: { id: locals.user.id },
		select: {
			wallet_address: true,
			wallet_type: true,
			near_derived_scroll_address: true
		}
	});

	if (!user) {
		throw error(404, 'User not found');
	}

	return json({
		wallet_address: user.wallet_address ?? null,
		wallet_type: user.wallet_type ?? null,
		near_derived_scroll_address: user.near_derived_scroll_address ?? null
	});
};
