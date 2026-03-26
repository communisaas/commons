/**
 * Alert Preferences Endpoint
 *
 * GET/PATCH org-configurable alert thresholds.
 *
 * Fields:
 * - minRelevanceScore: number (default 0.6, range 0.5-1.0)
 * - digestOnly: boolean (default false — if true, only weekly digest)
 * - autoArchiveDays: number (default 30)
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** GET /api/org/[slug]/settings/alert-preferences */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const prefs = await serverQuery(api.legislation.getAlertPreferences, {
		slug: params.slug
	});
	return json(prefs);
};

/** PATCH /api/org/[slug]/settings/alert-preferences */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();

	const result = await serverMutation(api.legislation.updateAlertPreferences, {
		slug: params.slug,
		minRelevanceScore: body.minRelevanceScore ?? undefined,
		digestOnly: body.digestOnly ?? undefined,
		autoArchiveDays: body.autoArchiveDays ?? undefined
	});
	return json(result);
};
