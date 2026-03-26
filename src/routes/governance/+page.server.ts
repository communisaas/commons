// CONVEX: Fully migrated — debates awaiting governance via Convex query
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
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
	escalatedAt: string;
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
		argumentIndex: number;
		aiScores: unknown;
		aiWeighted: number | null;
		finalScore: number | null;
		modelAgreement: number | null;
		weightedScore: string;
	}>,
	signatureCount: number | null
): AIResolutionData {
	const models = (blob.models ?? []) as Array<unknown>;
	const source = (blob.source as string) ?? 'ai_panel';
	const minerCount = (blob.minerCount as number) ?? undefined;

	const scoredArgs = args.filter((a) => a.aiScores != null);
	const maxWeightedScore = Math.max(...scoredArgs.map((a) => Number(a.weightedScore ?? 0)), 1);

	const argumentScores: ArgumentAIScore[] = scoredArgs.map((a) => {
		const dims = (a.aiScores ?? {}) as Record<string, number>;
		return {
			argumentIndex: a.argumentIndex,
			dimensions: {
				reasoning: dims.reasoning ?? 0,
				accuracy: dims.accuracy ?? 0,
				evidence: dims.evidence ?? 0,
				constructiveness: dims.constructiveness ?? 0,
				feasibility: dims.feasibility ?? 0
			},
			weightedAIScore: a.aiWeighted ?? 0,
			communityScore: Math.round((Number(a.weightedScore ?? 0) / maxWeightedScore) * 10000),
			finalScore: a.finalScore ?? 0,
			modelAgreement: a.modelAgreement ?? 0
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

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!FEATURES.DEBATE) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const focusDebateId = url.searchParams.get('debate');

	const debates = await serverQuery(api.debates.listAwaitingGovernance, {});

	const cases: GovernanceCase[] = debates.map((d) => {
		const blob = (d.aiResolution ?? {}) as Record<string, unknown>;

		return {
			id: d._id,
			debateIdOnchain: d.debateIdOnchain,
			templateId: d.templateId,
			templateTitle: d.templateTitle,
			templateSlug: d.templateSlug,
			propositionText: d.propositionText,
			actionDomain: d.actionDomain,
			deadline: new Date(d.deadline).toISOString(),
			totalStake: d.totalStake,
			argumentCount: d.argumentCount,
			uniqueParticipants: d.uniqueParticipants,
			aiPanelConsensus: d.aiPanelConsensus,
			escalatedAt: new Date(d.updatedAt).toISOString(),
			arguments: d.arguments,
			aiResolution: d.aiResolution
				? buildResolutionData(blob, d.arguments, d.aiSignatureCount)
				: null
		};
	});

	return { cases, focusDebateId };
};
