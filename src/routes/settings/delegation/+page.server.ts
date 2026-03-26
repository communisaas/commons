import { redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { decryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexGrants = await serverQuery(api.delegation.listGrants, {});

			console.log(`[Delegation] Convex: loaded ${convexGrants.length} grants`);

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
		} catch (err) {
			console.error('[Delegation] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

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
