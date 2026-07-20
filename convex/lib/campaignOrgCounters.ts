import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const CAMPAIGN_ACTIVE_COUNTER_VERSION = 1;
export const CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY = 'v1' as const;

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';

function campaignStatus(status: string): CampaignStatus {
	if (status === 'DRAFT' || status === 'ACTIVE' || status === 'PAUSED' || status === 'COMPLETE') {
		return status;
	}
	throw new Error('CAMPAIGN_STATUS_INVALID');
}

function statusCounts(org: Doc<'organizations'>) {
	return (
		org.campaignStatusCounts ?? {
			DRAFT: 0,
			ACTIVE: 0,
			PAUSED: 0,
			COMPLETE: 0,
			total: 0
		}
	);
}

export function isOperationalCampaignStatus(status: string): boolean {
	return status === 'ACTIVE' || status === 'PAUSED';
}

export function operationalCampaignDelta(before: string, after: string): number {
	return Number(isOperationalCampaignStatus(after)) - Number(isOperationalCampaignStatus(before));
}

async function patchOrgCounts(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	{
		campaignDelta = 0,
		activeDelta = 0,
		statusDeltas = [],
		now = Date.now()
	}: {
		campaignDelta?: number;
		activeDelta?: number;
		statusDeltas?: Array<{ status: CampaignStatus; delta: number }>;
		now?: number;
	}
): Promise<Doc<'organizations'>> {
	const org = await ctx.db.get(orgId);
	if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
	const nextStatusCounts = { ...statusCounts(org) };
	for (const { status, delta } of statusDeltas) {
		nextStatusCounts[status] = Math.max(0, nextStatusCounts[status] + delta);
		nextStatusCounts.total = Math.max(0, nextStatusCounts.total + delta);
	}
	await ctx.db.patch(orgId, {
		campaignCount: Math.max(0, (org.campaignCount ?? 0) + campaignDelta),
		activeCampaignCount: Math.max(0, (org.activeCampaignCount ?? 0) + activeDelta),
		campaignStatusCounts: nextStatusCounts,
		updatedAt: now
	});
	return { ...org, campaignCount: Math.max(0, (org.campaignCount ?? 0) + campaignDelta) };
}

/** Record a newly inserted, already-versioned campaign exactly once. */
export async function recordCampaignCreated(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	status: string,
	now = Date.now()
): Promise<void> {
	await patchOrgCounts(ctx, orgId, {
		campaignDelta: 1,
		activeDelta: isOperationalCampaignStatus(status) ? 1 : 0,
		statusDeltas: [{ status: campaignStatus(status), delta: 1 }],
		now
	});
}

/**
 * Adopt a legacy campaign before a transition/delete. The per-row marker makes
 * this commute with the bounded backfill: whichever mutation sees the row first
 * accounts for its current operational state and stamps it in one transaction.
 */
export async function adoptLegacyCampaignCounter(
	ctx: MutationCtx,
	campaign: Doc<'campaigns'>,
	now = Date.now()
): Promise<Doc<'campaigns'>> {
	if (campaign.orgCounterVersion === CAMPAIGN_ACTIVE_COUNTER_VERSION) return campaign;
	await patchOrgCounts(ctx, campaign.orgId, {
		activeDelta: isOperationalCampaignStatus(campaign.status) ? 1 : 0,
		statusDeltas: [{ status: campaign.status, delta: 1 }],
		now
	});
	await ctx.db.patch(campaign._id, { orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION });
	return { ...campaign, orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION };
}

export async function recordCampaignStatusTransition(
	ctx: MutationCtx,
	campaign: Doc<'campaigns'>,
	newStatus: string,
	now = Date.now()
): Promise<void> {
	await adoptLegacyCampaignCounter(ctx, campaign, now);
	const activeDelta = operationalCampaignDelta(campaign.status, newStatus);
	await patchOrgCounts(ctx, campaign.orgId, {
		activeDelta,
		statusDeltas: [
			{ status: campaign.status, delta: -1 },
			{ status: campaignStatus(newStatus), delta: 1 }
		],
		now
	});
}

export async function recordCampaignRemoved(
	ctx: MutationCtx,
	campaign: Doc<'campaigns'>,
	now = Date.now()
): Promise<void> {
	await adoptLegacyCampaignCounter(ctx, campaign, now);
	await patchOrgCounts(ctx, campaign.orgId, {
		campaignDelta: -1,
		activeDelta: isOperationalCampaignStatus(campaign.status) ? -1 : 0,
		statusDeltas: [{ status: campaign.status, delta: -1 }],
		now
	});
}
