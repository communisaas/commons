import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api, internal } from '$lib/convex';

/**
 * GET /api/delegation/[id]
 *
 * Get a single delegation grant with recent actions.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const grant = await serverQuery(internal.v1api.getDelegationGrant, { grantId: params.id });
	if (!grant) {
		throw error(404, 'Delegation grant not found');
	}

	if (String(grant.userId) !== session.userId) {
		throw error(403, 'Not authorized to view this grant');
	}

	// Policy text is client-encrypted — return as-is for client-side decryption
	return json({ grant });
};

/**
 * PATCH /api/delegation/[id]
 *
 * Update a delegation grant: pause/resume, edit constraints.
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
	const data: Record<string, unknown> = {};

	if (body.status !== undefined) data.status = body.status;
	if (body.maxActionsPerDay !== undefined) {
		data.maxActionsPerDay = Math.max(1, Math.min(20, Math.round(body.maxActionsPerDay)));
	}
	if (body.requireReviewAbove !== undefined) {
		data.requireReviewAbove = Math.max(0, body.requireReviewAbove);
	}
	if (body.issueFilter !== undefined) {
		data.issueFilter = (body.issueFilter as string[])
			.map((s: string) => s.toLowerCase().trim())
			.filter(Boolean);
	}
	if (body.orgFilter !== undefined) {
		data.orgFilter = (body.orgFilter as string[])
			.map((s: string) => s.toLowerCase().trim())
			.filter(Boolean);
	}
	if (body.policyText !== undefined && typeof body.policyText === 'string') {
		// Client sends pre-encrypted policy blob — store as-is
		data.policyText = body.policyText.trim();
	}

	if (Object.keys(data).length === 0) {
		throw error(400, 'No valid fields to update');
	}

	const result = await serverMutation(internal.v1api.updateDelegationGrant, {
		grantId: params.id,
		userId: session.userId,
		data
	});

	if (!result) throw error(404, 'Delegation grant not found');
	if ('forbidden' in result && result.forbidden) throw error(403, 'Not authorized to modify this grant');
	if ('revoked' in result && result.revoked) throw error(400, 'Cannot modify a revoked grant');

	return json({ grant: result });
};

/**
 * DELETE /api/delegation/[id]
 *
 * Revoke a delegation grant.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const result = await serverMutation(api.delegation.revokeGrant, {
		grantId: params.id
	});

	return json({ message: 'Delegation grant revoked' });
};
