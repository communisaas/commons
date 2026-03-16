import type { PageServerLoad } from './$types';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';
import { prisma } from '$lib/core/db';
import { error } from '@sveltejs/kit';

/**
 * Transform Prisma debate row into store-compatible AIResolutionData.
 * The ai_resolution JSON blob stores raw evaluator output; we reshape it
 * for the frontend type contract.
 */
function buildAIResolution(
	dbDebate: {
		ai_resolution: unknown;
		ai_signature_count: number | null;
		ai_panel_consensus: number | null;
		resolution_method: string | null;
		appeal_deadline: Date | null;
		governance_justification: string | null;
		arguments: Array<{
			argument_index: number;
			ai_scores: unknown;
			ai_weighted: number | null;
			final_score: number | null;
			model_agreement: number | null;
			weighted_score: unknown;
		}>;
	}
): AIResolutionData {
	const blob = (dbDebate.ai_resolution ?? {}) as Record<string, unknown>;
	const models = (blob.models ?? []) as Array<unknown>;
	const source = (blob.source as string) ?? 'ai_panel';
	const minerCount = (blob.minerCount as number) ?? undefined;

	// Normalize community weighted_score (raw stake) to 0-10000 basis points
	const scoredArgs = dbDebate.arguments.filter((a) => a.ai_scores != null);
	const maxWeightedScore = Math.max(...scoredArgs.map((a) => Number(a.weighted_score ?? 0)), 1);

	const argumentScores: ArgumentAIScore[] = scoredArgs
		.map((a) => {
			const dims = (a.ai_scores ?? {}) as Record<string, number>;
			return {
				argumentIndex: a.argument_index,
				dimensions: {
					reasoning: dims.reasoning ?? 0,
					accuracy: dims.accuracy ?? 0,
					evidence: dims.evidence ?? 0,
					constructiveness: dims.constructiveness ?? 0,
					feasibility: dims.feasibility ?? 0
				},
				weightedAIScore: a.ai_weighted ?? 0,
				communityScore: Math.round((Number(a.weighted_score ?? 0) / maxWeightedScore) * 10000),
				finalScore: a.final_score ?? 0,
				modelAgreement: a.model_agreement ?? 0
			};
		});

	// Level 3: extract per-evaluator results with grounding evidence
	const rawMinerEvals = blob.minerEvaluations as MinerEvaluation[] | undefined;

	return {
		argumentScores,
		alphaWeight: 4000, // Default α from MockAIEvaluationRegistry
		modelCount: minerCount ?? (models.length || 5),
		signatureCount: dbDebate.ai_signature_count ?? 0,
		quorumRequired: 4, // ceil(2*5/3)
		resolutionMethod: (dbDebate.resolution_method as AIResolutionData['resolutionMethod']) ?? 'ai_community',
		evaluatedAt: (blob.evaluatedAt as string) ?? undefined,
		source: source as AIResolutionData['source'],
		minerCount,
		minerEvaluations: rawMinerEvals,
		appealDeadline: dbDebate.appeal_deadline?.toISOString(),
		hasAppeal: false,
		governanceJustification: dbDebate.governance_justification ?? undefined
	};
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { debateId } = params;
	const parentData = await parent();

	// Load specific debate by ID
	const dbDebate = await prisma.debate.findUnique({
		where: { id: debateId },
		include: {
			arguments: { orderBy: { weighted_score: 'desc' } }
		}
	});

	if (!dbDebate) {
		throw error(404, 'Debate not found');
	}

	// Verify this debate belongs to this template
	if (parentData.template && dbDebate.template_id !== parentData.template.id) {
		throw error(404, 'Debate not found for this template');
	}

	// Build AI resolution data if available
	const aiResolution = dbDebate.ai_resolution
		? buildAIResolution(dbDebate)
		: undefined;

	const debate = {
		id: dbDebate.id,
		debateIdOnchain: dbDebate.debate_id_onchain,
		templateId: dbDebate.template_id,
		propositionText: dbDebate.proposition_text,
		propositionHash: dbDebate.proposition_hash,
		actionDomain: dbDebate.action_domain,
		deadline: dbDebate.deadline.toISOString(),
		jurisdictionSize: dbDebate.jurisdiction_size,
		status: dbDebate.status as
			| 'active'
			| 'resolving'
			| 'resolved'
			| 'awaiting_governance'
			| 'under_appeal',
		argumentCount: dbDebate.argument_count,
		uniqueParticipants: dbDebate.unique_participants,
		totalStake: dbDebate.total_stake.toString(),
		winningArgumentIndex: dbDebate.winning_argument_index,
		winningStance: dbDebate.winning_stance,
		resolvedAt: dbDebate.resolved_at?.toISOString(),
		aiResolution,
		arguments: dbDebate.arguments.map((arg) => ({
			id: arg.id,
			argumentIndex: arg.argument_index,
			stance: arg.stance,
			body: arg.body,
			amendmentText: arg.amendment_text,
			stakeAmount: arg.stake_amount.toString(),
			engagementTier: arg.engagement_tier,
			weightedScore: arg.weighted_score.toString(),
			totalStake: arg.total_stake.toString(),
			coSignCount: arg.co_sign_count,
			createdAt: arg.created_at.toISOString(),
			// AI evaluation scores (populated after resolution)
			aiScore: arg.ai_scores as Record<string, number> | undefined,
			weightedAIScore: arg.ai_weighted ?? undefined,
			finalScore: arg.final_score ?? undefined,
			modelAgreement: arg.model_agreement ?? undefined
		}))
	};

	return {
		user: locals.user,
		template: parentData.template,
		channel: parentData.channel,
		debate
	};
};
