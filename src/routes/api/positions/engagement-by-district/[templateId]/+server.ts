/**
// CONVEX: Keep SvelteKit
 * Engagement by District Endpoint — Community Field MVP
 *
 * GET: Return per-district position breakdown for a template.
 * Public endpoint — no authentication required.
 * Returns only aggregate counts with privacy threshold (min 3 positions per district).
 *
 * Query params:
 *   - userDistrict (optional): highlights the user's own district in response
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const { templateId } = params;

		if (!templateId) {
			return json({ error: 'Missing templateId' }, { status: 400 });
		}

		const userDistrict = url.searchParams.get('userDistrict') ?? undefined;
		const engagement = await serverQuery(api.positions.getFullEngagementByDistrict, {
			templateId: templateId as any,
			userDistrictCode: userDistrict
		});

		if (!engagement) {
			return json({
				template_id: templateId,
				districts: [],
				aggregate: { total_districts: 0, total_positions: 0, total_support: 0, total_oppose: 0 }
			});
		}

		// Tag user's district if provided
		const districts = engagement.districts.map((d) => ({
			...d,
			is_user_district: userDistrict ? d.district_code === userDistrict : false
		}));

		return json({
			template_id: templateId,
			districts,
			aggregate: engagement.aggregate
		});
	} catch (err) {
		console.error('[Engagement by District] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message =
			err instanceof Error ? err.message : 'Failed to get engagement by district';
		throw error(500, message);
	}
};
