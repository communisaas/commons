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

	// bound each per-rep string. Without these, an attacker
	// could submit 100 reps × 10 fields × megabytes each before downstream
	// rejected. Generous caps cover real-world ID/name/URL lengths.
	function bound(value: unknown, max: number): string | undefined {
		if (value === undefined || value === null || value === '') return undefined;
		if (typeof value !== 'string' || value.length > max) {
			throw error(400, `representative field exceeds ${max} characters`);
		}
		return value;
	}
	function require_(value: unknown, max: number): string {
		const v = bound(value, max);
		return v ?? '';
	}

	const result = await serverMutation(api.legislation.importRepresentatives, {
		slug: params.slug,
		representatives: representatives.map((r: any) => ({
			countryCode: require_(r.countryCode, 8),
			constituencyId: require_(r.constituencyId, 128),
			constituencyName: require_(r.constituencyName, 200),
			name: require_(r.name, 200),
			party: bound(r.party, 100),
			office: bound(r.office, 200),
			phone: bound(r.phone, 32),
			email: bound(r.email, 254),
			websiteUrl: bound(r.websiteUrl, 2048),
			photoUrl: bound(r.photoUrl, 2048)
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
