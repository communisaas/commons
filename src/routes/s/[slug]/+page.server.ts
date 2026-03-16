import type { PageServerLoad } from './$types';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';
import { prisma } from '$lib/core/db';
import { getPositionCounts, getEngagementByDistrict } from '$lib/services/positionService';
import { parseRecipientConfig } from '$lib/types/template';
import { getOfficials } from '$lib/core/shadow-atlas/client';
import type { DistrictOfficialInput } from '$lib/utils/landscapeMerge';

/**
 * Transform Prisma debate row into store-compatible AIResolutionData.
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
		appealDeadline: dbDebate.appeal_deadline?.toISOString(),
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
		// District message aggregates
		templateId
			? prisma.message
					.findMany({
						where: { template_id: templateId, delivery_status: 'delivered' },
						select: { district_hash: true }
					})
					.catch(() => [])
			: Promise.resolve([]),

		// Total active states
		prisma.representative
			.findMany({
				where: { is_active: true },
				select: { state: true },
				distinct: ['state']
			})
			.catch(() => []),

		// Active debate with arguments
		templateId
			? prisma.debate
					.findFirst({
						where: { template_id: templateId },
						orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
						include: { arguments: { orderBy: { weighted_score: 'desc' } } }
					})
					.catch(() => null)
			: Promise.resolve(null),

		// Position counts
		templateId
			? getPositionCounts(templateId).catch(() => ({ support: 0, oppose: 0, districts: 0 }))
			: Promise.resolve({ support: 0, oppose: 0, districts: 0 }),

		// Existing user position
		templateId && identityCommitment
			? prisma.positionRegistration
					.findUnique({
						where: {
							template_id_identity_commitment: {
								template_id: templateId,
								identity_commitment: identityCommitment
							}
						},
						select: { id: true, stance: true }
					})
					.catch(() => null)
			: Promise.resolve(null),

		// User representative (for district code)
		userId && userDistrictHash
			? prisma.user_representatives
					.findFirst({
						where: { user_id: userId, is_active: true },
						select: { representative_id: true }
					})
					.then(async (userRep) => {
						if (!userRep) return null;
						const rep = await prisma.representative.findUnique({
							where: { id: userRep.representative_id },
							select: { state: true, district: true }
						});
						return rep?.state && rep?.district ? `${rep.state}-${rep.district}` : null;
					})
					.catch(() => null)
			: Promise.resolve(null)
	]);

	// Process Batch 1 results
	const districtCounts = (messagesResult as { district_hash: string | null }[]).reduce(
		(acc, msg) => {
			if (msg.district_hash) acc[msg.district_hash] = (acc[msg.district_hash] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>
	);
	const totalDistricts = Object.keys(districtCounts).length;
	const totalStates = totalStatesResult.length || 50;
	const userDistrictCount =
		userDistrictHash && districtCounts[userDistrictHash]
			? districtCounts[userDistrictHash]
			: 0;
	const userDistrictCode = userRepResult;
	const positionCounts = positionCountsResult;

	const existingPosition = existingPositionResult
		? { stance: existingPositionResult.stance, registrationId: existingPositionResult.id }
		: null;

	// Build debate object (same transform logic as original)
	let debate = null;
	if (debateResult) {
		const dbDebate = debateResult;
		const aiResolution = dbDebate.ai_resolution ? buildAIResolution(dbDebate) : undefined;

		debate = {
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
				aiScore: arg.ai_scores as Record<string, number> | undefined,
				weightedAIScore: arg.ai_weighted ?? undefined,
				finalScore: arg.final_score ?? undefined,
				modelAgreement: arg.model_agreement ?? undefined
			}))
		};
	}

	// Batch 2: Queries depending on Batch 1 results
	const [deliveredRecipients, districtOfficials, engagementByDistrict] = await Promise.all([
		existingPosition
			? prisma.positionDelivery
					.findMany({
						where: { registration_id: existingPosition.registrationId },
						select: { recipient_name: true }
					})
					.then((deliveries) => deliveries.map((d) => d.recipient_name))
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

		// Engagement by district (coordination visibility)
		templateId
			? getEngagementByDistrict(templateId, userDistrictCode).catch(() => null)
			: Promise.resolve(null)
	]);

	// Parse typed recipient_config from template JSON
	const recipientConfig = parentData.template
		? parseRecipientConfig(parentData.template.recipient_config)
		: {};

	return {
		user: locals.user,
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
