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

	// typed bounds on each preference field at the boundary.
	if (
		body.minRelevanceScore !== undefined &&
		body.minRelevanceScore !== null &&
		(typeof body.minRelevanceScore !== 'number' ||
			!Number.isFinite(body.minRelevanceScore) ||
			body.minRelevanceScore < 0 ||
			body.minRelevanceScore > 1)
	) {
		throw error(400, 'minRelevanceScore must be a number 0-1');
	}
	if (body.digestOnly !== undefined && body.digestOnly !== null && typeof body.digestOnly !== 'boolean') {
		throw error(400, 'digestOnly must be a boolean');
	}
	if (
		body.autoArchiveDays !== undefined &&
		body.autoArchiveDays !== null &&
		(typeof body.autoArchiveDays !== 'number' ||
			!Number.isInteger(body.autoArchiveDays) ||
			body.autoArchiveDays < 1 ||
			body.autoArchiveDays > 365)
	) {
		throw error(400, 'autoArchiveDays must be an integer 1-365');
	}

	const result = await serverMutation(api.legislation.updateAlertPreferences, {
		slug: params.slug,
		minRelevanceScore: body.minRelevanceScore ?? undefined,
		digestOnly: body.digestOnly ?? undefined,
		autoArchiveDays: body.autoArchiveDays ?? undefined
	});
	return json(result);
};
