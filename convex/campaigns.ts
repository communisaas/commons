import {
	query,
	mutation,
	action,
	internalMutation,
	internalQuery,
	internalAction
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { MutationCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { campaignType, campaignStatus } from './_validators';
import { requireOrgRole, loadOrg, requireAuth, requireOrgMembership } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import {
	TEMPLATE_LIST_MAX_PAGE_SIZE,
	readTemplateListPageByOrg,
	templateListPaginationValidator,
	toOrgTemplateListItem
} from './lib/templateListProjection';
import type { Doc, Id } from './_generated/dataModel';
import {
	computeOrgScopedEmailHash,
	computeOrgScopedPhoneHash,
	computeGlobalEmailHash,
	computeGlobalPhoneHash
} from './_orgHash';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { encryptForSupporterV2 } from './_orgKey';
import { hashDistrictCode, hashPostalCode } from './lib/districtHash';
import { applySupporterStatsDelta, type CountableSupporter } from './_supporterStats';
import {
	CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY,
	CAMPAIGN_ACTIVE_COUNTER_VERSION,
	recordCampaignCreated,
	recordCampaignRemoved,
	recordCampaignStatusTransition
} from './lib/campaignOrgCounters';
import { syncPublicOrganizationDirectory } from './lib/publicOrganizationDirectory';
import {
	applyCampaignActionReadModel,
	applyCampaignDeliveryBaselineReadModel,
	applyCampaignDeliveryTransitionReadModel
} from './lib/campaignReadModelDb';
import {
	CAMPAIGN_READ_MODEL_MIGRATION_KEY,
	CAMPAIGN_READ_MODEL_VERSION,
	emptyCampaignReadModel
} from './lib/campaignReadModel';
import { requireDebateReadModelReady } from './lib/debateReadModel';
import {
	applyCoalitionActionTransition,
	applyCoalitionReceiptProjection
} from './lib/coalitionMetrics';
import { ACCOUNTABILITY_RESPONSE_MAX } from './lib/accountabilityReadModel';
import {
	syncAccountabilityReceiptProjection,
	syncSupporterIdentityReceiptProjections
} from './lib/accountabilityReadModelDb';
import { normalizeSupporterBrowseSource, SUPPORTER_BROWSE_VERSION } from './lib/supporterBrowse';
import {
	applySupporterAudienceActionTransition,
	SUPPORTER_AUDIENCE_ACTION_VERSION
} from './lib/supporterAudience';
import { assertSupporterInputBudget } from './lib/supporterInputBudget';
import {
	engagementTierForReputationTier,
	reputationStateForActionCount
} from './lib/reputationTier';
import {
	blockEmailReservation,
	EMAIL_RESERVATION_LEASE_MS,
	reconcileEmailReservation,
	renewEmailReservationLease,
	reserveEmailUsage
} from './lib/planUsageReservations';

declare const process: { env: Record<string, string | undefined> };

const enqueuePlanUsageRepairRef = makeFunctionReference<'mutation'>(
	'planUsage:enqueueForOrg'
) as unknown as FunctionReference<'mutation', 'internal', { orgId: Id<'organizations'> }, unknown>;

const CAMPAIGN_REPORT_TARGET_LIMIT = 50;
const CAMPAIGN_REPORT_HTML_MAX_BYTES = 64 * 1024;
const CAMPAIGN_REPORT_DIGEST_RE = /^[a-f0-9]{64}$/i;

async function assertActiveTemplateAttributionAvailable(
	ctx: MutationCtx,
	args: {
		templateId: Id<'templates'>;
		orgId: Id<'organizations'>;
		excludeCampaignId: Id<'campaigns'>;
	}
): Promise<void> {
	const active = await ctx.db
		.query('campaigns')
		.withIndex('by_templateId_orgId_status', (q) =>
			q.eq('templateId', args.templateId).eq('orgId', args.orgId).eq('status', 'ACTIVE')
		)
		.take(2);
	if (active.some((campaign) => campaign._id !== args.excludeCampaignId)) {
		throw new Error('CAMPAIGN_ACTIVE_TEMPLATE_ATTRIBUTION_CONFLICT');
	}
	if (active.length > 1) {
		throw new Error('CAMPAIGN_ACTIVE_TEMPLATE_ATTRIBUTION_MULTIPLICITY');
	}
}

function assertCampaignReportPacketInput(args: {
	renderedHtml?: string;
	packetDigest?: string;
	proofWeight?: number;
	packetSummary?: ProofPacketSummary;
}): void {
	if (
		args.renderedHtml !== undefined &&
		new TextEncoder().encode(args.renderedHtml).byteLength > CAMPAIGN_REPORT_HTML_MAX_BYTES
	) {
		throw new Error('CAMPAIGN_REPORT_HTML_TOO_LARGE');
	}
	if (args.packetDigest !== undefined && !CAMPAIGN_REPORT_DIGEST_RE.test(args.packetDigest)) {
		throw new Error('CAMPAIGN_REPORT_PACKET_DIGEST_INVALID');
	}
	if (
		args.proofWeight !== undefined &&
		(!Number.isFinite(args.proofWeight) || args.proofWeight < 0 || args.proofWeight > 1)
	) {
		throw new Error('CAMPAIGN_REPORT_PROOF_WEIGHT_INVALID');
	}
	const summary = args.packetSummary;
	if (!summary) return;
	for (const [name, value] of [
		['verified', summary.verified],
		['total', summary.total],
		['districtCount', summary.districtCount]
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error(`CAMPAIGN_REPORT_PACKET_${name.toUpperCase()}_INVALID`);
		}
	}
	if (summary.verified > summary.total || summary.districtCount > summary.total) {
		throw new Error('CAMPAIGN_REPORT_PACKET_COUNTS_INCONSISTENT');
	}
	for (const [name, value] of [
		['gds', summary.gds],
		['ald', summary.ald],
		['cai', summary.cai],
		['temporalEntropy', summary.temporalEntropy]
	] as const) {
		if (value != null && (!Number.isFinite(value) || value < 0)) {
			throw new Error(`CAMPAIGN_REPORT_PACKET_${name.toUpperCase()}_INVALID`);
		}
	}
	if ((summary.gds ?? 0) > 1 || (summary.ald ?? 0) > 1) {
		throw new Error('CAMPAIGN_REPORT_PACKET_RATIO_INVALID');
	}
}

type ActiveCampaignForSubmission = {
	_id: Id<'campaigns'>;
	orgId: Id<'organizations'>;
};

type AuthenticatedCampaignSubmitter = {
	userId: Id<'users'>;
	normalizedEmail: string;
	identityCommitment?: string;
	trustTier: number;
	engagementTier: number;
} | null;

type FindOrCreateSupporterResult = {
	supporterId: Id<'supporters'>;
	isNew: boolean;
};

type CreateCampaignActionResult = {
	alreadySubmitted: boolean;
	actionCount: number;
	totalCount?: number;
};

type SubmitActionResult = {
	success: true;
	// K-floor at 5 (null below 5, exact above) — see submitAction return.
	actionCount: number | null;
	supporterName: string;
	alreadySubmitted?: true;
	totalCount?: number | null;
	verified?: boolean;
};

type CampaignTarget = {
	name?: string;
	email: string;
	title?: string;
	district?: string;
	decisionMakerId?: Id<'decisionMakers'> | string;
};

type ReceiptEligibility =
	| 'eligible'
	| 'missing_bill'
	| 'unresolved_target'
	| 'missing_bill_and_target';

type ReceiptReadiness = {
	receiptEligibility: ReceiptEligibility;
	receiptBlockers: string[];
};

type ProofPacketSummary = {
	verified: number;
	total: number;
	districtCount: number;
	gds?: number | null;
	ald?: number | null;
	cai?: number | null;
	temporalEntropy?: number | null;
};

function receiptReadinessFor(
	billId: Id<'bills'> | undefined,
	decisionMakerId: Id<'decisionMakers'> | undefined
): ReceiptReadiness {
	const missingBill = !billId;
	const unresolvedTarget = !decisionMakerId;
	if (!missingBill && !unresolvedTarget) {
		return { receiptEligibility: 'eligible', receiptBlockers: [] };
	}
	if (missingBill && unresolvedTarget) {
		return {
			receiptEligibility: 'missing_bill_and_target',
			receiptBlockers: ['missing_bill', 'unresolved_target']
		};
	}
	if (missingBill) {
		return { receiptEligibility: 'missing_bill', receiptBlockers: ['missing_bill'] };
	}
	return { receiptEligibility: 'unresolved_target', receiptBlockers: ['unresolved_target'] };
}

async function resolveDecisionMakerForTarget(
	ctx: { db: any },
	target: Pick<CampaignTarget, 'email' | 'decisionMakerId'>
): Promise<Doc<'decisionMakers'> | null> {
	if (target.decisionMakerId) {
		try {
			const existing = await ctx.db.get(target.decisionMakerId as Id<'decisionMakers'>);
			if (existing?.active) return existing;
		} catch {
			// Ignore malformed legacy target ids and fall back to email resolution.
		}
	}

	const trimmed = target.email.trim();
	const candidates = Array.from(new Set([trimmed, trimmed.toLowerCase()].filter(Boolean)));
	for (const email of candidates) {
		const match = await ctx.db
			.query('decisionMakers')
			.withIndex('by_email', (q: any) => q.eq('email', email))
			.first();
		if (match?.active) return match;
	}

	return null;
}

function packetSummaryFromSnapshot(snapshot: unknown): ProofPacketSummary | null {
	const summary =
		snapshot && typeof snapshot === 'object'
			? (snapshot as { summary?: Partial<ProofPacketSummary> }).summary
			: null;
	if (!summary) return null;
	if (
		typeof summary.verified !== 'number' ||
		typeof summary.total !== 'number' ||
		typeof summary.districtCount !== 'number'
	) {
		return null;
	}
	return {
		verified: summary.verified,
		total: summary.total,
		districtCount: summary.districtCount,
		gds: typeof summary.gds === 'number' ? summary.gds : null,
		ald: typeof summary.ald === 'number' ? summary.ald : null,
		cai: typeof summary.cai === 'number' ? summary.cai : null,
		temporalEntropy: typeof summary.temporalEntropy === 'number' ? summary.temporalEntropy : null
	};
}

function finiteOptional(value: number | null | undefined): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function computeReceiptAttestationDigest(
	packetDigest: string,
	billExternalId: string,
	decisionMakerId: Id<'decisionMakers'>,
	proofWeight: number
): Promise<string> {
	const scaledWeight = Math.round(proofWeight * 10000).toString();
	return sha256Hex(`${packetDigest}:${billExternalId}:${decisionMakerId}:${scaledWeight}`);
}

const getActiveCampaignRef = makeFunctionReference<'query'>(
	'campaigns:getActiveCampaign'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ campaignId: string },
	ActiveCampaignForSubmission | null
>;

type EmailPlanAdmission = {
	periodStart: number;
	usageReady: boolean;
	usageFailureCode: string | null;
	usageRepairRequired: boolean;
	usageRepairStatus: 'not_requested' | 'pending' | 'running' | 'ready' | 'blocked';
	limits: { maxEmails: number };
	current: { emailsSent: number; emailsReserved: number };
} | null;

const checkPlanLimitsByOrgIdRef = makeFunctionReference<'query'>(
	'subscriptions:checkPlanLimitsByOrgId'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ orgId: Id<'organizations'> },
	EmailPlanAdmission
>;
const getAuthenticatedCampaignSubmitterRef = makeFunctionReference<'query'>(
	'campaigns:getAuthenticatedCampaignSubmitter'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ userId: Id<'users'> },
	AuthenticatedCampaignSubmitter
>;
const findOrCreateSupporterRef = makeFunctionReference<'mutation'>(
	'campaigns:findOrCreateSupporter'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		orgId: Id<'organizations'>;
		emailHash: string;
		encryptedEmail: string;
		encryptedName?: string;
		postalCode?: string;
		encryptedPhone?: string;
		phoneHash?: string;
		globalEmailHash?: string;
		globalPhoneHash?: string;
		identityCommitment?: string;
		source: string;
	},
	FindOrCreateSupporterResult
>;
const createCampaignActionRef = makeFunctionReference<'mutation'>(
	'campaigns:createCampaignAction'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		campaignId: Id<'campaigns'>;
		supporterId: Id<'supporters'>;
		verified: boolean;
		engagementTier: number;
		districtHash?: string;
		districtCode?: string;
		h3Cell?: string;
		messageHash?: string;
		trustTier?: number;
		compositionMode?: string;
		atlasVersion?: string;
		userId?: Id<'users'>;
	},
	CreateCampaignActionResult
>;

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Authenticated, paginated campaign list for an org.
 * Reads denormalized actionCount/verifiedActionCount from campaign docs.
 */
export const list = query({
	args: {
		slug: v.string(),
		status: v.optional(campaignStatus),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, { slug, status, paginationOpts }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		if (!Number.isSafeInteger(paginationOpts.numItems) || paginationOpts.numItems < 1) {
			throw new Error('CAMPAIGN_LIST_PAGE_SIZE_INVALID');
		}
		if (paginationOpts.cursor !== null && paginationOpts.cursor.length > 2_048) {
			throw new Error('CAMPAIGN_LIST_CURSOR_INVALID');
		}
		const numItems = Math.min(paginationOpts.numItems, 100);

		const campaignQuery = status
			? ctx.db
					.query('campaigns')
					.withIndex('by_orgId_status', (q) => q.eq('orgId', org._id).eq('status', status))
			: ctx.db.query('campaigns').withIndex('by_orgId', (q) => q.eq('orgId', org._id));
		const results = await campaignQuery.order('desc').paginate({
			numItems,
			cursor: paginationOpts.cursor,
			maximumRowsRead: numItems + 1,
			maximumBytesRead: 4 * 1024 * 1024
		});

		// Resolve template titles for campaigns that reference a template.
		// Pre-F19 the schema stored templateId as v.string() which forced a
		// dead lookup path (this block was empty). Post-F19 templateId is
		// v.id('templates'), so a direct ctx.db.get(c.templateId) works.
		const campaigns = await Promise.all(
			results.page.map(async (c) => {
				let templateTitle: string | null = null;
				if (c.templateId) {
					const tmpl = await ctx.db.get(c.templateId);
					templateTitle = tmpl?.title ?? null;
				}

				return {
					_id: c._id,
					title: c.title,
					type: c.type,
					status: c.status,
					body: c.body ?? null,
					templateId: c.templateId ?? null,
					templateTitle,
					debateEnabled: c.debateEnabled,
					debateThreshold: c.debateThreshold,
					actionCount: c.actionCount ?? 0,
					verifiedActionCount: c.verifiedActionCount ?? 0,
					targetCountry: c.targetCountry,
					targetJurisdiction: c.targetJurisdiction ?? null,
					goalAmountCents: c.goalAmountCents ?? null,
					raisedAmountCents: c.raisedAmountCents,
					donorCount: c.donorCount,
					updatedAt: c.updatedAt,
					_creationTime: c._creationTime
				};
			})
		);

		return {
			page: campaigns,
			isDone: results.isDone,
			continueCursor: results.continueCursor
		};
	}
});

/**
 * Public campaign by ID (any type). No auth required.
 * Returns public-safe fields. Used by submission pages (c/[slug], embed/campaign/[slug]).
 */
export const getPublicAny = query({
	args: { _secret: v.string(), campaignId: v.string() },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		let campaign;
		try {
			campaign = await ctx.db.get(campaignId as Id<'campaigns'>);
		} catch {
			return null;
		}
		if (!campaign || campaign.status !== 'ACTIVE') return null;

		const org = await ctx.db.get(campaign.orgId);

		// verifiedActionCount has a K-floor at 5 (null below 5, exact above) on
		// this public surface — sub-K cohort sizes name specific submitters; above
		// K the count is the product (campaign visibility). Org-admin paths read
		// the exact denormalized counter directly without the floor.
		const raw = campaign.verifiedActionCount ?? 0;
		const verifiedActionCount = raw < 5 ? null : raw;

		return {
			_id: campaign._id,
			title: campaign.title,
			type: campaign.type,
			status: campaign.status,
			body: campaign.body ?? null,
			orgName: org?.name ?? null,
			orgSlug: org?.slug ?? null,
			orgAvatar: org?.avatar ?? null,
			// Branding for the embed widget (D-09) + white-label flag (D-10).
			// Coalition-gated at the writer, so these are only set for Coalition
			// orgs that have configured branding; the widget falls back to its
			// default Commons styling otherwise.
			orgBrandingAccent: org?.brandingAccent ?? null,
			orgLogoUrl: org?.logoUrl ?? null,
			orgWhiteLabel: org?.whiteLabel ?? false,
			verifiedActionCount,
			targets: campaign.targets ?? null
		};
	}
});

/**
 * Public campaign by ID. No auth required.
 * Returns public-safe fields only. Includes org name/slug.
 * Used by: src/routes/d/[campaignId]/+page.server.ts
 */
export const getPublic = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;

		// Only expose active fundraisers publicly
		if (campaign.type !== 'FUNDRAISER' || campaign.status !== 'ACTIVE') {
			return null;
		}

		const org = await ctx.db.get(campaign.orgId);

		return {
			_id: campaign._id,
			title: campaign.title,
			type: campaign.type,
			status: campaign.status,
			body: campaign.body ?? null,
			goalAmountCents: campaign.goalAmountCents ?? null,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			targetCountry: campaign.targetCountry,
			orgName: org?.name ?? null,
			orgSlug: org?.slug ?? null,
			orgAvatar: org?.avatar ?? null
		};
	}
});

/**
 * Single campaign by ID. Requires org membership.
 */
export const get = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const { userId } = await requireAuth(ctx);

		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;

		// Verify the user is a member of the campaign's org
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId).eq('orgId', campaign.orgId))
			.first();

		if (!membership) {
			throw new Error('You are not a member of this organization');
		}

		return {
			_id: campaign._id,
			orgId: campaign.orgId,
			title: campaign.title,
			type: campaign.type,
			status: campaign.status,
			body: campaign.body ?? null,
			templateId: campaign.templateId ?? null,
			debateEnabled: campaign.debateEnabled,
			debateThreshold: campaign.debateThreshold,
			debateId: campaign.debateId ?? null,
			actionCount: campaign.actionCount ?? 0,
			verifiedActionCount: campaign.verifiedActionCount ?? 0,
			targets: campaign.targets ?? null,
			targetCountry: campaign.targetCountry,
			targetJurisdiction: campaign.targetJurisdiction ?? null,
			billId: campaign.billId ?? null,
			position: campaign.position ?? null,
			goalAmountCents: campaign.goalAmountCents ?? null,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? null,
			donationReceiptPolicy: campaign.donationReceiptPolicy ?? null,
			updatedAt: campaign.updatedAt,
			_creationTime: campaign._creationTime
		};
	}
});

/** Exact O(1) status counts maintained by the shared org-counter writer. */
export const getStatusCounts = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const migration = await ctx.db
			.query('campaignActiveCounterMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready' || !org.campaignStatusCounts) {
			throw new Error('CAMPAIGN_STATUS_COUNTERS_NOT_READY');
		}
		return {
			ALL: org.campaignStatusCounts.total,
			DRAFT: org.campaignStatusCounts.DRAFT,
			ACTIVE: org.campaignStatusCounts.ACTIVE,
			PAUSED: org.campaignStatusCounts.PAUSED,
			COMPLETE: org.campaignStatusCounts.COMPLETE
		};
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new campaign. Requires editor+ role.
 * Increments org's campaignCount and updates onboardingState.
 */
export const create = mutation({
	args: {
		slug: v.string(),
		title: v.string(),
		// Single-sourced from the shared campaignType validator so adding a
		// value (e.g. CONGRESSIONAL) is one edit, not a per-mutation inline
		// union to keep in sync.
		type: campaignType,
		body: v.optional(v.string()),
		templateId: v.optional(v.id('templates')),
		debateEnabled: v.optional(v.boolean()),
		debateThreshold: v.optional(v.number()),
		targetCountry: v.optional(v.string()),
		targetJurisdiction: v.optional(v.string()),
		billId: v.optional(v.id('bills')),
		position: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		if (!args.title.trim()) {
			throw new Error('Title is required');
		}

		// Runtime allowlist mirrors the campaignType union in
		// convex/_validators.ts. The args validator already rejects anything
		// outside the union; this is the redundant in-handler guard kept for
		// defense in depth.
		const validTypes = ['LETTER', 'EVENT', 'FORM', 'FUNDRAISER', 'CONGRESSIONAL'];
		if (!validTypes.includes(args.type)) {
			throw new Error('Invalid campaign type');
		}

		// Template ownership: a campaign may only link a template owned by the
		// caller's org. Without this, Org B could point a (congressional) campaign
		// at Org A's public template and siphon A's attributed actions — and leak
		// A's constituents' districtHash/districtCode/trustTier via the
		// campaign_action.created webhook. requireOrgRole(editor) above only proves
		// the caller can edit THIS org; it says nothing about the template's owner.
		if (args.templateId !== undefined) {
			const template = await ctx.db.get(args.templateId);
			if (!template || template.orgId !== org._id) {
				throw new Error('Template not found in this organization');
			}
		}

		const now = Date.now();

		const campaignId = await ctx.db.insert('campaigns', {
			orgId: org._id,
			title: args.title.trim(),
			type: args.type,
			body: args.body?.trim() ?? undefined,
			status: 'DRAFT',
			templateId: args.templateId ?? undefined,
			debateEnabled: args.debateEnabled ?? false,
			debateThreshold: args.debateThreshold ?? 50,
			targetCountry: args.targetCountry ?? org.countryCode,
			targetJurisdiction: args.targetJurisdiction,
			billId: args.billId,
			position: args.position,
			raisedAmountCents: 0,
			donorCount: 0,
			actionCount: 0,
			verifiedActionCount: 0,
			orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION,
			updatedAt: now
		});

		await recordCampaignCreated(ctx, org._id, 'DRAFT', now);
		const currentOnboarding = org.onboardingState ?? {
			hasDescription: !!org.description,
			hasIssueDomains: false,
			hasSupporters: false,
			hasCampaigns: false,
			hasTeam: false,
			hasSentEmail: false
		};

		await ctx.db.patch(org._id, {
			onboardingState: {
				...currentOnboarding,
				hasCampaigns: true
			},
			updatedAt: now
		});
		await syncPublicOrganizationDirectory(ctx, org._id);

		return campaignId;
	}
});

/**
 * Clone a campaign. Copies content fields onto a new DRAFT with all counters
 * reset; status starts as DRAFT regardless of the source status. The new
 * title gets a " (copy)" suffix. Requires editor+ role.
 *
 * Linked donation page IDs are intentionally NOT carried over — a clone is a
 * fresh DRAFT, not a continuation; the editor wires a new donation page if
 * they want one. `debateId` is also dropped for the same reason.
 */
export const clone = mutation({
	args: {
		slug: v.string(),
		sourceCampaignId: v.id('campaigns')
	},
	handler: async (ctx, { slug, sourceCampaignId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');

		const source = await ctx.db.get(sourceCampaignId);
		if (!source || source.orgId !== org._id) {
			throw new Error('Campaign not found');
		}

		const now = Date.now();
		const newCampaignId = await ctx.db.insert('campaigns', {
			orgId: org._id,
			title: `${source.title} (copy)`,
			type: source.type,
			body: source.body,
			status: 'DRAFT',
			templateId: source.templateId,
			debateEnabled: source.debateEnabled,
			debateThreshold: source.debateThreshold,
			targetCountry: source.targetCountry,
			targetJurisdiction: source.targetJurisdiction,
			targets: source.targets,
			billId: source.billId,
			position: source.position,
			districtCode: source.districtCode,
			districtCentroid: source.districtCentroid,
			goalAmountCents: source.goalAmountCents,
			donationCurrency: source.donationCurrency,
			raisedAmountCents: 0,
			donorCount: 0,
			actionCount: 0,
			verifiedActionCount: 0,
			tier3VerifiedActionCount: 0,
			orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION,
			updatedAt: now
		});

		await recordCampaignCreated(ctx, org._id, 'DRAFT', now);
		await syncPublicOrganizationDirectory(ctx, org._id);

		return newCampaignId;
	}
});

/**
 * Update campaign fields. Requires editor+ role.
 */
export const update = mutation({
	args: {
		campaignId: v.id('campaigns'),
		slug: v.string(),
		title: v.optional(v.string()),
		type: v.optional(campaignType),
		body: v.optional(v.string()),
		status: v.optional(campaignStatus),
		templateId: v.optional(v.id('templates')),
		debateEnabled: v.optional(v.boolean()),
		debateThreshold: v.optional(v.number()),
		targetCountry: v.optional(v.string()),
		targetJurisdiction: v.optional(v.string()),
		position: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}
		const updates: Record<string, unknown> = {
			updatedAt: Date.now()
		};

		if (args.title !== undefined) {
			if (!args.title.trim()) throw new Error('Title is required');
			updates.title = args.title.trim();
		}
		if (args.type !== undefined) {
			// Runtime allowlist mirrors the campaignType union in
			// convex/_validators.ts (args validator already enforces it; this
			// is the redundant defense-in-depth guard).
			const validTypes = ['LETTER', 'EVENT', 'FORM', 'FUNDRAISER', 'CONGRESSIONAL'];
			if (!validTypes.includes(args.type)) {
				throw new Error('Invalid campaign type');
			}
			updates.type = args.type;
		}
		if (args.body !== undefined) updates.body = args.body.trim() || undefined;
		if (args.status !== undefined) {
			const validStatuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'];
			if (!validStatuses.includes(args.status)) {
				throw new Error('Invalid status');
			}
			updates.status = args.status;
		}
		if (args.templateId !== undefined) {
			// Template ownership: only allow linking a template owned by the
			// caller's org (same cross-org siphon/PII-leak risk as campaigns.create).
			// A falsy templateId means "unlink" and skips the ownership check.
			if (args.templateId) {
				const template = await ctx.db.get(args.templateId);
				if (!template || template.orgId !== org._id) {
					throw new Error('Template not found in this organization');
				}
			}
			updates.templateId = args.templateId || undefined;
		}
		const effectiveStatus = args.status ?? campaign.status;
		const effectiveTemplateId =
			args.templateId !== undefined ? args.templateId || undefined : campaign.templateId;
		if (
			effectiveStatus === 'ACTIVE' &&
			effectiveTemplateId &&
			(args.status !== undefined || args.templateId !== undefined)
		) {
			await assertActiveTemplateAttributionAvailable(ctx, {
				templateId: effectiveTemplateId,
				orgId: org._id,
				excludeCampaignId: campaign._id
			});
		}
		if (args.debateEnabled !== undefined) updates.debateEnabled = args.debateEnabled;
		if (args.debateThreshold !== undefined) updates.debateThreshold = args.debateThreshold;
		if (args.targetCountry !== undefined) updates.targetCountry = args.targetCountry;
		if (args.targetJurisdiction !== undefined) updates.targetJurisdiction = args.targetJurisdiction;
		if (args.position !== undefined) updates.position = args.position;

		if (args.status !== undefined && args.status !== campaign.status) {
			await recordCampaignStatusTransition(ctx, campaign, args.status);
		}
		await ctx.db.patch(args.campaignId, updates);
		if (args.status !== undefined && args.status !== campaign.status) {
			await syncPublicOrganizationDirectory(ctx, org._id);
		}

		// Emit campaign.updated (A4) after a field edit via this path. No PII.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'campaign.updated',
			payload: JSON.stringify({
				campaignId: args.campaignId,
				timestamp: Date.now()
			})
		});

		return args.campaignId;
	}
});

/**
 * Delete a campaign and its actions/deliveries. Requires owner role.
 * Decrements org's campaignCount.
 */
export const remove = mutation({
	args: {
		campaignId: v.id('campaigns'),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'owner');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}
		const [queuedDelivery, sendingDelivery] = await Promise.all([
			ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId_status', (q) =>
					q.eq('campaignId', args.campaignId).eq('status', 'queued')
				)
				.first(),
			ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId_status', (q) =>
					q.eq('campaignId', args.campaignId).eq('status', 'sending')
				)
				.first()
		]);
		if (queuedDelivery || sendingDelivery) {
			throw new Error('CAMPAIGN_HAS_INFLIGHT_REPORT_DELIVERIES');
		}

		// Enumerate-to-delete over campaignActions/campaignDeliveries — both grow
		// with supporter activity and can exceed BOTH the per-query doc-read cap
		// (the `.collect()` throws) AND the per-mutation write-op budget. Delete a
		// BOUNDED batch of each here, then drop the campaign row. Any remainder is
		// drained out-of-band by `purgeCampaignData` (bounded self-scheduling
		// batches). Orphaned action/delivery rows pointing at a now-deleted
		// campaign are read-safe: org/campaign-scoped readers resolve via the
		// campaign id and drop them once the campaign row is gone.
		const actions = await ctx.db
			.query('campaignActions')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const action of actions) {
			await applyCoalitionActionTransition(ctx, action, null);
			if (
				action.audienceActionProjectionVersion === 1 ||
				action.audienceActionProjectionVersion === SUPPORTER_AUDIENCE_ACTION_VERSION
			) {
				await applySupporterAudienceActionTransition(ctx, action, null);
			}
			await ctx.db.delete(action._id);
		}

		const deliveries = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const delivery of deliveries) {
			await ctx.db.delete(delivery._id);
		}
		const dimensions = await ctx.db
			.query('campaignReadModelDimensions')
			.withIndex('by_campaignId_kind', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const dimension of dimensions) await ctx.db.delete(dimension._id);
		const readModel = await ctx.db
			.query('campaignReadModels')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.unique();
		if (readModel) await ctx.db.delete(readModel._id);

		await recordCampaignRemoved(ctx, campaign);

		// Delete the campaign
		await ctx.db.delete(args.campaignId);

		await syncPublicOrganizationDirectory(ctx, org._id);

		// Drain any remaining child rows out-of-band if either batch saturated.
		if (
			actions.length >= CAMPAIGN_PURGE_BATCH ||
			deliveries.length >= CAMPAIGN_PURGE_BATCH ||
			dimensions.length >= CAMPAIGN_PURGE_BATCH
		) {
			await ctx.scheduler.runAfter(0, internal.campaigns.purgeCampaignData, {
				campaignId: args.campaignId
			});
		}

		return args.campaignId;
	}
});

/** Per-mutation cap on campaign child-row deletes. Under the ~4096 write-op budget. */
const CAMPAIGN_PURGE_BATCH = 24;

/**
 * Drain remaining campaignActions + campaignDeliveries for a deleted campaign
 * in bounded batches. Self-schedules until both child sets are empty. The
 * campaign row is already gone, so any in-flight orphans are read-safe.
 */
export const purgeCampaignData = internalMutation({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const actions = await ctx.db
			.query('campaignActions')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const action of actions) {
			await applyCoalitionActionTransition(ctx, action, null);
			if (
				action.audienceActionProjectionVersion === 1 ||
				action.audienceActionProjectionVersion === SUPPORTER_AUDIENCE_ACTION_VERSION
			) {
				await applySupporterAudienceActionTransition(ctx, action, null);
			}
			await ctx.db.delete(action._id);
		}
		const deliveries = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const delivery of deliveries) {
			await ctx.db.delete(delivery._id);
		}
		const dimensions = await ctx.db
			.query('campaignReadModelDimensions')
			.withIndex('by_campaignId_kind', (q) => q.eq('campaignId', args.campaignId))
			.take(CAMPAIGN_PURGE_BATCH);
		for (const dimension of dimensions) await ctx.db.delete(dimension._id);
		if (
			actions.length >= CAMPAIGN_PURGE_BATCH ||
			deliveries.length >= CAMPAIGN_PURGE_BATCH ||
			dimensions.length >= CAMPAIGN_PURGE_BATCH
		) {
			await ctx.scheduler.runAfter(0, internal.campaigns.purgeCampaignData, {
				campaignId: args.campaignId
			});
		}
		return {
			actionsRemoved: actions.length,
			deliveriesRemoved: deliveries.length,
			dimensionsRemoved: dimensions.length
		};
	}
});

/**
 * Record a manual response from a decision-maker on a campaign delivery.
 * Appends to the accountability receipt's responses array.
 */
export const recordResponse = mutation({
	args: {
		slug: v.string(),
		campaignId: v.id('campaigns'),
		deliveryId: v.id('campaignDeliveries'),
		type: v.union(
			v.literal('replied'),
			v.literal('meeting_requested'),
			v.literal('vote_cast'),
			v.literal('public_statement')
		),
		detail: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const VALID_TYPES = ['replied', 'meeting_requested', 'vote_cast', 'public_statement'];
		if (!VALID_TYPES.includes(args.type)) {
			throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`);
		}

		// Verify campaign belongs to org
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}

		// Find the delivery
		const matchedDelivery = await ctx.db.get(args.deliveryId);
		if (!matchedDelivery || matchedDelivery.campaignId !== args.campaignId) {
			throw new Error('Delivery not found for this campaign');
		}

		const response = {
			type: args.type,
			detail: args.detail?.trim()?.slice(0, 2000),
			confidence: 'reported',
			occurredAt: Date.now()
		};

		// Find the accountability receipt for this delivery
		const receipt = await ctx.db
			.query('accountabilityReceipts')
			.withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
			.first();

		if (receipt) {
			const responses = receipt.responses ?? [];
			if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
				throw new Error('ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED');
			}
			await ctx.db.patch(receipt._id, {
				responses: [...responses, response],
				updatedAt: Date.now()
			});
			await syncAccountabilityReceiptProjection(ctx, receipt._id);
			return { receiptId: receipt._id };
		}

		const responses = matchedDelivery.responses ?? [];
		if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
			throw new Error('ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED');
		}
		await ctx.db.patch(matchedDelivery._id, {
			responses: [...responses, response]
		});

		return { deliveryId: args.deliveryId, recorded: true };
	}
});

/** Valid status transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
	DRAFT: ['ACTIVE'],
	ACTIVE: ['PAUSED', 'COMPLETE'],
	PAUSED: ['ACTIVE', 'COMPLETE'],
	COMPLETE: []
};

/**
 * Update campaign status with transition validation. Requires editor+ role.
 */
export const updateStatus = mutation({
	args: {
		campaignId: v.id('campaigns'),
		slug: v.string(),
		status: v.union(
			v.literal('DRAFT'),
			v.literal('ACTIVE'),
			v.literal('PAUSED'),
			v.literal('COMPLETE')
		)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}

		const validStatuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'];
		if (!validStatuses.includes(args.status)) {
			throw new Error('Invalid status');
		}

		const allowed = VALID_TRANSITIONS[campaign.status] ?? [];
		if (!allowed.includes(args.status)) {
			throw new Error(`Cannot transition from ${campaign.status} to ${args.status}`);
		}

		await recordCampaignStatusTransition(ctx, campaign, args.status);
		await ctx.db.patch(args.campaignId, {
			status: args.status,
			updatedAt: Date.now()
		});
		await syncPublicOrganizationDirectory(ctx, org._id);

		// Emit campaign.updated (A4) on a status transition — co-equal with the
		// field-edit path so the event is not half-dead. No PII.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'campaign.updated',
			payload: JSON.stringify({
				campaignId: args.campaignId,
				status: args.status,
				timestamp: Date.now()
			})
		});

		return args.campaignId;
	}
});

/**
 * Add a target to a campaign's targets JSON array. Requires editor+ role.
 */
export const addTarget = mutation({
	args: {
		campaignId: v.id('campaigns'),
		slug: v.string(),
		target: v.object({
			name: v.string(),
			email: v.string(),
			title: v.optional(v.string()),
			district: v.optional(v.string())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}

		const targets = Array.isArray(campaign.targets) ? (campaign.targets as CampaignTarget[]) : [];

		if (targets.length >= 50) {
			throw new Error('Maximum of 50 targets per campaign');
		}

		const rawEmail = args.target.email.trim();
		const email = rawEmail.toLowerCase();
		if (targets.some((t) => t.email === email)) {
			throw new Error('A target with this email already exists');
		}

		const resolvedDecisionMaker = await resolveDecisionMakerForTarget(ctx, {
			email: rawEmail
		});
		const targetRow: CampaignTarget = {
			name: args.target.name.trim(),
			email,
			title: args.target.title?.trim() || undefined,
			district: args.target.district?.trim() || undefined
		};
		if (resolvedDecisionMaker) {
			targetRow.decisionMakerId = resolvedDecisionMaker._id;
		}

		targets.push(targetRow);

		await ctx.db.patch(args.campaignId, {
			targets,
			updatedAt: Date.now()
		});

		return args.campaignId;
	}
});

/**
 * Remove a target from a campaign by email. Requires editor+ role.
 */
export const removeTarget = mutation({
	args: {
		campaignId: v.id('campaigns'),
		slug: v.string(),
		email: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}

		const targets = Array.isArray(campaign.targets) ? (campaign.targets as CampaignTarget[]) : [];

		const email = args.email.trim().toLowerCase();
		const filtered = targets.filter((t) => t.email !== email);

		await ctx.db.patch(args.campaignId, {
			targets: filtered,
			updatedAt: Date.now()
		});

		return args.campaignId;
	}
});

// =============================================================================
// SUBMISSION — Public campaign action submission (no auth required)
// =============================================================================

/**
 * Internal query: Get an active campaign by ID (any type, not just FUNDRAISER).
 * Used by the submitAction action.
 */
export const getActiveCampaign = internalQuery({
	args: { campaignId: v.string() },
	handler: async (ctx, { campaignId }) => {
		// Try direct ID lookup first
		try {
			const campaign = await ctx.db.get(campaignId as Id<'campaigns'>);
			if (campaign && campaign.status === 'ACTIVE') {
				const org = await ctx.db.get(campaign.orgId);
				return {
					_id: campaign._id,
					orgId: campaign.orgId,
					orgSlug: org?.slug ?? '',
					type: campaign.type,
					title: campaign.title,
					debateEnabled: campaign.debateEnabled,
					debateThreshold: campaign.debateThreshold,
					debateId: campaign.debateId ?? null,
					actionCount: campaign.actionCount ?? 0,
					verifiedActionCount: campaign.verifiedActionCount ?? 0
				};
			}
		} catch {
			// Not a valid Convex ID — fall through
		}
		return null;
	}
});

/**
 * Resolve campaign-submission authority from a server-authenticated user ID.
 * The action separately requires this row's normalized email to match the
 * submitted address. Looking up authority by caller-supplied email would let
 * an anonymous submitter impersonate a registered user's trust and receipts.
 */
export const getAuthenticatedCampaignSubmitter = internalQuery({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) => {
		const user = await ctx.db.get(userId);

		if (!user?.email) return null;

		const engagementTier = engagementTierForReputationTier(user.reputationTier);

		return {
			userId: user._id,
			normalizedEmail: user.email.trim().toLowerCase(),
			identityCommitment: user.identityCommitment,
			trustTier: user.trustTier,
			engagementTier
		};
	}
});

/**
 * Internal mutation: Find or create a supporter for a campaign submission.
 * Returns the supporter ID and whether it was newly created.
 */
export const findOrCreateSupporter = internalMutation({
	args: {
		orgId: v.id('organizations'),
		emailHash: v.string(),
		encryptedEmail: v.string(),
		encryptedName: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		// Global hash pair (computed by the caller from plaintext, same
		// helpers as `supporters.create`) so existing legacy supporters
		// get backfilled when they submit a campaign action — closes the
		// gap where only NEW writes would otherwise populate globals.
		globalEmailHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		identityCommitment: v.optional(v.string()),
		source: v.string()
	},
	handler: async (ctx, args) => {
		assertSupporterInputBudget(args, 'CAMPAIGN_SUPPORTER_INPUT');
		if (args.identityCommitment !== undefined && args.identityCommitment.length > 256) {
			throw new Error('IDENTITY_COMMITMENT_TOO_LARGE');
		}
		const identityCommitment = args.identityCommitment?.trim();
		if (args.identityCommitment !== undefined && !identityCommitment) {
			throw new Error('IDENTITY_COMMITMENT_BLANK');
		}
		// Check for existing supporter by email hash
		const existing = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (idx) =>
				idx.eq('orgId', args.orgId).eq('emailHash', args.emailHash)
			)
			.first();

		if (existing) {
			// Update fields if not already set
			const patch: Record<string, unknown> = {};
			const existingIdentityCommitment = existing.identityCommitment?.trim() || undefined;
			const newlyBoundIdentity = !!identityCommitment && !existingIdentityCommitment;
			if (args.encryptedName && !existing.encryptedName) patch.encryptedName = args.encryptedName;
			if (args.postalCode && !existing.postalCode) patch.postalCode = args.postalCode;
			if (args.encryptedPhone && !existing.encryptedPhone)
				patch.encryptedPhone = args.encryptedPhone;
			if (args.phoneHash && !existing.phoneHash) patch.phoneHash = args.phoneHash;
			// Backfill global hashes on existing rows when the caller now
			// supplies them — legacy supporters submitting a new action
			// become reachable from the SES/TCPA webhooks without waiting
			// for the operator to run `backfillSupporterGlobalHashes`.
			if (args.globalEmailHash && !existing.globalEmailHash)
				patch.globalEmailHash = args.globalEmailHash;
			if (args.globalPhoneHash && !existing.globalPhoneHash)
				patch.globalPhoneHash = args.globalPhoneHash;
			if (
				identityCommitment &&
				existingIdentityCommitment &&
				existingIdentityCommitment !== identityCommitment
			) {
				throw new Error('SUPPORTER_IDENTITY_CONFLICT');
			}
			if (identityCommitment && existing.identityCommitment !== identityCommitment) {
				patch.identityCommitment = identityCommitment;
			}
			if (Object.keys(patch).length > 0) {
				patch.updatedAt = Date.now();
				assertSupporterInputBudget({ ...existing, ...patch }, 'CAMPAIGN_SUPPORTER_UPDATE');
				await ctx.db.patch(existing._id, patch);
				// postalCode / phone fill-ins are counted breakdown fields —
				// apply a transition delta so postalResolved / phonePresent stay
				// exact when a returning supporter supplies new contact data.
				await applySupporterStatsDelta(ctx, args.orgId, existing as CountableSupporter, {
					...(existing as CountableSupporter),
					...(patch as Partial<CountableSupporter>)
				});
			}
			if (newlyBoundIdentity) {
				await syncSupporterIdentityReceiptProjections(ctx, existing._id, args.orgId);
			}
			return { supporterId: existing._id, isNew: false };
		}

		// Create new supporter
		const now = Date.now();
		const supporterId = await ctx.db.insert('supporters', {
			orgId: args.orgId,
			encryptedEmail: args.encryptedEmail,
			emailHash: args.emailHash,
			globalEmailHash: args.globalEmailHash,
			encryptedName: args.encryptedName,
			postalCode: args.postalCode,
			country: 'US',
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash,
			globalPhoneHash: args.globalPhoneHash,
			identityCommitment,
			source: args.source,
			browseSource: normalizeSupporterBrowseSource(args.source),
			browseTagIds: [],
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			updatedAt: now
		});

		// Increment org supporterCount
		const org = await ctx.db.get(args.orgId);
		if (org) {
			const newCount = (org.supporterCount ?? 0) + 1;
			const onboarding = org.onboardingState ?? {
				hasDescription: false,
				hasIssueDomains: false,
				hasSupporters: false,
				hasCampaigns: false,
				hasTeam: false,
				hasSentEmail: false
			};
			await ctx.db.patch(args.orgId, {
				supporterCount: newCount,
				onboardingState: { ...onboarding, hasSupporters: true },
				updatedAt: now
			});
			await syncPublicOrganizationDirectory(ctx, args.orgId);
		}

		// Maintain the breakdown counters for the new row. Created subscribed/none
		// with no identity/consent; postal/phone/source contribute when present.
		await applySupporterStatsDelta(ctx, args.orgId, null, {
			emailStatus: 'subscribed',
			smsStatus: 'none',
			source: args.source,
			postalCode: args.postalCode,
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash
		});

		return { supporterId, isNew: true };
	}
});

/**
 * Internal mutation: Create a campaign action (dedup on supporter+campaign).
 * Returns action count and whether it was a duplicate.
 */
export const createCampaignAction = internalMutation({
	args: {
		campaignId: v.id('campaigns'),
		// Optional to support the congressional-delivery channel, which has no
		// server-side supporter row (constituent PII is never custodied for
		// person-layer CWC sends). Email/form/web actions still pass a real
		// supporterId; the schema field is already optional.
		supporterId: v.optional(v.id('supporters')),
		verified: v.boolean(),
		engagementTier: v.number(),
		districtHash: v.optional(v.string()),
		districtCode: v.optional(v.string()),
		h3Cell: v.optional(v.string()),
		messageHash: v.optional(v.string()),
		trustTier: v.optional(v.number()),
		compositionMode: v.optional(v.string()),
		atlasVersion: v.optional(v.string()),
		userId: v.optional(v.id('users')),
		// Delivery-channel discriminator (closed union mirrors the schema field).
		// Defaults to undefined (unattributed) when omitted, preserving existing
		// email/form writers that don't set it yet.
		channel: v.optional(
			v.union(v.literal('congressional'), v.literal('email'), v.literal('sms'), v.literal('web'))
		),
		// Congressional dedup key — the submission whose delivery produced this
		// action. Used in place of supporterId when the channel has no supporter.
		congressionalSubmissionId: v.optional(v.id('submissions')),
		// Whether this action consumes the org's METERED billing quota. Default
		// true preserves the org-initiated paths (email/form/web blasts). Set to
		// false for person-layer congressional deliveries: a constituent
		// contacting their own rep is attributed (campaign + org tier histogram)
		// for reach/reporting, but it is NOT org-initiated paid usage, so it must
		// not bump verifiedActionsLifetime (the metered billing base). This
		// restores the pre-attribution-emit non-metering of congressional sends.
		metersOrgQuota: v.optional(v.boolean()),
		// Delivery completeness for multi-recipient channels (congressional):
		// 'delivered' = every targeted chamber received the message; 'partial' =
		// at least one delivered AND at least one failed. Stored on the action so
		// the org ledger distinguishes full from partial delivery. Undefined for
		// single-recipient channels, treated as fully delivered.
		deliveryStatus: v.optional(v.union(v.literal('delivered'), v.literal('partial')))
	},
	handler: async (ctx, args) => {
		// Dedup via a single-doc composite-index lookup. Two keys depending on
		// channel:
		//   - supporter-bearing channels (email/form/web): (campaignId, supporterId)
		//   - congressional (no supporter): (campaignId, congressionalSubmissionId)
		// Without an index, a `withIndex("by_campaignId").collect()` would scan
		// every action for the campaign — two O(n) passes that hit Convex's
		// row-scan cap on popular campaigns. The composite indexes keep this a
		// single-doc lookup on either key.
		const alreadySubmitted = args.congressionalSubmissionId
			? await ctx.db
					.query('campaignActions')
					.withIndex('by_campaignId_congressionalSubmissionId', (q) =>
						q
							.eq('campaignId', args.campaignId)
							.eq('congressionalSubmissionId', args.congressionalSubmissionId)
					)
					.first()
			: args.supporterId
				? await ctx.db
						.query('campaignActions')
						.withIndex('by_campaignId_supporterId', (q) =>
							q.eq('campaignId', args.campaignId).eq('supporterId', args.supporterId)
						)
						.first()
				: null;

		// Denormalize orgId from campaign for billing query performance.
		// Also: returns `verifiedActionCount` from the denormalized
		// counter on the campaign row instead of re-scanning every
		// action — the counter is maintained below on every insert path.
		const campaign = await ctx.db.get(args.campaignId);
		const orgId = campaign?.orgId;

		if (alreadySubmitted) {
			return {
				alreadySubmitted: true,
				actionCount: campaign?.verifiedActionCount ?? 0
			};
		}

		// Validate h3Cell format: H3 res-7 indices are 15-char hex strings starting with '87'
		const h3Cell = args.h3Cell && /^8[0-9a-f]{14}$/.test(args.h3Cell) ? args.h3Cell : undefined;
		const normalizedDistrictCode = args.districtCode?.trim().toUpperCase();
		const districtCode =
			normalizedDistrictCode && /^[A-Z]{2}-(\d{2}|AL)$/.test(normalizedDistrictCode)
				? normalizedDistrictCode
				: undefined;

		// A registered user's verified action advances both durable reputation
		// coordinates before the immutable action and every derived attribution
		// are constructed. The enclosing mutation makes the user patch, action
		// insert, read models, histogram, and events one OCC-serialized commit.
		let effectiveEngagementTier = args.engagementTier;
		if (args.userId && args.verified) {
			const user = await ctx.db.get(args.userId);
			if (!user) throw new Error('CAMPAIGN_ACTION_USER_NOT_FOUND');
			const nextUserActionCount = (user.actionCount ?? 0) + 1;
			const nextUserReputation = reputationStateForActionCount(nextUserActionCount);
			await ctx.db.patch(args.userId, {
				actionCount: nextUserActionCount,
				reputationTier: nextUserReputation.reputationTier,
				updatedAt: Date.now()
			});
			effectiveEngagementTier = nextUserReputation.engagementTier;
		}

		const actionId = await ctx.db.insert('campaignActions', {
			campaignId: args.campaignId,
			orgId,
			supporterId: args.supporterId,
			verified: args.verified,
			engagementTier: effectiveEngagementTier,
			districtHash: args.districtHash,
			districtCode,
			h3Cell,
			messageHash: args.messageHash,
			trustTier: args.trustTier,
			compositionMode: args.compositionMode,
			atlasVersion: args.atlasVersion,
			channel: args.channel,
			congressionalSubmissionId: args.congressionalSubmissionId,
			deliveryStatus: args.deliveryStatus,
			delegated: false,
			audienceActionProjectionVersion: SUPPORTER_AUDIENCE_ACTION_VERSION,
			sentAt: Date.now()
		});
		await applyCampaignActionReadModel(ctx, actionId);
		const projectedAction = await ctx.db.get(actionId);
		if (!projectedAction) throw new Error('CAMPAIGN_ACTION_INSERT_FAILED');
		await applyCoalitionActionTransition(ctx, null, projectedAction);
		await applySupporterAudienceActionTransition(ctx, null, projectedAction);

		// Update campaign counters (reuse campaign from orgId lookup above).
		// Tier-3+ counter incremented when the action is BOTH verified AND
		// carries trustTier >= 3 (document-verified, ZKP-grade). The
		// denormalized `tier3VerifiedActionCount` lets `getCampaignForReport`
		// avoid a `.collect()` scan-cliff for this count.
		const isTier3Plus = args.verified && (args.trustTier ?? 0) >= 3;
		if (campaign) {
			const newActionCount = (campaign.actionCount ?? 0) + 1;
			const newVerifiedCount = args.verified
				? (campaign.verifiedActionCount ?? 0) + 1
				: (campaign.verifiedActionCount ?? 0);
			const newTier3Count = isTier3Plus
				? (campaign.tier3VerifiedActionCount ?? 0) + 1
				: (campaign.tier3VerifiedActionCount ?? 0);
			await ctx.db.patch(args.campaignId, {
				actionCount: newActionCount,
				verifiedActionCount: newVerifiedCount,
				tier3VerifiedActionCount: newTier3Count,
				updatedAt: Date.now()
			});
		}

		// Monotonic org-level counters bumped on insert — the only-ever-increments
		// bases for scale-safe dashboard + billing reads. Bumped here, next to the
		// campaign counter, so there's exactly one new write site and they can
		// never drift.
		//   - verifiedActionsLifetime: lifetime tally of VERIFIED actions, the base
		//     for billing metering (period usage = lifetime - period baseline,
		//     baseline snapshotted at billing-period rollover). Only verified
		//     actions count toward the metered quota.
		//   - actionTierCounts: engagement-tier histogram over ALL actions (matches
		//     the prior getDashboardStats loop, which counted every action's tier
		//     regardless of verified). engagementTier is immutable post-creation, so
		//     a monotonic counter is exact. Indexed 0-4; out-of-range tiers ignored.
		if (orgId) {
			const org = await ctx.db.get(orgId);
			if (org) {
				const patch: Record<string, unknown> = {};
				// Only bump the metered billing base for actions that consume the
				// org quota. Congressional person-layer deliveries pass
				// metersOrgQuota:false — attributed below (actionTierCounts /
				// campaign counters) but never charged to the org's paid usage.
				const metersOrgQuota = args.metersOrgQuota !== false;
				if (args.verified && metersOrgQuota) {
					patch.verifiedActionsLifetime = (org.verifiedActionsLifetime ?? 0) + 1;
				}
				const tier = effectiveEngagementTier;
				if (typeof tier === 'number' && tier >= 0 && tier <= 4) {
					const counts = [...(org.actionTierCounts ?? [0, 0, 0, 0, 0])];
					// Defensive: pad/truncate to exactly 5 slots in case a legacy doc
					// stored a shorter array.
					while (counts.length < 5) counts.push(0);
					counts[tier] = (counts[tier] ?? 0) + 1;
					patch.actionTierCounts = counts.slice(0, 5);
				}
				if (Object.keys(patch).length > 0) {
					await ctx.db.patch(orgId, patch);
				}
			}
		}

		// T5-1 — Auto-spawn debate when the verified-action count crosses the
		// configured threshold. Scheduled rather than synchronous so a slow
		// action-domain derivation doesn't block the action's response. The
		// mutation it calls is idempotent — re-checks campaign.debateId so
		// simultaneous threshold-crossers don't double-spawn.
		if (
			args.verified &&
			// Congressional emits are person-layer civic deliveries; their volume must
			// not force-spawn an org's debate. The recipientSubdivision nullifier
			// multiplier is not yet bounded (see the congressional-launch hardening
			// gating the CONGRESSIONAL flag flip), so an attacker could otherwise push
			// a victim's verifiedActionCount over the threshold. Debates spawn from
			// org-initiated action volume only.
			args.channel !== 'congressional' &&
			campaign?.debateEnabled &&
			!campaign?.debateId &&
			(campaign?.verifiedActionCount ?? 0) + 1 >= (campaign?.debateThreshold ?? 0)
		) {
			await ctx.scheduler.runAfter(0, internal.debates.atomicSpawnIfEligible, {
				campaignId: args.campaignId
			});
		}

		// Emit campaign_action.created event for outbound webhooks (T9-3) + SSE
		// subscribers (T9-7). Both share orgEvents via queueEvent. Per-org throttle
		// is enforced inside queueEvent's downstream consumers, not here. Skip if
		// orgId is undefined (defensive — should not occur if campaign exists).
		if (orgId) {
			const timestamp = Date.now();
			await ctx.runMutation(internal.orgWebhooks.queueEvent, {
				orgId,
				event: 'campaign_action.created',
				payload: JSON.stringify({
					campaignId: args.campaignId,
					actionId,
					verified: args.verified,
					engagementTier: effectiveEngagementTier,
					trustTier: args.trustTier ?? null,
					districtHash: args.districtHash ?? null,
					timestamp
				})
			});

			await ctx.runMutation(internal.workflows.dispatchTrigger, {
				orgId,
				triggerType: 'campaign_action',
				supporterId: args.supporterId,
				triggerEvent: {
					type: 'campaign_action',
					campaignId: args.campaignId,
					actionId,
					verified: args.verified,
					engagementTier: effectiveEngagementTier,
					trustTier: args.trustTier ?? null,
					districtHash: args.districtHash ?? null,
					h3Cell: h3Cell ?? null,
					compositionMode: args.compositionMode ?? null,
					atlasVersion: args.atlasVersion ?? null,
					timestamp
				}
			});
		}

		// Use the just-patched campaign counters for the return value
		// instead of re-scanning every action via `.collect()`. The new
		// value is what we just wrote, so it's exact.
		const totalCount = (campaign?.actionCount ?? 0) + 1;
		const verifiedCount = (campaign?.verifiedActionCount ?? 0) + (args.verified ? 1 : 0);
		return { alreadySubmitted: false, actionCount: verifiedCount, totalCount };
	}
});

/**
 * Public action: Submit a campaign action (sign a letter, etc.).
 * No auth required — supporters identify by email.
 * Handles PII encryption (random IV → action), supporter dedup, action dedup.
 */
export const submitAction = action({
	args: {
		_secret: v.string(),
		campaignId: v.string(),
		email: v.string(),
		name: v.string(),
		postalCode: v.optional(v.string()),
		phone: v.optional(v.string()),
		message: v.optional(v.string()),
		districtCode: v.optional(v.string()),
		h3Cell: v.optional(v.string()), // H3 res-7 cell index from client-side district resolution
		source: v.optional(v.string()),
		compositionMode: v.optional(v.string()), // 'individual' | 'shared' | 'edited'
		// NEW-E-2: atlas snapshot at action-time. Callers that resolved districts
		// via the shadow-atlas client know the manifest's cellMapRoot; pass it
		// here so packets can surface driftCount when the atlas rotates.
		atlasVersion: v.optional(v.string()),
		// Set only by the trusted SvelteKit boundary from locals.user. The
		// action verifies the canonical user row and exact normalized email
		// before deriving identity, trust, or reputation from it.
		authenticatedUserId: v.optional(v.id('users'))
	},
	handler: async (ctx, args): Promise<SubmitActionResult> => {
		requireInternalSecret(args._secret);
		// Validate early
		if (!args.email) throw new Error('Email is required');
		if (!args.name) throw new Error('Name is required');
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
			throw new Error('Please enter a valid email address');
		}
		if (args.message && args.message.length > 5000) {
			throw new Error('Message too long (5000 character maximum)');
		}

		// action-boundary length caps. SvelteKit gates are public-
		// facing, but Convex actions are also directly callable — defense-in-depth.
		if (args.email.length > 254) throw new Error('EMAIL_TOO_LARGE');
		if (args.name.length > 200) throw new Error('NAME_TOO_LARGE');
		if (args.campaignId.length > 64) throw new Error('CAMPAIGN_ID_TOO_LARGE');
		if (args.postalCode !== undefined && args.postalCode.length > 16) {
			throw new Error('POSTAL_CODE_TOO_LARGE');
		}
		if (args.phone !== undefined && args.phone.length > 32) {
			throw new Error('PHONE_TOO_LARGE');
		}
		if (args.districtCode !== undefined && args.districtCode.length > 64) {
			throw new Error('DISTRICT_CODE_TOO_LARGE');
		}
		if (args.h3Cell !== undefined && args.h3Cell.length > 32) {
			throw new Error('H3_CELL_TOO_LARGE');
		}
		if (args.source !== undefined && args.source.length > 64) {
			throw new Error('SOURCE_TOO_LARGE');
		}
		if (args.compositionMode !== undefined && args.compositionMode.length > 16) {
			throw new Error('COMPOSITION_MODE_TOO_LARGE');
		}

		const normalizedEmail = args.email.trim().toLowerCase();
		const userData = args.authenticatedUserId
			? await ctx.runQuery(getAuthenticatedCampaignSubmitterRef, {
					userId: args.authenticatedUserId
				})
			: null;
		if (args.authenticatedUserId && (!userData || userData.normalizedEmail !== normalizedEmail)) {
			throw new Error('AUTHENTICATED_SUBMITTER_MISMATCH');
		}

		// Get campaign first — needed for orgId
		const campaign = await ctx.runQuery(getActiveCampaignRef, {
			campaignId: args.campaignId
		});
		if (!campaign) {
			throw new Error('Campaign not found or inactive');
		}

		// Unseal org key — required for PII encryption
		const orgKey = await getOrgKeyForAction(ctx, campaign.orgId);
		if (!orgKey)
			throw new Error(
				'Organization encryption not configured. An org owner must set up encryption in org settings before accepting submissions.'
			);

		// Org-scoped email hash (deterministic, no secret key)
		const emailHash = await computeOrgScopedEmailHash(campaign.orgId, normalizedEmail);

		// Rate limit: 10 actions per minute per campaign+donor
		const rlKey = `campaigns.submitAction:${args.campaignId}:${emailHash.slice(0, 16)}`;
		const rl = await ctx.runMutation(internal._rateLimit.check, {
			key: rlKey,
			windowMs: 60_000,
			maxRequests: 10
		});
		if (!rl.allowed) throw new Error('Rate limit exceeded — please try again shortly');

		// Compute the global-hash pair from plaintext BEFORE the find-or-create
		// mutation so existing legacy supporters get backfilled in the same
		// mutation call. Computing globals only inside an `if (isNew)` branch
		// would leave existing rows invisible to the SES/TCPA webhooks until
		// an operator ran the backfill action.
		const globalEmailHash = await computeGlobalEmailHash(normalizedEmail);
		let phoneHash: string | undefined;
		let globalPhoneHash: string | undefined;
		if (args.phone) {
			const trimmedPhone = args.phone.trim();
			try {
				phoneHash = await computeOrgScopedPhoneHash(campaign.orgId, trimmedPhone);
				globalPhoneHash = await computeGlobalPhoneHash(trimmedPhone);
			} catch {
				// Non-E.164 input — both hashes intentionally undefined. The
				// supporter row still lands (email-only path); SMS opt-in/out
				// for this phone is unreachable until the user submits a valid
				// E.164-formatted number on a subsequent action.
				phoneHash = undefined;
				globalPhoneHash = undefined;
			}
		}

		// Encrypt PII pre-insert with the v=org-2 AAD scheme
		// (`eh:${emailHash}` anchor). Real ciphertext goes into the row on
		// the first insert — no placeholder, no patchEncryptedPii follow-up.
		// The two-phase create's crash window (where an insert could land a
		// placeholder row that the follow-up patch never reaches) is
		// structurally eliminated for new supporters. Existing supporters
		// reached via findOrCreateSupporter's existing-row branch still get
		// their global hashes backfilled but skip the placeholder ciphertext
		// write entirely.
		const [encEmail, encName, encPhone] = await Promise.all([
			encryptForSupporterV2(normalizedEmail, orgKey, emailHash, 'email'),
			args.name ? encryptForSupporterV2(args.name.trim(), orgKey, emailHash, 'name') : null,
			args.phone ? encryptForSupporterV2(args.phone.trim(), orgKey, emailHash, 'phone') : null
		]);

		const { supporterId } = await ctx.runMutation(findOrCreateSupporterRef, {
			orgId: campaign.orgId,
			emailHash,
			globalEmailHash,
			globalPhoneHash,
			identityCommitment: userData?.identityCommitment,
			encryptedEmail: JSON.stringify(encEmail),
			encryptedName: encName ? JSON.stringify(encName) : undefined,
			encryptedPhone: encPhone ? JSON.stringify(encPhone) : undefined,
			phoneHash,
			postalCode: args.postalCode,
			source: args.source ?? 'campaign'
		});

		// Compute district hash
		let districtHash: string | undefined;
		let districtVerified = false;
		const normalizedDistrictCode = args.districtCode?.trim().toUpperCase();
		const districtCodePattern = /^[A-Z]{2}-(\d{2}|AL)$/;
		if (normalizedDistrictCode && districtCodePattern.test(normalizedDistrictCode)) {
			districtHash = await hashDistrictCode(normalizedDistrictCode);
			districtVerified = true;
		} else if (args.postalCode) {
			districtHash = await hashPostalCode(args.postalCode);
		}

		// Compute message hash
		let messageHash: string | undefined;
		if (args.message) {
			const encoder = new TextEncoder();
			const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(args.message));
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			messageHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		}

		// Anonymous submissions use only submission-local verification heuristics;
		// they can never inherit authority by typing a registered user's email.
		const trustTier = userData?.trustTier ?? (districtVerified ? 2 : args.postalCode ? 1 : 0);
		const engagementTier = userData?.engagementTier ?? 0;

		// Create campaign action (dedup inside mutation)
		const verified = districtVerified || !!args.postalCode;

		const result = await ctx.runMutation(createCampaignActionRef, {
			campaignId: campaign._id,
			supporterId,
			verified,
			engagementTier,
			districtHash,
			districtCode: districtVerified ? normalizedDistrictCode : undefined,
			h3Cell: args.h3Cell,
			messageHash,
			trustTier,
			compositionMode: args.compositionMode,
			// NEW-E-1: thread userId so a verified action can advance actionCount,
			// reputationTier, and immutable engagement attribution atomically. Only
			// registered users carry it; anonymous-email submissions stay null.
			userId: userData?.userId,
			// NEW-E-2: atlas snapshot at action-time. driftCount in the packet
			// (verification-packet.ts) compares against the modal value across
			// the campaign; rotations surface as non-zero drift.
			atlasVersion: args.atlasVersion
		});

		// K-floor at 5 on the returned count: sub-K cohorts name specific
		// submitters, but above K the just-submitted user expects to see their
		// action counted precisely.
		const kFloor = (n: number | undefined): number | null => (n === undefined || n < 5 ? null : n);

		if (result.alreadySubmitted) {
			return {
				success: true,
				actionCount: kFloor(result.actionCount),
				supporterName: args.name,
				alreadySubmitted: true
			};
		}

		return {
			success: true,
			actionCount: kFloor(result.actionCount),
			totalCount: kFloor(result.totalCount),
			supporterName: args.name,
			verified
		};
	}
});

// =============================================================================
// Campaign stream helpers (for SSE polling replacement)
// =============================================================================

/**
 * Get campaign debateId (for SSE stream polling).
 */
export const getDebateId = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign) return null;
		return { debateId: campaign.debateId ?? null };
	}
});

/**
 * Get campaign for org detail page — includes template list and debate data.
 * Auth: org member.
 */
export const getForOrgPage = query({
	args: {
		slug: v.string(),
		campaignId: v.id('campaigns'),
		templatePaginationOpts: v.optional(templateListPaginationValidator)
	},
	handler: async (ctx, { slug, campaignId, templatePaginationOpts }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'member');

		const campaign = await ctx.db.get(campaignId);
		if (!campaign || campaign.orgId !== org._id) return null;

		const requestedPagination = templatePaginationOpts ?? {
			numItems: TEMPLATE_LIST_MAX_PAGE_SIZE,
			cursor: null
		};
		// Keep the selected option visible without ever returning a 51st row.
		// Reserving one slot preserves every range row and its continuation cursor.
		const pagination = {
			...requestedPagination,
			numItems: Math.min(
				requestedPagination.numItems,
				TEMPLATE_LIST_MAX_PAGE_SIZE - (campaign.templateId ? 1 : 0)
			)
		};
		const templatePage = await readTemplateListPageByOrg(
			ctx,
			org._id,
			pagination,
			'INVALID_ORG_TEMPLATE_PAGE_SIZE'
		);
		if (!templatePaginationOpts && !templatePage.isDone) {
			throw new ConvexError({
				code: 'ORG_TEMPLATE_PAGINATION_REQUIRED',
				maxPageSize: TEMPLATE_LIST_MAX_PAGE_SIZE
			});
		}

		const selectedTemplate = campaign.templateId
			? (templatePage.page.find((template) => template.templateId === campaign.templateId) ??
				(await ctx.db
					.query('templateListProjections')
					.withIndex('by_templateId', (q) => q.eq('templateId', campaign.templateId!))
					.unique()))
			: null;
		const selectedOrgTemplate =
			selectedTemplate?.orgId === org._id
				? { _id: selectedTemplate.templateId, title: selectedTemplate.title }
				: null;
		const sortedTemplates = templatePage.page
			.map(toOrgTemplateListItem)
			.concat(
				selectedOrgTemplate &&
					!templatePage.page.some((template) => template.templateId === selectedOrgTemplate._id)
					? [selectedOrgTemplate]
					: []
			)
			.sort((a, b) => a.title.localeCompare(b.title));
		const templateTitle = selectedOrgTemplate?.title ?? null;

		// Load debate data if campaign has a linked debate
		let debate = null;
		if (campaign.debateId) {
			const dbDebate = await ctx.db.get(campaign.debateId);
			if (dbDebate) {
				const winningArg =
					dbDebate.winningArgumentIndex != null
						? await ctx.db
								.query('debateArguments')
								.withIndex('by_debateId_argumentIndex', (idx) =>
									idx
										.eq('debateId', dbDebate._id)
										.eq('argumentIndex', dbDebate.winningArgumentIndex!)
								)
								.unique()
						: null;

				// Get template slug for debate
				let debateTemplateSlug = '';
				if (dbDebate.templateId) {
					const t = await ctx.db
						.query('templateListProjections')
						.withIndex('by_templateId', (q) => q.eq('templateId', dbDebate.templateId!))
						.unique();
					if (t) debateTemplateSlug = t.slug ?? '';
				}

				debate = {
					_id: dbDebate._id,
					propositionText: dbDebate.propositionText,
					status: dbDebate.status,
					deadline: dbDebate.deadline,
					argumentCount: dbDebate.argumentCount,
					uniqueParticipants: dbDebate.uniqueParticipants,
					winningStance: dbDebate.winningStance ?? null,
					aiPanelConsensus: dbDebate.aiPanelConsensus ?? null,
					resolutionMethod: dbDebate.resolutionMethod ?? null,
					governanceJustification: dbDebate.governanceJustification ?? null,
					templateSlug: debateTemplateSlug,
					winningArgument: winningArg ? { body: winningArg.body, stance: winningArg.stance } : null
				};
			}
		}

		// Action count for pre-threshold debate progress. Sub-class (B) pure
		// count — read the denormalized verifiedActionCount counter maintained at
		// createCampaignAction instead of a .collect() that throws past the
		// per-query doc cap once the campaign passes ~16K actions.
		const isActive = campaign.status !== 'DRAFT';
		let actionCount: number | null = null;
		if (isActive && campaign.debateEnabled && !campaign.debateId) {
			actionCount = campaign.verifiedActionCount ?? 0;
		}

		return {
			campaign: {
				_id: campaign._id,
				title: campaign.title,
				type: campaign.type,
				status: campaign.status,
				body: campaign.body ?? null,
				templateId: campaign.templateId ?? null,
				templateTitle,
				debateEnabled: campaign.debateEnabled,
				debateThreshold: campaign.debateThreshold,
				debateId: campaign.debateId ?? null,
				targets: campaign.targets ?? null,
				targetCountry: campaign.targetCountry,
				targetJurisdiction: campaign.targetJurisdiction ?? null,
				districtCode: campaign.districtCode ?? null,
				districtCentroid: campaign.districtCentroid ?? null,
				createdAt: campaign._creationTime,
				updatedAt: campaign.updatedAt
			},
			templates: sortedTemplates,
			templatePagination: {
				isDone: templatePage.isDone,
				continueCursor: templatePage.continueCursor,
				pageStatus: templatePage.pageStatus ?? null
			},
			debate,
			actionCount,
			memberRole: membership.role
		};
	}
});

/**
 * Public campaign lookup — used for verify-district (no auth).
 */
export const getPublicActive = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign || campaign.status !== 'ACTIVE') return null;
		return { _id: campaign._id };
	}
});

/**
 * Public campaign stats — constant-read projection, K-floor at 5 (sub-K
 * suppressed, exact above).
 *
 * Threat model: we defend against unique-identification at sub-K cohort
 * sizes — a count of 1-4 would name a specific submitter. Above K, counts
 * are exact by design because aggregate civic participation is the product
 * (decision-makers and the public are entitled to see "127 verified
 * constituents from 14 districts sent this"). Users at high risk of
 * timing-correlation attacks (state-level adversaries with out-of-band
 * signals on a specific target) should use pseudonymous submission modes;
 * we do not attempt to mask above-K +1 polling deltas.
 *
 * uniqueDistricts uses a lower floor (3) because rural campaigns often have
 * low district counts and the marginal anonymity gain past 3 is small. The
 * write-maintained campaign read model owns district cardinality; this public,
 * polled query must never scan the campaign action ledger. Tier-3 district
 * cardinality is suppressed until the projection tracks that subset exactly.
 */
export const getStats = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) {
			return {
				verifiedActions: null,
				totalActions: null,
				uniqueDistricts: null,
				tier3VerifiedActions: null,
				tier3UniqueDistricts: null
			};
		}

		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready') throw new Error('CAMPAIGN_READ_MODEL_NOT_READY');
		const model = await ctx.db
			.query('campaignReadModels')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.unique();
		if (model && model.state.version !== CAMPAIGN_READ_MODEL_VERSION) {
			throw new Error('CAMPAIGN_READ_MODEL_MISSING');
		}
		if (!model && (campaign.actionCount ?? 0) > 0) {
			throw new Error('CAMPAIGN_READ_MODEL_MISSING');
		}
		const state = model?.state ?? emptyCampaignReadModel(campaign.updatedAt);
		const verifiedCount = state.verifiedActionCount;
		const totalCount = state.actionCount;
		const tier3Count = campaign.tier3VerifiedActionCount ?? 0;

		const kFloor5 = (n: number): number | null => (n < 5 ? null : n);
		const kFloor3 = (n: number): number | null => (n < 3 ? null : n);

		return {
			verifiedActions: kFloor5(verifiedCount),
			totalActions: kFloor5(totalCount),
			uniqueDistricts: kFloor3(state.districtCount),
			tier3VerifiedActions: kFloor5(tier3Count),
			tier3UniqueDistricts: null
		};
	}
});

/**
 * Constant-read campaign proof/analytics source for trusted SSR. The caller
 * must establish org authorization before using this service credential.
 */
export const getReadModelBundle = query({
	args: {
		_secret: v.string(),
		campaignId: v.id('campaigns'),
		orgId: v.id('organizations')
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== args.orgId) throw new Error('CAMPAIGN_NOT_FOUND');
		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready') {
			throw new Error(migration?.failureCode ?? 'CAMPAIGN_READ_MODEL_NOT_READY');
		}
		const model = await ctx.db
			.query('campaignReadModels')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.unique();
		if (model && model.state.version !== CAMPAIGN_READ_MODEL_VERSION) {
			throw new Error('CAMPAIGN_READ_MODEL_MISSING');
		}
		if (!model && (campaign.actionCount ?? 0) > 0) throw new Error('CAMPAIGN_READ_MODEL_MISSING');

		let debate = null;
		if (campaign.debateId) {
			await requireDebateReadModelReady(ctx);
			const [debateDoc, debateModel] = await Promise.all([
				ctx.db.get(campaign.debateId),
				ctx.db
					.query('debateReadModels')
					.withIndex('by_debateId', (q) => q.eq('debateId', campaign.debateId!))
					.unique()
			]);
			if (!debateDoc || !debateModel) throw new Error('DEBATE_READ_MODEL_MISSING');
			const participantCount = debateModel.uniqueParticipants;
			debate = {
				marketPosition:
					typeof debateDoc.aiResolution === 'string' ? debateDoc.aiResolution : 'pending',
				totalStake: String(debateModel.totalStake),
				topArgumentScore: String(debateModel.topArgument?.weightedScore ?? 0),
				aiPanelConsensus: debateDoc.aiPanelConsensus ?? null,
				participantCount: participantCount >= 5 ? participantCount : null,
				resolutionHash:
					debateDoc.resolvedFromChain && typeof debateDoc.aiResolution === 'string'
						? debateDoc.aiResolution
						: null
			};
		}
		return { state: model?.state ?? emptyCampaignReadModel(campaign.updatedAt), debate };
	}
});

const CAMPAIGN_ACTION_MIGRATION_PAGE = 8;
const CAMPAIGN_DELIVERY_MIGRATION_PAGE = 32;

/** Self-paging legacy adoption; readers remain closed until explicit activation. */
export const migrateCampaignReadModels = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();
		let migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (!migration) {
			const id = await ctx.db.insert('campaignReadModelMigrations', {
				key: CAMPAIGN_READ_MODEL_MIGRATION_KEY,
				status: 'running',
				phase: 'actions',
				actionsScanned: 0,
				actionsAdopted: 0,
				deliveriesScanned: 0,
				deliveriesAdopted: 0,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		}
		if (!migration) throw new Error('CAMPAIGN_READ_MODEL_MIGRATION_STATE_MISSING');
		if (migration.status === 'ready' || migration.status === 'migrated') return migration;
		if (migration.status === 'blocked') {
			throw new Error(migration.failureCode ?? 'CAMPAIGN_READ_MODEL_MIGRATION_BLOCKED');
		}
		const expectedCursor = migration.cursor ?? null;
		if ((cursor ?? null) !== expectedCursor) {
			throw new Error('CAMPAIGN_READ_MODEL_MIGRATION_CURSOR_MISMATCH');
		}

		try {
			if (migration.phase === 'actions') {
				const page = await ctx.db.query('campaignActions').paginate({
					cursor: expectedCursor,
					numItems: CAMPAIGN_ACTION_MIGRATION_PAGE,
					maximumRowsRead: CAMPAIGN_ACTION_MIGRATION_PAGE + 1,
					maximumBytesRead: 2 * 1024 * 1024
				});
				let adopted = 0;
				for (const action of page.page) {
					if (action.readModelVersion !== CAMPAIGN_READ_MODEL_VERSION) {
						await applyCampaignActionReadModel(ctx, action._id, now);
						adopted += 1;
					}
				}
				const patch = {
					phase: page.isDone ? ('deliveries' as const) : ('actions' as const),
					cursor: page.isDone ? undefined : page.continueCursor,
					actionsScanned: migration.actionsScanned + page.page.length,
					actionsAdopted: migration.actionsAdopted + adopted,
					updatedAt: now
				};
				await ctx.db.patch(migration._id, patch);
				await ctx.scheduler.runAfter(0, internal.campaigns.migrateCampaignReadModels, {
					cursor: page.isDone ? null : page.continueCursor
				});
				return { ...migration, ...patch };
			}

			const page = await ctx.db.query('campaignDeliveries').paginate({
				cursor: expectedCursor,
				numItems: CAMPAIGN_DELIVERY_MIGRATION_PAGE,
				maximumRowsRead: CAMPAIGN_DELIVERY_MIGRATION_PAGE + 1,
				maximumBytesRead: 2 * 1024 * 1024
			});
			let adopted = 0;
			for (const delivery of page.page) {
				if (delivery.readModelVersion !== CAMPAIGN_READ_MODEL_VERSION) {
					await applyCampaignDeliveryBaselineReadModel(ctx, delivery._id, now);
					adopted += 1;
				}
			}
			const patch = {
				status: page.isDone ? ('migrated' as const) : ('running' as const),
				cursor: page.isDone ? undefined : page.continueCursor,
				deliveriesScanned: migration.deliveriesScanned + page.page.length,
				deliveriesAdopted: migration.deliveriesAdopted + adopted,
				updatedAt: now
			};
			await ctx.db.patch(migration._id, patch);
			if (!page.isDone) {
				await ctx.scheduler.runAfter(0, internal.campaigns.migrateCampaignReadModels, {
					cursor: page.continueCursor
				});
			}
			return { ...migration, ...patch };
		} catch (error) {
			const failureCode =
				error instanceof Error
					? error.message.slice(0, 200)
					: 'CAMPAIGN_READ_MODEL_MIGRATION_FAILED';
			await ctx.db.patch(migration._id, { status: 'blocked', failureCode, updatedAt: now });
			return { ...migration, status: 'blocked' as const, failureCode };
		}
	}
});

export const activateCampaignReadModels = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return migration;
		if (!migration || migration.status !== 'migrated') {
			throw new Error('CAMPAIGN_READ_MODEL_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

export const getCampaignReadModelReadiness = query({
	args: { _secret: v.string() },
	handler: async (ctx, { _secret }) => {
		requireInternalSecret(_secret);
		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					ready: migration.status === 'ready',
					phase: migration.phase,
					actionsScanned: migration.actionsScanned,
					actionsAdopted: migration.actionsAdopted,
					deliveriesScanned: migration.deliveriesScanned,
					deliveriesAdopted: migration.deliveriesAdopted,
					failureCode: migration.failureCode ?? null,
					updatedAt: migration.updatedAt
				}
			: {
					status: 'missing',
					ready: false,
					phase: null,
					actionsScanned: 0,
					actionsAdopted: 0,
					deliveriesScanned: 0,
					deliveriesAdopted: 0,
					failureCode: null,
					updatedAt: null
				};
	}
});

/**
 * NEW-E-3 — debate field populator for VerificationPacket. Returns the
 * DebateMarketSnapshot shape when the campaign has a linked debateId and
 * debate row exists; null otherwise. Top argument score is the max
 * weightedScore on any single debateArguments row.
 */
export const getDebateSnapshotForCampaign = query({
	args: { campaignId: v.id('campaigns') },
	handler: async () => {
		throw new Error('CAMPAIGN_DEBATE_SNAPSHOT_PUBLIC_QUERY_RETIRED');
	}
});

/**
 * Anonymous-safe campaign packet summary for /v/[hash]. Returns only date
 * precision (YYYY-MM-DD), no counts. Per-category breakdowns (authorship,
 * identityBreakdown) were removed because any deterministic exact count is
 * a polling oracle: an attacker watches a category tick from N to N+1 and
 * attributes that increment to their target's known activity window.
 * Bucketing each category to multiples of K only delays single-step
 * differencing; padding-bypass survives any L-diversity floor. The org-auth
 * surfaces get the full packet with exact breakdowns.
 */
export const getCampaignPacketSummary = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;
		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready') throw new Error('CAMPAIGN_READ_MODEL_NOT_READY');
		const model = await ctx.db
			.query('campaignReadModels')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.unique();
		const state = model?.state ?? emptyCampaignReadModel(campaign.updatedAt);
		if (state.actionCount === 0) {
			return {
				dateRange: null,
				verified: 0,
				total: 0,
				identityPhrase: null,
				authorshipPhrase: null,
				integrityPhrase: null,
				topDistricts: [] as Array<{ hash: string; count: number }>,
				attestationHash: null
			};
		}
		const earliest = state.firstSentAt ?? campaign.updatedAt;
		const latest = state.lastSentAt ?? earliest;
		const dateRange = {
			earliest: new Date(earliest).toISOString().split('T')[0],
			latest: new Date(latest).toISOString().split('T')[0],
			spanDays: Math.floor((latest - earliest) / (1000 * 60 * 60 * 24))
		};

		// T8-2 — staffer-legible aggregates, all K-floored.
		const K = 5;
		const total = state.actionCount;
		const verified = state.verifiedActionCount;

		// Identity breakdown — qualitative prose, not raw counts
		let identityPhrase: string | null = null;
		if (verified >= K) {
			const govId = state.trustTierCounts.slice(3).reduce((sum, count) => sum + count, 0);
			const address = state.trustTierCounts[2] ?? 0;
			const email = (state.trustTierCounts[0] ?? 0) + (state.trustTierCounts[1] ?? 0);
			const parts: string[] = [];
			if (govId >= K) parts.push('identity-document verified');
			if (address >= K) parts.push('address verified');
			if (email >= K) parts.push('email authenticated');
			identityPhrase = parts.length > 0 ? parts.join(' + ') : 'verification mixed';
		}

		// Authorship — qualitative
		let authorshipPhrase: string | null = null;
		if (verified >= K) {
			const withHash = state.messageHashActionCount;
			if (withHash >= K) {
				const ratio = state.uniqueMessageHashCount / withHash;
				if (ratio >= 0.7) authorshipPhrase = 'messages mostly individually composed';
				else if (ratio >= 0.3) authorshipPhrase = 'messages mixed between individual and shared';
				else authorshipPhrase = 'messages mostly shared template';
			}
		}

		// Integrity — qualitative prose covering the same axes the IntegrityAssessment
		// component renders, computed from action distribution.
		let integrityPhrase: string | null = null;
		if (verified >= K) {
			const gds =
				state.districtActionCount > 0
					? 1 - state.districtCountSquares / state.districtActionCount ** 2
					: null;
			const parts: string[] = [];
			if (gds !== null && gds >= 0.7) parts.push('spread across multiple areas');
			else if (gds !== null) parts.push('concentrated in a few areas');
			if (state.hourBucketCount >= 5) parts.push('submitted over time');
			integrityPhrase = parts.length > 0 ? parts.join(', ') : null;
		}

		// Top districts — K-floored. Sort by count desc, then hash for determinism.
		const topDistricts = state.topDistricts
			.filter(({ count }) => count >= K)
			.map(({ key: hash, count }) => ({ hash, count }))
			.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash)))
			.slice(0, 10);

		// Attestation hash from latest delivery's packetSnapshot
		let attestationHash: string | null = null;
		const latestDelivery = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.order('desc')
			.take(1);
		if (latestDelivery[0]?.packetDigest) {
			attestationHash = latestDelivery[0].packetDigest;
		}

		return {
			dateRange,
			verified: verified >= K ? verified : null,
			total: total >= K ? total : null,
			identityPhrase,
			authorshipPhrase,
			integrityPhrase,
			topDistricts,
			attestationHash
		};
	}
});

/**
 * Report preview: returns campaign, targets, and a staffer-legible packet summary.
 * Used by the report page to show what the decision-maker will receive.
 */
export const getReportPreview = query({
	args: {
		campaignId: v.id('campaigns'),
		orgSlug: v.string()
	},
	handler: async (ctx, { campaignId, orgSlug }) => {
		const { org } = await requireOrgRole(ctx, orgSlug, 'editor');
		const campaign = await ctx.db.get(campaignId);
		if (!campaign || campaign.orgId !== org._id) return null;

		const targets = (campaign.targets as CampaignTarget[]) ?? [];

		const migration = await ctx.db
			.query('campaignReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready') throw new Error('CAMPAIGN_READ_MODEL_NOT_READY');
		const model = await ctx.db
			.query('campaignReadModels')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.unique();

		return {
			campaign: {
				_id: campaign._id,
				title: campaign.title,
				status: campaign.status,
				type: campaign.type
			},
			targets: targets.map((t) => ({
				name: t.name ?? null,
				email: t.email,
				title: t.title ?? null,
				district: t.district ?? null,
				decisionMakerId: t.decisionMakerId ?? null
			})),
			packet: {
				verified: campaign.verifiedActionCount ?? 0,
				total: campaign.actionCount ?? 0,
				districtCount: model?.state.districtCount ?? 0
			},
			// HTML rendering happens server-side via report-template.ts
			renderedHtml: null
		};
	}
});

/**
 * Send a campaign report to selected decision-makers.
 * Creates campaignDelivery records, deduplicates targets, then schedules
 * dispatchReportEmails to send via SES immediately.
 */
export const sendReport = mutation({
	args: {
		campaignId: v.id('campaigns'),
		orgSlug: v.string(),
		targetEmails: v.array(v.string()),
		renderedHtml: v.optional(v.string()), // Pre-rendered report email HTML from server
		packetDigest: v.optional(v.string()),
		proofWeight: v.optional(v.float64()),
		packetSummary: v.optional(
			v.object({
				verified: v.number(),
				total: v.number(),
				districtCount: v.number(),
				gds: v.union(v.float64(), v.null()),
				ald: v.union(v.float64(), v.null()),
				cai: v.union(v.float64(), v.null()),
				temporalEntropy: v.union(v.float64(), v.null())
			})
		)
	},
	handler: async (ctx, args): Promise<{ error: string | null; deliveryCount: number }> => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		assertCampaignReportPacketInput(args);
		if (args.targetEmails.length > CAMPAIGN_REPORT_TARGET_LIMIT) {
			throw new Error('CAMPAIGN_REPORT_TARGET_LIMIT_EXCEEDED');
		}
		for (const email of args.targetEmails) {
			if (email.length < 1 || email.length > 254) {
				throw new Error('CAMPAIGN_REPORT_TARGET_EMAIL_INVALID');
			}
		}
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			return { error: 'Campaign not found', deliveryCount: 0 };
		}

		if (
			campaign.status !== 'ACTIVE' &&
			campaign.status !== 'PAUSED' &&
			campaign.status !== 'COMPLETE'
		) {
			return {
				error: 'Campaign must be active, paused, or complete to send reports',
				deliveryCount: 0
			};
		}

		const targets = (campaign.targets as CampaignTarget[]) ?? [];
		const plannedTargets: CampaignTarget[] = [];
		const seen = new Set<string>();

		for (const email of args.targetEmails) {
			if (seen.has(email)) continue;
			seen.add(email);
			const target = targets.find((t) => t.email === email);
			if (!target) continue;

			// Exact indexed dedup. More than one canonical row means legacy state
			// has already diverged; fail closed instead of choosing one silently.
			const existingRows = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId_targetEmail', (q) =>
					q.eq('campaignId', args.campaignId).eq('targetEmail', email)
				)
				.take(2);
			if (existingRows.length > 1) {
				throw new Error('CAMPAIGN_DELIVERY_DEDUP_STATE_DIVERGED');
			}
			const existing = existingRows[0];

			if (existing) continue; // One canonical target row; retries are idempotent.

			plannedTargets.push(target);
		}

		// Authoritative in-Convex gate: the Svelte route is only presentation.
		// This query executes in the same serializable mutation transaction, so a
		// direct client cannot bypass migration readiness, cancellation, rollover,
		// or the current exact projected quota.
		const limits = await ctx.runQuery(checkPlanLimitsByOrgIdRef, {
			orgId: org._id
		});
		if (!limits?.usageReady) {
			if (limits?.usageRepairRequired) {
				await ctx.runMutation(enqueuePlanUsageRepairRef, { orgId: org._id });
			}
			return {
				error: limits?.usageFailureCode ?? 'PLAN_USAGE_NOT_READY',
				deliveryCount: 0
			};
		}
		const emailQuotaRemaining = Math.max(
			0,
			limits.limits.maxEmails - limits.current.emailsSent - limits.current.emailsReserved
		);
		if (plannedTargets.length > emailQuotaRemaining) {
			return { error: 'EMAIL_QUOTA_EXCEEDED', deliveryCount: 0 };
		}

		let deliveryCount = 0;
		for (const target of plannedTargets) {
			const email = target.email;
			const resolvedDecisionMaker = await resolveDecisionMakerForTarget(ctx, target);
			const readiness = receiptReadinessFor(campaign.billId, resolvedDecisionMaker?._id);
			const packetSnapshot =
				args.renderedHtml || args.packetSummary
					? {
							...(args.renderedHtml ? { html: args.renderedHtml } : {}),
							...(args.packetSummary ? { summary: args.packetSummary } : {})
						}
					: undefined;

			const deliveryId = await ctx.db.insert('campaignDeliveries', {
				campaignId: args.campaignId,
				orgId: org._id,
				decisionMakerId: resolvedDecisionMaker?._id,
				billId: campaign.billId,
				targetEmail: email,
				targetName: target.name ?? email,
				targetTitle: target.title ?? '',
				targetDistrict: target.district,
				status: 'queued',
				packetSnapshot,
				packetDigest: args.packetDigest,
				proofWeight: args.proofWeight,
				receiptEligibility: readiness.receiptEligibility,
				receiptBlockers:
					readiness.receiptBlockers.length > 0 ? readiness.receiptBlockers : undefined,
				createdAt: Date.now()
			});
			const reservation = await reserveEmailUsage(ctx, {
				orgId: org._id,
				sourceType: 'campaignDelivery',
				sourceId: String(deliveryId),
				requestedCount: 1,
				admission: {
					periodStart: limits.periodStart,
					currentEmailsSent: limits.current.emailsSent,
					maxEmails: limits.limits.maxEmails
				},
				leaseExpiresAt: Date.now() + EMAIL_RESERVATION_LEASE_MS
			});
			await ctx.db.patch(deliveryId, { planUsageReservationId: reservation._id });
			await applyCampaignDeliveryBaselineReadModel(ctx, deliveryId);
			deliveryCount++;
		}

		// Schedule actual email dispatch for queued deliveries
		if (deliveryCount > 0) {
			await ctx.scheduler.runAfter(0, internal.campaigns.dispatchReportEmails, {
				campaignId: args.campaignId
			});
		}

		return { error: null, deliveryCount };
	}
});

/** Last serializable boundary before SES. The reservation was created with the
 * delivery, but cancellation/rollover can occur while its scheduled action is
 * waiting. Only a current-period active reservation may transition queued →
 * sending; retries see `sending` and cannot issue a second carrier request. */
export const claimReportDeliveryForDispatch = internalMutation({
	args: { deliveryId: v.id('campaignDeliveries') },
	handler: async (
		ctx,
		args
	): Promise<{ ok: boolean; reason: string | null; retryable: boolean }> => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery || delivery.status !== 'queued') {
			return { ok: false as const, reason: null, retryable: false };
		}
		if (!delivery.orgId || !delivery.planUsageReservationId) {
			throw new Error('CAMPAIGN_DELIVERY_RESERVATION_MISSING');
		}
		const reservation = await ctx.db.get(delivery.planUsageReservationId);
		if (!reservation || reservation.sourceId !== String(delivery._id)) {
			throw new Error('CAMPAIGN_DELIVERY_RESERVATION_MISMATCH');
		}
		const limits = await ctx.runQuery(checkPlanLimitsByOrgIdRef, {
			orgId: delivery.orgId
		});
		if (!limits?.usageReady) {
			if (limits?.usageRepairRequired) {
				await ctx.runMutation(enqueuePlanUsageRepairRef, { orgId: delivery.orgId });
			}
			return {
				ok: false as const,
				reason: limits?.usageFailureCode ?? 'PLAN_USAGE_NOT_READY',
				retryable:
					limits?.usageRepairRequired === true &&
					limits.usageRepairStatus !== 'blocked' &&
					!limits.usageFailureCode?.includes('RESERVATION_BLOCKED')
			};
		}
		if (limits.limits.maxEmails <= 0 || reservation.periodStart !== limits.periodStart) {
			await applyCampaignDeliveryTransitionReadModel(ctx, delivery._id, delivery.status, 'failed');
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason:
					limits.limits.maxEmails <= 0
						? 'PLAN_INACTIVE_BEFORE_DISPATCH'
						: 'RESERVATION_PERIOD_ROLLED_OVER_BEFORE_DISPATCH'
			});
			await ctx.db.patch(delivery._id, { status: 'failed' });
			return {
				ok: false as const,
				reason: limits.limits.maxEmails <= 0 ? 'EMAIL_QUOTA_INACTIVE' : 'RESERVATION_PERIOD_STALE',
				retryable: false
			};
		}
		await renewEmailReservationLease(ctx, reservation._id, Date.now() + EMAIL_RESERVATION_LEASE_MS);
		await applyCampaignDeliveryTransitionReadModel(ctx, delivery._id, delivery.status, 'sending');
		await ctx.db.patch(delivery._id, { status: 'sending' });
		return { ok: true as const, reason: null, retryable: false };
	}
});

/** A transport exception after SES authority was exercised is not evidence of
 * failure. Hold the reservation and block new admissions until an operator
 * reconciles against SES evidence. */
export const blockReportDeliveryAfterAmbiguousCarrierError = internalMutation({
	args: { deliveryId: v.id('campaignDeliveries'), failureCode: v.string() },
	handler: async (ctx, args) => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery || delivery.status !== 'sending' || !delivery.planUsageReservationId) return;
		await blockEmailReservation(ctx, delivery.planUsageReservationId, args.failureCode);
	}
});

/**
 * Internal action: Dispatch queued report emails via SES.
 * Finds all "queued" deliveries for a campaign, sends each via SES,
 * updates status to "sent" or "failed".
 */
export const dispatchReportEmails = internalAction({
	args: {
		campaignId: v.id('campaigns'),
		retryAttempt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
		const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
		const awsRegion = process.env.AWS_REGION || 'us-east-1';
		const fromEmail = process.env.SES_FROM_EMAIL || 'reports@commons.email';

		// Get queued deliveries first so configuration failures can mark them failed.
		const deliveries = await ctx.runQuery(internal.campaigns.getQueuedDeliveries, {
			campaignId: args.campaignId
		});
		if (deliveries.length === 0) return;

		if (!awsAccessKeyId || !awsSecretAccessKey) {
			console.error(
				'[dispatchReportEmails] AWS SES credentials not configured — marking deliveries as failed'
			);
			for (const delivery of deliveries) {
				await ctx.runMutation(internal.campaigns.updateDeliveryStatus, {
					deliveryId: delivery._id,
					status: 'failed'
				});
			}
			return;
		}

		// Get campaign + org for email content
		const campaign = await ctx.runQuery(internal.campaigns.getCampaignForReport, {
			campaignId: args.campaignId
		});
		if (!campaign) return;

		// Build the report email subject — "constituent actions" is honest across
		// both tier-2 heuristic and tier-3+ ID-verified rows. The ID-verified subset
		// is called out in the body for staffers who weight by verification depth.
		const subject = `${campaign.verifiedActionCount} constituent actions — ${campaign.title}`;

		// Prefer pre-rendered HTML from server (matches preview), fall back to inline template
		const fallbackHtml = buildReportEmailHtml(campaign);

		for (const delivery of deliveries) {
			const claim: { ok: boolean; reason: string | null; retryable: boolean } =
				await ctx.runMutation(internal.campaigns.claimReportDeliveryForDispatch, {
					deliveryId: delivery._id
				});
			if (!claim.ok) {
				if (claim.retryable && (args.retryAttempt ?? 0) < 3) {
					const retryAttempt = (args.retryAttempt ?? 0) + 1;
					await ctx.scheduler.runAfter(
						30_000 * 2 ** (retryAttempt - 1),
						internal.campaigns.dispatchReportEmails,
						{
							campaignId: args.campaignId,
							retryAttempt
						}
					);
					return;
				}
				if (claim.reason?.startsWith('PLAN_USAGE_')) {
					// Blocked/inconsistent evidence requires operator reconciliation;
					// never turn it into a recurring scheduler/function-call bomb.
					console.error('[dispatchReportEmails] plan usage claim blocked', {
						campaignId: args.campaignId,
						reason: claim.reason
					});
					return;
				}
				continue;
			}
			const htmlBody = (delivery as Record<string, any>).packetHtml ?? fallbackHtml;

			try {
				const sesResult = await sendReportViaSes(
					delivery.targetEmail,
					fromEmail,
					campaign.orgName,
					subject,
					htmlBody,
					awsAccessKeyId,
					awsSecretAccessKey,
					awsRegion
				);

				if (!sesResult.ok && sesResult.ambiguous) {
					await ctx.runMutation(internal.campaigns.blockReportDeliveryAfterAmbiguousCarrierError, {
						deliveryId: delivery._id,
						failureCode: 'SES_OUTCOME_AMBIGUOUS'
					});
					continue;
				}
				await ctx.runMutation(internal.campaigns.updateDeliveryStatus, {
					deliveryId: delivery._id,
					status: sesResult.ok ? 'sent' : 'failed',
					sentAt: sesResult.ok ? Date.now() : undefined,
					sesMessageId: sesResult.ok ? (sesResult.messageId ?? undefined) : undefined
				});
			} catch (err) {
				console.error(
					`[dispatchReportEmails] Failed for ${delivery.targetEmail}:`,
					err instanceof Error ? err.message : err
				);
				await ctx.runMutation(internal.campaigns.blockReportDeliveryAfterAmbiguousCarrierError, {
					deliveryId: delivery._id,
					failureCode: 'SES_OUTCOME_AMBIGUOUS'
				});
			}
		}
	}
});

/** Internal query: get campaign data needed for report emails */
export const getCampaignForReport = internalQuery({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;
		const org = await ctx.db.get(campaign.orgId);

		// Tier partition for honest reporting: tier-3+ (document-verified,
		// ZKP-grade) action count. `.collect()`-ing every campaignAction and
		// filtering in memory would hit Convex's row-scan cap on popular
		// campaigns (10K+ actions) exactly during the report email build
		// phase. `tier3VerifiedActionCount` is denormalized on the campaign
		// row and maintained by `createCampaignAction` on every insert; we
		// read it directly.
		return {
			_id: campaign._id,
			title: campaign.title,
			orgName: org?.name ?? org?.slug ?? 'Organization',
			verifiedActionCount: campaign.verifiedActionCount ?? 0,
			tier3VerifiedActionCount: campaign.tier3VerifiedActionCount ?? 0,
			actionCount: campaign.actionCount ?? 0
		};
	}
});

/** Internal query: get queued deliveries for a campaign */
export const getQueuedDeliveries = internalQuery({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const deliveries = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId_status', (q) =>
				q.eq('campaignId', campaignId).eq('status', 'queued')
			)
			.take(51);
		if (deliveries.length > 50) throw new Error('CAMPAIGN_QUEUED_DELIVERY_LIMIT_EXCEEDED');
		return deliveries.map((d) => ({
			_id: d._id,
			targetEmail: d.targetEmail,
			targetName: d.targetName,
			targetTitle: d.targetTitle,
			targetDistrict: d.targetDistrict ?? null,
			packetHtml:
				((d.packetSnapshot as Record<string, unknown> | undefined)?.html as string | undefined) ??
				undefined
		}));
	}
});

async function maybeCreateAccountabilityReceiptForDelivery(
	ctx: MutationCtx,
	deliveryId: Id<'campaignDeliveries'>,
	proofDeliveredAt?: number
): Promise<Id<'accountabilityReceipts'> | null> {
	const delivery = await ctx.db.get(deliveryId);
	if (!delivery) return null;
	if (delivery.receiptEligibility !== 'eligible') return null;
	if (!delivery.decisionMakerId || !delivery.billId) return null;
	if (!delivery.packetDigest || typeof delivery.packetDigest !== 'string') return null;
	if (typeof delivery.proofWeight !== 'number' || !Number.isFinite(delivery.proofWeight)) {
		return null;
	}

	const packetSummary = packetSummaryFromSnapshot(delivery.packetSnapshot);
	if (!packetSummary || packetSummary.total <= 0 || packetSummary.verified <= 0) return null;

	const existing = await ctx.db
		.query('accountabilityReceipts')
		.withIndex('by_deliveryId', (q: any) => q.eq('deliveryId', deliveryId))
		.first();
	if (existing) {
		await syncAccountabilityReceiptProjection(ctx, existing._id);
		return existing._id;
	}

	const campaign = await ctx.db.get(delivery.campaignId);
	if (!campaign) return null;
	const decisionMaker = await ctx.db.get(delivery.decisionMakerId);
	if (!decisionMaker?.active) return null;
	const bill = await ctx.db.get(delivery.billId);
	if (!bill) return null;

	const now = Date.now();
	const billExternalId = bill.externalId ?? String(bill._id);
	const attestationDigest = await computeReceiptAttestationDigest(
		delivery.packetDigest,
		billExternalId,
		delivery.decisionMakerId,
		delivery.proofWeight
	);

	const receiptId = await ctx.db.insert('accountabilityReceipts', {
		decisionMakerId: delivery.decisionMakerId,
		dmName: decisionMaker.name,
		billId: delivery.billId,
		orgId: campaign.orgId,
		deliveryId,
		verifiedCount: packetSummary.verified,
		totalCount: packetSummary.total,
		gds: finiteOptional(packetSummary.gds),
		ald: finiteOptional(packetSummary.ald),
		cai: finiteOptional(packetSummary.cai),
		temporalEntropy: finiteOptional(packetSummary.temporalEntropy),
		districtCount: packetSummary.districtCount,
		proofWeight: delivery.proofWeight,
		attestationDigest,
		packetDigest: delivery.packetDigest,
		proofDeliveredAt: proofDeliveredAt ?? delivery.sentAt ?? now,
		causalityClass: 'pending',
		alignment: 0,
		status: 'pending_response',
		updatedAt: now
	});
	const receipt = await ctx.db.get(receiptId);
	if (!receipt) throw new Error('ACCOUNTABILITY_RECEIPT_INSERT_FAILED');
	await applyCoalitionReceiptProjection(ctx, receipt, bill.title);
	await syncAccountabilityReceiptProjection(ctx, receiptId);
	return receiptId;
}

/** Internal mutation: update a delivery's status */
export const updateDeliveryStatus = internalMutation({
	args: {
		deliveryId: v.id('campaignDeliveries'),
		status: v.string(),
		sentAt: v.optional(v.number()),
		// Persisted so the SES bounce/delivery webhook
		// (`webhooks.handleDeliveryEvent`) can find this row by its
		// SES-assigned MessageId. Without this field set, the webhook's
		// `by_sesMessageId` lookup always returns zero rows and
		// delivered/bounced/opened state never lands.
		sesMessageId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery) throw new Error('CAMPAIGN_DELIVERY_NOT_FOUND');
		const campaign = delivery.orgId ? null : await ctx.db.get(delivery.campaignId);
		const orgId = delivery.orgId ?? campaign?.orgId;
		if (!orgId) throw new Error('CAMPAIGN_DELIVERY_ORGANIZATION_MISSING');
		const firstConfirmedSend = args.status === 'sent' && delivery.sentAt === undefined;
		if (firstConfirmedSend && args.sentAt === undefined) {
			throw new Error('CAMPAIGN_DELIVERY_SENT_AT_REQUIRED');
		}
		if (firstConfirmedSend) {
			if (!delivery.planUsageReservationId) {
				throw new Error('CAMPAIGN_DELIVERY_RESERVATION_MISSING');
			}
			await reconcileEmailReservation(ctx, {
				reservationId: delivery.planUsageReservationId,
				absoluteSentCount: 1,
				terminal: true,
				terminalReason: 'SES_ACCEPTED'
			});
		} else if (
			args.status === 'failed' &&
			delivery.sentAt === undefined &&
			(delivery.status === 'queued' || delivery.status === 'sending')
		) {
			if (!delivery.planUsageReservationId) {
				throw new Error('CAMPAIGN_DELIVERY_RESERVATION_MISSING');
			}
			await reconcileEmailReservation(ctx, {
				reservationId: delivery.planUsageReservationId,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason: 'SES_REJECTED_BEFORE_ACCEPTANCE'
			});
		}
		await applyCampaignDeliveryTransitionReadModel(
			ctx,
			args.deliveryId,
			delivery.status,
			args.status
		);
		const patch: Record<string, unknown> = { status: args.status, orgId };
		// sentAt is immutable proof of the first carrier-accepted transition.
		if (args.sentAt !== undefined && delivery.sentAt === undefined) patch.sentAt = args.sentAt;
		if (args.sesMessageId) {
			// Convex has no native unique indexes; the webhook reads via
			// `.first()` and would silently update only one row if the
			// SES-assigned MessageId ever collided across our rows. SES
			// guarantees uniqueness per send, but if our state were ever
			// corrupted (manual seed insert, replay of a stale event with
			// wrong delivery id, etc.) the divergence would be invisible.
			//
			// Collision policy: the EARLIER row keeps the binding by
			// default. Two exceptions where we steal the binding:
			//   (1) The colliding row's status is `failed` — the earlier
			//       binding is stale (the SES attempt failed; the
			//       MessageId on that row is from a defunct send).
			//       Clear the earlier row's sesMessageId and take it here.
			//   (2) The colliding row's sentAt predates ours by more than
			//       SES-RECEIPT-MAX-AGE (30 days, SES retention boundary)
			//       — the earlier binding can no longer receive webhook
			//       updates anyway.
			// Otherwise drop our write: the earlier delivery keeps the
			// webhook correlation deterministically; our row's status still
			// moves to `sent` but its sesMessageId stays undefined.
			const colliding = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_sesMessageId', (q) => q.eq('sesMessageId', args.sesMessageId))
				.first();
			if (colliding && colliding._id !== args.deliveryId) {
				const SES_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
				const collidingIsStaleFailed = colliding.status === 'failed';
				const collidingIsExpired =
					colliding.sentAt !== undefined && Date.now() - colliding.sentAt > SES_RECEIPT_MAX_AGE_MS;
				if (collidingIsStaleFailed || collidingIsExpired) {
					console.warn(
						`[updateDeliveryStatus] sesMessageId collision: stealing binding from ${String(colliding._id).slice(0, 8)} (${collidingIsStaleFailed ? 'failed-status' : 'expired'}) → ${String(args.deliveryId).slice(0, 8)}`
					);
					// Preserve the cleared binding on the loser row so operators
					// can reconstruct the prior webhook correlation during
					// incident response. Bounded to last 16 ids so a pathological
					// sequence of collisions on the same row can't grow the
					// array toward Convex's 1 MiB doc limit. Real collisions
					// are rare (SES guarantees unique MessageId per send) — 16
					// is conservatively above any plausible forensic need.
					const PREVIOUS_IDS_CAP = 16;
					const priorIds = colliding.previousSesMessageIds ?? [];
					const nextIds = [...priorIds, args.sesMessageId as string].slice(-PREVIOUS_IDS_CAP);
					await ctx.db.patch(colliding._id, {
						sesMessageId: undefined,
						previousSesMessageIds: nextIds
					});
					patch.sesMessageId = args.sesMessageId;
				} else {
					console.warn(
						`[updateDeliveryStatus] sesMessageId collision: keeping earlier binding on ${String(colliding._id).slice(0, 8)} (status=${colliding.status}), dropping write on ${String(args.deliveryId).slice(0, 8)} (webhook correlation lost for this row)`
					);
					// Intentionally do NOT set patch.sesMessageId.
				}
			} else {
				patch.sesMessageId = args.sesMessageId;
			}
		}
		await ctx.db.patch(args.deliveryId, patch);
		if (args.status === 'sent') {
			await maybeCreateAccountabilityReceiptForDelivery(ctx, args.deliveryId, args.sentAt);
		}
	}
});

/**
 * Build a simple report email HTML inline (for Convex action context where
 * SvelteKit imports aren't available). The full rich template from
 * report-template.ts is used in the server-side preview.
 *
 * Site origin is read from PUBLIC_BASE_URL (default: https://commons.email).
 * Peer implementations override via the Convex dashboard so report links
 * resolve to their own deployment instead of the reference one.
 */
export function buildReportEmailHtml(campaign: {
	title: string;
	orgName: string;
	verifiedActionCount: number;
	tier3VerifiedActionCount?: number;
	_id: any;
}): string {
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://commons.email').replace(/\/$/, '');
	const tier3 = campaign.tier3VerifiedActionCount ?? 0;
	const hasTier3 = tier3 > 0;
	const tier3Line = hasTier3
		? `<tr><td style="padding:12px 0 0 0;"><p style="margin:0;font-size:13px;color:#525252;">Including <strong style="color:#171717;">${tier3.toLocaleString()}</strong> with government ID verification</p></td></tr>`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 0 32px 0;"><p style="margin:0;font-size:12px;font-weight:600;color:#a3a3a3;text-transform:uppercase;letter-spacing:.08em;">Constituent Report</p></td></tr>
<tr><td style="padding:0 0 8px 0;"><p style="margin:0;font-size:18px;font-weight:600;color:#171717;line-height:1.4;">${esc(campaign.title)}</p></td></tr>
<tr><td style="padding:0 0 28px 0;"><p style="margin:0;font-size:13px;color:#737373;">from ${esc(campaign.orgName)}</p></td></tr>
<tr><td style="padding:24px 0;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">
<p style="margin:0 0 4px 0;font-size:36px;font-weight:700;color:#171717;font-family:'Courier New',monospace;">${campaign.verifiedActionCount.toLocaleString()}</p>
<p style="margin:0;font-size:15px;color:#525252;">constituent actions</p>
${tier3Line}
</td></tr>
<tr><td style="padding:20px 0 0 0;"><p style="margin:0;font-size:13px;color:#525252;">One submission per person · duplicates removed</p></td></tr>
<tr><td style="padding:28px 0 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#f5f5f4;border:1px solid #e5e5e5;border-radius:6px;padding:12px 20px;">
<a href="${baseUrl}/v/${campaign._id}" style="font-size:13px;color:#525252;text-decoration:none;">Verify these claims independently &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:40px 0 0 0;">
<p style="margin:0;font-size:11px;color:#a3a3a3;line-height:1.6;">This report was generated by <a href="${baseUrl}" style="color:#a3a3a3;text-decoration:underline;">${esc(new URL(baseUrl).host)}</a>. Every claim is cryptographically attested and independently auditable.</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

/**
 * Send a report email via SES v2 using raw HTTP (same pattern as email.ts sendViaSes).
 */
async function sendReportViaSes(
	to: string,
	from: string,
	fromName: string,
	subject: string,
	htmlBody: string,
	accessKeyId: string,
	secretAccessKey: string,
	region: string
): Promise<
	{ ok: false; ambiguous: boolean } | { ok: true; messageId: string | null; ambiguous?: never }
> {
	const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
	const safeFromName = fromName.replace(/[\r\n\x00-\x1f\x7f]/g, '');
	const safeSubject = subject.replace(/[\r\n\x00-\x1f\x7f]/g, '');

	const body = JSON.stringify({
		Content: {
			Simple: {
				Subject: { Data: safeSubject, Charset: 'UTF-8' },
				Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } }
			}
		},
		Destination: { ToAddresses: [to] },
		FromEmailAddress: `${safeFromName} <${from}>`
	});

	const now = new Date();
	const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
	const amzDate = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
	const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
	const encoder = new TextEncoder();

	async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			key as BufferSource,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
	}

	async function sha256Hex(data: string): Promise<string> {
		const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	const payloadHash = await sha256Hex(body);
	const canonicalHeaders = `content-type:application/json\nhost:email.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'content-type;host;x-amz-date';
	const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
	const canonicalRequestHash = await sha256Hex(canonicalRequest);
	const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

	const kDate = await hmacSha256(encoder.encode('AWS4' + secretAccessKey), dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, 'ses');
	const kSigning = await hmacSha256(kService, 'aws4_request');
	const signatureBytes = await hmacSha256(kSigning, stringToSign);
	const signature = Array.from(new Uint8Array(signatureBytes))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

	try {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Amz-Date': amzDate,
				Authorization: authorization
			},
			body
		});
		if (!res.ok) return { ok: false, ambiguous: res.status >= 500 };
		// Parse the SES v2 response for the MessageId so the caller can
		// persist it on the campaignDelivery row. Without this, the SES
		// bounce/delivery webhook (`webhooks.handleDeliveryEvent`) has no
		// way to correlate inbound notifications to the delivery row —
		// the field stays undefined and every webhook call returns
		// `{ found: false }`. Treat parse failure as soft (the send did
		// succeed); the row still moves to `sent`, just without a
		// messageId. Operators see the soft case via the warn log below.
		let messageId: string | null = null;
		try {
			const payload = (await res.json()) as { MessageId?: unknown };
			if (typeof payload.MessageId === 'string' && payload.MessageId.length > 0) {
				messageId = payload.MessageId;
			}
		} catch {
			// Soft fail: don't unwind the send because we couldn't read the
			// response. The send was accepted by SES (res.ok); we just lose
			// webhook correlation for this row.
		}
		if (!messageId) {
			console.warn(
				'[sendReportViaSes] SES accepted send but response had no MessageId — webhook correlation will miss this row'
			);
		}
		return { ok: true, messageId };
	} catch {
		return { ok: false, ambiguous: true };
	}
}

/**
 * Get past deliveries for a campaign. Requires org membership.
 * Decrypts targetEmail/targetName from encrypted fields with plaintext fallback.
 */
export const getPastDeliveries = query({
	args: {
		campaignId: v.id('campaigns'),
		orgSlug: v.string(),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { campaignId, orgSlug, cursor, limit }) => {
		const { org } = await requireOrgRole(ctx, orgSlug, 'member');

		const campaign = await ctx.db.get(campaignId);
		if (!campaign || campaign.orgId !== org._id) return null;

		if (cursor && cursor.length > 2_048) throw new Error('DELIVERY_CURSOR_INVALID');
		const pageSize = Math.min(Math.max(Math.trunc(limit ?? 25), 1), 25);
		const page = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.order('desc')
			.paginate({
				cursor: cursor ?? null,
				numItems: pageSize,
				maximumRowsRead: pageSize + 1,
				maximumBytesRead: 2 * 1024 * 1024
			});

		const result = [];
		for (const d of page.page) {
			const receipt = await ctx.db
				.query('accountabilityReceipts')
				.withIndex('by_deliveryId', (q) => q.eq('deliveryId', d._id))
				.first();
			const packetSummary = packetSummaryFromSnapshot(d.packetSnapshot);
			const decisionMakerId = d.decisionMakerId ?? receipt?.decisionMakerId ?? undefined;
			const billId = d.billId ?? receipt?.billId ?? undefined;
			const readiness = receipt
				? { receiptEligibility: 'eligible' as const, receiptBlockers: [] }
				: d.receiptEligibility
					? {
							receiptEligibility: d.receiptEligibility,
							receiptBlockers: d.receiptBlockers ?? []
						}
					: receiptReadinessFor(billId, decisionMakerId);

			result.push({
				_id: d._id,
				receiptId: receipt?._id ?? null,
				decisionMakerId: decisionMakerId ?? null,
				billId: billId ?? null,
				targetEmail: d.targetEmail ?? null,
				targetName: d.targetName ?? null,
				encryptedTargetEmail: d.encryptedTargetEmail ?? null,
				encryptedTargetName: d.encryptedTargetName ?? null,
				targetTitle: d.targetTitle,
				targetDistrict: d.targetDistrict ?? null,
				status: d.status,
				sentAt: d.sentAt ?? null,
				createdAt: d.createdAt ?? null,
				receiptBacked: !!receipt,
				receiptEligibility: readiness.receiptEligibility,
				receiptBlockers: readiness.receiptBlockers,
				proofWeight: d.proofWeight ?? receipt?.proofWeight ?? null,
				verifiedCount: receipt?.verifiedCount ?? packetSummary?.verified ?? null,
				totalCount: receipt?.totalCount ?? packetSummary?.total ?? null,
				districtCount: receipt?.districtCount ?? packetSummary?.districtCount ?? null,
				packetDigest: d.packetDigest ?? receipt?.packetDigest ?? null,
				attestationDigest: receipt?.attestationDigest ?? null,
				responses: receipt?.responses ?? d.responses ?? []
			});
		}

		return {
			data: result,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone
		};
	}
});

/**
 * Look up the campaign linked to a debate (reverse of `campaign.debateId`).
 *
 * Used by `/api/debates/[debateId]/settle` to verify a debate is associated
 * with a campaign before allowing org-admin settlement. cure shipped.
 */
export const getCampaignByDebateId = query({
	args: { debateId: v.id('debates') },
	handler: async (ctx, { debateId }) => {
		const { userId } = await requireAuth(ctx);
		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_debateId', (idx) => idx.eq('debateId', debateId))
			.first();
		if (!campaign) return null;
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId).eq('orgId', campaign.orgId))
			.first();
		if (!membership) return null;
		const settlementRole =
			membership.role === 'owner' || membership.role === 'editor' ? membership.role : null;
		return {
			_id: campaign._id,
			orgId: campaign.orgId,
			title: campaign.title,
			status: campaign.status,
			templateId: campaign.templateId ?? null,
			settlementRole
		};
	}
});

/**
 * Operator-driven reconciliation for the denormalized counters on
 * `campaigns`. `actionCount`/`verifiedActionCount`/`tier3VerifiedActionCount`
 * are maintained by `createCampaignAction` on insert and the bounded purge
 * path on campaign deletion. A manual data fix or incomplete purge could still
 * desynchronize them, so the invariant needs a forensic verifier.
 *
 * This action recomputes the canonical counts from the source table
 * and reports drift. Operators run on demand (or via cron) and can
 * inspect divergence; not auto-corrected because a drift indicates
 * something is wrong upstream and silent repair would mask the cause.
 */
type CampaignCounterPage = {
	storedActionCount: number;
	storedVerifiedActionCount: number;
	storedTier3VerifiedActionCount: number;
	actualActionCount: number;
	actualVerifiedActionCount: number;
	actualTier3VerifiedActionCount: number;
	cursor: string | null;
};

const recomputeCampaignCountersRef = makeFunctionReference<'query'>(
	'campaigns:recomputeCampaignCounters'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ campaignId: Id<'campaigns'>; cursor?: string | null },
	CampaignCounterPage
>;

export const reconcileCampaignCounters = internalAction({
	args: { campaignId: v.id('campaigns') },
	handler: async (
		ctx,
		{ campaignId }
	): Promise<{
		storedActionCount: number;
		storedVerifiedActionCount: number;
		storedTier3VerifiedActionCount: number;
		actualActionCount: number;
		actualVerifiedActionCount: number;
		actualTier3VerifiedActionCount: number;
		drift: boolean;
	}> => {
		let cursor: string | null = null;
		let storedActionCount = 0;
		let storedVerifiedActionCount = 0;
		let storedTier3VerifiedActionCount = 0;
		let actualActionCount = 0;
		let actualVerifiedActionCount = 0;
		let actualTier3VerifiedActionCount = 0;
		do {
			const page: CampaignCounterPage = await ctx.runQuery(recomputeCampaignCountersRef, {
				campaignId,
				cursor
			});
			storedActionCount = page.storedActionCount;
			storedVerifiedActionCount = page.storedVerifiedActionCount;
			storedTier3VerifiedActionCount = page.storedTier3VerifiedActionCount;
			actualActionCount += page.actualActionCount;
			actualVerifiedActionCount += page.actualVerifiedActionCount;
			actualTier3VerifiedActionCount += page.actualTier3VerifiedActionCount;
			cursor = page.cursor;
		} while (cursor !== null);
		const result = {
			storedActionCount,
			storedVerifiedActionCount,
			storedTier3VerifiedActionCount,
			actualActionCount,
			actualVerifiedActionCount,
			actualTier3VerifiedActionCount,
			drift:
				storedActionCount !== actualActionCount ||
				storedVerifiedActionCount !== actualVerifiedActionCount ||
				storedTier3VerifiedActionCount !== actualTier3VerifiedActionCount
		};
		if (result.drift) {
			console.error(
				`[reconcileCampaignCounters] DRIFT detected for campaign ${campaignId}: ` +
					`stored=(${result.storedActionCount},${result.storedVerifiedActionCount},${result.storedTier3VerifiedActionCount}) ` +
					`actual=(${result.actualActionCount},${result.actualVerifiedActionCount},${result.actualTier3VerifiedActionCount})`
			);
		}
		return result;
	}
});

/** One bounded source page for the action-level forensic reconciler. */
export const recomputeCampaignCounters = internalQuery({
	args: {
		campaignId: v.id('campaigns'),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, { campaignId, cursor }) => {
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) {
			throw new Error('CAMPAIGN_NOT_FOUND');
		}
		if (cursor && cursor.length > 2_048) throw new Error('CAMPAIGN_RECONCILE_CURSOR_INVALID');
		const page = await ctx.db
			.query('campaignActions')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.paginate({
				cursor: cursor ?? null,
				numItems: 512,
				maximumRowsRead: 513,
				maximumBytesRead: 2 * 1024 * 1024
			});
		let actualActionCount = 0;
		let actualVerifiedActionCount = 0;
		let actualTier3VerifiedActionCount = 0;
		for (const action of page.page) {
			actualActionCount++;
			if (action.verified) {
				actualVerifiedActionCount++;
				if ((action.trustTier ?? 0) >= 3) {
					actualTier3VerifiedActionCount++;
				}
			}
		}
		const storedActionCount = campaign.actionCount ?? 0;
		const storedVerifiedActionCount = campaign.verifiedActionCount ?? 0;
		const storedTier3VerifiedActionCount = campaign.tier3VerifiedActionCount ?? 0;
		return {
			storedActionCount,
			storedVerifiedActionCount,
			storedTier3VerifiedActionCount,
			actualActionCount,
			actualVerifiedActionCount,
			actualTier3VerifiedActionCount,
			cursor: page.isDone ? null : page.continueCursor
		};
	}
});
