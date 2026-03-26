import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';

const VALID_SCOPES = ['campaign_sign', 'debate_position', 'message_generate', 'full'] as const;

/**
 * GET /api/delegation
 *
 * List user's delegation grants. Requires auth + Trust Tier 3+.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	const result = await serverQuery(api.delegation.listGrants, {});
	return json({ grants: result });
};

/**
 * POST /api/delegation
 *
 * Create a new delegation grant. Requires auth + Trust Tier 3+.
 *
 * Body: { scope, policyText, issueFilter?, orgFilter?, stanceProfileId?,
 *         maxActionsPerDay?, requireReviewAbove?, expiresAt? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
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
	const {
		scope,
		policyText,
		issueFilter,
		orgFilter,
		stanceProfileId,
		maxActionsPerDay,
		requireReviewAbove,
		expiresAt
	} = body;

	// Validate scope
	if (!scope || !VALID_SCOPES.includes(scope)) {
		throw error(400, `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}`);
	}

	// Validate policy text
	if (!policyText || typeof policyText !== 'string' || policyText.trim().length < 5) {
		throw error(400, 'Policy text must be at least 5 characters');
	}
	if (policyText.length > 5000) {
		throw error(400, 'Policy text must not exceed 5000 characters');
	}

	const result = await serverAction(api.delegation.createGrant, {
		scope,
		policyText: policyText.trim(),
		issueFilter: issueFilter || undefined,
		orgFilter: orgFilter || undefined,
		stanceProfileId: stanceProfileId || undefined,
		maxActionsPerDay: maxActionsPerDay ?? undefined,
		requireReviewAbove: requireReviewAbove ?? undefined,
		expiresAt: expiresAt ? new Date(expiresAt).getTime() : undefined
	});
	return json({ grant: result }, { status: 201 });
};
