import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
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

	const result = await serverMutation(api.campaigns.recordResponse, {
		slug: params.slug,
		campaignId: params.campaignId as any,
		deliveryId,
		type,
		detail
	});
	return json(result, { status: 201 });
};
