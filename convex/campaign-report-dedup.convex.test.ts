/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

async function editorCampaign(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|campaign-report-dedup';
	const email = 'campaign-report-dedup@example.test';
	const { orgId, campaignId } = await t.run(async (ctx) => {
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
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Bounded multi-recipient report',
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
			actionCount: 0,
			verifiedActionCount: 0,
			updatedAt: NOW
		});
		return { orgId, campaignId };
	});
	return {
		orgId,
		campaignId,
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
		const exact64KiB = 'é'.repeat(32 * 1024);
		expect(new TextEncoder().encode(exact64KiB)).toHaveLength(64 * 1024);

		await expect(
			fixture.authenticated.mutation(api.campaigns.sendReport, {
				campaignId: fixture.campaignId,
				orgSlug: 'campaign-report-dedup',
				targetEmails: ['alpha@example.test'],
				renderedHtml: exact64KiB,
				packetDigest: 'a'.repeat(64),
				proofWeight: 1,
				packetSummary: {
					verified: Number.MAX_SAFE_INTEGER,
					total: Number.MAX_SAFE_INTEGER,
					districtCount: Number.MAX_SAFE_INTEGER,
					gds: 1,
					ald: 1,
					cai: Number.MAX_VALUE,
					temporalEntropy: Number.MAX_VALUE
				}
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
});
