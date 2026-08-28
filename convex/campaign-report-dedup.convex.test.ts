/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import { emptyCampaignReadModel, type CampaignReadModelState } from './lib/campaignReadModel';
import { canonicalReportPreimage, reportPacketPreimageFields } from './lib/campaignProofPacket';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

function campaignProofState(receiptEligible: boolean): CampaignReadModelState {
	if (!receiptEligible) return emptyCampaignReadModel(NOW);
	return {
		...emptyCampaignReadModel(NOW),
		actionCount: 9,
		verifiedActionCount: 7,
		districtActionCount: 9,
		districtCount: 3,
		districtCountSquares: 27,
		topDistricts: [
			{ key: 'district-a', count: 3 },
			{ key: 'district-b', count: 3 },
			{ key: 'district-c', count: 3 }
		],
		firstSentAt: NOW - 2 * 60 * 60 * 1000,
		lastSentAt: NOW,
		hourBucketCount: 3,
		hourCountLog2Count: 9 * Math.log2(3),
		maxHourCount: 3,
		recentHours: [
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)) - 2, count: 3 },
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)) - 1, count: 3 },
			{ bucket: Math.floor(NOW / (60 * 60 * 1000)), count: 3 }
		],
		engagementTierCounts: [0, 3, 0, 3, 3],
		messageHashActionCount: 9,
		uniqueMessageHashCount: 9,
		noModeCount: 9,
		noModeIndividualCount: 9
	};
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function packetDigest(campaignId: string, state: CampaignReadModelState): Promise<string> {
	return sha256Hex(
		canonicalReportPreimage({
			campaignId,
			campaignTitle: 'Bounded multi-recipient report',
			orgName: 'Campaign Report Dedup',
			...reportPacketPreimageFields(state, state.updatedAt),
			debate: null
		})
	);
}

async function editorCampaign(t: Harness, options: { receiptEligible?: boolean } = {}) {
	const tokenIdentifier = 'https://issuer.example|campaign-report-dedup';
	const email = 'campaign-report-dedup@example.test';
	const state = campaignProofState(options.receiptEligible === true);
	const { orgId, campaignId, decisionMakerId, billId } = await t.run(async (ctx) => {
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
			name: 'Campaign Report Dedup',
			slug: 'campaign-report-dedup',
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
			stripeSubscriptionId: 'sub_campaign_report_dedup',
			currentPeriodStart: NOW,
			currentPeriodEnd: NOW + 30 * 24 * 60 * 60 * 1000,
			updatedAt: NOW
		});
		await ctx.db.insert('planUsageMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'campaign-report-ready',
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
		// Only the receipt-liveness case needs a bill + a resolvable Power
		// target; the dedup/envelope cases keep the original ineligible shape.
		const decisionMakerId = options.receiptEligible
			? await ctx.db.insert('decisionMakers', {
					type: 'legislator',
					name: 'Representative Alpha',
					lastName: 'Alpha',
					email: 'alpha@example.test',
					active: true,
					updatedAt: NOW
				})
			: undefined;
		const billId = options.receiptEligible
			? await ctx.db.insert('bills', {
					externalId: 'hr-1-campaign-report-dedup',
					jurisdiction: 'us-federal',
					jurisdictionLevel: 'federal',
					title: 'Receipt Liveness Act',
					status: 'introduced',
					statusDate: NOW,
					committees: [],
					sourceUrl: 'https://example.test/hr-1',
					topics: [],
					entities: [],
					updatedAt: NOW
				})
			: undefined;
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Bounded multi-recipient report',
			status: 'ACTIVE',
			...(billId ? { billId } : {}),
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
		await ctx.db.insert('campaignReadModelMigrations', {
			key: 'v1',
			status: 'ready',
			phase: 'deliveries',
			actionsScanned: state.actionCount,
			actionsAdopted: state.actionCount,
			deliveriesScanned: 0,
			deliveriesAdopted: 0,
			updatedAt: NOW
		});
		await ctx.db.insert('campaignReadModels', { campaignId, orgId, state });
		return { orgId, campaignId, decisionMakerId, billId };
	});
	return {
		orgId,
		campaignId,
		decisionMakerId,
		billId,
		state,
		authenticated: t.withIdentity({
			subject: 'campaign-report-dedup',
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email
		})
	};
}

describe('campaign report target deduplication', () => {
	it('admits the exact 64 KiB UTF-8 packet envelope and rejects one byte beyond it', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorCampaign(t);
		const digest = await packetDigest(fixture.campaignId, fixture.state);
		const binding = `sha256:${digest}`;
		const remainingBytes = 64 * 1024 - new TextEncoder().encode(binding).byteLength;
		const exact64KiB = `${binding}${'é'.repeat(Math.floor(remainingBytes / 2))}${'x'.repeat(
			remainingBytes % 2
		)}`;
		expect(new TextEncoder().encode(exact64KiB)).toHaveLength(64 * 1024);

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['alpha@example.test'],
				renderedHtml: exact64KiB,
				packetDigest: digest
			})
		).resolves.toEqual({ error: null, deliveryCount: 1 });

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['beta@example.test'],
				renderedHtml: `${exact64KiB}x`
			})
		).rejects.toThrow('CAMPAIGN_REPORT_HTML_TOO_LARGE');
	});

	it('creates one row per target, makes retries idempotent, and fails closed on legacy duplicates', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorCampaign(t);

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['alpha@example.test', 'alpha@example.test', 'beta@example.test']
			})
		).resolves.toEqual({ error: null, deliveryCount: 2 });

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['beta@example.test', 'alpha@example.test']
			})
		).resolves.toEqual({ error: null, deliveryCount: 0 });

		const deliveries = await t.run((ctx) =>
			ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.campaignId))
				.collect()
		);
		expect(deliveries.map((delivery) => delivery.targetEmail).sort()).toEqual([
			'alpha@example.test',
			'beta@example.test'
		]);

		await t.run((ctx) =>
			ctx.db.insert('campaignDeliveries', {
				campaignId: fixture.campaignId,
				targetEmail: 'beta@example.test',
				targetName: 'Legacy duplicate',
				targetTitle: '',
				status: 'failed',
				createdAt: NOW + 1
			})
		);
		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['beta@example.test']
			})
		).rejects.toThrow('CAMPAIGN_DELIVERY_DEDUP_STATE_DIVERGED');
	});

	it('keeps campaign browse pages bounded and applies status at the compound index', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorCampaign(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 104; index += 1) {
				await ctx.db.insert('campaigns', {
					orgId: fixture.orgId,
					type: 'LETTER',
					title: `Paged campaign ${String(index).padStart(3, '0')}`,
					status: index % 2 === 0 ? 'ACTIVE' : 'DRAFT',
					debateEnabled: false,
					debateThreshold: 50,
					raisedAmountCents: 0,
					donorCount: 0,
					targetCountry: 'US',
					actionCount: 0,
					verifiedActionCount: 0,
					updatedAt: NOW + index
				});
			}
		});

		const active = await fixture.authenticated.query(api.campaigns.list, {
			slug: 'campaign-report-dedup',
			status: 'ACTIVE',
			paginationOpts: { numItems: 1_000, cursor: null }
		});
		expect(active.page).toHaveLength(53);
		expect(active.page.every((campaign) => campaign.status === 'ACTIVE')).toBe(true);
		expect(active.isDone).toBe(true);

		const first = await fixture.authenticated.query(api.campaigns.list, {
			slug: 'campaign-report-dedup',
			paginationOpts: { numItems: 1_000, cursor: null }
		});
		expect(first.page).toHaveLength(100);
		expect(first.isDone).toBe(false);
		const second = await fixture.authenticated.query(api.campaigns.list, {
			slug: 'campaign-report-dedup',
			paginationOpts: { numItems: 1_000, cursor: first.continueCursor }
		});
		expect(second.page).toHaveLength(5);
		expect(second.isDone).toBe(true);

		await expect(
			fixture.authenticated.query(api.campaigns.list, {
				slug: 'campaign-report-dedup',
				paginationOpts: { numItems: 0, cursor: null }
			})
		).rejects.toThrow('CAMPAIGN_LIST_PAGE_SIZE_INVALID');
	});

	it('reconciles canonical counters across multiple bounded source pages', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorCampaign(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 600; index += 1) {
				await ctx.db.insert('campaignActions', {
					campaignId: fixture.campaignId,
					orgId: fixture.orgId,
					verified: index % 2 === 0,
					engagementTier: 3,
					trustTier: index % 4 === 0 ? 3 : 1,
					delegated: false,
					sentAt: NOW + index
				});
			}
			await ctx.db.patch(fixture.campaignId, {
				actionCount: 600,
				verifiedActionCount: 300,
				tier3VerifiedActionCount: 150
			});
		});

		await expect(
			t.action(internal.campaigns.reconcileCampaignCounters, {
				campaignId: fixture.campaignId
			})
		).resolves.toEqual({
			storedActionCount: 600,
			storedVerifiedActionCount: 300,
			storedTier3VerifiedActionCount: 150,
			actualActionCount: 600,
			actualVerifiedActionCount: 300,
			actualTier3VerifiedActionCount: 150,
			drift: false
		});
	});
	// Receipt creation used to be gated on a per-delivery composite score. That
	// gate is gone; if its removal had silently broken creation, nothing else in
	// the tree would raise an error — the lane would just stop producing
	// receipts. This pins creation to the surviving gates alone.
	it('still creates an accountability receipt from an eligible server-derived packet', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorCampaign(t, { receiptEligible: true });
		const digest = await packetDigest(fixture.campaignId, fixture.state);

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['alpha@example.test'],
				renderedHtml: `<p>report sha256:${digest}</p>`,
				packetDigest: digest
			})
		).resolves.toMatchObject({ error: null, deliveryCount: 1 });

		const deliveryId = await t.run(async (ctx) => {
			const delivery = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.campaignId))
				.first();
			if (!delivery) throw new Error('delivery missing');
			expect(delivery.receiptEligibility).toBe('eligible');
			return delivery._id;
		});

		await t.mutation(internal.campaigns.updateDeliveryStatus, {
			deliveryId,
			status: 'sent',
			sentAt: NOW
		});

		const receipt = await t.run(async (ctx) =>
			ctx.db
				.query('accountabilityReceipts')
				.withIndex('by_deliveryId', (q) => q.eq('deliveryId', deliveryId))
				.first()
		);
		expect(receipt).not.toBeNull();
		expect(receipt).toMatchObject({
			decisionMakerId: fixture.decisionMakerId,
			billId: fixture.billId,
			verifiedCount: 7,
			totalCount: 9,
			districtCount: 3,
			packetDigest: digest
		});
		// The digest now binds three facts, not four.
		expect(receipt?.attestationDigest).toMatch(/^[0-9a-f]{64}$/);
	});
});
