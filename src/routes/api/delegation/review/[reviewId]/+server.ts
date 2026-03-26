import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';

/**
 * PATCH /api/delegation/review/[reviewId]
 *
 * Approve or reject a pending delegation review.
 *
 * Body: { decision: 'approve' | 'reject' }
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	const body = await request.json();
	const { decision } = body;

	if (!decision || !['approve', 'reject'].includes(decision)) {
		throw error(400, "Decision must be 'approve' or 'reject'");
	}

	const result = await serverMutation(internal.v1api.submitDelegationReview, {
		reviewId: params.reviewId,
		userId: session.userId,
		decision
	});

	if (!result) throw error(404, 'Review not found');
	if ('forbidden' in result && result.forbidden) throw error(403, 'Not authorized to review this action');
	if ('alreadyDecided' in result && result.alreadyDecided) throw error(400, 'Review already decided');

	return json(result);
};
