import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePolicy } from '$lib/server/delegation/parse-policy';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/delegation/parse-policy
 *
 * Parse natural language policy text into structured delegation constraints.
 * Requires auth + Trust Tier 3+.
 *
 * Body: { policyText: string }
 * Returns: { scope, issueFilter, orgFilter, maxActionsPerDay, requireReviewAbove }
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
	const { policyText } = body;

	if (!policyText || typeof policyText !== 'string' || policyText.trim().length < 5) {
		throw error(400, 'Policy text must be at least 5 characters');
	}
	if (policyText.length > 5000) {
		throw error(400, 'Policy text must not exceed 5000 characters');
	}

	try {
		const parsed = await parsePolicy(policyText.trim());
		return json({ policy: parsed });
	} catch (err) {
		console.error('[delegation/parse-policy] Parse failed:', err);
		throw error(500, 'Failed to parse policy. Please try rephrasing.');
	}
};
