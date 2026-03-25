import { redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { decryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
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

	// Load grants, pending reviews, and recent actions
	const grantsPromise = db.delegationGrant.findMany({
		where: { userId },
		orderBy: { createdAt: 'desc' },
		include: {
			_count: {
				select: { actions: true, reviewQueue: true }
			}
		}
	});

	const pendingReviewsPromise = db.delegationReview.findMany({
		where: {
			grant: { userId },
			decision: null
		},
		include: {
			grant: { select: { id: true, scope: true } }
		},
		orderBy: { createdAt: 'desc' },
		take: 20
	});

	const recentActionsPromise = db.delegatedAction.findMany({
		where: {
			grant: { userId }
		},
		include: {
			grant: { select: { id: true, scope: true } }
		},
		orderBy: { createdAt: 'desc' },
		take: 20
	});

	const [grants, pendingReviews, recentActions] = await Promise.all([
		grantsPromise,
		pendingReviewsPromise,
		recentActionsPromise
	]);

	// Decrypt policy text on each grant
	const decryptedGrants = await Promise.all(
		grants.map(async (grant) => {
			let policyText = grant.policyText;
			try {
				const parsed = JSON.parse(grant.policyText) as EncryptedPii;
				if (parsed.ciphertext && parsed.iv) {
					policyText = await decryptPii(parsed, grant.userId, 'policy');
				}
			} catch {
				// Not encrypted — use as-is
			}

			return {
				id: grant.id,
				scope: grant.scope,
				policyText,
				issueFilter: grant.issueFilter,
				orgFilter: grant.orgFilter,
				maxActionsPerDay: grant.maxActionsPerDay,
				requireReviewAbove: grant.requireReviewAbove,
				status: grant.status,
				totalActions: grant.totalActions,
				lastActionAt: grant.lastActionAt,
				expiresAt: grant.expiresAt,
				createdAt: grant.createdAt,
				actionCount: grant._count.actions,
				pendingReviewCount: grant._count.reviewQueue
			};
		})
	);

	return {
		user: {
			id: userId,
			name: locals.user.name,
			trust_tier: trustTier
		},
		grants: decryptedGrants,
		pendingReviews: pendingReviews.map((r) => ({
			id: r.id,
			grantId: r.grantId,
			grantScope: r.grant.scope,
			targetId: r.targetId,
			targetTitle: r.targetTitle,
			reasoning: r.reasoning,
			proofWeight: r.proofWeight,
			createdAt: r.createdAt
		})),
		recentActions: recentActions.map((a) => ({
			id: a.id,
			grantId: a.grantId,
			grantScope: a.grant.scope,
			actionType: a.actionType,
			targetTitle: a.targetTitle,
			reasoning: a.reasoning,
			relevanceScore: a.relevanceScore,
			stanceAlignment: a.stanceAlignment,
			status: a.status,
			createdAt: a.createdAt
		})),
		gated: false
	};
};
