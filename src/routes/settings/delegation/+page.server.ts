import { redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const userId = locals.user.id;
	const trustTier = locals.user.trust_tier ?? 0;

	// If below Tier 3, return early with gate info
	if (trustTier < 3) {
		return {
			user: {
				id: userId,
				name: locals.user.name,
				trust_tier: trustTier
			},
			grants: [],
			pendingReviews: [],
			recentActions: [],
			gated: true
		};
	}

	const convexGrants = await serverQuery(api.delegation.listGrants, {});

	// Flatten pending reviews and recent actions from grants
	const pendingReviews: Array<Record<string, unknown>> = [];
	const recentActions: Array<Record<string, unknown>> = [];

	for (const grant of convexGrants) {
		const g = grant as Record<string, unknown>;
		for (const review of (g.pendingReviews as Array<Record<string, unknown>>) ?? []) {
			pendingReviews.push({
				id: review._id,
				grantId: g._id,
				grantScope: g.scope,
				targetId: review.targetId ?? null,
				targetTitle: review.targetTitle,
				reasoning: review.reasoning,
				proofWeight: review.proofWeight,
				createdAt: typeof review._creationTime === 'number'
					? new Date(review._creationTime as number).toISOString()
					: review._creationTime
			});
		}
		for (const action of (g.recentActions as Array<Record<string, unknown>>) ?? []) {
			recentActions.push({
				id: action._id,
				grantId: g._id,
				grantScope: g.scope,
				actionType: action.actionType,
				targetTitle: action.targetTitle,
				reasoning: '',
				relevanceScore: action.relevanceScore,
				stanceAlignment: null,
				status: action.status,
				createdAt: typeof action._creationTime === 'number'
					? new Date(action._creationTime as number).toISOString()
					: action._creationTime
			});
		}
	}

	return {
		user: {
			id: userId,
			name: locals.user.name,
			trust_tier: trustTier
		},
		grants: convexGrants.map((g: Record<string, unknown>) => ({
			id: g._id,
			scope: g.scope,
			policyText: g.policyText,
			issueFilter: g.issueFilter,
			orgFilter: g.orgFilter,
			maxActionsPerDay: g.maxActionsPerDay,
			requireReviewAbove: g.requireReviewAbove,
			status: g.status,
			totalActions: g.totalActions,
			lastActionAt: g.lastActionAt,
			expiresAt: g.expiresAt ?? null,
			createdAt: typeof g._creationTime === 'number'
				? new Date(g._creationTime as number).toISOString()
				: g._creationTime,
			actionCount: ((g.recentActions as unknown[]) ?? []).length,
			pendingReviewCount: ((g.pendingReviews as unknown[]) ?? []).length
		})),
		pendingReviews,
		recentActions,
		gated: false
	};
};
