/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

const TOKEN = 'https://issuer.example|org-shell-budget';
const SLUG = 'org-shell-budget';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

function transactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	return (
		ctx as {
			meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
		}
	).meta.getTransactionMetrics();
}

async function seedShell(t: Harness): Promise<{ orgId: Id<'organizations'> }> {
	return await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'shell-budget@example.test',
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 10,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const orgId = await ctx.db.insert('organizations', {
			name: 'Org Shell Budget',
			slug: SLUG,
			maxSeats: 10,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 2_500,
			campaignCount: 0,
			activeCampaignCount: 0,
			memberCount: 1,
			supporterStats: {
				identityVerified: 1_250,
				postalResolved: 1_250,
				phonePresent: 0,
				emailSubscribed: 2_500,
				emailUnsubscribed: 0,
				emailBounced: 0,
				emailComplained: 0,
				smsSubscribed: 0,
				smsUnsubscribed: 0,
				smsStopped: 0,
				smsNone: 2_500,
				emailConsentEvidence: 2_500,
				emailSubscribedConsentEvidence: 2_500,
				smsConsentEvidence: 0,
				smsSubscribedConsentEvidence: 0,
				sourceCounts: { csv: 2_500 }
			},
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		await ctx.db.insert('campaignActiveCounterMigrations', {
			key: 'v1',
			status: 'ready',
			scanned: 0,
			adopted: 0,
			activeCounted: 0,
			updatedAt: NOW
		});
		return { orgId };
	});
}

async function seedLargeFeatureHistories(t: Harness, orgId: Id<'organizations'>): Promise<void> {
	const cardinality = 2_500;
	const batchSize = 125;
	const wide = 'x'.repeat(2_048);
	for (let start = 0; start < cardinality; start += batchSize) {
		await t.run(async (ctx) => {
			for (let index = start; index < Math.min(cardinality, start + batchSize); index += 1) {
				await ctx.db.insert('supporters', {
					orgId,
					encryptedEmail: `ciphertext-${index}`,
					emailHash: `hash-${index}`,
					encryptedCustomFields: wide,
					verified: index % 2 === 0,
					emailStatus: 'subscribed',
					smsStatus: 'none',
					source: 'csv',
					updatedAt: NOW + index
				});
				await ctx.db.insert('smsReplies', {
					orgId,
					body: wide,
					twilioSid: `reply-${index}`,
					receivedAt: NOW + index
				});
			}
		});
	}
}

async function seedOversizedCampaignCards(t: Harness, orgId: Id<'organizations'>): Promise<void> {
	const oversizedBody = 'wide-campaign-body'.repeat(18_000);
	for (let index = 0; index < 12; index += 1) {
		await t.run((ctx) =>
			ctx.db.insert('campaigns', {
				orgId,
				type: 'LETTER',
				title: `Wide campaign ${index}`,
				body: oversizedBody,
				status: 'ACTIVE',
				debateEnabled: false,
				debateThreshold: 0,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				actionCount: index,
				verifiedActionCount: index,
				updatedAt: NOW + index
			})
		);
	}
	await t.run((ctx) =>
		ctx.db.patch(orgId, {
			campaignCount: 12,
			activeCampaignCount: 12
		})
	);
}

describe('compact organization route context', () => {
	it('has constant read cost with 5,000 wide feature-history rows', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: {
				documentsRead: 4,
				databaseQueries: 4,
				bytesRead: 20_000
			}
		});
		const { orgId } = await seedShell(t);
		await seedLargeFeatureHistories(t, orgId);
		const authenticated = t.withIdentity({
			subject: 'org-shell-budget',
			issuer: 'https://issuer.example',
			tokenIdentifier: TOKEN
		});

		const observed = await authenticated.query(async (ctx) => {
			const value = await ctx.runQuery(api.organizations.getOrgContext, { slug: SLUG });
			return { value, metrics: await transactionMetrics(ctx) };
		});

		expect(observed.value.navBadges).toMatchObject({
			supporters: 2_500,
			campaigns: 0,
			activeCampaigns: 0
		});
		expect(observed.value.workspace).toBeNull();
		expect(observed.metrics.documentsRead.used).toBe(4);
		expect(observed.metrics.databaseQueries.used).toBe(4);
		expect(observed.metrics.bytesRead.used).toBeLessThan(20_000);
	});

	it('fails a campaign-card slice closed when one source row exceeds the byte page', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: {
				documentsRead: 8,
				databaseQueries: 8,
				bytesRead: 600_000
			}
		});
		const { orgId } = await seedShell(t);
		await seedOversizedCampaignCards(t, orgId);
		const authenticated = t.withIdentity({
			subject: 'org-shell-budget',
			issuer: 'https://issuer.example',
			tokenIdentifier: TOKEN
		});

		const observed = await authenticated.query(async (ctx) => {
			const value = await ctx.runQuery(api.organizations.getOrgContext, {
				slug: SLUG,
				workspace: 'return'
			});
			return { value, metrics: await transactionMetrics(ctx) };
		});

		expect(observed.value.workspace).toMatchObject({
			kind: 'return',
			campaignCardsReady: false,
			campaigns: []
		});
		expect(observed.metrics.documentsRead.used).toBeLessThanOrEqual(8);
		expect(observed.metrics.databaseQueries.used).toBeLessThanOrEqual(8);
		expect(observed.metrics.bytesRead.used).toBeLessThan(600_000);
	});

	it('keeps both accountability workspace slices closed for a status-only ready marker', async () => {
		const t = convexTest({ schema, modules });
		await seedShell(t);
		await t.run((ctx) =>
			ctx.db.insert('accountabilityReadModelMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'stale-ready-marker',
				phase: 'scorecards',
				cursor: 'still-scanning',
				scanComplete: false,
				scanned: 1,
				projected: 0,
				userProjected: 0,
				failureCode: 'SOURCE_INVALID',
				failureSourceId: 'receipt:stale',
				failurePhase: 'scorecards',
				startedAt: NOW,
				updatedAt: NOW
			})
		);
		const authenticated = t.withIdentity({
			subject: 'org-shell-budget',
			issuer: 'https://issuer.example',
			tokenIdentifier: TOKEN
		});

		const returnContext = await authenticated.query(api.organizations.getOrgContext, {
			slug: SLUG,
			workspace: 'return'
		});
		const landscapeContext = await authenticated.query(api.organizations.getOrgContext, {
			slug: SLUG,
			workspace: 'landscape'
		});

		expect(returnContext.workspace).toMatchObject({
			kind: 'return',
			readModelReady: false,
			receipts: null
		});
		expect(landscapeContext.workspace).toMatchObject({
			kind: 'landscape',
			readModelReady: false,
			followedReady: false,
			followed: []
		});
	});
});
