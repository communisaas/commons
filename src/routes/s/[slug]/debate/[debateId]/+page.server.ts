import type { PageServerLoad } from './$types';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';
import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { debateId } = params;
	const parentData = await parent();

	const result = await serverQuery(api.debates.getPublicDetail, { debateId });

	if (!result) throw error(404, 'Debate not found');

	// Verify this debate belongs to this template
	if (parentData.template && result.templateId !== parentData.template.id) {
		throw error(404, 'Debate not found for this template');
	}

	// Build AI resolution from Convex data if available
	const aiBlob = result.aiResolution as Record<string, unknown> | null;
	let aiResolution: AIResolutionData | undefined;
	if (aiBlob) {
		const scoredArgs = result.arguments.filter(
			(a: Record<string, unknown>) => a.aiScores != null
		);
		const maxWeightedScore = Math.max(
			...scoredArgs.map((a: Record<string, unknown>) => Number(a.weightedScore ?? 0)),
			1
		);
		const argumentScores: ArgumentAIScore[] = scoredArgs.map(
			(a: Record<string, unknown>) => {
				const dims = (a.aiScores ?? {}) as Record<string, number>;
				return {
					argumentIndex: a.argumentIndex as number,
					dimensions: {
						reasoning: dims.reasoning ?? 0,
						accuracy: dims.accuracy ?? 0,
						evidence: dims.evidence ?? 0,
						constructiveness: dims.constructiveness ?? 0,
						feasibility: dims.feasibility ?? 0
					},
					weightedAIScore: (a.aiWeighted as number) ?? 0,
					communityScore: Math.round(
						(Number(a.weightedScore ?? 0) / maxWeightedScore) * 10000
					),
					finalScore: (a.finalScore as number) ?? 0,
					modelAgreement: (a.modelAgreement as number) ?? 0
				};
			}
		);

		const source = (aiBlob.source as string) ?? 'ai_panel';
		const minerCount = (aiBlob.minerCount as number) ?? undefined;
		const models = (aiBlob.models ?? []) as Array<unknown>;

		aiResolution = {
			argumentScores,
			alphaWeight: 4000,
			modelCount: minerCount ?? (models.length || 5),
			signatureCount: (result.aiSignatureCount as number) ?? 0,
			quorumRequired: 4,
			resolutionMethod:
				(result.resolutionMethod as AIResolutionData['resolutionMethod']) ??
				'ai_community',
			evaluatedAt: (aiBlob.evaluatedAt as string) ?? undefined,
			source: source as AIResolutionData['source'],
			minerCount,
			minerEvaluations: aiBlob.minerEvaluations as MinerEvaluation[] | undefined,
			appealDeadline: result.appealDeadline
				? new Date(result.appealDeadline as number).toISOString()
				: undefined,
			hasAppeal: false,
			governanceJustification:
				(result.governanceJustification as string) ?? undefined
		};
	}

	return {
		user: locals.user
			? {
					id: locals.user.id,
					name: locals.user.name,
					trust_tier: locals.user.trust_tier,
					is_verified: locals.user.is_verified
				}
			: null,
		template: parentData.template,
		channel: parentData.channel,
		debate: {
			id: result._id,
			debateIdOnchain: result.debateIdOnchain,
			templateId: result.templateId,
			propositionText: result.propositionText,
			propositionHash: result.propositionHash,
			actionDomain: result.actionDomain,
			deadline: new Date(result.deadline).toISOString(),
			jurisdictionSize: result.jurisdictionSize,
			status: result.status,
			argumentCount: result.argumentCount,
			uniqueParticipants: result.uniqueParticipants,
			totalStake: String(result.totalStake),
			winningArgumentIndex: result.winningArgumentIndex,
			winningStance: result.winningStance,
			resolvedAt: result.resolvedAt
				? new Date(result.resolvedAt as number).toISOString()
				: undefined,
			aiResolution,
			arguments: result.arguments.map((arg: Record<string, unknown>) => ({
				id: arg._id,
				argumentIndex: arg.argumentIndex,
				stance: arg.stance,
				body: arg.body,
				amendmentText: arg.amendmentText,
				stakeAmount: String(arg.stakeAmount),
				engagementTier: arg.engagementTier,
				weightedScore: String(arg.weightedScore),
				totalStake: String(arg.totalStake),
				coSignCount: arg.coSignCount,
				createdAt: new Date(arg._creationTime as number).toISOString(),
				aiScore: arg.aiScores as Record<string, number> | undefined,
				weightedAIScore: (arg.aiWeighted as number) ?? undefined,
				finalScore: (arg.finalScore as number) ?? undefined,
				modelAgreement: (arg.modelAgreement as number) ?? undefined
			}))
		}
	};
};
