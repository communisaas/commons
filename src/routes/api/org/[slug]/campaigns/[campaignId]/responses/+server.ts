import { json, error } from '@sveltejs/kit';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

const VALID_TYPES = ['replied', 'meeting_requested', 'vote_cast', 'public_statement'] as const;
type ManualResponseType = (typeof VALID_TYPES)[number];

/**
 * POST /api/org/[slug]/campaigns/[campaignId]/responses
 *
 * Log a manually-observed response from a decision-maker.
 * Body: { deliveryId, type, detail? }
 * Auth: editor+ role required.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	let body: { deliveryId?: string; type?: string; detail?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { deliveryId, type, detail } = body;

	if (!deliveryId || typeof deliveryId !== 'string') {
		throw error(400, 'deliveryId is required');
	}

	if (!type || !VALID_TYPES.includes(type as ManualResponseType)) {
		throw error(400, `type must be one of: ${VALID_TYPES.join(', ')}`);
	}

	// Validate deliveryId belongs to this campaign and org
	const delivery = await db.campaignDelivery.findFirst({
		where: {
			id: deliveryId,
			campaignId: params.campaignId,
			campaign: { orgId: org.id }
		},
		select: { id: true }
	});

	if (!delivery) {
		throw error(404, 'Delivery not found for this campaign');
	}

	const response = await db.reportResponse.create({
		data: {
			deliveryId,
			type,
			detail: detail?.trim()?.slice(0, 2000) || undefined,
			confidence: 'reported',
			occurredAt: new Date()
		}
	});

	return json({ id: response.id }, { status: 201 });
};
