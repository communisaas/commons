/**
 * I2 — Boundary-cell observability.
 *
 * H1 stores `cellStraddles` on `districtCredentials`. Storage ≠ monitoring.
 * Without an alert, a deploy regression that misroutes every address to the
 * boundary path would only be detectable via end-of-quarter metrics review,
 * which is too slow.
 *
 * This module:
 *   - `getBoundaryCellRate24h` (internalQuery): reads one explicit, byte-bounded
 *     trailing-24 h page. Above the reviewed launch capacity it reports
 *     saturation instead of iterating an attacker-sized credential range.
 *   - `monitorBoundaryCellRate` (internalAction): runs the query and emits
 *     a Sentry alert via `/api/internal/alert` when the rate exceeds the
 *     threshold. Cron-driven (see `convex/crons.ts`).
 *
 * Alert payload contract (PII-free):
 *   - severity, code, message, context = { rate, numer, denom, threshold,
 *     period_ms }
 *   - NO user IDs, hashes, addresses, district codes, or credential bytes
 *
 * Threshold rationale:
 *   - G3 measured CA boundary-cell rate: ~16.4%. A healthy steady-state.
 *   - Threshold: 28% sustained — chosen as 16.4% + ~12 percentage points
 *     of cushion. Hourly cron firing on a 24 h window means a spike must
 *     persist for ~hours before alerting; transient anomalies (a single
 *     bad batch of registrations) won't page.
 *   - Update the constant if multi-state launch shifts the baseline.
 */

import { v } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { captureToSentry } from './_sentry';
import { requireInternalSecret } from './_internalAuth';
import {
	supervisePublicDiscoveryCoordinatedRebuildLease,
	supervisePublicDiscoveryCoordinatedRebuildWatchdog,
	type PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult,
	type PublicDiscoveryCoordinatedRebuildWatchdogResult
} from './lib/publicDiscovery';
import {
	PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
	publicRecipientMigrationIntegrityReady
} from './lib/publicTemplateDiscoverySource';
import { isAccountabilityReadModelReady } from './lib/accountabilityReadModel';
import { isPlanUsageMigrationReady } from './lib/planUsage';

// Break circular type inference between the action and the query in the same
// file (mirrors the revocations.ts pattern). Calling `internal.observability.*`
// from monitorBoundaryCellRate would create a self-referential type.

declare const process: { env: Record<string, string | undefined> };
const getBoundaryCellRate24hRef = makeFunctionReference<'query'>(
	'observability:getBoundaryCellRate24h'
) as unknown as FunctionReference<
	'query',
	'internal',
	Record<string, never>,
	{
		rate: number | null;
		boundaryCount: number;
		postH1Count: number;
		totalRecent: number;
		periodMs: number;
		capacityExceeded: boolean;
		scanned: number;
		cutoff: number;
		asOf: number;
	}
>;
const recordBoundaryCellRateResultRef = makeFunctionReference<'mutation'>(
	'observability:recordBoundaryCellRateResult'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		asOf: number;
		cutoff: number;
		scanned: number;
		boundaryCount: number;
		postH1Count: number;
		totalRecent: number;
		rate?: number;
		capacityExceeded: boolean;
	},
	unknown
>;

const reportCoordinatedPublicDiscoveryRebuildLeaseFailureRef = makeFunctionReference<'action'>(
	'observability:reportCoordinatedPublicDiscoveryRebuildLeaseFailure'
) as unknown as FunctionReference<
	'action',
	'internal',
	{
		failureAt: number;
		failureCode: string;
		leaseExpiresAt: number;
		retryAt: number;
		kind: 'clearSeed' | 'reseedTemplates' | null;
		attempt: number;
	},
	{ reported: true }
>;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const BOUNDARY_CELL_MONITOR_PAGE_ROWS = 250;
const BOUNDARY_CELL_MONITOR_PAGE_BYTES = 512 * 1024;

/**
 * Tunable threshold for boundary_cell_send_rate alerts.
 *
 * G3 baseline (CA): ~16.4%. We alert at 28% to cover normal noise and
 * still page on regressions where every credential ends up on the
 * boundary path. Multi-state launch should re-tune this.
 */
const BOUNDARY_RATE_ALERT_THRESHOLD = 0.28;

/**
 * Minimum denominator before we trust the rate. With <50 credentials in
 * the window the rate is too noisy to alert on (single boundary-cell
 * credential at denom=10 would show 10%, easily spiking to >28% with
 * a couple of bad apples). 50 is a launch-defensible floor; revisit if
 * volume forces it lower.
 */
const MIN_DENOMINATOR_FOR_ALERT = 50;

/**
 * Coverage-bias floor. The boundary-rate denominator excludes legacy rows
 * (no `cellStraddles` field) per H0r honesty. Over time, if pre-H1 users
 * never re-issue, the post-H1 fraction shrinks vs the total recent
 * credentials, and the boundary rate becomes increasingly biased toward
 * power users who DO re-issue. When the post-H1 fraction drops below
 * this threshold, the alert fires once per cron tick to push operators
 * to either backfill `cellStraddles` from a re-resolution sweep or accept
 * the bias and document.
 */
const COVERAGE_FLOOR = 0.5;
const PUBLIC_DISCOVERY_REFRESH_OVERDUE_GRACE_MS = 15 * 60 * 1000;

type StaleCoordinatedRebuildResult = Extract<
	PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult,
	{ status: 'stale' }
>;

async function enqueueCoordinatedPublicDiscoveryRebuildLeaseAlert(
	ctx: Pick<MutationCtx, 'scheduler'>,
	result: StaleCoordinatedRebuildResult
): Promise<void> {
	if (!result.shouldAlert) return;
	await ctx.scheduler.runAfter(0, reportCoordinatedPublicDiscoveryRebuildLeaseFailureRef, {
		failureAt: result.failureAt,
		failureCode: result.failureCode,
		leaseExpiresAt: result.leaseExpiresAt,
		retryAt: result.retryAt,
		kind: result.kind,
		attempt: result.attempt
	});
}

/**
 * Stamp an expired coordinated-rebuild lease and atomically enqueue its alert.
 *
 * The shared helper never unlocks or publishes. Scheduling from the same
 * mutation as the first durable failure stamp prevents a worker crash between
 * persistence and notification from permanently losing the alert.
 */
export const superviseCoordinatedPublicDiscoveryRebuildLease = internalMutation({
	args: {},
	handler: async (ctx): Promise<PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult> => {
		const result = await supervisePublicDiscoveryCoordinatedRebuildLease(ctx);
		if (result.status === 'stale' && result.shouldAlert) {
			await enqueueCoordinatedPublicDiscoveryRebuildLeaseAlert(ctx, result);
		}
		return result;
	}
});

/**
 * Contained-mode, zero-idle lease watchdog.
 *
 * Acquisition schedules this mutation once with the exact owner coordinate.
 * Only that coordinate can re-arm after a renewal or stamp terminal evidence;
 * every cleared, duplicate, delayed, or predecessor invocation is a no-op.
 */
export const superviseCoordinatedPublicDiscoveryRebuildWatchdog = internalMutation({
	args: {
		coordinatedRebuildToken: v.string(),
		coordinatedRebuildAttempt: v.number(),
		scheduledAt: v.number()
	},
	handler: async (ctx, args): Promise<PublicDiscoveryCoordinatedRebuildWatchdogResult> => {
		const result = await supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, args);
		if (result.status === 'stale' && result.shouldAlert) {
			await enqueueCoordinatedPublicDiscoveryRebuildLeaseAlert(ctx, result);
		}
		return result;
	}
});

/** Emit the one-shot, PII-free alert for a coordinated rebuild that lost its lease. */
export const reportCoordinatedPublicDiscoveryRebuildLeaseFailure = internalAction({
	args: {
		failureAt: v.number(),
		failureCode: v.string(),
		leaseExpiresAt: v.number(),
		retryAt: v.number(),
		kind: v.union(v.literal('clearSeed'), v.literal('reseedTemplates'), v.null()),
		attempt: v.number()
	},
	handler: async (_ctx, args): Promise<{ reported: true }> => {
		await captureToSentry(new Error(args.failureCode), {
			action: 'observability:superviseCoordinatedPublicDiscoveryRebuildLease',
			level: 'error',
			extra: args
		});
		return { reported: true };
	}
});

async function readPublicDiscoveryManifest(ctx: QueryCtx) {
	return ctx.db
		.query('publicDiscoveryManifest')
		.withIndex('by_key', (q) => q.eq('key', 'public'))
		.unique();
}

async function readPublicDiscoverySourceMigration(ctx: QueryCtx) {
	return ctx.db
		.query('publicDiscoverySourceMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readTemplateListProjectionMigration(ctx: QueryCtx) {
	return ctx.db
		.query('templateListProjectionMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readRecipientMetricsMigration(ctx: QueryCtx) {
	return ctx.db
		.query('recipientMetricsMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readSessionAuthorityMigration(ctx: QueryCtx) {
	return ctx.db
		.query('sessionAuthorityMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readCampaignReadModelMigration(ctx: QueryCtx) {
	return ctx.db
		.query('campaignReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readCampaignCounterMigration(ctx: QueryCtx) {
	return ctx.db
		.query('campaignActiveCounterMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readDebateReadModelMigration(ctx: QueryCtx) {
	return ctx.db
		.query('debateReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readPublicOrganizationDirectoryMigration(ctx: QueryCtx) {
	return ctx.db
		.query('publicOrganizationDirectoryMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readCoalitionMetricsMigration(ctx: QueryCtx) {
	return ctx.db
		.query('coalitionMetricsMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readNetworkCharterMigration(ctx: QueryCtx) {
	return ctx.db
		.query('networkCharterMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readSupporterBrowseMigration(ctx: QueryCtx) {
	return ctx.db
		.query('supporterBrowseMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'supporter-browse-v1'))
		.unique();
}

async function readSupporterAudienceActionMigration(ctx: QueryCtx) {
	return ctx.db
		.query('supporterAudienceActionMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'supporter-audience-actions-v2'))
		.unique();
}

async function readAccountabilityReadModelMigration(ctx: QueryCtx) {
	return ctx.db
		.query('accountabilityReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readPlanUsageMigration(ctx: QueryCtx) {
	return ctx.db
		.query('planUsageMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

async function readSubscriptionAuthorityMigration(ctx: QueryCtx) {
	return ctx.db
		.query('subscriptionAuthorityMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'subscription-authority-v1'))
		.unique();
}

async function readContactAuthorityMigration(ctx: QueryCtx) {
	return ctx.db
		.query('contactAuthorityMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'contact-authority-v1'))
		.unique();
}

async function readOldestContactFanoutJob(ctx: QueryCtx, status: 'pending' | 'failed') {
	return ctx.db
		.query('contactFanoutJobs')
		.withIndex('by_status_createdAt', (q) => q.eq('status', status))
		.order('asc')
		.first();
}

async function readWorkflowExecutionCountMigration(ctx: QueryCtx) {
	return ctx.db
		.query('workflowExecutionCountMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'workflow-execution-count-v1'))
		.unique();
}

async function readDonationConfirmationSummaryMigration(ctx: QueryCtx) {
	return ctx.db
		.query('donationConfirmationSummaryMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'donation-confirmation-summary-v1'))
		.unique();
}

async function readSmsReplySummaryMigration(ctx: QueryCtx) {
	return ctx.db
		.query('smsReplySummaryMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'sms-reply-summary-v1'))
		.unique();
}

function launchPlane(status: unknown, ready: boolean, failureCode?: unknown) {
	return {
		status:
			typeof status === 'string' && status.length > 0 ? status.slice(0, 64) : ('missing' as const),
		ready,
		failureCode:
			typeof failureCode === 'string' && failureCode.length > 0 ? failureCode.slice(0, 256) : null
	};
}

async function readDiscoveryProducerStatus(ctx: QueryCtx) {
	const [
		manifest,
		sourceMigration,
		templateListMigration,
		recipientMetricsMigration,
		sessionAuthorityMigration,
		campaignReadModelMigration,
		campaignCounterMigration,
		debateReadModelMigration,
		publicOrganizationDirectoryMigration,
		coalitionMetricsMigration,
		networkCharterMigration,
		supporterBrowseMigration,
		supporterAudienceActionMigration,
		accountabilityReadModelMigration,
		planUsageMigration,
		subscriptionAuthorityMigration,
		contactAuthorityMigration,
		failedContactFanoutJob,
		pendingContactFanoutJob,
		workflowExecutionCountMigration,
		donationConfirmationSummaryMigration,
		smsReplySummaryMigration
	] = await Promise.all([
		readPublicDiscoveryManifest(ctx),
		readPublicDiscoverySourceMigration(ctx),
		readTemplateListProjectionMigration(ctx),
		readRecipientMetricsMigration(ctx),
		readSessionAuthorityMigration(ctx),
		readCampaignReadModelMigration(ctx),
		readCampaignCounterMigration(ctx),
		readDebateReadModelMigration(ctx),
		readPublicOrganizationDirectoryMigration(ctx),
		readCoalitionMetricsMigration(ctx),
		readNetworkCharterMigration(ctx),
		readSupporterBrowseMigration(ctx),
		readSupporterAudienceActionMigration(ctx),
		readAccountabilityReadModelMigration(ctx),
		readPlanUsageMigration(ctx),
		readSubscriptionAuthorityMigration(ctx),
		readContactAuthorityMigration(ctx),
		readOldestContactFanoutJob(ctx, 'failed'),
		readOldestContactFanoutJob(ctx, 'pending'),
		readWorkflowExecutionCountMigration(ctx),
		readDonationConfirmationSummaryMigration(ctx),
		readSmsReplySummaryMigration(ctx)
	]);
	const discoverySourcePlaneReady =
		sourceMigration?.status === 'ready' &&
		sourceMigration.projectionVersion === PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION &&
		sourceMigration.completedAt !== undefined &&
		sourceMigration.rejected === 0 &&
		sourceMigration.sourcesWritten === sourceMigration.eligible &&
		publicRecipientMigrationIntegrityReady(sourceMigration);
	const discoveryEndorsementCountsReady =
		manifest?.endorsementCountMigrationStatus === 'complete' &&
		manifest.endorsementCountMigrationCompletedAt !== undefined &&
		manifest.endorsementCountMigrationFailureCode === undefined;
	const templateListProjectionStatus = templateListMigration?.status ?? 'not-started';
	const templateListProjectionReady =
		templateListProjectionStatus === 'ready' &&
		templateListMigration?.completedAt !== undefined &&
		templateListMigration.cursor === undefined &&
		templateListMigration.failureCode === undefined &&
		templateListMigration.scanned === templateListMigration.projected;
	const recipientMetricsStatus = recipientMetricsMigration?.status ?? 'not-started';
	const recipientMetricsReady =
		recipientMetricsStatus === 'ready' &&
		recipientMetricsMigration?.phase === 'complete' &&
		recipientMetricsMigration.completedAt !== undefined &&
		recipientMetricsMigration.scannedMessages === recipientMetricsMigration.projectedMessages &&
		recipientMetricsMigration.scannedPositions === recipientMetricsMigration.projectedPositions;
	const launchProjectionPlanes = {
		discoverySource: launchPlane(
			sourceMigration?.status,
			discoverySourcePlaneReady,
			sourceMigration?.failureCode
		),
		endorsementCounts: launchPlane(
			manifest?.endorsementCountMigrationStatus,
			discoveryEndorsementCountsReady,
			manifest?.endorsementCountMigrationFailureCode
		),
		templateList: launchPlane(
			templateListProjectionStatus,
			templateListProjectionReady,
			templateListMigration?.failureCode
		),
		recipientMetrics: launchPlane(
			recipientMetricsStatus,
			recipientMetricsReady,
			recipientMetricsMigration?.failureCode
		),
		sessionAuthority: launchPlane(
			sessionAuthorityMigration?.status,
			sessionAuthorityMigration?.status === 'ready' &&
				sessionAuthorityMigration.scanComplete === true &&
				sessionAuthorityMigration.cursor === undefined &&
				sessionAuthorityMigration.failureCode === undefined &&
				sessionAuthorityMigration.scanned === sessionAuthorityMigration.written,
			sessionAuthorityMigration?.failureCode
		),
		campaignReadModel: launchPlane(
			campaignReadModelMigration?.status,
			campaignReadModelMigration?.status === 'ready' &&
				campaignReadModelMigration.phase === 'deliveries' &&
				campaignReadModelMigration.cursor === undefined &&
				campaignReadModelMigration.failureCode === undefined,
			campaignReadModelMigration?.failureCode
		),
		campaignCounters: launchPlane(
			campaignCounterMigration?.status,
			campaignCounterMigration?.status === 'ready' &&
				campaignCounterMigration.cursor === undefined &&
				campaignCounterMigration.failureCode === undefined,
			campaignCounterMigration?.failureCode
		),
		debateReadModel: launchPlane(
			debateReadModelMigration?.status,
			debateReadModelMigration?.status === 'ready' &&
				debateReadModelMigration.cursor === undefined &&
				debateReadModelMigration.failureCode === undefined,
			debateReadModelMigration?.failureCode
		),
		organizationDirectory: launchPlane(
			publicOrganizationDirectoryMigration?.status,
			publicOrganizationDirectoryMigration?.status === 'ready' &&
				publicOrganizationDirectoryMigration.scanComplete === true &&
				publicOrganizationDirectoryMigration.cursor === undefined &&
				publicOrganizationDirectoryMigration.failureCode === undefined,
			publicOrganizationDirectoryMigration?.failureCode
		),
		coalitionMetrics: launchPlane(
			coalitionMetricsMigration?.status,
			coalitionMetricsMigration?.status === 'ready' &&
				coalitionMetricsMigration.phase === 'complete' &&
				coalitionMetricsMigration.cursor === undefined &&
				coalitionMetricsMigration.failureCode === undefined &&
				coalitionMetricsMigration.scannedSupporters ===
					coalitionMetricsMigration.projectedSupporters &&
				coalitionMetricsMigration.scannedActions === coalitionMetricsMigration.projectedActions &&
				coalitionMetricsMigration.scannedReceipts === coalitionMetricsMigration.projectedReceipts &&
				coalitionMetricsMigration.networksScheduled === coalitionMetricsMigration.networksReady,
			coalitionMetricsMigration?.failureCode
		),
		networkCharters: launchPlane(
			networkCharterMigration?.status,
			networkCharterMigration?.status === 'ready' &&
				networkCharterMigration.cursor === undefined &&
				networkCharterMigration.failureCode === undefined &&
				networkCharterMigration.scanned === networkCharterMigration.projected,
			networkCharterMigration?.failureCode
		),
		supporterBrowse: launchPlane(
			supporterBrowseMigration?.status,
			supporterBrowseMigration?.status === 'ready' &&
				supporterBrowseMigration.phase === 'complete' &&
				supporterBrowseMigration.cursor === undefined &&
				supporterBrowseMigration.failureCode === undefined &&
				supporterBrowseMigration.completedAt !== undefined &&
				supporterBrowseMigration.scanned === supporterBrowseMigration.projected,
			supporterBrowseMigration?.failureCode
		),
		supporterAudienceActions: launchPlane(
			supporterAudienceActionMigration?.status,
			supporterAudienceActionMigration?.status === 'ready' &&
				supporterAudienceActionMigration.cursor === undefined &&
				supporterAudienceActionMigration.failureCode === undefined &&
				supporterAudienceActionMigration.completedAt !== undefined &&
				supporterAudienceActionMigration.scanned === supporterAudienceActionMigration.projected,
			supporterAudienceActionMigration?.failureCode
		),
		accountabilityReadModel: launchPlane(
			accountabilityReadModelMigration?.status,
			isAccountabilityReadModelReady(accountabilityReadModelMigration),
			accountabilityReadModelMigration?.failureCode
		),
		planUsage: launchPlane(
			planUsageMigration?.status,
			isPlanUsageMigrationReady(planUsageMigration),
			planUsageMigration?.failureCode
		),
		subscriptionAuthority: launchPlane(
			subscriptionAuthorityMigration?.status,
			subscriptionAuthorityMigration?.status === 'ready' &&
				subscriptionAuthorityMigration.cursor === undefined &&
				subscriptionAuthorityMigration.completedAt !== undefined &&
				subscriptionAuthorityMigration.failureCode === undefined,
			subscriptionAuthorityMigration?.failureCode
		),
		contactAuthority: launchPlane(
			failedContactFanoutJob
				? 'failed'
				: pendingContactFanoutJob
					? 'draining'
					: contactAuthorityMigration?.status,
			contactAuthorityMigration?.status === 'ready' &&
				contactAuthorityMigration.cursor === undefined &&
				contactAuthorityMigration.completedAt !== undefined &&
				contactAuthorityMigration.failureCode === undefined &&
				failedContactFanoutJob === null &&
				pendingContactFanoutJob === null,
			contactAuthorityMigration?.failureCode ??
				failedContactFanoutJob?.failureCode ??
				(pendingContactFanoutJob ? 'CONTACT_FANOUT_PENDING' : undefined)
		),
		workflowExecutionCounts: launchPlane(
			workflowExecutionCountMigration?.status,
			workflowExecutionCountMigration?.status === 'ready' &&
				workflowExecutionCountMigration.phase === 'complete' &&
				workflowExecutionCountMigration.cursor === undefined &&
				workflowExecutionCountMigration.completedAt !== undefined &&
				workflowExecutionCountMigration.failureCode === undefined,
			workflowExecutionCountMigration?.failureCode
		),
		donationConfirmationSummaries: launchPlane(
			donationConfirmationSummaryMigration?.status,
			donationConfirmationSummaryMigration?.status === 'ready' &&
				donationConfirmationSummaryMigration.cursor === undefined &&
				donationConfirmationSummaryMigration.completedAt !== undefined &&
				donationConfirmationSummaryMigration.failureCode === undefined,
			donationConfirmationSummaryMigration?.failureCode
		),
		smsReplySummaries: launchPlane(
			smsReplySummaryMigration?.status,
			smsReplySummaryMigration?.status === 'ready' &&
				smsReplySummaryMigration.cursor === undefined &&
				smsReplySummaryMigration.completedAt !== undefined &&
				smsReplySummaryMigration.failureCode === undefined,
			smsReplySummaryMigration?.failureCode
		)
	};
	const launchProjectionsReady = Object.values(launchProjectionPlanes).every(
		(plane) => plane.ready
	);
	const overdueCandidates = manifest
		? [
				manifest.listDirtyAt === undefined
					? null
					: (manifest.listRefreshScheduledAt ?? manifest.listDirtyAt) +
						PUBLIC_DISCOVERY_REFRESH_OVERDUE_GRACE_MS,
				manifest.relationsDirtyAt === undefined
					? null
					: (manifest.relationsRefreshScheduledAt ?? manifest.relationsDirtyAt) +
						PUBLIC_DISCOVERY_REFRESH_OVERDUE_GRACE_MS
			].filter((value): value is number => value !== null)
		: [];
	return {
		ok: true as const,
		storageReadable: true as const,
		discoveryManifestPresent: manifest !== null,
		discoverySourcePlaneReady,
		discoveryEndorsementCountsReady,
		templateListProjectionStatus,
		templateListProjectionReady,
		recipientMetricsStatus,
		recipientMetricsReady,
		launchProjectionPlanes,
		launchProjectionsReady,
		discoveryProducerHealthy:
			manifest !== null &&
			discoverySourcePlaneReady &&
			discoveryEndorsementCountsReady &&
			templateListProjectionReady &&
			recipientMetricsReady &&
			manifest.listReady &&
			manifest.relationsReady &&
			manifest.listFailureCode === undefined &&
			manifest.relationsFailureCode === undefined &&
			!(manifest.listDirtyAt !== undefined && manifest.listRefreshScheduledAt === undefined) &&
			!(
				manifest.relationsDirtyAt !== undefined &&
				manifest.relationsRefreshScheduledAt === undefined
			),
		discoveryProducerOverdueAt:
			overdueCandidates.length === 0 ? null : Math.min(...overdueCandidates)
	};
}

/**
 * Public service-liveness probe.
 *
 * Reaching and executing this function proves both that the deployment is
 * enabled and that its data plane can serve an indexed read. The manifest is a
 * tiny control-plane singleton, so the uptime monitor never hydrates an
 * embedding-bearing application row. Publication state deliberately stays out
 * of this anonymous response; trusted server probes use
 * `discoveryProducerStatus` below.
 */
export const servicePing = internalQuery({
	args: {},
	handler: async (ctx) => {
		await readPublicDiscoveryManifest(ctx);
		return { ok: true as const, storageReadable: true as const };
	}
});

/**
 * Trusted publication-readiness probe for SvelteKit and release automation.
 * The shared-secret check runs before the indexed read so anonymous callers
 * cannot use this endpoint to observe failure state or refresh timing.
 */
export const discoveryProducerStatus = query({
	args: { _secret: v.string() },
	handler: async (ctx, { _secret }) => {
		requireInternalSecret(_secret);
		return readDiscoveryProducerStatus(ctx);
	}
});

/**
 * Secret-free operator view for `npx convex run`. Internal functions are
 * deployment-authorized by Convex and cannot be called by application clients,
 * so cutover polling does not need to serialize INTERNAL_API_SECRET.
 */
export const launchProjectionStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const status = await readDiscoveryProducerStatus(ctx);
		return {
			launchProjectionPlanes: status.launchProjectionPlanes,
			launchProjectionsReady: status.launchProjectionsReady
		};
	}
});

export const getBoundaryCellRate24h = internalQuery({
	args: {},
	handler: async (ctx) => {
		const asOf = Date.now();
		const cutoff = asOf - TWENTY_FOUR_HOURS_MS;

		// One explicit page makes hourly I/O independent of an attacker-sized
		// trailing-day range. At launch, <=250 credentials/day is measured
		// exactly. A larger range becomes a durable capacity alert; it is never
		// sampled and mislabeled as the exact population rate.
		const page = await ctx.db
			.query('districtCredentials')
			.withIndex('by_issuedAt', (q) => q.gte('issuedAt', cutoff).lte('issuedAt', asOf))
			.order('asc')
			.paginate({
				cursor: null,
				numItems: BOUNDARY_CELL_MONITOR_PAGE_ROWS,
				maximumRowsRead: BOUNDARY_CELL_MONITOR_PAGE_ROWS + 1,
				maximumBytesRead: BOUNDARY_CELL_MONITOR_PAGE_BYTES
			});
		const capacityExceeded = !page.isDone || page.pageStatus === 'SplitRequired';
		let postH1Count = 0;
		let boundaryCount = 0;
		let totalRecent = 0;
		for (const row of page.page.slice(0, BOUNDARY_CELL_MONITOR_PAGE_ROWS)) {
			totalRecent++;
			// H0r CRITICAL: only rows with cellStraddles defined contribute to
			// the denominator. Legacy rows (undefined) are "unknown," not "no
			// boundary issue." Including them as 0 would bias the rate down.
			if (row.cellStraddles === undefined) continue;
			postH1Count++;
			if (row.cellStraddles === true) boundaryCount++;
		}

		const rate = !capacityExceeded && postH1Count > 0 ? boundaryCount / postH1Count : null;
		return {
			rate,
			boundaryCount,
			postH1Count,
			totalRecent,
			periodMs: TWENTY_FOUR_HOURS_MS,
			capacityExceeded,
			scanned: Math.min(page.page.length, BOUNDARY_CELL_MONITOR_PAGE_ROWS),
			cutoff,
			asOf
		};
	}
});

/** Persist exact-or-saturated aggregate evidence in one compact singleton. */
export const recordBoundaryCellRateResult = internalMutation({
	args: {
		asOf: v.number(),
		cutoff: v.number(),
		scanned: v.number(),
		boundaryCount: v.number(),
		postH1Count: v.number(),
		totalRecent: v.number(),
		rate: v.optional(v.number()),
		capacityExceeded: v.boolean()
	},
	handler: async (ctx, args) => {
		for (const value of [
			args.asOf,
			args.cutoff,
			args.scanned,
			args.boundaryCount,
			args.postH1Count,
			args.totalRecent
		]) {
			if (!Number.isSafeInteger(value)) {
				throw new Error('BOUNDARY_CELL_MONITOR_RESULT_INVALID');
			}
		}
		const rateRequired = !args.capacityExceeded && args.postH1Count > 0;
		if (
			args.asOf - args.cutoff !== TWENTY_FOUR_HOURS_MS ||
			args.scanned < 0 ||
			args.scanned > BOUNDARY_CELL_MONITOR_PAGE_ROWS ||
			args.boundaryCount < 0 ||
			args.postH1Count < args.boundaryCount ||
			args.totalRecent < args.postH1Count ||
			args.totalRecent > args.scanned ||
			(args.rate !== undefined) !== rateRequired ||
			(!args.capacityExceeded && args.rate !== undefined && (args.rate < 0 || args.rate > 1)) ||
			(args.capacityExceeded && args.rate !== undefined)
		) {
			throw new Error('BOUNDARY_CELL_MONITOR_RESULT_INVALID');
		}
		const existing = await ctx.db
			.query('boundaryCellMonitorState')
			.withIndex('by_key', (q) => q.eq('key', 'rolling-24h-v1'))
			.unique();
		// A delayed action must never replace evidence from a newer hourly run.
		// Equal timestamps are idempotent retries and likewise need no write.
		if (existing && existing.asOf >= args.asOf) {
			return { status: 'stale_ignored' as const };
		}
		const row = {
			key: 'rolling-24h-v1' as const,
			status: args.capacityExceeded ? ('capacity_exceeded' as const) : ('complete' as const),
			cutoff: args.cutoff,
			asOf: args.asOf,
			scanned: args.scanned,
			boundaryCount: args.boundaryCount,
			postH1Count: args.postH1Count,
			totalRecent: args.totalRecent,
			rate: args.rate,
			updatedAt: Date.now()
		};
		if (existing) await ctx.db.replace(existing._id, row);
		else await ctx.db.insert('boundaryCellMonitorState', row);
		return { status: row.status };
	}
});

/**
 * Outer try/catch + direct-HTTP Sentry capture covers the case the
 * `/api/internal/alert` path can't: the cron handler itself throws
 * unexpectedly (DB timeout, malformed data, transient Convex outage).
 * Intentional alerts (threshold-cross, coverage-low) still go through
 * `/api/internal/alert` below — that path uses the SvelteKit Sentry SDK
 * for full breadcrumbs/release attribution. This wrapper is the safety
 * net for *unhandled* throws so they don't disappear into Convex
 * dashboard logs only.
 */
export const monitorBoundaryCellRate = internalAction({
	args: {},
	handler: async (ctx) => {
		try {
			const stats = await ctx.runQuery(getBoundaryCellRate24hRef, {});
			await ctx.runMutation(recordBoundaryCellRateResultRef, {
				asOf: stats.asOf,
				cutoff: stats.cutoff,
				scanned: stats.scanned,
				boundaryCount: stats.boundaryCount,
				postH1Count: stats.postH1Count,
				totalRecent: stats.totalRecent,
				...(stats.rate === null ? {} : { rate: stats.rate }),
				capacityExceeded: stats.capacityExceeded
			});
			return await runMonitorBoundaryCellRate(stats);
		} catch (err) {
			await captureToSentry(err, {
				action: 'monitorBoundaryCellRate',
				level: 'error'
			});
			throw err;
		}
	}
});

async function runMonitorBoundaryCellRate(stats: {
	rate: number | null;
	boundaryCount: number;
	postH1Count: number;
	totalRecent: number;
	periodMs: number;
	capacityExceeded: boolean;
	scanned: number;
	cutoff: number;
	asOf: number;
}): Promise<unknown> {
	if (stats.capacityExceeded) {
		await captureToSentry(new Error('BOUNDARY_CELL_MONITOR_CAPACITY_EXCEEDED'), {
			action: 'monitorBoundaryCellRate',
			level: 'error',
			extra: {
				asOf: stats.asOf,
				cutoff: stats.cutoff,
				scanned: stats.scanned,
				pageRows: BOUNDARY_CELL_MONITOR_PAGE_ROWS,
				pageBytes: BOUNDARY_CELL_MONITOR_PAGE_BYTES
			}
		});
		return { alerted: true, reason: 'capacity_exceeded', stats };
	}

	// Insufficient signal — log silently, do NOT alert (would just
	// generate noise during low-volume periods like fresh deploys).
	if (stats.postH1Count < MIN_DENOMINATOR_FOR_ALERT) {
		console.debug('[observability] boundary-cell rate skipped (insufficient denominator)', {
			postH1Count: stats.postH1Count,
			minRequired: MIN_DENOMINATOR_FOR_ALERT
		});
		return { alerted: false, reason: 'insufficient_denominator', stats };
	}

	// Coverage-bias check — see COVERAGE_FLOOR rationale. Fires when
	// post-H1 rows are < COVERAGE_FLOOR of total recent credentials,
	// signaling the rate is becoming biased toward re-issuers. Sentry
	// dedupes by code so persistent low-coverage doesn't spam.
	if (stats.totalRecent > 0 && stats.postH1Count / stats.totalRecent < COVERAGE_FLOOR) {
		const baseUrlCov = process.env.CONVEX_SITE_URL ?? '';
		const internalSecretCov = process.env.INTERNAL_API_SECRET ?? '';
		if (baseUrlCov && internalSecretCov) {
			try {
				await fetch(`${baseUrlCov}/api/internal/alert`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-internal-secret': internalSecretCov
					},
					body: JSON.stringify({
						code: 'BOUNDARY_CELL_COVERAGE_LOW',
						message: `Only ${stats.postH1Count}/${stats.totalRecent} (${((stats.postH1Count / stats.totalRecent) * 100).toFixed(1)}%) of recent credentials carry cellStraddles — boundary-rate denominator is biased toward re-issuers`,
						severity: 'warning',
						context: {
							postH1Count: stats.postH1Count,
							totalRecent: stats.totalRecent,
							coverageFraction: stats.postH1Count / stats.totalRecent,
							floor: COVERAGE_FLOOR,
							periodMs: stats.periodMs
						}
					}),
					signal: AbortSignal.timeout(10_000)
				});
			} catch (err) {
				console.error(
					'[observability] coverage-low alert failed:',
					err instanceof Error ? err.message : String(err)
				);
			}
		}
		// NOTE: continue past the coverage alert — rate alert below still
		// fires on its own threshold so a high biased rate is at least
		// surfaced even when the bias warning is also active.
	}

	// rate is non-null when postH1Count > 0; we just guarded that.
	const rate = stats.rate as number;
	if (rate <= BOUNDARY_RATE_ALERT_THRESHOLD) {
		console.debug('[observability] boundary-cell rate healthy', {
			rate,
			threshold: BOUNDARY_RATE_ALERT_THRESHOLD,
			postH1Count: stats.postH1Count
		});
		return { alerted: false, reason: 'rate_healthy', stats };
	}

	// Threshold exceeded — emit Sentry alert via the existing
	// /api/internal/alert endpoint. Pattern mirrors revocations.ts
	// reconcileSMTRoot.
	const baseUrl = process.env.CONVEX_SITE_URL ?? '';
	const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
	if (!baseUrl || !internalSecret) {
		console.warn(
			'[observability] CONVEX_SITE_URL or INTERNAL_API_SECRET not set; cannot emit alert',
			{ rate, threshold: BOUNDARY_RATE_ALERT_THRESHOLD }
		);
		return {
			alerted: false,
			reason: 'missing_alert_env',
			stats
		};
	}

	// Alert payload — aggregate counts only. NO user IDs, hashes, addresses.
	try {
		const res = await fetch(`${baseUrl}/api/internal/alert`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-internal-secret': internalSecret
			},
			body: JSON.stringify({
				code: 'BOUNDARY_CELL_RATE_HIGH',
				message: `boundary-cell rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(BOUNDARY_RATE_ALERT_THRESHOLD * 100).toFixed(0)}% over the trailing 24 h`,
				severity: 'error',
				context: {
					rate,
					boundaryCount: stats.boundaryCount,
					postH1Count: stats.postH1Count,
					totalRecent: stats.totalRecent,
					threshold: BOUNDARY_RATE_ALERT_THRESHOLD,
					periodMs: stats.periodMs
				}
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) {
			console.error(`[observability] alert emission failed: HTTP ${res.status}`);
			return { alerted: false, reason: 'alert_http_error', stats };
		}
	} catch (err) {
		console.error(
			'[observability] alert fetch failed:',
			err instanceof Error ? err.message : String(err)
		);
		return { alerted: false, reason: 'alert_fetch_failed', stats };
	}

	return { alerted: true, stats };
}

/**
 * Daily heartbeat to the alert pipe. Fires a known-OK Sentry event at a
 * predictable cadence so operators can detect "the alert pipe itself is
 * down" — when this stops arriving in Sentry for >24h+slack, an external
 * monitor (Sentry's expected-interval feature, an UptimeRobot probe on
 * the Sentry project, etc.) pages on-call independent of `/api/internal/
 * alert`. Without this, the only liveness signal for the alerting path
 * is the alerts themselves; a broken pipe stays silent until a real
 * incident also fails to alert.
 *
 * Severity 'info' so it doesn't pollute the alert-counts dashboard but
 * still creates a Sentry event with a fingerprintable code. Best-effort
 * — alert-env missing falls back to a console line that operators
 * monitoring the Convex log stream can still see.
 */
export const heartbeatAlertPipe = internalAction({
	args: {},
	handler: async (): Promise<{ ok: boolean; reason?: string }> => {
		const baseUrl = process.env.CONVEX_SITE_URL ?? '';
		const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
		if (!baseUrl || !internalSecret) {
			console.warn(
				'[observability] heartbeat: alert env missing; logged here but not emitted to Sentry'
			);
			return { ok: false, reason: 'missing_alert_env' };
		}
		try {
			const res = await fetch(`${baseUrl}/api/internal/alert`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-internal-secret': internalSecret
				},
				body: JSON.stringify({
					code: 'HEARTBEAT_DAILY',
					message:
						'Daily alert-pipe heartbeat — if you see this, /api/internal/alert is reachable from Convex',
					severity: 'warning',
					context: { emittedAt: Date.now() }
				}),
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) {
				console.error(`[observability] heartbeat: HTTP ${res.status}`);
				return { ok: false, reason: 'http_error' };
			}
			return { ok: true };
		} catch (err) {
			console.error(
				'[observability] heartbeat: fetch failed:',
				err instanceof Error ? err.message : String(err)
			);
			return { ok: false, reason: 'fetch_failed' };
		}
	}
});
