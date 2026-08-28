/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import { emptyCampaignReadModel, type CampaignReadModelState } from './lib/campaignReadModel';
import {
	canonicalReportPreimage,
	deriveProofPacketSummary,
	reportPacketPreimageFields
} from './lib/campaignProofPacket';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-21T15:00:00.000Z');

function proofState(): CampaignReadModelState {
	return {
		...emptyCampaignReadModel(NOW),
		revision: 12,
		actionCount: 12,
		verifiedActionCount: 8,
		districtActionCount: 12,
		districtCount: 3,
		districtCountSquares: 54,
		topDistricts: [
			{ key: 'district-a', count: 6 },
			{ key: 'district-b', count: 3 },
			{ key: 'district-c', count: 3 }
		],
		firstSentAt: NOW - 3 * 60 * 60 * 1000,
		lastSentAt: NOW,
		hourBucketCount: 4,
		hourCountLog2Count: 12 * Math.log2(3),
		maxHourCount: 3,
		recentHours: [
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)) - 3, count: 3 },
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)) - 2, count: 3 },
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)) - 1, count: 3 },
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)), count: 3 }
		],
		engagementTierCounts: [0, 4, 2, 4, 2],
		trustTierCounts: [1, 3, 5, 3],
		trustTierPresentCount: 12,
		explicitCompositionCount: 12,
		explicitIndividualCount: 7,
		explicitSharedCount: 4,
		explicitUnknownCount: 1,
		messageHashActionCount: 12,
		uniqueMessageHashCount: 9
	};
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function expectedDigest(campaignId: string, state: CampaignReadModelState): Promise<string> {
	return sha256Hex(
		canonicalReportPreimage({
			campaignId,
			campaignTitle: 'Server-derived campaign report',
			orgName: 'Proof Packet Org',
			...reportPacketPreimageFields(state, state.updatedAt),
			debate: null
		})
	);
}

async function fixture(t: Harness, options: { migration?: 'ready' | 'pending' | 'missing' } = {}) {
	const state = proofState();
	const migration = options.migration ?? 'ready';
	const tokenIdentifier = 'https://issuer.example|campaign-proof-packet';
	const email = 'campaign-proof-packet@example.test';
	const { campaignId, orgId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 100,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const orgId = await ctx.db.insert('organizations', {
			name: 'Proof Packet Org',
			slug: 'proof-packet-org',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			verifiedActionsLifetime: 0,
			verifiedActionsPeriodBaseline: 0,
			verifiedActionsPeriodBaselineAt: NOW,
			sentEmailCount: 0,
			sentEmailPeriodBaseline: 0,
			sentEmailPeriodBaselineAt: NOW,
			emailReservedCount: 0,
			emailReservationPeriodStart: NOW,
			emailReservationState: 'ready',
			smsSentCount: 0,
			smsSentPeriodBaseline: 0,
			smsSentPeriodBaselineAt: NOW,
			updatedAt: NOW
		});
		await ctx.db.insert('subscriptions', {
			orgId,
			plan: 'starter',
			priceCents: 1_000,
			status: 'active',
			paymentMethod: 'stripe',
			stripeSubscriptionId: 'sub_campaign_proof_packet',
			currentPeriodStart: NOW,
			currentPeriodEnd: NOW + 30 * 24 * 60 * 60 * 1000,
			updatedAt: NOW
		});
		await ctx.db.insert('planUsageMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'campaign-proof-packet-ready',
			phase: 'complete',
			verifiedActions: 0,
			emailsSent: 0,
			emailReserved: 0,
			smsSent: 0,
			restarts: 0,
			scannedOrganizations: 1,
			projectedOrganizations: 1,
			scannedSourceRows: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'editor',
			joinedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Server-derived campaign report',
			status: 'ACTIVE',
			targets: [
				{ email: 'alpha@example.test', name: 'Alpha' },
				{ email: 'beta@example.test', name: 'Beta' }
			],
			debateEnabled: false,
			debateThreshold: 50,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			actionCount: state.actionCount,
			verifiedActionCount: state.verifiedActionCount,
			updatedAt: NOW
		});
		if (migration !== 'missing') {
			await ctx.db.insert('campaignReadModelMigrations', {
				key: 'v1',
				status: migration,
				phase: 'deliveries',
				actionsScanned: state.actionCount,
				actionsAdopted: state.actionCount,
				deliveriesScanned: 0,
				deliveriesAdopted: 0,
				updatedAt: NOW
			});
		}
		await ctx.db.insert('campaignReadModels', { campaignId, orgId, state });
		return { campaignId, orgId };
	});

	return {
		campaignId,
		orgId,
		state,
		authenticated: t.withIdentity({
			subject: 'campaign-proof-packet',
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email
		})
	};
}

async function deliveries(t: Harness, campaignId: string) {
	return t.run((ctx) =>
		ctx.db
			.query('campaignDeliveries')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId as never))
			.collect()
	);
}

describe('server-derived campaign report packets', () => {
	it('persists a summary and digest derived from the transaction read model', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);
		const digest = await expectedDigest(seeded.campaignId, seeded.state);

		await expect(
			seeded.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: seeded.campaignId,
				orgSlug: 'proof-packet-org',
				targetEmails: ['alpha@example.test']
			})
		).resolves.toEqual({ error: null, deliveryCount: 1 });

		const [delivery] = await deliveries(t, seeded.campaignId);
		expect(delivery?.packetSnapshot?.summary).toEqual(deriveProofPacketSummary(seeded.state));
		expect(delivery?.packetDigest).toBe(digest);
	});

	it('refuses a fabricated digest and inserts no delivery', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);

		await expect(
			seeded.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: seeded.campaignId,
				orgSlug: 'proof-packet-org',
				targetEmails: ['alpha@example.test'],
				packetDigest: 'a'.repeat(64)
			})
		).resolves.toEqual({ error: 'CAMPAIGN_REPORT_PACKET_STALE', deliveryCount: 0 });
		expect(await deliveries(t, seeded.campaignId)).toHaveLength(0);
	});

	it('requires rendered HTML to contain the derived digest', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);
		const digest = await expectedDigest(seeded.campaignId, seeded.state);

		await expect(
			seeded.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: seeded.campaignId,
				orgSlug: 'proof-packet-org',
				targetEmails: ['alpha@example.test'],
				renderedHtml: '<p>unbound report</p>'
			})
		).resolves.toEqual({ error: 'CAMPAIGN_REPORT_PACKET_HTML_UNBOUND', deliveryCount: 0 });
		expect(await deliveries(t, seeded.campaignId)).toHaveLength(0);

		await expect(
			seeded.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: seeded.campaignId,
				orgSlug: 'proof-packet-org',
				targetEmails: ['alpha@example.test'],
				renderedHtml: `<p>attestation sha256:${digest}</p>`,
				packetDigest: digest
			})
		).resolves.toEqual({ error: null, deliveryCount: 1 });
	});

	it('rejects the removed packetSummary argument', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);

		await expect(
			seeded.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: seeded.campaignId,
				orgSlug: 'proof-packet-org',
				targetEmails: ['alpha@example.test'],
				packetSummary: deriveProofPacketSummary(seeded.state)
			} as never)
		).rejects.toThrow(/packetSummary/);
		expect(await deliveries(t, seeded.campaignId)).toHaveLength(0);
	});

	it.each(['missing', 'pending'] as const)(
		'fails closed when the read-model migration is %s',
		async (migration) => {
			const t = convexTest(schema, modules);
			const seeded = await fixture(t, { migration });

			await expect(
				seeded.authenticated.mutation(api.campaigns.sendReport, {
					campaignId: seeded.campaignId,
					orgSlug: 'proof-packet-org',
					targetEmails: ['alpha@example.test']
				})
			).resolves.toEqual({ error: 'CAMPAIGN_READ_MODEL_NOT_READY', deliveryCount: 0 });
			expect(await deliveries(t, seeded.campaignId)).toHaveLength(0);
		}
	);
});
