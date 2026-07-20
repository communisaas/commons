import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
	CAMPAIGN_READ_MODEL_VERSION,
	applyCampaignActionToReadModel,
	applyCampaignDeliveryBaseline,
	applyCampaignDeliveryTransition,
	applyCampaignVerifyClick,
	campaignActionDimensionKeys,
	emptyCampaignReadModel,
	type CampaignDimensionCounts,
	type CampaignDimensionKind,
	type CampaignReadModelAction,
	type CampaignReadModelState
} from './campaignReadModel';

async function modelForCampaign(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	orgId: Id<'organizations'>,
	now: number
) {
	const existing = await ctx.db
		.query('campaignReadModels')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.unique();
	if (existing) return existing;

	const state = emptyCampaignReadModel(now);
	const id = await ctx.db.insert('campaignReadModels', { campaignId, orgId, state });
	const inserted = await ctx.db.get(id);
	if (!inserted) throw new Error('CAMPAIGN_READ_MODEL_INSERT_FAILED');
	return inserted;
}

async function incrementDimensions(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	action: CampaignReadModelAction,
	now: number
): Promise<CampaignDimensionCounts> {
	const prior: CampaignDimensionCounts = {};
	const keys = campaignActionDimensionKeys(action);

	for (const [kind, key] of Object.entries(keys) as Array<
		[CampaignDimensionKind, string | undefined]
	>) {
		if (!key) continue;
		const existing = await ctx.db
			.query('campaignReadModelDimensions')
			.withIndex('by_campaignId_kind_key', (q) =>
				q.eq('campaignId', campaignId).eq('kind', kind).eq('key', key)
			)
			.unique();
		prior[kind] = existing?.count ?? 0;
		if (existing) {
			await ctx.db.patch(existing._id, { count: existing.count + 1, updatedAt: now });
		} else {
			await ctx.db.insert('campaignReadModelDimensions', {
				campaignId,
				kind,
				key,
				count: 1,
				updatedAt: now
			});
		}
	}
	return prior;
}

export async function applyCampaignActionReadModel(
	ctx: MutationCtx,
	actionId: Id<'campaignActions'>,
	now = Date.now()
): Promise<CampaignReadModelState> {
	const action = await ctx.db.get(actionId);
	if (!action) throw new Error('CAMPAIGN_ACTION_NOT_FOUND');
	const campaign = await ctx.db.get(action.campaignId);
	if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
	const model = await modelForCampaign(ctx, campaign._id, campaign.orgId, now);
	if (action.readModelVersion === CAMPAIGN_READ_MODEL_VERSION) return model.state;

	const input: CampaignReadModelAction = {
		verified: action.verified,
		engagementTier: action.engagementTier,
		districtHash: action.districtHash,
		h3Cell: action.h3Cell,
		messageHash: action.messageHash,
		trustTier: action.trustTier,
		compositionMode: action.compositionMode,
		atlasVersion: action.atlasVersion,
		sentAt: action.sentAt
	};
	const prior = await incrementDimensions(ctx, campaign._id, input, now);
	const next = applyCampaignActionToReadModel(model.state, input, prior, now);
	await ctx.db.patch(model._id, { state: next });
	await ctx.db.patch(actionId, { readModelVersion: CAMPAIGN_READ_MODEL_VERSION });
	return next;
}

function hasVerifyClick(delivery: Pick<Doc<'campaignDeliveries'>, 'responses'>): boolean {
	return Boolean(delivery.responses?.some((response) => response.type === 'clicked_verify'));
}

async function baselineDelivery(
	ctx: MutationCtx,
	delivery: Doc<'campaignDeliveries'>,
	now: number
) {
	const campaign = await ctx.db.get(delivery.campaignId);
	if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
	const model = await modelForCampaign(ctx, campaign._id, campaign.orgId, now);
	if (delivery.readModelVersion === CAMPAIGN_READ_MODEL_VERSION) {
		return { model, state: model.state, newlyAdopted: false };
	}

	let state = applyCampaignDeliveryBaseline(model.state, delivery.status, now);
	state = applyCampaignVerifyClick(state, !hasVerifyClick(delivery), now);
	await ctx.db.patch(model._id, { state });
	await ctx.db.patch(delivery._id, { readModelVersion: CAMPAIGN_READ_MODEL_VERSION });
	return { model: { ...model, state }, state, newlyAdopted: true };
}

export async function applyCampaignDeliveryBaselineReadModel(
	ctx: MutationCtx,
	deliveryId: Id<'campaignDeliveries'>,
	now = Date.now()
): Promise<CampaignReadModelState> {
	const delivery = await ctx.db.get(deliveryId);
	if (!delivery) throw new Error('CAMPAIGN_DELIVERY_NOT_FOUND');
	return (await baselineDelivery(ctx, delivery, now)).state;
}

/** Call with the canonical old/new status in the same mutation as the row patch. */
export async function applyCampaignDeliveryTransitionReadModel(
	ctx: MutationCtx,
	deliveryId: Id<'campaignDeliveries'>,
	oldStatus: string,
	newStatus: string,
	now = Date.now()
): Promise<CampaignReadModelState> {
	const delivery = await ctx.db.get(deliveryId);
	if (!delivery) throw new Error('CAMPAIGN_DELIVERY_NOT_FOUND');
	const baseline = await baselineDelivery(ctx, delivery, now);
	const next = applyCampaignDeliveryTransition(baseline.state, oldStatus, newStatus, now);
	if (next !== baseline.state) await ctx.db.patch(baseline.model._id, { state: next });
	return next;
}

/** Call before appending the canonical clicked_verify response. */
export async function applyCampaignVerifyClickReadModel(
	ctx: MutationCtx,
	deliveryId: Id<'campaignDeliveries'>,
	now = Date.now()
): Promise<CampaignReadModelState> {
	const delivery = await ctx.db.get(deliveryId);
	if (!delivery) throw new Error('CAMPAIGN_DELIVERY_NOT_FOUND');
	const alreadyRecorded = hasVerifyClick(delivery);
	const baseline = await baselineDelivery(ctx, delivery, now);
	const next = applyCampaignVerifyClick(baseline.state, alreadyRecorded, now);
	if (next !== baseline.state) await ctx.db.patch(baseline.model._id, { state: next });
	return next;
}
