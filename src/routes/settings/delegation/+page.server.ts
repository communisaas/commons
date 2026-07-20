import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type DelegationGrantView = {
	id: string;
	scope: string;
	policyText: string;
	issueFilter: string[];
	orgFilter: string[];
	maxActionsPerDay: number;
	requireReviewAbove: number;
	status: string;
	totalActions: number;
	lastActionAt?: number;
	expiresAt: number | null;
	createdAt: string | number;
	actionCount: number;
	pendingReviewCount: number;
};

type DelegationReviewView = {
	id: string;
	grantId: string;
	grantScope: string;
	targetId: string | null;
	targetTitle: string;
	reasoning: string;
	proofWeight: number;
	createdAt: string | number;
};

type DelegationActionView = {
	id: string;
	grantId: string;
	grantScope: string;
	actionType: string;
	targetTitle: string;
	reasoning: string;
	relevanceScore: number;
	stanceAlignment: null;
	status: string;
	createdAt: string | number;
};

type DelegationPagePayload = {
	user: { id: string; name?: string | null; trust_tier: number };
	grants: DelegationGrantView[];
	pendingReviews: DelegationReviewView[];
	recentActions: DelegationActionView[];
	gated: boolean;
};

/**
 * Delegation's Convex reads are launch tombstones with a `never` return type.
 * Keep the route equally fail-closed instead of casting that authority into a
 * fictitious grant array. The explicit payload return type preserves the page's
 * compile-time view model while the function itself always stops pre-I/O.
 */
function delegationNotLaunched(): DelegationPagePayload {
	throw error(404, 'Not found');
}

export const load = (async () => delegationNotLaunched()) satisfies PageServerLoad;
