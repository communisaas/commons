import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePolicy } from '$lib/server/delegation/parse-policy';
import { FEATURES } from '$lib/config/features';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { enforceLLMRateLimit, rateLimitResponse } from '$lib/server/llm-cost-protection';

// Sized for the 5,000-character policy allowance at the UTF-8 worst case
// (4 bytes/char) plus JSON envelope overhead; the character cap is enforced
// below.
const MAX_POLICY_REQUEST_BYTES = 24 * 1024;

/**
 * POST /api/delegation/parse-policy
 *
 * Parse natural language policy text into structured delegation constraints.
 * Requires auth + Trust Tier 3+.
 *
 * Body: { policyText: string }
 * Returns: { scope, issueFilter, orgFilter, maxActionsPerDay, requireReviewAbove }
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	let body: unknown;
	try {
		body = await readBoundedJsonRequest(request, MAX_POLICY_REQUEST_BYTES, {
			maxArrayItems: 1,
			maxDepth: 2,
			maxNodes: 4,
			maxObjectKeys: 2,
			maxStringBytes: 20_000
		});
	} catch (cause) {
		if (cause instanceof BoundedJsonRequestError) throw error(cause.status, cause.message);
		throw error(400, 'Invalid request body');
	}
	const policyText =
		body !== null && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>).policyText
			: undefined;

	if (!policyText || typeof policyText !== 'string' || policyText.trim().length < 5) {
		throw error(400, 'Policy text must be at least 5 characters');
	}
	if (policyText.length > 5000) {
		throw error(400, 'Policy text must not exceed 5000 characters');
	}

	const rateLimitCheck = await enforceLLMRateLimit(event, 'delegation-policy');
	if (!rateLimitCheck.allowed) return rateLimitResponse(rateLimitCheck);

	try {
		const parsed = await parsePolicy(policyText.trim());
		return json({ policy: parsed });
	} catch (err) {
		console.error('[delegation/parse-policy] Parse failed:', err);
		throw error(500, 'Failed to parse policy. Please try rephrasing.');
	}
};
