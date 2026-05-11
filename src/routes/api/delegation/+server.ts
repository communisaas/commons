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

	// bound remaining caller-supplied fields.
	// issueFilter/orgFilter are arrays of strings per the Convex action
	// signature (`v.optional(v.array(v.string()))`). Validate as arrays
	// with per-entry caps — bounding them as scalar strings would break
	// every legitimate client request.
	if (issueFilter !== undefined && issueFilter !== null) {
		if (
			!Array.isArray(issueFilter) ||
			issueFilter.length > 32 ||
			issueFilter.some((s) => typeof s !== 'string' || s.length > 200)
		) {
			throw error(400, 'issueFilter must be an array of ≤32 strings (each ≤200 characters)');
		}
	}
	if (orgFilter !== undefined && orgFilter !== null) {
		if (
			!Array.isArray(orgFilter) ||
			orgFilter.length > 32 ||
			orgFilter.some((s) => typeof s !== 'string' || s.length > 64)
		) {
			throw error(400, 'orgFilter must be an array of ≤32 strings (each ≤64 characters)');
		}
	}
	if (stanceProfileId !== undefined && stanceProfileId !== null && (typeof stanceProfileId !== 'string' || stanceProfileId.length > 64)) {
		throw error(400, 'stanceProfileId must be ≤64 characters');
	}
	if (
		maxActionsPerDay !== undefined &&
		maxActionsPerDay !== null &&
		(typeof maxActionsPerDay !== 'number' || !Number.isInteger(maxActionsPerDay) || maxActionsPerDay < 0 || maxActionsPerDay > 10_000)
	) {
		throw error(400, 'maxActionsPerDay must be an integer 0-10,000');
	}
	if (
		requireReviewAbove !== undefined &&
		requireReviewAbove !== null &&
		(typeof requireReviewAbove !== 'number' || !Number.isFinite(requireReviewAbove))
	) {
		throw error(400, 'requireReviewAbove must be a finite number');
	}
	const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : undefined;
	if (expiresAt !== undefined && expiresAt !== null && (expiresAtMs === undefined || !Number.isFinite(expiresAtMs))) {
		throw error(400, 'expiresAt must be a valid date');
	}

	const result = await serverAction(api.delegation.createGrant, {
		scope,
		policyText: policyText.trim(),
		issueFilter: issueFilter || undefined,
		orgFilter: orgFilter || undefined,
		stanceProfileId: stanceProfileId || undefined,
		maxActionsPerDay: maxActionsPerDay ?? undefined,
		requireReviewAbove: requireReviewAbove ?? undefined,
		expiresAt: expiresAtMs
	});
	return json({ grant: result }, { status: 201 });
};
