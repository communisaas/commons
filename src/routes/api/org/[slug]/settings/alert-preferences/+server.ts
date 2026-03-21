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
import { loadOrgContext, requireRole } from '$lib/server/org';
import {
	getAlertPreferences,
	saveAlertPreferences
} from '$lib/server/legislation/alerts/preferences';
import type { RequestHandler } from './$types';

/** GET /api/org/[slug]/settings/alert-preferences */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const prefs = await getAlertPreferences(org.id);
	return json(prefs);
};

/** PATCH /api/org/[slug]/settings/alert-preferences */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const body = await request.json();
	const current = await getAlertPreferences(org.id);

	if (typeof body.minRelevanceScore === 'number' && Number.isFinite(body.minRelevanceScore)) {
		current.minRelevanceScore = Math.min(1.0, Math.max(0.5, body.minRelevanceScore));
	}
	if (typeof body.digestOnly === 'boolean') {
		current.digestOnly = body.digestOnly;
	}
	if (typeof body.autoArchiveDays === 'number' && Number.isFinite(body.autoArchiveDays)) {
		current.autoArchiveDays = Math.min(365, Math.max(1, Math.round(body.autoArchiveDays)));
	}

	await saveAlertPreferences(org.id, current);

	return json(current);
};
