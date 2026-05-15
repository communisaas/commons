/**
 * GET /api/e/[id]/stats — Public live stats for an event
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	const result = await serverQuery(api.v1api.getEventStats, {
 _secret: getInternalSecret(), eventId: params.id});
	if (!result) throw error(404, 'Event not found');

	return json(result);
};
