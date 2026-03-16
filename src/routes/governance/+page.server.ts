import type { PageServerLoad } from './$types';
import { prisma } from '$lib/core/db';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';

/**
 * Governance Dashboard — loads all debates awaiting governance review.
 *
 * Each case includes the full AI evaluation evidence so the reviewer
 * can understand *why* consensus failed before making a judgment.
 */

interface GovernanceCase {
	id: string;
	debateIdOnchain: string;
	templateId: string;
	templateTitle: string;
	templateSlug: string;
	propositionText: string;
	actionDomain: string;
	deadline: string;
	totalStake: string;
	argumentCount: number;
	uniqueParticipants: number;
	aiPanelConsensus: number | null;
	escalatedAt: string; // updatedAt as proxy
	arguments: {
		argumentIndex: number;
		stance: string;
		body: string;
		amendmentText: string | null;
		stakeAmount: string;
		weightedScore: string;
		coSignCount: number;
		aiScores: Record<string, number> | null;
		aiWeighted: number | null;
		finalScore: number | null;
		modelAgreement: number | null;
	}[];
	aiResolution: AIResolutionData | null;
}

function buildResolutionData(
	blob: Record<string, unknown>,
	args: Array<{
		argument_index: number;
		ai_scores: unknown;
		ai_weighted: number | null;
		final_score: number | null;
		model_agreement: number | null;
		weighted_score: unknown;
	}>,
	signatureCount: number | null
): AIResolutionData {
	const models = (blob.models ?? []) as Array<unknown>;
	const source = (blob.source as string) ?? 'ai_panel';
	const minerCount = (blob.minerCount as number) ?? undefined;

	const scoredArgs = args.filter((a) => a.ai_scores != null);
	const maxWeightedScore = Math.max(...scoredArgs.map((a) => Number(a.weighted_score ?? 0)), 1);

	const argumentScores: ArgumentAIScore[] = scoredArgs.map((a) => {
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

	const rawMinerEvals = blob.minerEvaluations as MinerEvaluation[] | undefined;

	return {
		argumentScores,
		alphaWeight: 4000,
		modelCount: minerCount ?? (models.length || 5),
		signatureCount: signatureCount ?? 0,
		quorumRequired: 4,
		resolutionMethod: 'ai_community',
		evaluatedAt: (blob.evaluatedAt as string) ?? undefined,
		source: source as AIResolutionData['source'],
		minerCount,
		minerEvaluations: rawMinerEvals,
		hasAppeal: false
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const focusDebateId = url.searchParams.get('debate');

	const debates = await prisma.debate.findMany({
		where: { status: 'awaiting_governance' },
		include: {
			arguments: { orderBy: { weighted_score: 'desc' } },
			template: { select: { id: true, title: true, slug: true } }
		},
		orderBy: { updated_at: 'desc' }
	});

	const cases: GovernanceCase[] = debates.map((d) => {
		const blob = (d.ai_resolution ?? {}) as Record<string, unknown>;

		return {
			id: d.id,
			debateIdOnchain: d.debate_id_onchain,
			templateId: d.template_id,
			templateTitle: d.template?.title ?? 'Unknown Template',
			templateSlug: d.template?.slug ?? '',
			propositionText: d.proposition_text,
			actionDomain: d.action_domain,
			deadline: d.deadline.toISOString(),
			totalStake: d.total_stake.toString(),
			argumentCount: d.argument_count,
			uniqueParticipants: d.unique_participants,
			aiPanelConsensus: d.ai_panel_consensus,
			escalatedAt: d.updated_at.toISOString(),
			arguments: d.arguments.map((a) => ({
				argumentIndex: a.argument_index,
				stance: a.stance,
				body: a.body,
				amendmentText: a.amendment_text,
				stakeAmount: a.stake_amount.toString(),
				weightedScore: a.weighted_score.toString(),
				coSignCount: a.co_sign_count,
				aiScores: a.ai_scores as Record<string, number> | null,
				aiWeighted: a.ai_weighted,
				finalScore: a.final_score,
				modelAgreement: a.model_agreement
			})),
			aiResolution: d.ai_resolution
				? buildResolutionData(blob, d.arguments, d.ai_signature_count)
				: null
		};
	});

	return { cases, focusDebateId };
};
