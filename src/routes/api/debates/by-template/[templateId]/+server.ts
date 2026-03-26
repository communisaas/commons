import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * GET /api/debates/by-template/[templateId]
 *
 * Returns the most recent debate for a template (active preferred over resolved).
 * Includes arguments sorted by weighted_score descending.
 *
 * Response: { debate: DebateData | null }
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { templateId } = params;

	if (!templateId) {
		throw error(400, 'templateId is required');
	}

	const result = await serverQuery(api.debates.getFullByTemplateId, {
		templateId: templateId as any
	});
	return json({ debate: result ?? null });
};
