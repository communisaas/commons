/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type FunctionReference } from 'convex/server';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const TOKEN = 'https://issuer.example|plan-usage-projection';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const PERIOD_START = Date.parse('2026-07-01T00:00:00.000Z');
const PERIOD_END = Date.parse('2026-08-01T00:00:00.000Z');
const NEXT_PERIOD_START = PERIOD_END;
const NEXT_PERIOD_END = Date.parse('2026-09-01T00:00:00.000Z');
type Harness = TestConvex<typeof schema>;
type MigrationResult = { status: string; runToken: string };

const migrateRef = makeFunctionReference<'mutation'>(
	'planUsage:migrate'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ runToken?: string; retryBlocked?: boolean; scheduleContinuation?: boolean },
	MigrationResult
>;
const activateRef = makeFunctionReference<'mutation'>(
	'planUsage:activate'
) as unknown as FunctionReference<'mutation', 'internal', Record<string, never>, unknown>;
const repairRef = makeFunctionReference<'mutation'>(
	'planUsage:repairOrg'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ orgId: Id<'organizations'>; runToken: string },
	{ status: string }
>;
const sweepStaleRef = makeFunctionReference<'mutation'>(
	'planUsage:sweepStale'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ cursor?: string },
	{ status: string; enqueued?: number }
>;
const updateSubscriptionRef = makeFunctionReference<'mutation'>(
	'subscriptions:updateByStripeId'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		stripeSubscriptionId: string;
		status: 'active';
		currentPeriodStart: number;
		currentPeriodEnd: number;
	},
	unknown
>;

async function seedBillingOrg(t: Harness, projected = false) {
	return t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'plan-usage@example.test',
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
			name: 'Plan Usage Projection',
			slug: 'plan-usage-projection',
			maxSeats: 5,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			verifiedActionsLifetime: 250,
			sentEmailCount: 1_000,
			smsSentCount: 500,
			...(projected
				? {
						verifiedActionsPeriodBaseline: 45,
						verifiedActionsPeriodBaselineAt: PERIOD_START,
						sentEmailPeriodBaseline: 799,
						sentEmailPeriodBaselineAt: PERIOD_START,
						emailReservedCount: 0,
						emailReservationPeriodStart: PERIOD_START,
						emailReservationState: 'ready' as const,
						smsSentPeriodBaseline: 299,
						smsSentPeriodBaselineAt: PERIOD_START
					}
				: {}),
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		await ctx.db.insert('subscriptions', {
			orgId,
			plan: 'starter',
			priceCents: 1_000,
			status: 'active',
			currentPeriodStart: PERIOD_START,
			currentPeriodEnd: PERIOD_END,
			paymentMethod: 'stripe',
			stripeSubscriptionId: 'sub_plan_usage_projection',
			updatedAt: NOW
		});
		await ctx.db.insert('subscriptionAuthorityMigrations', {
			key: 'subscription-authority-v1',
			status: 'ready',
			scanned: 1,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Plan usage campaign',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			updatedAt: NOW
		});
		return { orgId, campaignId };
	});
}

async function installReadyMigration(t: Harness): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('planUsageMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'ready-plan-usage',
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
		})
	);
}

async function drainMigration(t: Harness, initial?: MigrationResult): Promise<MigrationResult> {
	let result = initial ?? (await t.mutation(migrateRef, { scheduleContinuation: false }));
	for (let page = 0; result.status === 'running' && page < 100; page += 1) {
		result = await t.mutation(migrateRef, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
	}
	return result;
}

async function advanceMigrationToPhase(
	t: Harness,
	phase: string,
	initial?: MigrationResult
): Promise<MigrationResult> {
	let result = initial ?? (await t.mutation(migrateRef, { scheduleContinuation: false }));
	for (let page = 0; page < 100; page += 1) {
		const state = await t.run((ctx) =>
			ctx.db
				.query('planUsageMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique()
		);
		if (state?.phase === phase) return result;
		if (result.status !== 'running') break;
		result = await t.mutation(migrateRef, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
	}
	throw new Error(`migration did not reach ${phase}`);
}

async function drainRepair(t: Harness, orgId: Id<'organizations'>): Promise<void> {
	for (let page = 0; page < 100; page += 1) {
		const repair = await t.run((ctx) =>
			ctx.db
				.query('planUsageRepairs')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique()
		);
		if (!repair) throw new Error('repair missing');
		if (repair.status === 'ready') return;
		if (repair.status === 'blocked') throw new Error(repair.failureCode ?? 'repair blocked');
		await t.mutation(repairRef, { orgId, runToken: repair.runToken });
	}
	throw new Error('repair did not complete');
}

async function seedCurrentPeriodHistory(
	t: Harness,
	orgId: Id<'organizations'>,
	campaignId: Id<'campaigns'>,
	rows: number
): Promise<void> {
	for (let start = 0; start < rows; start += 50) {
		await t.run(async (ctx) => {
			for (let index = start; index < Math.min(rows, start + 50); index += 1) {
				await ctx.db.insert('campaignActions', {
					campaignId,
					orgId,
					verified: true,
					engagementTier: 1,
					delegated: false,
					sentAt: PERIOD_START + index + 1
				});
				await ctx.db.insert('emailBlasts', {
					orgId,
					subject: `Email ${index}`,
					bodyHtml: '<p>bounded</p>',
					fromName: 'Commons',
					fromEmail: 'hello@example.test',
					totalRecipients: 1,
					totalSent: 1,
					totalBounced: 0,
					totalOpened: 0,
					totalClicked: 0,
					totalComplained: 0,
					status: 'sent',
					isAbTest: false,
					sentAt: PERIOD_START + index + 1,
					updatedAt: NOW
				});
				await ctx.db.insert('smsBlasts', {
					orgId,
					body: `SMS ${index}`,
					fromNumber: '+15555550100',
					totalRecipients: 1,
					sentCount: 1,
					deliveredCount: 1,
					failedCount: 0,
					status: 'sent',
					sentAt: PERIOD_START + index + 1,
					updatedAt: NOW
				});
			}
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('plan usage projection', () => {
	it('migrates each history source in cursor pages and activates exact baselines', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedBillingOrg(t);
		await seedCurrentPeriodHistory(t, orgId, campaignId, 201);

		let result = await t.mutation(migrateRef, { scheduleContinuation: false });
		for (let page = 0; result.status === 'running' && page < 30; page += 1) {
			result = await t.mutation(migrateRef, {
				runToken: result.runToken,
				scheduleContinuation: false
			});
		}
		expect(result.status).toBe('migrated');
		await t.run(async (ctx) => {
			const authority = await ctx.db
				.query('subscriptionAuthorityMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'subscription-authority-v1'))
				.unique();
			if (!authority) throw new Error('subscription authority fixture missing');
			await ctx.db.delete(authority._id);
		});
		await expect(t.mutation(activateRef, {})).rejects.toThrow('PLAN_USAGE_MIGRATION_INEXACT');
		await t.run((ctx) =>
			ctx.db.insert('subscriptionAuthorityMigrations', {
				key: 'subscription-authority-v1',
				status: 'ready',
				scanned: 1,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			})
		);
		await expect(t.mutation(activateRef, {})).resolves.toMatchObject({ status: 'ready' });

		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org).toMatchObject({
			verifiedActionsPeriodBaseline: 49,
			verifiedActionsPeriodBaselineAt: PERIOD_START,
			sentEmailPeriodBaseline: 799,
			sentEmailPeriodBaselineAt: PERIOD_START,
			smsSentPeriodBaseline: 299,
			smsSentPeriodBaselineAt: PERIOD_START
		});
	});

	it('serves a constant-cardinality plan check despite large raw histories', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 8, databaseQueries: 8, bytesRead: 64 * 1024 }
		});
		const { orgId, campaignId } = await seedBillingOrg(t, true);
		await installReadyMigration(t);
		await seedCurrentPeriodHistory(t, orgId, campaignId, 1_000);

		const result = await t
			.withIdentity({ tokenIdentifier: TOKEN })
			.query(api.subscriptions.checkPlanLimits, { orgSlug: 'plan-usage-projection' });
		expect(result).toMatchObject({
			usageReady: true,
			usageFailureCode: null,
			current: { verifiedActions: 205, emailsSent: 201, smsSent: 201 }
		});
	});

	it('restarts an organization instead of publishing across concurrent counter writes', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedBillingOrg(t);
		await seedCurrentPeriodHistory(t, orgId, campaignId, 1);
		let result = await advanceMigrationToPhase(t, 'smsBlasts');

		await t.run(async (ctx) => {
			await ctx.db.insert('emailBlasts', {
				orgId,
				subject: 'Concurrent email',
				bodyHtml: '<p>concurrent</p>',
				fromName: 'Commons',
				fromEmail: 'hello@example.test',
				totalRecipients: 1,
				totalSent: 1,
				totalBounced: 0,
				totalOpened: 0,
				totalClicked: 0,
				totalComplained: 0,
				status: 'sent',
				isAbTest: false,
				sentAt: NOW,
				updatedAt: NOW
			});
			await ctx.db.patch(orgId, { sentEmailCount: 1_001 });
		});
		result = await t.mutation(migrateRef, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
		const restarted = await t.run((ctx) =>
			ctx.db
				.query('planUsageMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique()
		);
		expect(restarted).toMatchObject({
			status: 'running',
			phase: 'verifiedActions',
			restarts: 1,
			projectedOrganizations: 0
		});

		for (let page = 0; result.status === 'running' && page < 20; page += 1) {
			result = await t.mutation(migrateRef, {
				runToken: result.runToken,
				scheduleContinuation: false
			});
		}
		expect(result.status).toBe('migrated');
		await t.mutation(activateRef, {});
		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org?.sentEmailPeriodBaseline).toBe(999);
	});

	it('fails quota accounting closed while migration or period baselines are incomplete', async () => {
		const t = convexTest({ schema, modules });
		await seedBillingOrg(t);
		const result = await t
			.withIdentity({ tokenIdentifier: TOKEN })
			.query(api.subscriptions.checkPlanLimits, { orgSlug: 'plan-usage-projection' });
		expect(result).toMatchObject({
			usageReady: false,
			usageFailureCode: 'PLAN_USAGE_MIGRATION_NOT_READY',
			current: { verifiedActions: 1_000, emailsSent: 20_000, smsSent: 1_000 }
		});
	});

	it('rejects an active Stripe period start beyond the clock-skew envelope', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedBillingOrg(t, true);
		await installReadyMigration(t);
		await t.run(async (ctx) => {
			const subscription = await ctx.db
				.query('subscriptions')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			if (!subscription) throw new Error('subscription missing');
			await ctx.db.patch(subscription._id, { currentPeriodStart: NOW + 60 * 60 * 1000 });
		});

		await expect(
			t
				.withIdentity({ tokenIdentifier: TOKEN })
				.query(api.subscriptions.checkPlanLimits, { orgSlug: 'plan-usage-projection' })
		).resolves.toMatchObject({
			usageReady: false,
			usageFailureCode: 'PLAN_USAGE_NOT_READY:period'
		});
	});

	it('revalidates the Stripe period before global publish and never rewinds newer baselines', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedBillingOrg(t);
		await seedCurrentPeriodHistory(t, orgId, campaignId, 1);

		let result = await advanceMigrationToPhase(t, 'smsBlasts');

		vi.setSystemTime(Date.parse('2026-08-02T12:00:00.000Z'));
		await t.run(async (ctx) => {
			const subscription = await ctx.db
				.query('subscriptions')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			if (!subscription) throw new Error('subscription missing');
			await ctx.db.patch(subscription._id, {
				currentPeriodStart: NEXT_PERIOD_START,
				currentPeriodEnd: NEXT_PERIOD_END
			});
			await ctx.db.patch(orgId, {
				verifiedActionsPeriodBaseline: 250,
				verifiedActionsPeriodBaselineAt: NEXT_PERIOD_START,
				sentEmailPeriodBaseline: 1_000,
				sentEmailPeriodBaselineAt: NEXT_PERIOD_START,
				smsSentPeriodBaseline: 500,
				smsSentPeriodBaselineAt: NEXT_PERIOD_START
			});
		});

		result = await t.mutation(migrateRef, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
		const restarted = await t.run((ctx) =>
			ctx.db
				.query('planUsageMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique()
		);
		expect(restarted).toMatchObject({
			status: 'running',
			phase: 'verifiedActions',
			periodStart: NEXT_PERIOD_START,
			restarts: 1
		});
		const beforeRepublish = await t.run((ctx) => ctx.db.get(orgId));
		expect(beforeRepublish?.verifiedActionsPeriodBaselineAt).toBe(NEXT_PERIOD_START);

		result = await drainMigration(t, result);
		expect(result.status).toBe('migrated');
		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org).toMatchObject({
			verifiedActionsPeriodBaselineAt: NEXT_PERIOD_START,
			sentEmailPeriodBaselineAt: NEXT_PERIOD_START,
			smsSentPeriodBaselineAt: NEXT_PERIOD_START
		});
	});

	it('retries a blocked global migration from fresh snapshots and zero restarts', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedBillingOrg(t);
		await t.run((ctx) =>
			ctx.db.insert('planUsageMigrations', {
				key: 'v1',
				status: 'blocked',
				runToken: 'blocked-plan-usage',
				phase: 'smsBlasts',
				currentOrgId: orgId,
				sourceCursor: 'stale-source-cursor',
				periodStart: PERIOD_START,
				verifiedActions: 99,
				emailsSent: 99,
				emailReserved: 0,
				smsSent: 99,
				verifiedLifetimeSnapshot: 1,
				emailLifetimeSnapshot: 1,
				emailReservedSnapshot: 0,
				emailReservationPeriodSnapshot: PERIOD_START,
				smsLifetimeSnapshot: 1,
				restarts: 8,
				scannedOrganizations: 1,
				projectedOrganizations: 0,
				scannedSourceRows: 99,
				failureCode: 'PLAN_USAGE_MIGRATION_CONCURRENT_WRITES',
				failureSourceId: String(orgId),
				startedAt: NOW,
				updatedAt: NOW
			})
		);

		const result = await t.mutation(migrateRef, {
			runToken: 'blocked-plan-usage',
			retryBlocked: true,
			scheduleContinuation: false
		});
		expect(result.status).toBe('running');
		const retried = await t.run((ctx) =>
			ctx.db
				.query('planUsageMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique()
		);
		expect(retried).toMatchObject({
			status: 'running',
			phase: 'emailBlasts',
			restarts: 0,
			verifiedLifetimeSnapshot: 250,
			emailLifetimeSnapshot: 1_000,
			smsLifetimeSnapshot: 500
		});
		expect(retried?.sourceCursor).toBeUndefined();
		expect(retried?.failureCode).toBeUndefined();
	});

	it('repairs a stale paid period exactly and meters successful SMS batches still sending', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedBillingOrg(t, true);
		await installReadyMigration(t);
		vi.setSystemTime(Date.parse('2026-08-02T12:00:00.000Z'));
		await t.run(async (ctx) => {
			await ctx.db.insert('campaignActions', {
				campaignId,
				orgId,
				verified: true,
				engagementTier: 1,
				delegated: false,
				sentAt: NEXT_PERIOD_START + 1
			});
			await ctx.db.insert('emailBlasts', {
				orgId,
				subject: 'Late webhook email',
				bodyHtml: '<p>sent before webhook</p>',
				fromName: 'Commons',
				fromEmail: 'hello@example.test',
				totalRecipients: 2,
				totalSent: 2,
				totalBounced: 0,
				totalOpened: 0,
				totalClicked: 0,
				totalComplained: 0,
				status: 'sent',
				isAbTest: false,
				sentAt: NEXT_PERIOD_START + 2,
				updatedAt: Date.now()
			});
			await ctx.db.insert('smsBlasts', {
				orgId,
				body: 'Partial successful batch',
				fromNumber: '+15555550100',
				totalRecipients: 10,
				sentCount: 3,
				deliveredCount: 2,
				failedCount: 0,
				status: 'sending',
				sentAt: NEXT_PERIOD_START + 3,
				updatedAt: Date.now()
			});
			await ctx.db.patch(orgId, {
				verifiedActionsLifetime: 251,
				sentEmailCount: 1_002,
				smsSentCount: 503
			});
		});
		await t.mutation(updateSubscriptionRef, {
			stripeSubscriptionId: 'sub_plan_usage_projection',
			status: 'active',
			currentPeriodStart: NEXT_PERIOD_START,
			currentPeriodEnd: NEXT_PERIOD_END
		});

		const stale = await t
			.withIdentity({ tokenIdentifier: TOKEN })
			.query(api.subscriptions.checkPlanLimits, { orgSlug: 'plan-usage-projection' });
		expect(stale).toMatchObject({
			usageReady: false,
			usageRepairRequired: false,
			usageRepairStatus: 'pending'
		});
		const beforeRepair = await t.run((ctx) => ctx.db.get(orgId));
		// A delayed webhook must not snapshot lifetime and erase the already-sent
		// rows above. Publication stays on the old period until the exact scan wins.
		expect(beforeRepair?.smsSentPeriodBaselineAt).toBe(PERIOD_START);
		await drainRepair(t, orgId);

		const ready = await t
			.withIdentity({ tokenIdentifier: TOKEN })
			.query(api.subscriptions.checkPlanLimits, { orgSlug: 'plan-usage-projection' });
		expect(ready).toMatchObject({
			usageReady: true,
			usageFailureCode: null,
			current: { verifiedActions: 1, emailsSent: 2, smsSent: 3 }
		});
		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org).toMatchObject({
			verifiedActionsPeriodBaseline: 250,
			sentEmailPeriodBaseline: 1_000,
			smsSentPeriodBaseline: 500,
			smsSentPeriodBaselineAt: NEXT_PERIOD_START
		});

		// An out-of-order subscription.updated event may arrive after repair. It
		// must not rewind either the subscription authority or published baselines.
		await t.mutation(updateSubscriptionRef, {
			stripeSubscriptionId: 'sub_plan_usage_projection',
			status: 'active',
			currentPeriodStart: PERIOD_START,
			currentPeriodEnd: PERIOD_END
		});
		const afterStaleWebhook = await t.run(async (ctx) => {
			const subscription = await ctx.db
				.query('subscriptions')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			return { subscription, org: await ctx.db.get(orgId) };
		});
		expect(afterStaleWebhook.subscription?.currentPeriodStart).toBe(NEXT_PERIOD_START);
		expect(afterStaleWebhook.org?.smsSentPeriodBaselineAt).toBe(NEXT_PERIOD_START);
	});

	it('sweeps inactive organizations into the new UTC calendar period', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedBillingOrg(t, true);
		await installReadyMigration(t);
		vi.setSystemTime(Date.parse('2026-08-02T12:00:00.000Z'));
		await t.run(async (ctx) => {
			const subscription = await ctx.db
				.query('subscriptions')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			if (!subscription) throw new Error('subscription missing');
			await ctx.db.patch(subscription._id, { status: 'canceled' });
		});

		await expect(t.mutation(sweepStaleRef, {})).resolves.toMatchObject({
			status: 'complete',
			enqueued: 1
		});
		await drainRepair(t, orgId);
		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org).toMatchObject({
			verifiedActionsPeriodBaselineAt: NEXT_PERIOD_START,
			sentEmailPeriodBaselineAt: NEXT_PERIOD_START,
			smsSentPeriodBaselineAt: NEXT_PERIOD_START
		});
	});

	it('global migration adopts legacy SMS counters and bills partial sending rows', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedBillingOrg(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(orgId, { smsSentCount: 0 });
			await ctx.db.insert('smsBlasts', {
				orgId,
				body: 'Legacy partial batch',
				fromNumber: '+15555550100',
				totalRecipients: 10,
				sentCount: 7,
				deliveredCount: 4,
				failedCount: 1,
				status: 'sending',
				sentAt: PERIOD_START + 1,
				updatedAt: NOW
			});
		});

		const result = await drainMigration(t);
		expect(result.status).toBe('migrated');
		await t.mutation(activateRef, {});
		const org = await t.run((ctx) => ctx.db.get(orgId));
		expect(org).toMatchObject({
			smsSentCount: 7,
			smsSentPeriodBaseline: 0,
			smsSentPeriodBaselineAt: PERIOD_START
		});
		const repair = await t.run((ctx) =>
			ctx.db
				.query('planUsageRepairs')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique()
		);
		expect(repair?.smsSent).toBe(7);
		expect(repair?.repairedCounterFields).toContain('smsSentCount');
	});
});
