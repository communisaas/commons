import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const debate = await serverQuery(api.debates.get, {
				debateId: debateId as any
			});
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
		} catch (err) {
			console.error('[Debates.aiResolution.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: {
			id: true,
			status: true,
			winning_argument_index: true,
			winning_stance: true,
			resolved_at: true,
			ai_resolution: true,
			ai_signature_count: true,
			ai_panel_consensus: true,
			resolution_method: true,
			appeal_deadline: true,
			governance_justification: true,
			arguments: {
				select: {
					argument_index: true,
					ai_scores: true,
					ai_weighted: true,
					final_score: true,
					model_agreement: true
				},
				orderBy: { argument_index: 'asc' }
			}
		}
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}

	// No AI resolution data yet
	if (!debate.ai_resolution && !debate.ai_signature_count) {
		return json({ aiResolution: null });
	}

	return json({
		aiResolution: {
			...(debate.ai_resolution as Record<string, unknown> ?? {}),
			signatureCount: debate.ai_signature_count,
			panelConsensus: debate.ai_panel_consensus,
			resolutionMethod: debate.resolution_method,
			appealDeadline: debate.appeal_deadline?.toISOString() ?? null,
			governanceJustification: debate.governance_justification,
			winningArgumentIndex: debate.winning_argument_index,
			winningStance: debate.winning_stance,
			resolvedAt: debate.resolved_at?.toISOString() ?? null,
			arguments: debate.arguments.map((arg) => ({
				argumentIndex: arg.argument_index,
				aiScores: arg.ai_scores,
				aiWeighted: arg.ai_weighted,
				finalScore: arg.final_score,
				modelAgreement: arg.model_agreement
			}))
		}
	});
};
