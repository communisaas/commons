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
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const result = await serverQuery(api.users.getWalletStatus, {});

	if (!result) {
		throw error(404, 'User not found');
	}

	return json(result);
};
