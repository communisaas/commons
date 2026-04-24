import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * GET /api/debates/[debateId]/ai-resolution
 *
 * Fetch AI evaluation resolution data for a debate.
 * Returns dimension scores, alpha blend, model agreement,
 * and resolution metadata.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	const debate = await serverQuery(api.debates.get, {
		debateId: debateId as any
	});
	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (!debate.aiResolution && !debate.aiSignatureCount) {
		return json({ aiResolution: null });
	}
	return json({
		aiResolution: {
			...(debate.aiResolution as Record<string, unknown> ?? {}),
			signatureCount: debate.aiSignatureCount,
			panelConsensus: debate.aiPanelConsensus,
			resolutionMethod: debate.resolutionMethod,
			appealDeadline: debate.appealDeadline ? new Date(debate.appealDeadline).toISOString() : null,
			governanceJustification: debate.governanceJustification,
			winningArgumentIndex: debate.winningArgumentIndex,
			winningStance: debate.winningStance,
			resolvedAt: debate.resolvedAt ? new Date(debate.resolvedAt).toISOString() : null
		}
	});
};
