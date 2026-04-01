import type { PageServerLoad } from './$types';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { parseRecipientConfig } from '$lib/types/template';
import { getOfficials } from '$lib/core/shadow-atlas/client';
import type { DistrictOfficialInput } from '$lib/utils/landscapeMerge';

/**
 * Transform Convex debate row into store-compatible AIResolutionData.
 */
function buildAIResolution(
	dbDebate: {
		ai_resolution: unknown;
		ai_signature_count: number | null;
		ai_panel_consensus: number | null;
		resolution_method: string | null;
		appeal_deadline: number | null;
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

	const source = (blob.source as string) ?? 'ai_panel';
	const minerCount = (blob.minerCount as number) ?? undefined;
	const rawMinerEvals = blob.minerEvaluations as MinerEvaluation[] | undefined;

	return {
		argumentScores,
		alphaWeight: 4000,
		modelCount: minerCount ?? (models.length || 5),
		signatureCount: dbDebate.ai_signature_count ?? 0,
		quorumRequired: 4,
		resolutionMethod: (dbDebate.resolution_method as AIResolutionData['resolutionMethod']) ?? 'ai_community',
		evaluatedAt: (blob.evaluatedAt as string) ?? undefined,
		source: source as AIResolutionData['source'],
		minerCount,
		minerEvaluations: rawMinerEvals,
		appealDeadline: dbDebate.appeal_deadline ? new Date(dbDebate.appeal_deadline).toISOString() : undefined,
		hasAppeal: false,
		governanceJustification: dbDebate.governance_justification ?? undefined
	};
}

export const load: PageServerLoad = async ({ locals, parent }) => {
	// Get template and channel data from parent layout
	const parentData = await parent();

	const templateId = parentData.template?.id;
	const userId = locals.user?.id;
	const userDistrictHash = locals.user?.district_hash;
	const identityCommitment =
		locals.user?.identity_commitment ?? null;

	// Batch 1: All independent queries in parallel
	const [
		messagesResult,
		totalStatesResult,
		debateResult,
		positionCountsResult,
		existingPositionResult,
		userRepResult
	] = await Promise.all([
		// District message aggregates via Convex
		templateId
			? serverQuery(api.templatePage.getMessageDistrictCounts, { templateId })
					.catch(() => ({ districtCounts: {} as Record<string, number> }))
			: Promise.resolve({ districtCounts: {} as Record<string, number> }),

		// Total active states via Convex
		serverQuery(api.templatePage.getTotalStates, {})
			.catch(() => ({ count: 50 })),

		// Active debate with arguments via Convex
		templateId
			? serverQuery(api.debates.getFullByTemplateId, { templateId })
					.catch(() => null)
			: Promise.resolve(null),

		// Position counts via Convex
		templateId
			? serverQuery(api.positions.getCounts, { templateId })
					.catch(() => ({ support: 0, oppose: 0, districts: 0 }))
			: Promise.resolve({ support: 0, oppose: 0, districts: 0 }),

		// Existing user position via Convex
		templateId && identityCommitment
			? serverQuery(api.positions.getExisting, { templateId, identityCommitment })
					.catch(() => null)
			: Promise.resolve(null),

		// User representative (for district code) via Convex
		userId && userDistrictHash
			? serverQuery(api.templatePage.getUserDmRelation, { userId })
					.catch(() => null)
			: Promise.resolve(null)
	]);

	// Process Batch 1 results
	const districtCounts = (messagesResult as { districtCounts: Record<string, number> }).districtCounts ?? {};
	const totalDistricts = Object.keys(districtCounts).length;
	const totalStates = (totalStatesResult as { count: number }).count || 50;
	const userDistrictCount =
		userDistrictHash && districtCounts[userDistrictHash]
			? districtCounts[userDistrictHash]
			: 0;
	const userDistrictCode = userRepResult && typeof userRepResult === 'object' && 'districtCode' in userRepResult
		? (userRepResult as { districtCode: string | null }).districtCode
		: null;
	const positionCounts = positionCountsResult;

	const existingPosition = existingPositionResult
		? { stance: (existingPositionResult as any).stance, registrationId: (existingPositionResult as any)._id }
		: null;

	// Build debate object (same transform logic as original)
	let debate = null;
	if (debateResult) {
		const dbDebate = debateResult as any;
		const aiResolution = dbDebate.ai_resolution ? buildAIResolution(dbDebate) : undefined;

		debate = {
			id: dbDebate._id ?? dbDebate.id,
			debateIdOnchain: dbDebate.debateIdOnchain ?? dbDebate.debate_id_onchain,
			templateId: dbDebate.templateId ?? dbDebate.template_id,
			propositionText: dbDebate.propositionText ?? dbDebate.proposition_text,
			propositionHash: dbDebate.propositionHash ?? dbDebate.proposition_hash,
			actionDomain: dbDebate.actionDomain ?? dbDebate.action_domain,
			deadline: typeof dbDebate.deadline === 'number' ? new Date(dbDebate.deadline).toISOString() : dbDebate.deadline,
			jurisdictionSize: dbDebate.jurisdictionSize ?? dbDebate.jurisdiction_size,
			status: dbDebate.status as
				| 'active'
				| 'resolving'
				| 'resolved'
				| 'awaiting_governance'
				| 'under_appeal',
			argumentCount: dbDebate.argumentCount ?? dbDebate.argument_count,
			uniqueParticipants: dbDebate.uniqueParticipants ?? dbDebate.unique_participants,
			totalStake: String(dbDebate.totalStake ?? dbDebate.total_stake),
			winningArgumentIndex: dbDebate.winningArgumentIndex ?? dbDebate.winning_argument_index,
			winningStance: dbDebate.winningStance ?? dbDebate.winning_stance,
			resolvedAt: dbDebate.resolvedAt ? new Date(dbDebate.resolvedAt).toISOString() : (dbDebate.resolved_at?.toISOString?.() ?? null),
			aiResolution,
			arguments: (dbDebate.arguments ?? []).map((arg: any) => ({
				id: arg._id ?? arg.id,
				argumentIndex: arg.argumentIndex ?? arg.argument_index,
				stance: arg.stance,
				body: arg.body,
				amendmentText: arg.amendmentText ?? arg.amendment_text,
				stakeAmount: String(arg.stakeAmount ?? arg.stake_amount),
				engagementTier: arg.engagementTier ?? arg.engagement_tier,
				weightedScore: String(arg.weightedScore ?? arg.weighted_score),
				totalStake: String(arg.totalStake ?? arg.total_stake),
				coSignCount: arg.coSignCount ?? arg.co_sign_count,
				createdAt: typeof arg.createdAt === 'number' ? new Date(arg.createdAt).toISOString() : (arg.created_at?.toISOString?.() ?? new Date(arg._creationTime ?? 0).toISOString()),
				aiScore: (arg.aiScores ?? arg.ai_scores) as Record<string, number> | undefined,
				weightedAIScore: arg.aiWeighted ?? arg.ai_weighted ?? undefined,
				finalScore: arg.finalScore ?? arg.final_score ?? undefined,
				modelAgreement: arg.modelAgreement ?? arg.model_agreement ?? undefined
			}))
		};
	}

	// Batch 2: Queries depending on Batch 1 results
	const [deliveredRecipients, districtOfficials, engagementByDistrict] = await Promise.all([
		existingPosition
			? serverQuery(api.positions.getDeliveries, {
						registrationId: existingPosition.registrationId,
						deliveryMethod: 'email'
					})
					.then((deliveries: any[]) => deliveries.map((d) => d.recipientKey ?? d.recipientName))
					.catch(() => [])
			: Promise.resolve([]),

		userDistrictCode
			? getOfficials(userDistrictCode)
					.then((data) =>
						(data.officials || []).map((o) => ({
							name: o.name || '',
							title:
								o.office || (o.chamber === 'senate' ? 'Senator' : 'Representative'),
							organization: o.party
								? `${o.chamber === 'senate' ? 'US Senate' : 'US House'} · ${o.party}`
								: '',
							bioguideId: o.bioguide_id ?? null,
							cwcCode: o.cwc_code ?? null,
							chamber: o.chamber ?? null,
							phone: o.phone ?? null,
							contactFormUrl: o.contact_form_url ?? null,
							websiteUrl: o.website_url ?? null
						}))
					)
					.catch(() => [])
			: Promise.resolve([]),

		// Engagement by district (coordination visibility) via Convex
		templateId
			? serverQuery(api.positions.getEngagementByDistrict, {
						templateId,
						userDistrictCode: userDistrictCode ?? undefined
					}).catch(() => null)
			: Promise.resolve(null)
	]);

	// Parse typed recipient_config from template JSON
	const recipientConfig = parentData.template
		? parseRecipientConfig(parentData.template.recipient_config)
		: {};

	return {
		user: locals.user ? {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			avatar: locals.user.avatar,
			trust_tier: locals.user.trust_tier,
			is_verified: locals.user.is_verified,
			identity_commitment: locals.user.identity_commitment
		} : null,
		template: parentData.template,
		channel: parentData.channel,
		totalDistricts,
		totalStates,
		userDistrictCount,
		userDistrictCode,
		debate,
		// Power Landscape data
		positionCounts,
		existingPosition,
		deliveredRecipients,
		districtOfficials: districtOfficials as DistrictOfficialInput[],
		recipientConfig,
		engagementByDistrict
	};
};
