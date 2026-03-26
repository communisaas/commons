/**
 * POST /api/org/[slug]/representatives — Import international decision-makers.
 * GET  /api/org/[slug]/representatives — List decision-makers by country + constituency.
 */

import { json, error } from '@sveltejs/kit';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { representatives } = body;

	if (!Array.isArray(representatives) || representatives.length === 0) {
		throw error(400, 'representatives array is required');
	}

	if (representatives.length > 100) {
		throw error(400, 'Maximum 100 representatives per request');
	}

	const result = await serverMutation(api.legislation.importRepresentatives, {
		slug: params.slug,
		representatives: representatives.map((r: any) => ({
			countryCode: r.countryCode ?? '',
			constituencyId: r.constituencyId ?? '',
			constituencyName: r.constituencyName ?? '',
			name: r.name ?? '',
			party: r.party || undefined,
			office: r.office || undefined,
			phone: r.phone || undefined,
			email: r.email || undefined,
			websiteUrl: r.websiteUrl || undefined,
			photoUrl: r.photoUrl || undefined
		}))
	});
	return json({ success: true, data: result }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const countryCode = url.searchParams.get('country');
	const constituencyId = url.searchParams.get('constituency');
	const cursor = url.searchParams.get('cursor');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

	const result = await serverQuery(api.legislation.listRepresentatives, {
		slug: params.slug,
		country: countryCode ?? undefined,
		constituency: constituencyId ?? undefined,
		limit,
		cursor: cursor ?? undefined
	});
	return json({
		success: true,
		data: result.data,
		meta: {
			count: result.data.length,
			cursor: result.cursor ?? null,
			hasMore: result.hasMore
		}
	});
};
