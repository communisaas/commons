/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'coalition-metrics-test-secret-0123456789';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

function orgValue(name: string, slug: string, isPublic = true) {
	return {
		name,
		slug,
		maxSeats: 10,
		maxTemplatesMonth: 100,
		dmCacheTtlDays: 30,
		countryCode: 'US',
		isPublic,
		updatedAt: NOW
	};
}

function campaignValue(orgId: Id<'organizations'>, title = 'Coalition campaign') {
	return {
		orgId,
		type: 'LETTER' as const,
		title,
		status: 'ACTIVE' as const,
		debateEnabled: false,
		debateThreshold: 0,
		raisedAmountCents: 0,
		donorCount: 0,
		targetCountry: 'US',
		updatedAt: NOW
	};
}

function transactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	return (
		ctx as { meta: { getTransactionMetrics: () => Promise<TransactionMetrics> } }
	).meta.getTransactionMetrics();
}

async function driveNetwork(t: Harness, networkId: Id<'orgNetworks'>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		await t.mutation(internal.networks.continueCoalitionNetworkRebuild, { networkId });
		const state = await t.run(async (ctx) => {
			const aggregate = await ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
				.unique();
			const rebuild = await ctx.db
				.query('coalitionNetworkRebuilds')
				.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
				.unique();
			return { aggregate, rebuild };
		});
		if (state.aggregate?.activeGeneration && state.rebuild?.status === 'complete') return;
		if (state.rebuild?.status === 'blocked') {
			throw new Error(state.rebuild.failureCode ?? 'network rebuild blocked');
		}
	}
	throw new Error('network rebuild did not finish');
}

async function finishLegacyMigration(t: Harness): Promise<void> {
	let result = (await t.mutation(internal.networks.migrateCoalitionMetrics, {
		scheduleContinuation: false
	})) as { status: string; runToken: string };
	for (let attempt = 0; result.status === 'running' && attempt < 30; attempt += 1) {
		result = (await t.mutation(internal.networks.migrateCoalitionMetrics, {
			runToken: result.runToken,
			scheduleContinuation: false
		})) as { status: string; runToken: string };
	}
	expect(result.status).toBe('migrated');
	await expect(t.mutation(internal.networks.activateCoalitionMetrics, {})).resolves.toMatchObject({
		status: 'ready'
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('coalition source projection and exact cutover', () => {
	it('migrates legacy supporters, actions, and receipts exactly once', async () => {
		const t = convexTest(schema, modules);
		const fixture = await t.run(async (ctx) => {
			const orgId = await ctx.db.insert('organizations', orgValue('Legacy Org', 'legacy-org'));
			const campaignId = await ctx.db.insert('campaigns', campaignValue(orgId));
			const dmId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				name: 'Representative Exact',
				lastName: 'Exact',
				active: true,
				updatedAt: NOW
			});
			const billId = await ctx.db.insert('bills', {
				externalId: 'hr-exact',
				jurisdiction: 'us-federal',
				jurisdictionLevel: 'federal',
				title: 'Exact Migration Act',
				status: 'introduced',
				statusDate: NOW,
				committees: [],
				sourceUrl: 'https://example.test/bill',
				topics: [],
				entities: [],
				updatedAt: NOW
			});
			const supporterId = await ctx.db.insert('supporters', {
				orgId,
				encryptedEmail: 'ciphertext',
				emailHash: 'org-hash',
				globalEmailHash: 'global-hash',
				country: 'US',
				verified: true,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				updatedAt: NOW
			});
			const actionId = await ctx.db.insert('campaignActions', {
				campaignId,
				orgId,
				verified: true,
				engagementTier: 3,
				districtHash: 'district-exact',
				messageHash: 'message-exact',
				delegated: false,
				sentAt: NOW
			});
			const receiptId = await ctx.db.insert('accountabilityReceipts', {
				decisionMakerId: dmId,
				dmName: 'Representative Exact',
				billId,
				orgId,
				verifiedCount: 7,
				totalCount: 8,
				districtCount: 3,
				proofWeight: 11,
				attestationDigest: 'attestation',
				packetDigest: 'packet',
				proofDeliveredAt: NOW,
				causalityClass: 'pending',
				alignment: 0.5,
				status: 'pending_response',
				updatedAt: NOW
			});
			return { orgId, supporterId, actionId, receiptId, dmId, billId };
		});

		await finishLegacyMigration(t);
		const projected = await t.run(async (ctx) => ({
			supporter: await ctx.db.get(fixture.supporterId),
			action: await ctx.db.get(fixture.actionId),
			receipt: await ctx.db.get(fixture.receiptId),
			input: await ctx.db
				.query('coalitionOrgMetricInputs')
				.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
				.unique(),
			pressure: await ctx.db
				.query('coalitionOrgPressureInputs')
				.withIndex('by_orgId_decisionMakerId', (q) =>
					q.eq('orgId', fixture.orgId).eq('decisionMakerId', fixture.dmId)
				)
				.unique(),
			bill: await ctx.db
				.query('coalitionOrgPressureBillInputs')
				.withIndex('by_orgId_decisionMakerId_billId', (q) =>
					q
						.eq('orgId', fixture.orgId)
						.eq('decisionMakerId', fixture.dmId)
						.eq('billId', fixture.billId)
				)
				.unique()
		}));
		expect(projected.supporter?.coalitionMetricsVersion).toBe(1);
		expect(projected.action?.coalitionMetricsVersion).toBe(1);
		expect(projected.receipt?.coalitionMetricsVersion).toBe(1);
		expect(projected.input).toMatchObject({
			totalSupporters: 1,
			verifiedSupporters: 1,
			totalCampaignActions: 1,
			verifiedCampaignActions: 1,
			messageHashedTotal: 1,
			tier3: 1
		});
		expect(projected.pressure).toMatchObject({
			maxProofWeight: 11,
			verifiedActionEvidence: 7,
			districtSignalCount: 3,
			receiptCount: 1
		});
		expect(projected.bill).toMatchObject({
			billTitle: 'Exact Migration Act',
			alignmentNumerator: 5.5,
			alignmentWeight: 11,
			receiptCount: 1
		});

		await expect(
			t.mutation(internal.networks.migrateCoalitionMetrics, { scheduleContinuation: false })
		).resolves.toMatchObject({ status: 'already-ready' });
		const inputAfterRetry = await t.run((ctx) =>
			ctx.db
				.query('coalitionOrgMetricInputs')
				.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
				.unique()
		);
		expect(inputAfterRetry).toMatchObject(projected.input!);
	});
});

describe('revisioned coalition network generation', () => {
	it('deduplicates cross-org dimensions and combines strongest per-org pressure', async () => {
		const t = convexTest(schema, modules);
		const fixture = await t.run(async (ctx) => {
			const org1 = await ctx.db.insert('organizations', orgValue('One Org', 'one-org'));
			const org2 = await ctx.db.insert('organizations', orgValue('Two Org', 'two-org'));
			const networkId = await ctx.db.insert('orgNetworks', {
				name: 'Exact Network',
				slug: 'exact-network',
				ownerOrgId: org1,
				status: 'active',
				applicableCountries: ['US'],
				coalitionMembershipRevision: 1,
				updatedAt: NOW
			});
			for (const [orgId, role] of [
				[org1, 'admin'],
				[org2, 'member']
			] as const) {
				await ctx.db.insert('orgNetworkMembers', {
					networkId,
					orgId,
					role,
					status: 'active',
					joinedAt: NOW - 1
				});
			}
			await ctx.db.insert('coalitionNetworkAggregates', {
				networkId,
				version: 1,
				status: 'building',
				revision: 0,
				memberCount: 0,
				totalSupporters: 0,
				uniqueSupporters: 0,
				verifiedSupporters: 0,
				totalCampaignActions: 0,
				verifiedCampaignActions: 0,
				messageHashedTotal: 0,
				uniqueMessages: 0,
				districtCount: 0,
				districtSquareSum: 0,
				hourCountXLogXSum: 0,
				tier1: 0,
				tier3: 0,
				tier4: 0,
				stateDistribution: [],
				stateDistributionOtherCount: 0,
				dirtyAt: NOW,
				refreshScheduledAt: NOW,
				updatedAt: NOW
			});
			for (const [orgId, values] of [
				[
					org1,
					{
						supporters: 5,
						verified: 5,
						actions: 6,
						verifiedActions: 5,
						hashed: 4,
						t1: 2,
						t3: 2,
						t4: 1
					}
				],
				[
					org2,
					{
						supporters: 4,
						verified: 3,
						actions: 4,
						verifiedActions: 4,
						hashed: 3,
						t1: 1,
						t3: 2,
						t4: 1
					}
				]
			] as const) {
				await ctx.db.insert('coalitionOrgMetricInputs', {
					orgId,
					version: 1,
					revision: 1,
					totalSupporters: values.supporters,
					verifiedSupporters: values.verified,
					totalCampaignActions: values.actions,
					verifiedCampaignActions: values.verifiedActions,
					messageHashedTotal: values.hashed,
					tier1: values.t1,
					tier3: values.t3,
					tier4: values.t4,
					updatedAt: NOW
				});
			}
			for (const [orgId, kind, key, count] of [
				[org1, 'supporter_hash', 'h1', 2],
				[org1, 'supporter_hash', 'h2', 3],
				[org2, 'supporter_hash', 'h2', 1],
				[org2, 'supporter_hash', 'h3', 3],
				[org1, 'country', 'US', 5],
				[org2, 'country', 'US', 4],
				[org1, 'action_district', 'd1', 3],
				[org1, 'action_district', 'd2', 3],
				[org2, 'action_district', 'd1', 1],
				[org2, 'action_district', 'd3', 3],
				[org1, 'action_message', 'm1', 2],
				[org1, 'action_message', 'm2', 2],
				[org2, 'action_message', 'm1', 1],
				[org2, 'action_message', 'm3', 2],
				[org1, 'action_hour', '1', 4],
				[org1, 'action_hour', '2', 2],
				[org2, 'action_hour', '1', 2],
				[org2, 'action_hour', '2', 2]
			] as const) {
				await ctx.db.insert('coalitionOrgMetricDimensions', {
					orgId,
					kind,
					key,
					count,
					updatedAt: NOW
				});
			}
			const dmId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				name: 'Representative Proof',
				lastName: 'Proof',
				active: true,
				updatedAt: NOW
			});
			const billId = await ctx.db.insert('bills', {
				externalId: 'hr-proof',
				jurisdiction: 'us-federal',
				jurisdictionLevel: 'federal',
				title: 'Proof Act',
				status: 'introduced',
				statusDate: NOW,
				committees: [],
				sourceUrl: 'https://example.test/proof',
				topics: [],
				entities: [],
				updatedAt: NOW
			});
			for (const [orgId, weight, verified, districts, receipts, numerator, alignmentWeight] of [
				[org1, 10, 5, 3, 2, 4, 8],
				[org2, 7, 4, 2, 3, -1, 2]
			] as const) {
				await ctx.db.insert('coalitionOrgPressureInputs', {
					orgId,
					decisionMakerId: dmId,
					dmName: 'Representative Proof',
					canonicalSlug: 'proof',
					maxProofWeight: weight,
					verifiedActionEvidence: verified,
					districtSignalCount: districts,
					receiptCount: receipts,
					latestReceiptAt: NOW,
					updatedAt: NOW
				});
				await ctx.db.insert('coalitionOrgPressureBillInputs', {
					orgId,
					decisionMakerId: dmId,
					billId,
					billTitle: 'Proof Act',
					alignmentNumerator: numerator,
					alignmentWeight,
					receiptCount: receipts,
					latestReceiptAt: NOW,
					updatedAt: NOW
				});
			}
			return { networkId };
		});

		await driveNetwork(t, fixture.networkId);
		await t.run((ctx) =>
			ctx.db.insert('coalitionMetricsMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'ready-network',
				phase: 'complete',
				scannedSupporters: 0,
				projectedSupporters: 0,
				scannedActions: 0,
				projectedActions: 0,
				scannedReceipts: 0,
				projectedReceipts: 0,
				networksScheduled: 1,
				networksReady: 1,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			})
		);
		const stats = await t.query(api.networks.getStats, {
			networkId: fixture.networkId,
			_secret: SECRET
		});
		expect(stats).toMatchObject({
			memberCount: 2,
			totalSupporters: 9,
			uniqueSupporters: null,
			verifiedSupporters: 8,
			totalCampaignActions: 10,
			verifiedCampaignActions: 9,
			stateDistribution: { US: 9 },
			districtCount: 3,
			ald: 3 / 7,
			cai: 2
		});
		expect(stats.gds).toBeCloseTo(0.66, 10);
		const pressure = await t.query(api.networks.getProofPressure, {
			networkId: fixture.networkId,
			_secret: SECRET,
			limit: 12
		});
		expect(pressure).toEqual([
			expect.objectContaining({
				canonicalSlug: 'proof',
				orgCount: 2,
				combinedProofWeight: 17,
				verifiedActionEvidence: 9,
				districtSignalCount: 5,
				receiptCount: 5,
				bills: [expect.objectContaining({ billTitle: 'Proof Act', alignment: 0.3 })]
			})
		]);
	});

	it('keeps hot read cost constant when raw source cardinality grows', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 30, databaseQueries: 4, bytesRead: 80_000 }
		});
		const networkId = await t.run(async (ctx) => {
			const orgId = await ctx.db.insert('organizations', orgValue('Bounded Org', 'bounded-org'));
			const id = await ctx.db.insert('orgNetworks', {
				name: 'Bounded Network',
				slug: 'bounded-network',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				coalitionMembershipRevision: 1,
				updatedAt: NOW
			});
			await ctx.db.insert('coalitionMetricsMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'bounded',
				phase: 'complete',
				scannedSupporters: 300,
				projectedSupporters: 300,
				scannedActions: 300,
				projectedActions: 300,
				scannedReceipts: 0,
				projectedReceipts: 0,
				networksScheduled: 1,
				networksReady: 1,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			});
			await ctx.db.insert('coalitionNetworkAggregates', {
				networkId: id,
				version: 1,
				status: 'ready',
				activeGeneration: 1,
				revision: 1,
				memberCount: 1,
				totalSupporters: 300,
				uniqueSupporters: 300,
				verifiedSupporters: 300,
				totalCampaignActions: 300,
				verifiedCampaignActions: 300,
				messageHashedTotal: 300,
				uniqueMessages: 300,
				districtCount: 300,
				districtSquareSum: 300,
				hourCountXLogXSum: 300,
				tier1: 100,
				tier3: 100,
				tier4: 100,
				stateDistribution: [{ code: 'US', count: 300 }],
				stateDistributionOtherCount: 0,
				gds: 0.99,
				ald: 1,
				temporalEntropy: 4,
				cai: 2,
				updatedAt: NOW
			});
			return id;
		});
		await t.run(async (ctx) => {
			const org = await ctx.db
				.query('organizations')
				.withIndex('by_slug', (q) => q.eq('slug', 'bounded-org'))
				.unique();
			if (!org) throw new Error('fixture org missing');
			const campaignId = await ctx.db.insert('campaigns', campaignValue(org._id, 'Bounded raw'));
			for (let index = 0; index < 300; index += 1) {
				await ctx.db.insert('supporters', {
					orgId: org._id,
					encryptedEmail: `cipher-${index}`,
					emailHash: `org-${index}`,
					globalEmailHash: `global-${index}`,
					country: 'US',
					verified: true,
					emailStatus: 'subscribed',
					smsStatus: 'none',
					coalitionMetricsVersion: 1,
					updatedAt: NOW
				});
				await ctx.db.insert('campaignActions', {
					campaignId,
					orgId: org._id,
					verified: true,
					engagementTier: 3,
					districtHash: `district-${index}`,
					messageHash: `message-${index}`,
					delegated: false,
					coalitionMetricsVersion: 1,
					sentAt: NOW + index
				});
			}
		});
		const observed = await t.query(async (ctx) => {
			const stats = await ctx.runQuery(api.networks.getStats, {
				networkId,
				_secret: SECRET
			});
			return { stats, metrics: await transactionMetrics(ctx) };
		});
		expect(observed.stats.totalSupporters).toBe(300);
		expect(observed.metrics.documentsRead.used).toBe(2);
		expect(observed.metrics.databaseQueries.used).toBe(2);
		expect(observed.metrics.bytesRead.used).toBeLessThan(80_000);
	});
});
