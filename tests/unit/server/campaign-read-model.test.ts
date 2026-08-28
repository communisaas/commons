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

	it('leaves every coordination scalar uncomputed for a single-action campaign', () => {
		const packet = materializeCampaignReadModel(
			fold([
				{
					verified: true,
					engagementTier: 3,
					trustTier: 2,
					districtHash: 'district-0',
					h3Cell: 'cell-0',
					messageHash: 'message-0',
					atlasVersion: 'current',
					sentAt: 0
				}
			]),
			null
		).packet;

		expect(packet.gds).toBeNull();
		expect(packet.ald).toBeNull();
		expect(packet.temporalEntropy).toBeNull();
		expect(packet.burstVelocity).toBeNull();
		expect(packet.cai).toBeNull();
	});

	it('withholds the peak-vs-average ratio while every action shares one hour', () => {
		const packet = materializeCampaignReadModel(
			fold([
				{ verified: true, engagementTier: 2, sentAt: 0 },
				{ verified: true, engagementTier: 2, sentAt: 60_000 }
			]),
			null
		).packet;

		expect(packet.temporal).toBeNull();
		expect(packet.burstVelocity).toBeNull();
	});

	it('emits no coordination scalar and no action for an empty campaign', () => {
		const packet = materializeCampaignReadModel(fold([]), null).packet;

		expect(packet.total).toBe(0);
		expect(packet.gds).toBeNull();
		expect(packet.ald).toBeNull();
		expect(packet.temporalEntropy).toBeNull();
		expect(packet.burstVelocity).toBeNull();
		expect(packet.cai).toBeNull();
	});

	it('counts a lone action without deriving a peak-vs-average ratio from it', () => {
		const packet = materializeCampaignReadModel(
			fold([{ verified: true, engagementTier: 2, sentAt: 0 }]),
			null
		).packet;

		expect(packet.total).toBe(1);
		expect(packet.burstVelocity).toBeNull();
	});

	it('counts two actions inside one hour while withholding their ratio', () => {
		const packet = materializeCampaignReadModel(
			fold([
				{ verified: true, engagementTier: 2, sentAt: 0 },
				{ verified: true, engagementTier: 2, sentAt: 60_000 }
			]),
			null
		).packet;

		expect(packet.total).toBe(2);
		expect(packet.burstVelocity).toBeNull();
	});

	it('computes the ratio from two actions an hour or more apart', () => {
		const hour = 3_600_000;
		const packet = materializeCampaignReadModel(
			fold([
				{ verified: true, engagementTier: 2, sentAt: 0 },
				{ verified: true, engagementTier: 2, sentAt: 2 * hour }
			]),
			null
		).packet;

		expect(packet.total).toBe(2);
		expect(packet.temporal).not.toBeNull();
		expect(packet.burstVelocity).toBe(1);
	});

	it('computes the ratio below the display floor, so the floor withholds a real value', () => {
		const hour = 3_600_000;
		const packet = materializeCampaignReadModel(
			fold(
				Array.from({ length: 24 }, (_, index) => ({
					verified: true,
					engagementTier: 2,
					sentAt: index * hour
				}))
			),
			null
		).packet;

		expect(packet.total).toBe(24);
		expect(packet.burstVelocity).toBe(1);
	});

	it('computes the same ratio at and above the display floor', () => {
		const hour = 3_600_000;
		const hourly = (length: number) =>
			materializeCampaignReadModel(
				fold(
					Array.from({ length }, (_, index) => ({
						verified: true,
						engagementTier: 2,
						sentAt: index * hour
					}))
				),
				null
			).packet;

		const atFloor = hourly(25);
		expect(atFloor.total).toBe(25);
		expect(atFloor.burstVelocity).toBe(1);

		const aboveFloor = hourly(26);
		expect(aboveFloor.total).toBe(26);
		expect(aboveFloor.burstVelocity).not.toBeNull();
	});

	it('leaves the ratio uncomputed just below the floor when actions span under one hour', () => {
		const packet = materializeCampaignReadModel(
			fold(
				Array.from({ length: 24 }, (_, index) => ({
					verified: true,
					engagementTier: 2,
					sentAt: index * 60_000
				}))
			),
			null
		).packet;

		expect(packet.total).toBe(24);
		expect(packet.burstVelocity).toBeNull();
	});

	it('withholds the ratio from actions under an hour apart across two clock hours', () => {
		const hour = 3_600_000;
		const early = 59 * 60_000;
		const late = 61 * 60_000;
		// The falsifier for "every action arrived inside a single hour": these
		// land in two different clock buckets, yet span under an hour.
		expect(Math.floor(early / hour)).not.toBe(Math.floor(late / hour));

		const packet = materializeCampaignReadModel(
			fold(
				Array.from({ length: 30 }, (_, index) => ({
					verified: true,
					engagementTier: 2,
					sentAt: index < 15 ? early : late
				}))
			),
			null
		).packet;

		expect(packet.total).toBe(30);
		expect(packet.temporal).toBeNull();
		expect(packet.burstVelocity).toBeNull();
	});
});
