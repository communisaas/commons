import { describe, expect, it } from 'vitest';
import {
	applyCampaignActionToReadModel,
	campaignActionDimensionKeys,
	emptyCampaignReadModel,
	type CampaignDimensionKind,
	type CampaignReadModelAction
} from '../../../convex/lib/campaignReadModel';
import { materializeCampaignReadModel } from '$lib/server/campaign-read-model';
import { computePacket } from '$lib/server/verification-packet';

function fold(actions: CampaignReadModelAction[]) {
	let state = emptyCampaignReadModel(0);
	const counts = new Map<string, number>();
	for (const action of actions) {
		const keys = campaignActionDimensionKeys(action);
		const prior: Partial<Record<CampaignDimensionKind, number>> = {};
		for (const [kind, key] of Object.entries(keys) as Array<
			[CampaignDimensionKind, string | undefined]
		>) {
			if (key !== undefined) prior[kind] = counts.get(`${kind}:${key}`) ?? 0;
		}
		state = applyCampaignActionToReadModel(state, action, prior, action.sentAt);
		for (const [kind, key] of Object.entries(keys) as Array<
			[CampaignDimensionKind, string | undefined]
		>) {
			if (key === undefined) continue;
			const id = `${kind}:${key}`;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return state;
}

describe('campaign read-model materializer', () => {
	it('preserves the legacy packet scalars without re-reading canonical actions', () => {
		const hour = 3_600_000;
		const actions: CampaignReadModelAction[] = Array.from({ length: 20 }, (_, index) => ({
			verified: index % 3 !== 0,
			engagementTier: index % 5,
			trustTier: index % 4,
			districtHash: `district-${index % 4}`,
			h3Cell: `cell-${index % 3}`,
			messageHash: `message-${index % 7}`,
			compositionMode: index % 4 === 0 ? 'edited' : index % 4 === 1 ? 'shared' : undefined,
			atlasVersion: index < 5 ? 'old' : 'current',
			sentAt: index * hour
		}));
		const materialized = materializeCampaignReadModel(fold(actions), null, actions.at(-1)!.sentAt)
			.packet;
		// The legacy SvelteKit loader projected absent Convex fields to explicit
		// nulls before calling computePacket.
		const legacy = computePacket(
			actions.map((action) => ({
				...action,
				districtHash: action.districtHash ?? null,
				h3Cell: action.h3Cell ?? null,
				messageHash: action.messageHash ?? null,
				trustTier: action.trustTier ?? null,
				compositionMode: action.compositionMode ?? null,
				atlasVersion: action.atlasVersion ?? null
			}))
		);

		expect(materialized).toMatchObject({
			verified: legacy.verified,
			total: legacy.total,
			verifiedPct: legacy.verifiedPct,
			districtCount: legacy.districtCount,
			authorship: legacy.authorship,
			dateRange: legacy.dateRange,
			identityBreakdown: legacy.identityBreakdown,
			gds: legacy.gds,
			ald: legacy.ald,
			temporalEntropy: legacy.temporalEntropy,
			burstVelocity: legacy.burstVelocity,
			cai: legacy.cai,
			tiers: legacy.tiers,
			geography: legacy.geography,
			cells: legacy.cells,
			temporal: legacy.temporal,
			driftCount: legacy.driftCount,
			driftPct: legacy.driftPct,
			debate: null
		});
	});

	it('bounds the displayed temporal window while keeping lifetime scalars exact', () => {
		const hour = 3_600_000;
		const actions = Array.from({ length: 900 }, (_, index) => ({
			verified: true,
			engagementTier: 2,
			sentAt: index * hour
		}));
		const bundle = materializeCampaignReadModel(fold(actions), null);

		expect(bundle.packet.total).toBe(900);
		expect(bundle.packet.temporal?.bins).toHaveLength(720);
		expect(bundle.suppression.hours).toBe(180);
	});
});
