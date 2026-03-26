import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/debates/[debateId]/settle
 *
 * Org-admin settlement of a debate linked to a campaign.
 * Auth: authenticated user with editor+ role in the campaign's org.
 * Body: { outcome: 'support' | 'oppose', reasoning: string }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Debate feature is not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { debateId } = params;

	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });
	if (!debate) throw error(404, 'Debate not found');

	if (!(debate as any).campaign) {
		throw error(400, 'This debate is not linked to a campaign');
	}

	if (debate.status === 'resolved') {
		throw error(400, 'Debate has already been resolved');
	}
	if (debate.status === 'under_appeal') {
		throw error(400, 'Cannot settle a debate that is under appeal');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Request body is required');
	}

	const { outcome, reasoning } = body as { outcome?: string; reasoning?: string };

	if (!outcome || !['support', 'oppose'].includes(outcome)) {
		throw error(400, 'outcome must be "support" or "oppose"');
	}

	if (!reasoning || typeof reasoning !== 'string' || reasoning.trim().length < 10) {
		throw error(400, 'reasoning is required and must be at least 10 characters');
	}

	if (reasoning.trim().length > 2000) {
		throw error(400, 'reasoning must be 2000 characters or fewer');
	}

	const winningStance = outcome.toUpperCase();
	const matchingArg = (debate as any).arguments?.find(
		(a: any) => a.stance === winningStance
	);
	const winningArgumentIndex = matchingArg?.argumentIndex ?? undefined;

	await serverMutation(api.debates.updateStatus, {
		debateId: debateId as any,
		status: 'resolved',
		winningStance,
		winningArgumentIndex,
		resolutionMethod: 'org_settlement',
		governanceJustification: reasoning.trim(),
	});

	return json({
		success: true,
		debateId,
		status: 'resolved',
		outcome,
		winningStance,
		winningArgumentIndex: winningArgumentIndex ?? null,
		reasoning: reasoning.trim(),
		resolvedAt: new Date().toISOString(),
	});
};
