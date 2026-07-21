/**
 * Direct delivery persistence is intentionally paused for launch containment.
 *
 * Keep the authenticated route mounted so older clients receive an explicit,
 * retryable service response, but never consume their request body or touch
 * Convex while the durable admission contract is being hardened.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const NO_STORE_HEADERS = {
	'Cache-Control': 'private, no-store'
};

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.session?.userId) {
		return json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE_HEADERS });
	}

	return json(
		{ error: 'Delivery recording is temporarily unavailable' },
		{ status: 503, headers: NO_STORE_HEADERS }
	);
};
