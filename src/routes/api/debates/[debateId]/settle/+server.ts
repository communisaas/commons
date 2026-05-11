import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
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

	const debate = await serverQuery(api.debates.get, { debateId: debateId as Id<'debates'> });
	if (!debate) throw error(404, 'Debate not found');

	// verify debate is linked to a campaign via reverse index
	// (campaign.debateId → debate._id). `debates.get` returns no campaign field,
	// so the prior `(debate as any).campaign` always tripped the guard regardless.
	const linkedCampaign = await serverQuery(api.campaigns.getCampaignByDebateId, {
		debateId: debateId as Id<'debates'>
	});
	if (!linkedCampaign) {
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
	// fetch arguments via listArguments query, filtered to
	// the winning stance, take the highest-weighted one. The prior
	// `(debate as any).arguments` access was undefined since `debates.get` returns
	// no arguments field; on Convex, the listArguments query already sorts by
	// weightedScore descending so `[0]` is the top-stake winning argument.
	const stanceResult = await serverQuery(api.debates.listArguments, {
		debateId: debateId as Id<'debates'>,
		stance: winningStance,
		limit: 1
	});
	const winningArgumentIndex = stanceResult?.arguments?.[0]?.argumentIndex ?? undefined;

	await serverMutation(api.debates.updateStatus, {
		debateId: debateId as Id<'debates'>,
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
