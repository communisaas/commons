import { describe, expect, it } from 'vitest';
import {
	CAMPAIGN_RECENT_DAY_LIMIT,
	CAMPAIGN_RECENT_HOUR_LIMIT,
	CAMPAIGN_TOP_CELL_LIMIT,
	CAMPAIGN_TOP_DISTRICT_LIMIT,
	applyCampaignActionToReadModel,
	applyCampaignDeliveryBaseline,
	applyCampaignDeliveryTransition,
	applyCampaignVerifyClick,
	campaignActionDimensionKeys,
	campaignReadModelSuppression,
	emptyCampaignReadModel,
	updateExactTopK,
	type CampaignDimensionKind,
	type CampaignReadModelAction,
	type CampaignReadModelState
} from './lib/campaignReadModel';

function foldActions(actions: CampaignReadModelAction[]): CampaignReadModelState {
	let state = emptyCampaignReadModel(0);
	const dimensions = new Map<string, number>();
	for (const action of actions) {
		const keys = campaignActionDimensionKeys(action);
		const prior: Partial<Record<CampaignDimensionKind, number>> = {};
		for (const [kind, key] of Object.entries(keys) as Array<
			[CampaignDimensionKind, string | undefined]
		>) {
			if (key === undefined) continue;
			prior[kind] = dimensions.get(`${kind}:${key}`) ?? 0;
		}
		state = applyCampaignActionToReadModel(state, action, prior, action.sentAt);
		for (const [kind, key] of Object.entries(keys) as Array<
			[CampaignDimensionKind, string | undefined]
		>) {
			if (key === undefined) continue;
			const dimensionKey = `${kind}:${key}`;
			dimensions.set(dimensionKey, (dimensions.get(dimensionKey) ?? 0) + 1);
		}
	}
	return state;
}

describe('campaign read model fold', () => {
	it('maintains exact authorship, hash diversity, tiers, and delivery transitions', () => {
		const hour = 3_600_000;
		let state = foldActions([
			{
				verified: true,
				engagementTier: 1,
				trustTier: 1,
				messageHash: 'same',
				districtHash: 'd1',
				h3Cell: 'cell-a',
				atlasVersion: 'v1',
				sentAt: 0
			},
			{
				verified: false,
				engagementTier: 3,
				trustTier: 3,
				messageHash: 'same',
				districtHash: 'd1',
				h3Cell: 'cell-a',
				atlasVersion: 'v2',
				sentAt: hour
			},
			{
				verified: true,
				engagementTier: 4,
				trustTier: 2,
				messageHash: 'unique',
				compositionMode: 'edited',
				districtHash: 'd2',
				h3Cell: 'cell-b',
				atlasVersion: 'v2',
				sentAt: hour * 2
			}
		]);

		expect(state).toMatchObject({
			actionCount: 3,
			verifiedActionCount: 2,
			districtCount: 2,
			districtCountSquares: 5,
			cellCount: 2,
			noModeIndividualCount: 0,
			noModeSharedCount: 2,
			explicitIndividualCount: 1,
			messageHashActionCount: 3,
			uniqueMessageHashCount: 2,
			atlasVersionActionCount: 3,
			topAtlasVersion: 'v2',
			topAtlasVersionCount: 2
		});
		expect(state.engagementTierCounts).toEqual([0, 1, 0, 1, 1]);
		expect(state.trustTierCounts).toEqual([0, 1, 1, 1]);

		state = applyCampaignDeliveryBaseline(state, 'queued', 4);
		state = applyCampaignDeliveryTransition(state, 'queued', 'sent', 5);
		state = applyCampaignDeliveryTransition(state, 'sent', 'delivered', 6);
		state = applyCampaignDeliveryTransition(state, 'delivered', 'opened', 7);
		state = applyCampaignDeliveryTransition(state, 'opened', 'opened', 8);
		state = applyCampaignVerifyClick(state, false, 9);
		state = applyCampaignVerifyClick(state, true, 10);
		expect(state).toMatchObject({
			deliverySentCount: 1,
			deliveryDeliveredCount: 1,
			deliveryOpenedCount: 1,
			deliveryBouncedCount: 0,
			deliveryVerifyClickedCount: 1
		});
	});

	it('keeps singleton arrays bounded under cardinality far beyond the read envelope', () => {
		const cardinality = CAMPAIGN_TOP_DISTRICT_LIMIT + 1_000;
		const actions = Array.from({ length: cardinality }, (_, index) => ({
			verified: index % 2 === 0,
			engagementTier: index % 5,
			districtHash: `district-${String(index).padStart(5, '0')}`,
			h3Cell: `cell-${String(index).padStart(5, '0')}`,
			messageHash: `message-${index}`,
			atlasVersion: `atlas-${index % 3}`,
			sentAt: index * 86_400_000
		}));
		const state = foldActions(actions);

		expect(state.actionCount).toBe(cardinality);
		expect(state.districtCount).toBe(cardinality);
		expect(state.cellCount).toBe(cardinality);
		expect(state.uniqueMessageHashCount).toBe(cardinality);
		expect(state.topDistricts).toHaveLength(CAMPAIGN_TOP_DISTRICT_LIMIT);
		expect(state.topCells).toHaveLength(CAMPAIGN_TOP_CELL_LIMIT);
		expect(state.recentHours.length).toBeLessThanOrEqual(CAMPAIGN_RECENT_HOUR_LIMIT);
		expect(state.recentDays).toHaveLength(CAMPAIGN_RECENT_DAY_LIMIT);
		expect(state.recentVerifiedDays.length).toBeLessThanOrEqual(CAMPAIGN_RECENT_DAY_LIMIT);
		expect(campaignReadModelSuppression(state)).toMatchObject({
			districts: cardinality - CAMPAIGN_TOP_DISTRICT_LIMIT,
			districtActions: cardinality - CAMPAIGN_TOP_DISTRICT_LIMIT,
			cells: cardinality - CAMPAIGN_TOP_CELL_LIMIT,
			cellActions: cardinality - CAMPAIGN_TOP_CELL_LIMIT
		});
	});

	it('reconsiders an outside key on every increment so the retained top-K stays exact', () => {
		let rows = updateExactTopK([], 'a', 5, 2);
		rows = updateExactTopK(rows, 'b', 4, 2);
		rows = updateExactTopK(rows, 'c', 3, 2);
		expect(rows).toEqual([
			{ key: 'a', count: 5 },
			{ key: 'b', count: 4 }
		]);
		rows = updateExactTopK(rows, 'c', 6, 2);
		expect(rows).toEqual([
			{ key: 'c', count: 6 },
			{ key: 'a', count: 5 }
		]);
	});
});
