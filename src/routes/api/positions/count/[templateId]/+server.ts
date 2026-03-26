/**
 * Position Count Endpoint — Power Landscape (Cycle 37)
 *
 * GET: Return aggregate position counts for a template.
 * Public endpoint — no authentication required.
 * Returns only aggregate counts, zero PII.
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const { templateId } = params;

		if (!templateId) {
			return json({ error: 'Missing templateId' }, { status: 400 });
		}

		const counts = await getPositionCounts(templateId);

		return json(counts);
	} catch (err) {
		console.error('[Position Count] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to get position counts';
		throw error(500, message);
	}
};
