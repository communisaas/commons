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
import { getEngagementByDistrict } from '$lib/services/positionService';
import { prisma } from '$lib/core/db';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const { templateId } = params;

		if (!templateId) {
			return json({ error: 'Missing templateId' }, { status: 400 });
		}

		// Verify template exists and is public
		const template = await prisma.template.findUnique({
			where: { id: templateId },
			select: { id: true, is_public: true }
		});

		if (!template) {
			return json({ error: 'Template not found' }, { status: 404 });
		}

		const userDistrict = url.searchParams.get('userDistrict');
		const engagement = await getEngagementByDistrict(templateId);

		if (!engagement) {
			return json({ template_id: templateId, districts: [], aggregate: { total_districts: 0, total_positions: 0, total_support: 0, total_oppose: 0 } });
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
