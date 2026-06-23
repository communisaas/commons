import type { PageServerLoad } from './$types';
import type { AIResolutionData, ArgumentAIScore, MinerEvaluation } from '$lib/stores/debateState.svelte';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { parseRecipientConfig } from '$lib/types/template';
import { getOfficials } from '$lib/core/shadow-atlas/client';
import type { DistrictOfficialInput } from '$lib/utils/landscapeMerge';
import { env } from '$env/dynamic/private';
import type { Id } from '$convex/_generated/dataModel';

type DebateArgumentRow = {
	_id: string;
	_creationTime: number;
	argumentIndex: number;
	stance: string;
	body: string;
	amendmentText: string | null;
	stakeAmount: number;
	engagementTier: number;
	weightedScore: number;
	totalStake: number;
	coSignCount: number;
	aiScores: unknown;
	aiWeighted: number | null;
	finalScore: number | null;
	modelAgreement: number | null;
};

type DebateRow = {
	_id: string;
	templateId: string;
	debateIdOnchain: string | number | null;
	propositionText: string;
	propositionHash: string;
	actionDomain: string;
	deadline: number | string;
	jurisdictionSize: number;
	status: 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';
	argumentCount: number;
	uniqueParticipants: number;
	totalStake: number;
	winningArgumentIndex: number | null;
	winningStance: string | null;
	resolvedAt: number | null;
	aiResolution: unknown;
	resolutionMethod: string | null;
	aiSignatureCount: number | null;
	appealDeadline: number | null;
	governanceJustification: string | null;
	arguments: DebateArgumentRow[];
};

const onchainId = (value: string | number | null | undefined): string =>
	value == null ? '' : String(value);

/**
 * Transform Convex debate row into store-compatible AIResolutionData.
 */
function buildAIResolution(dbDebate: DebateRow): AIResolutionData {
	const blob = (dbDebate.aiResolution ?? {}) as Record<string, unknown>;
	const models = (blob.models ?? []) as Array<unknown>;

	const scoredArgs = dbDebate.arguments.filter((a) => a.aiScores != null);
	const maxWeightedScore = Math.max(...scoredArgs.map((a) => a.weightedScore), 1);

	const argumentScores: ArgumentAIScore[] = scoredArgs
		.map((a) => {
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
				communityScore: Math.round((a.weightedScore / maxWeightedScore) * 10000),
				finalScore: a.finalScore ?? 0,
				modelAgreement: a.modelAgreement ?? 0
			};
		});

	const source = (blob.source as string) ?? 'ai_panel';
	const minerCount = (blob.minerCount as number) ?? undefined;
	const rawMinerEvals = blob.minerEvaluations as MinerEvaluation[] | undefined;

	return {
		argumentScores,
		alphaWeight: 4000,
		modelCount: minerCount ?? (models.length || 5),
		signatureCount: dbDebate.aiSignatureCount ?? 0,
		quorumRequired: 4,
		resolutionMethod: (dbDebate.resolutionMethod as AIResolutionData['resolutionMethod']) ?? 'ai_community',
		evaluatedAt: (blob.evaluatedAt as string) ?? undefined,
		source: source as AIResolutionData['source'],
		minerCount,
		minerEvaluations: rawMinerEvals,
		appealDeadline: dbDebate.appealDeadline ? new Date(dbDebate.appealDeadline).toISOString() : undefined,
		hasAppeal: false,
		governanceJustification: dbDebate.governanceJustification ?? undefined
	};
}

export const load: PageServerLoad = async ({ locals, parent }) => {
	// Get template and channel data from parent layout
	const parentData = await parent();

	const templateId = parentData.template?.id;
	const templateSlug = parentData.template?.slug;
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
		userRepResult,
		viewerAuthorResult
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
			? serverQuery(api.templatePage.getUserDmRelation, {
					userId: userId as Id<'users'>,
					_secret: env.INTERNAL_API_SECRET
				})
					.catch((err) => {
						console.error(
							'[recipient-page] getUserDmRelation failed (check INTERNAL_API_SECRET / Convex):',
							err
						);
						return null;
					})
			: Promise.resolve(null),

		// Viewer-vs-author relation (viewerIsAuthor + coarse base-rate), computed
		// entirely inside Convex behind the internal-secret gate. The author's
		// identity and district never cross the boundary — only the derived facts do.
		templateSlug
			? serverQuery(api.templatePage.getViewerAuthorRelation, {
					slug: templateSlug,
					viewerUserId: userId ? (userId as Id<'users'>) : undefined,
					_secret: env.INTERNAL_API_SECRET
				})
					.catch((err) => {
						console.error(
							'[recipient-page] getViewerAuthorRelation failed (check INTERNAL_API_SECRET / Convex):',
							err
						);
						return null;
					})
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

	// Viewer-vs-author facts come back already minimized from Convex: the
	// author's identity and district never crossed the boundary — only these.
	const viewerAuthorRel = viewerAuthorResult as
		| { viewerIsAuthor: boolean; baseRateRelation: 'same' | 'diff' | 'unknown' }
		| null;
	const viewerIsAuthor = viewerAuthorRel?.viewerIsAuthor ?? false;
	// A viewer may be framed possessively ("YOUR REPRESENTATIVES") only as the
	// author or with a real verified/entered-address district.
	const viewerIsConstituent = viewerIsAuthor || userDistrictCode != null;
	const baseRateRelation = viewerAuthorRel?.baseRateRelation ?? 'unknown';

	const positionCounts = positionCountsResult;

	const existingPosition = existingPositionResult
		? { stance: existingPositionResult.stance, registrationId: existingPositionResult._id }
		: null;

	// Build debate object (same transform logic as original)
	let debate = null;
	if (debateResult) {
		const dbDebate = debateResult as DebateRow;
		const aiResolution = dbDebate.aiResolution ? buildAIResolution(dbDebate) : undefined;

		debate = {
			id: dbDebate._id,
			debateIdOnchain: onchainId(dbDebate.debateIdOnchain),
			templateId: dbDebate.templateId,
			propositionText: dbDebate.propositionText,
			propositionHash: dbDebate.propositionHash,
			actionDomain: dbDebate.actionDomain,
			deadline: typeof dbDebate.deadline === 'number' ? new Date(dbDebate.deadline).toISOString() : dbDebate.deadline,
			jurisdictionSize: dbDebate.jurisdictionSize,
			status: dbDebate.status,
			argumentCount: dbDebate.argumentCount,
			uniqueParticipants: dbDebate.uniqueParticipants,
			totalStake: String(dbDebate.totalStake),
			winningArgumentIndex: dbDebate.winningArgumentIndex,
			winningStance: dbDebate.winningStance,
			resolvedAt: dbDebate.resolvedAt ? new Date(dbDebate.resolvedAt).toISOString() : null,
			aiResolution,
			arguments: dbDebate.arguments.map((arg) => ({
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
				createdAt: new Date(arg._creationTime).toISOString(),
				aiScore: arg.aiScores as Record<string, number> | undefined,
				weightedAIScore: arg.aiWeighted ?? undefined,
				finalScore: arg.finalScore ?? undefined,
				modelAgreement: arg.modelAgreement ?? undefined
			}))
		};
	}

	// Batch 2: Queries depending on Batch 1 results.
	// Delivery records are intentionally NOT loaded here: a mailto handoff is not
	// a confirmed send, so prior "started" state must never persist across a
	// reload or revisit to lock a user out of writing again.
	const [districtOfficials, engagementByDistrict, credentialHash] = await Promise.all([
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
			: Promise.resolve(null),

		// Active credential hash → the public /v/[hash] verify URL in proof footers.
		// Auth-scoped (serverQuery carries the user's Convex token); resolves to the
		// same row resolveCredentialHash validates, so the link never 404s. Null when
		// the user has no active credential — callers then render no link.
		userId
			? serverQuery(api.users.getActiveCredentialHash, { userId: userId as Id<'users'> })
					.then((r) => r?.credentialHash ?? null)
					.catch(() => null)
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
			// Method drives the honest tier label (SSOT) — self-reported vs mDL vs postal —
			// so the email footer matches what /v/[hash] shows (no residency overclaim).
			verification_method: locals.user.verification_method,
			credentialHash
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
		districtOfficials: districtOfficials as DistrictOfficialInput[],
		recipientConfig,
		engagementByDistrict,
		// Honesty gating + coarse relation. These derived, non-identifying flags
		// are all that the guarded Convex query returns — no author id/district.
		viewerIsAuthor,
		viewerIsConstituent,
		baseRateRelation
	};
};
