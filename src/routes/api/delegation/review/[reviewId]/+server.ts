import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';

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

	const review = await prisma.delegationReview.findUnique({
		where: { id: params.reviewId },
		include: {
			grant: {
				select: { userId: true }
			}
		}
	});

	if (!review) {
		throw error(404, 'Review not found');
	}

	if (review.grant.userId !== session.userId) {
		throw error(403, 'Not authorized to review this action');
	}

	if (review.decision !== null) {
		throw error(400, 'Review already decided');
	}

	await prisma.delegationReview.update({
		where: { id: params.reviewId },
		data: {
			decision,
			decidedAt: new Date()
		}
	});

	return json({ message: `Review ${decision}d` });
};
