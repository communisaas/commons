import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { readBoundedJson } from '$lib/server/bounded-json';
import { isRecord } from '$lib/server/debate-input-validation';

const DEBATE_SETTLEMENT_REQUEST_MAX_BYTES = 8 * 1024;
const DEBATE_SETTLEMENT_REASONING_MAX_CHARS = 2_000;

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

	if (!locals.session?.userId || !locals.user) {
		throw error(401, 'Authentication required');
	}

	const { debateId } = params;
	const parsed = await readBoundedJson(request, DEBATE_SETTLEMENT_REQUEST_MAX_BYTES);
	if (!isRecord(parsed)) throw error(400, 'Request body is required');
	const { outcome, reasoning } = parsed;

	if (outcome !== 'support' && outcome !== 'oppose') {
		throw error(400, 'outcome must be "support" or "oppose"');
	}
	if (typeof reasoning !== 'string' || reasoning.trim().length < 10) {
		throw error(400, 'reasoning is required and must be at least 10 characters');
	}
	const normalizedReasoning = reasoning.trim();
	if (normalizedReasoning.length > DEBATE_SETTLEMENT_REASONING_MAX_CHARS) {
		throw error(
			400,
			`reasoning must be ${DEBATE_SETTLEMENT_REASONING_MAX_CHARS} characters or fewer`
		);
	}

	const debate = await serverQuery(api.debates.get, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>
	});
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
	if (linkedCampaign.settlementRole !== 'owner' && linkedCampaign.settlementRole !== 'editor') {
		throw error(403, 'Only organization editors or owners can settle this debate');
	}

	if (debate.status === 'resolved') {
		throw error(400, 'Debate has already been resolved');
	}
	if (debate.status === 'under_appeal') {
		throw error(400, 'Cannot settle a debate that is under appeal');
	}

	const winningStance = outcome.toUpperCase() as 'SUPPORT' | 'OPPOSE';
	// fetch arguments via listArguments query, filtered to
	// the winning stance, take the highest-weighted one. The prior
	// `(debate as any).arguments` access was undefined since `debates.get` returns
	// no arguments field; on Convex, the listArguments query already sorts by
	// weightedScore descending so `[0]` is the top-stake winning argument.
	const stanceResult = await serverQuery(api.debates.listArguments, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
		stance: winningStance,
		limit: 1
	});
	const winningArgumentIndex = stanceResult?.arguments?.[0]?.argumentIndex ?? undefined;

	await serverMutation(api.debates.updateStatus, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
		expectedStatus: debate.status,
		status: 'resolved',
		winningStance,
		winningArgumentIndex,
		resolutionMethod: 'org_settlement',
		governanceJustification: normalizedReasoning
	});

	return json({
		success: true,
		debateId,
		status: 'resolved',
		outcome,
		winningStance,
		winningArgumentIndex: winningArgumentIndex ?? null,
		reasoning: normalizedReasoning,
		resolvedAt: new Date().toISOString()
	});
};
