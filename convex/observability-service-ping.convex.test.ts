/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION } from './lib/publicTemplateDiscoverySource';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const INTERNAL_SECRET = 'observability-readiness-secret-32-byte-padding';

type TransactionMetrics = {
	bytesRead: { used: number };
	documentsRead: { used: number };
	databaseQueries: { used: number };
};

async function insertReadySourcePlane(ctx: MutationCtx): Promise<void> {
	await ctx.db.insert('publicDiscoverySourceMigrations', {
		key: 'v1',
		status: 'ready',
		projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
		runToken: 'ready-source-generation',
		startedAt: 1,
		completedAt: 2,
		scanned: 0,
		eligible: 0,
		sourcesWritten: 0,
		topicVectorsWritten: 0,
		tagVectorsWritten: 0,
		rejected: 0,
		recipientIntentTemplates: 0,
		recipientIntentRecipients: 0,
		recipientProjectedRecipients: 0,
		recipientLossTemplates: 0,
		recipientLossRecipients: 0,
		recipientLossClassifiedTemplates: 0,
		recipientLossClassifiedRecipients: 0,
		updatedAt: 2
	});
}

async function insertReadyTemplateListPlane(ctx: MutationCtx): Promise<void> {
	await ctx.db.insert('templateListProjectionMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-template-list-generation',
		startedAt: 1,
		completedAt: 2,
		scanned: 0,
		projected: 0,
		updatedAt: 2
	});
}

async function insertReadyRecipientMetricsPlane(ctx: MutationCtx): Promise<void> {
	await ctx.db.insert('recipientMetricsMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-recipient-metrics-generation',
		phase: 'complete',
		scannedMessages: 0,
		projectedMessages: 0,
		scannedPositions: 0,
		projectedPositions: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
}

async function insertReadyLaunchPlanes(ctx: MutationCtx): Promise<void> {
	await insertReadySourcePlane(ctx);
	await insertReadyTemplateListPlane(ctx);
	await insertReadyRecipientMetricsPlane(ctx);
	await ctx.db.insert('sessionAuthorityMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-session-authority',
		scanComplete: true,
		scanned: 0,
		written: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('campaignReadModelMigrations', {
		key: 'v1',
		status: 'ready',
		phase: 'deliveries',
		actionsScanned: 0,
		actionsAdopted: 0,
		deliveriesScanned: 0,
		deliveriesAdopted: 0,
		updatedAt: 2
	});
	await ctx.db.insert('campaignActiveCounterMigrations', {
		key: 'v1',
		status: 'ready',
		scanned: 0,
		adopted: 0,
		activeCounted: 0,
		updatedAt: 2
	});
	await ctx.db.insert('debateReadModelMigrations', {
		key: 'v1',
		status: 'ready',
		scanned: 0,
		projected: 0,
		updatedAt: 2
	});
	await ctx.db.insert('publicOrganizationDirectoryMigrations', {
		key: 'v1',
		status: 'ready',
		token: 'ready-public-organization-directory',
		scanComplete: true,
		scanned: 0,
		processed: 0,
		written: 0,
		rejected: 0,
		total: 0,
		updatedAt: 2
	});
	await ctx.db.insert('coalitionMetricsMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-coalition-metrics',
		phase: 'complete',
		scannedSupporters: 0,
		projectedSupporters: 0,
		scannedActions: 0,
		projectedActions: 0,
		scannedReceipts: 0,
		projectedReceipts: 0,
		networksScheduled: 0,
		networksReady: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('networkCharterMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-network-charters',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('supporterBrowseMigrations', {
		key: 'supporter-browse-v1',
		status: 'ready',
		runToken: 'ready-supporter-browse',
		phase: 'complete',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('supporterAudienceActionMigrations', {
		key: 'supporter-audience-actions-v2',
		status: 'ready',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('accountabilityReadModelMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-accountability-read-model',
		phase: 'complete',
		scanComplete: true,
		scanned: 0,
		projected: 0,
		userProjected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('planUsageMigrations', {
		key: 'v1',
		status: 'ready',
		runToken: 'ready-plan-usage',
		phase: 'complete',
		verifiedActions: 0,
		emailsSent: 0,
		emailReserved: 0,
		smsSent: 0,
		restarts: 0,
		scannedOrganizations: 0,
		projectedOrganizations: 0,
		scannedSourceRows: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('subscriptionAuthorityMigrations', {
		key: 'subscription-authority-v1',
		status: 'ready',
		scanned: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('contactAuthorityMigrations', {
		key: 'contact-authority-v1',
		status: 'ready',
		scanned: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('workflowExecutionCountMigrations', {
		key: 'workflow-execution-count-v1',
		status: 'ready',
		phase: 'complete',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('donationConfirmationSummaryMigrations', {
		key: 'donation-confirmation-summary-v1',
		status: 'ready',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
	await ctx.db.insert('smsReplySummaryMigrations', {
		key: 'sms-reply-summary-v1',
		status: 'ready',
		scanned: 0,
		projected: 0,
		startedAt: 1,
		completedAt: 2,
		updatedAt: 2
	});
}

describe('observability service ping', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', INTERNAL_SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('fails loudly when the manifest singleton invariant is violated', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			for (const revision of [1, 2]) {
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					listRevision: revision,
					relationsReady: true,
					relationsRevision: revision
				});
			}
		});

		await expect(t.query(internal.observability.servicePing, {})).rejects.toThrow();
	});

	it('proves indexed data-plane readability without hydrating an application row', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			})
		);

		const observed = await t.query(async (ctx) => {
			const value = await ctx.runQuery(internal.observability.servicePing, {});
			const metrics = await (
				ctx as unknown as {
					meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
				}
			).meta.getTransactionMetrics();
			return { value, metrics };
		});

		expect(observed.value).toEqual({
			ok: true,
			storageReadable: true
		});
		expect(observed.metrics.bytesRead.used).toBeLessThan(2_000);
		expect(observed.metrics.documentsRead.used).toBe(1);
		expect(observed.metrics.databaseQueries.used).toBe(1);
	});

	it('keeps producer health and refresh timing behind the internal-secret boundary', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadyLaunchPlanes(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: 'anonymous' })
		).rejects.toThrow('Unauthorized');
		const trusted = await t.query(api.observability.discoveryProducerStatus, {
			_secret: INTERNAL_SECRET
		});
		expect(trusted).toEqual({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoverySourcePlaneReady: true,
			discoveryEndorsementCountsReady: true,
			templateListProjectionStatus: 'ready',
			templateListProjectionReady: true,
			recipientMetricsStatus: 'ready',
			recipientMetricsReady: true,
			launchProjectionPlanes: {
				discoverySource: { status: 'ready', ready: true, failureCode: null },
				endorsementCounts: { status: 'complete', ready: true, failureCode: null },
				templateList: { status: 'ready', ready: true, failureCode: null },
				recipientMetrics: { status: 'ready', ready: true, failureCode: null },
				sessionAuthority: { status: 'ready', ready: true, failureCode: null },
				campaignReadModel: { status: 'ready', ready: true, failureCode: null },
				campaignCounters: { status: 'ready', ready: true, failureCode: null },
				debateReadModel: { status: 'ready', ready: true, failureCode: null },
				organizationDirectory: { status: 'ready', ready: true, failureCode: null },
				coalitionMetrics: { status: 'ready', ready: true, failureCode: null },
				networkCharters: { status: 'ready', ready: true, failureCode: null },
				supporterBrowse: { status: 'ready', ready: true, failureCode: null },
				supporterAudienceActions: { status: 'ready', ready: true, failureCode: null },
				accountabilityReadModel: { status: 'ready', ready: true, failureCode: null },
				planUsage: { status: 'ready', ready: true, failureCode: null },
				subscriptionAuthority: { status: 'ready', ready: true, failureCode: null },
				contactAuthority: { status: 'ready', ready: true, failureCode: null },
				workflowExecutionCounts: { status: 'ready', ready: true, failureCode: null },
				donationConfirmationSummaries: { status: 'ready', ready: true, failureCode: null },
				smsReplySummaries: { status: 'ready', ready: true, failureCode: null }
			},
			launchProjectionsReady: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});
		await expect(t.query(internal.observability.launchProjectionStatus, {})).resolves.toEqual({
			launchProjectionPlanes: trusted.launchProjectionPlanes,
			launchProjectionsReady: true
		});
	});

	it('does not treat a merely migrated action-audience projection as launch-ready', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadyLaunchPlanes(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
			const migration = await ctx.db
				.query('supporterAudienceActionMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'supporter-audience-actions-v2'))
				.unique();
			if (!migration) throw new Error('test audience migration missing');
			await ctx.db.patch(migration._id, { status: 'migrated' });
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			launchProjectionsReady: false,
			launchProjectionPlanes: {
				supporterAudienceActions: { status: 'migrated', ready: false, failureCode: null }
			}
		});
	});

	it('fails the aggregate launch gate when a required projection is missing or blocked', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadyLaunchPlanes(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
			const supporterMigration = await ctx.db
				.query('supporterBrowseMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'supporter-browse-v1'))
				.unique();
			if (!supporterMigration) throw new Error('test supporter migration missing');
			await ctx.db.delete(supporterMigration._id);
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			launchProjectionsReady: false,
			launchProjectionPlanes: {
				supporterBrowse: { status: 'missing', ready: false, failureCode: null }
			}
		});

		await t.run(async (ctx) => {
			await ctx.db.insert('supporterBrowseMigrations', {
				key: 'supporter-browse-v1',
				status: 'ready',
				runToken: 'ready-supporter-browse',
				phase: 'complete',
				scanned: 0,
				projected: 0,
				startedAt: 1,
				completedAt: 2,
				updatedAt: 2
			});
			const accountabilityMigration = await ctx.db
				.query('accountabilityReadModelMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique();
			if (!accountabilityMigration) throw new Error('test accountability migration missing');
			await ctx.db.patch(accountabilityMigration._id, {
				status: 'blocked',
				failureCode: 'ACCOUNTABILITY_MIGRATION_BLOCKED'
			});
			const subscriptionAuthority = await ctx.db
				.query('subscriptionAuthorityMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'subscription-authority-v1'))
				.unique();
			if (!subscriptionAuthority) throw new Error('test subscription authority missing');
			await ctx.db.patch(subscriptionAuthority._id, {
				status: 'blocked',
				failureCode: 'SUBSCRIPTION_OWNER_CARDINALITY_INVALID:test'
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			launchProjectionsReady: false,
			launchProjectionPlanes: {
				accountabilityReadModel: {
					status: 'blocked',
					ready: false,
					failureCode: 'ACCOUNTABILITY_MIGRATION_BLOCKED'
				},
				subscriptionAuthority: {
					status: 'blocked',
					ready: false,
					failureCode: 'SUBSCRIPTION_OWNER_CARDINALITY_INVALID:test'
				}
			}
		});
	});

	it('reports a durable producer failure from bounded control-plane rows', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadySourcePlane(ctx);
			await insertReadyTemplateListPlane(ctx);
			await insertReadyRecipientMetricsPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 3,
				listFailureAt: 123,
				listFailureCode: 'PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:all',
				relationsReady: true,
				relationsRevision: 3,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoveryManifestPresent: true,
			discoveryProducerHealthy: false,
			discoveryProducerOverdueAt: null
		});
	});

	it('returns deterministic readiness and overdue coordinates without reading the clock', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadySourcePlane(ctx);
			await insertReadyTemplateListPlane(ctx);
			await insertReadyRecipientMetricsPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				listDirtyAt: 100,
				listRefreshScheduledAt: 1_000,
				relationsReady: false,
				relationsRevision: 0,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoveryProducerHealthy: false,
			discoveryProducerOverdueAt: 1_000 + 15 * 60 * 1000
		});
	});

	it('fails closed when snapshots are ready but the compact source cutover is not', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadyTemplateListPlane(ctx);
			await insertReadyRecipientMetricsPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoverySourcePlaneReady: false,
			discoveryProducerHealthy: false
		});
	});

	it('fails launch readiness for missing or incoherent recipient-integrity counters', async () => {
		for (const counterPatch of [
			{ recipientIntentTemplates: undefined },
			{
				recipientIntentTemplates: 1,
				recipientIntentRecipients: 2,
				recipientProjectedRecipients: 0,
				recipientLossTemplates: 1,
				recipientLossRecipients: 1,
				recipientLossClassifiedTemplates: 1,
				recipientLossClassifiedRecipients: 1
			}
		] as const) {
			const t = convexTest({ schema, modules });
			await t.run(async (ctx) => {
				await insertReadySourcePlane(ctx);
				const sourceMigration = await ctx.db
					.query('publicDiscoverySourceMigrations')
					.withIndex('by_key', (q) => q.eq('key', 'v1'))
					.unique();
				if (!sourceMigration) throw new Error('missing source migration fixture');
				await ctx.db.patch(sourceMigration._id, counterPatch);
				await insertReadyTemplateListPlane(ctx);
				await insertReadyRecipientMetricsPlane(ctx);
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					listRevision: 1,
					relationsReady: true,
					relationsRevision: 1,
					endorsementCountMigrationStatus: 'complete',
					endorsementCountMigrationCompletedAt: 2
				});
			});

			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
			).resolves.toMatchObject({
				discoverySourcePlaneReady: false,
				discoveryProducerHealthy: false,
				launchProjectionPlanes: {
					discoverySource: { status: 'ready', ready: false }
				}
			});
		}
	});

	it('fails closed when exact endorsement counters have not completed migration', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadySourcePlane(ctx);
			await insertReadyTemplateListPlane(ctx);
			await insertReadyRecipientMetricsPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoverySourcePlaneReady: true,
			discoveryEndorsementCountsReady: false,
			discoveryProducerHealthy: false
		});
	});

	it('fails closed when the authenticated list projection has not completed cutover', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadySourcePlane(ctx);
			await insertReadyRecipientMetricsPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			templateListProjectionStatus: 'not-started',
			templateListProjectionReady: false,
			discoveryProducerHealthy: false
		});
	});

	it('fails closed when compact recipient metrics have not completed cutover', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await insertReadySourcePlane(ctx);
			await insertReadyTemplateListPlane(ctx);
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCompletedAt: 2
			});
		});

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			recipientMetricsStatus: 'not-started',
			recipientMetricsReady: false,
			discoveryProducerHealthy: false
		});
	});
});
