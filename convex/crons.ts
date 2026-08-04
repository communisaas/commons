/**
 * Convex Cron Jobs
 *
 * Replaces the 10 SvelteKit cron endpoints at src/routes/api/cron/*.
 * Each cron calls an internalAction or internalMutation.
 *
 * Original schedules (from GitHub Actions / wrangler):
 * 1. legislation-sync       — every 6h
 * 2. process-bounces        — every 5 min
 * 3. vote-tracker           — every 2h
 * 4. alert-digest           — weekly (Monday 14:00 UTC)
 * 5. cleanup-witness        — daily 01:00 UTC
 * 6. debate-resolution      — daily 02:00 UTC
 * 7. analytics-snapshot     — daily 00:05 UTC
 * 8. ab-winner              — every 15 min
 * 9. scorecard-compute      — weekly (Sunday 03:00 UTC)
 * 10. workflow-scheduler     — every 15 min (orphan-recovery safety net)
 *
 * --------------------------------------------------------------------------
 * CRON_PROFILE tiering (overage control)
 * --------------------------------------------------------------------------
 * The Convex scheduler registers EXACTLY the crons that this module produces
 * when it is evaluated during `convex deploy` / `convex dev` push. Skipping a
 * `crons.X(...)` call here means that cron is never added to the deployment —
 * it incurs ZERO function-call ticks against the (shared, free-plan) quota.
 *
 * `process.env.CRON_PROFILE` selects which TIERS register on this deployment:
 *
 *   full        → essential + operational + speculative  (= legacy)
 *   operational → essential + operational
 *   essential   → essential only (requires isolated/paid quota authority)
 *   contained   → no cron registrations (shared-Free launch containment)
 *
 * Tiers:
 *   ESSENTIAL   — correctness / safety / privacy hygiene for a traffic-bearing,
 *                 quota-authorized deployment (PII expiry, crashed-worker
 *                 recovery, revocation reconcile, key/TTL hygiene).
 *   OPERATIONAL — only meaningful with live traffic (bounce probes, retries,
 *                 A/B winners, analytics, digests, reputation/embedding refits).
 *   SPECULATIVE — no consumer yet / post-launch (legislation ingest, vote
 *                 tracking, scorecards). Primary pre-launch overage source.
 *
 * The two former 1-min pollers (workflow-scheduler, process-scheduled-blasts)
 * are now event-driven (native scheduler.runAfter/runAt at their write-sites)
 * plus a wide 15-min orphan-recovery sweep tiered ESSENTIAL. Coordinated public
 * discovery rebuilds additionally arm one token/attempt-scoped lease watchdog
 * at acquisition, so contained clear/reseed work has causal recovery with zero
 * idle ticks. The periodic backstops remain absent until the essential
 * profile's quota authority is activated.
 *
 * IMPORTANT — DEPLOY-TIME FROZEN: CRON_PROFILE is read once, at push/deploy
 * time. Changing the env var has NO effect until the next `convex deploy` /
 * `convex dev` re-registers the cron set. This matches documented Convex
 * behavior — environment variables used in cron definitions are only
 * reevaluated on deployment (Convex docs, "Environment Variables") — and is
 * exactly the semantics we want: each deployment freezes its tier at push.
 *
 * HARD CONTAINMENT FLOOR: unset (or unrecognized) CRON_PROFILE → 'contained'.
 * The shared Free-team quota has sibling-project TOCTOU risk that a release-
 * time headroom observation cannot govern. `contained` therefore registers no
 * cron at all: exactly zero recurring database-I/O allowance. Event-driven
 * `scheduler.runAfter` / `runAt` continuations remain available at write sites.
 * Opting up to `essential` requires quota isolation or a paid authority without
 * the shared hard-disable failure mode; a short-lived Free-team observation is
 * intentionally insufficient. The resolved profile is logged during deploy.
 *
 * Required shared-Free posture: preview (outstanding-firefly-831) and prod
 * (quirky-chinchilla-352) → 'contained'. Do not flip either deployment to
 * `essential` until its quota authority gate passes. See
 * docs/development/cron-setup.md.
 */

import { cronJobs, makeFunctionReference, type FunctionReference } from 'convex/server';
import { internal } from './_generated/api';
import { ANALYTICS_CONTRIBUTION_AUTHORITY_READY } from './lib/analyticsPrivacyGate';

declare const process: { env: Record<string, string | undefined> };

type CronTier = 'essential' | 'operational' | 'speculative';

const RAW_CRON_PROFILE = process.env.CRON_PROFILE;
// Unset → 'contained' (zero registered crons). Opt UP only with quota authority.
const CRON_PROFILE = (RAW_CRON_PROFILE ?? 'contained').toLowerCase();

// Profile → enabled tier set.
const PROFILE_TIERS: Record<string, ReadonlySet<CronTier>> = {
	full: new Set<CronTier>(['essential', 'operational', 'speculative']),
	operational: new Set<CronTier>(['essential', 'operational']),
	essential: new Set<CronTier>(['essential']),
	contained: new Set<CronTier>()
};

// Unknown / typo'd profile → 'contained', never a database-touching fleet.
// Own-property check (NOT the `in` operator): `in` matches inherited keys
// (`constructor`, `__proto__`, `toString`, …), which would resolve to a
// non-Set value and throw at module init — breaking the deploy. hasOwnProperty
// accepts only the four explicit profile keys; anything else floors to
// 'contained'.
const RESOLVED_PROFILE = Object.prototype.hasOwnProperty.call(PROFILE_TIERS, CRON_PROFILE)
	? CRON_PROFILE
	: 'contained';
const activeTiers = PROFILE_TIERS[RESOLVED_PROFILE];
const enabled = (tier: CronTier): boolean => activeTiers.has(tier);

// The bounded coordinator is deployed dark until durable contribution
// authority exists and its exact identity migration is activated. Enabling an
// operational/full profile alone must never publish an invalid epsilon claim.
const ANALYTICS_SNAPSHOT_CRON_READY = false;

// Surface the effective profile in the deploy/push logs so a typo'd profile
// (which floors to 'contained') is visible rather than silently differing from
// what the operator typed.
if (RAW_CRON_PROFILE !== undefined && RESOLVED_PROFILE !== CRON_PROFILE) {
	console.warn(
		`[crons] Unrecognized CRON_PROFILE="${RAW_CRON_PROFILE}" — flooring to 'contained' (zero registered crons).`
	);
} else {
	console.log(`[crons] CRON_PROFILE resolved to '${RESOLVED_PROFILE}'.`);
}

const crons = cronJobs();
const sweepStalePlanUsageRef = makeFunctionReference<'mutation'>(
	'planUsage:sweepStale'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;
const sweepStalePlanUsageReservationsRef = makeFunctionReference<'mutation'>(
	'planUsage:sweepStaleReservations'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;
const sweepPastDueGraceRef = makeFunctionReference<'mutation'>(
	'subscriptions:sweepPastDueGrace'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;
const drainContactFanoutQueueRef = makeFunctionReference<'action'>(
	'webhooks:drainContactFanoutQueue'
) as unknown as FunctionReference<'action', 'internal', Record<string, never>, unknown>;
const runContactAuthorityMigrationPageRef = makeFunctionReference<'mutation'>(
	'webhooks:runContactAuthorityMigrationPage'
) as unknown as FunctionReference<'mutation', 'internal', Record<string, never>, unknown>;

// ---------------------------------------------------------------------------
// 0. Expired distributed rate-limit buckets — one row per actor/window and a
//    bounded self-paging global cleanup. ESSENTIAL because paid public-action
//    abuse controls must not accumulate unbounded storage on a quiet product.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'cleanup-rate-limit-buckets',
		{ hourUTC: 2, minuteUTC: 47 },
		internal._rateLimit.cleanupExpired,
		{}
	);

	// Belt-and-suspenders scan for legacy/unarmed locks after quota activation.
	// New clear/reseed acquisitions already own a zero-idle event-driven watchdog.
	// Neither path auto-unlocks or publishes a partial corpus.
	crons.interval(
		'supervise-public-discovery-rebuild-lease',
		{ minutes: 15 },
		internal.observability.superviseCoordinatedPublicDiscoveryRebuildLease,
		{}
	);
	crons.hourly('subscription-past-due-grace-sweep', { minuteUTC: 49 }, sweepPastDueGraceRef, {});
}

// Projection-only billing must recover missed Stripe period events and the UTC
// month rollover without a request-path history scan. Each invocation reads ten
// organizations and self-pages; per-org repair workers independently coalesce.
if (enabled('essential')) {
	crons.hourly('plan-usage-stale-sweep', { minuteUTC: 43 }, sweepStalePlanUsageRef, {});
	crons.interval(
		'plan-usage-reservation-lease-sweep',
		{ minutes: 15 },
		sweepStalePlanUsageReservationsRef,
		{}
	);
}

// Provider ingress schedules the first contact fanout page transactionally and
// each page schedules its successor. This 15-minute cadence is only the bounded
// orphan-recovery net: STOP/email authority takes effect synchronously even if
// the denormalized supporter projection is temporarily behind. The wide
// backstop avoids 1,440 empty action/query pairs per backend and day; the
// sibling audit resumes a migration whose native continuation was lost.
if (enabled('essential')) {
	crons.interval('drain-contact-authority-fanout', { minutes: 15 }, drainContactFanoutQueueRef, {});
	crons.interval(
		'resume-contact-authority-migration',
		{ minutes: 15 },
		runContactAuthorityMigrationPageRef,
		{}
	);
}

// ---------------------------------------------------------------------------
// 1. Legislation Sync — fetch Congress.gov → embed → score → alert → sync
//    Original: every 6 hours
//    SPECULATIVE: bulk ingest with no consumer yet (primary overage source).
// ---------------------------------------------------------------------------
if (enabled('speculative')) {
	crons.interval('legislation-sync', { hours: 6 }, internal.legislation.syncPipeline, {
		source: 'federal',
		limit: 50
	});
}

// ---------------------------------------------------------------------------
// 2. Process Bounce Reports — SMTP probes via Reacher + auto-resolve stale
//    Original: every 5 minutes
//    OPERATIONAL: SMTP probes are meaningless without outbound mail.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.interval('process-bounces', { minutes: 5 }, internal.email.processBounceReports);
}

// ---------------------------------------------------------------------------
// 3. Vote Tracker — fetch roll call votes → correlate → generate receipts
//    Original: every 2 hours
//    SPECULATIVE: no consumer pre-launch.
// ---------------------------------------------------------------------------
if (enabled('speculative')) {
	crons.interval('vote-tracker', { hours: 2 }, internal.legislation.trackVotes);
}

// ---------------------------------------------------------------------------
// 4. Alert Digest — weekly email digest of pending legislative alerts
//    Original: Monday 14:00 UTC
//    OPERATIONAL: needs recipients / pending alerts.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.weekly(
		'alert-digest',
		{ dayOfWeek: 'monday', hourUTC: 14, minuteUTC: 0 },
		internal.email.sendAlertDigests
	);
}

// ---------------------------------------------------------------------------
// 5. Cleanup Expired Witnesses — NULL out PII from expired submissions
//    01:11 UTC (off :00 to avoid colliding with workflow-scheduler /
//    process-scheduled-blasts / process-bounces / sweep-stuck-processing
//    minute-cadence crons that align on :00).
//    ESSENTIAL: PII expiry is a privacy obligation independent of traffic.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'cleanup-witness',
		{ hourUTC: 1, minuteUTC: 11 },
		internal.submissions.cleanupExpiredWitnesses
	);
}

// ---------------------------------------------------------------------------
// 6. Debate Auto-Resolution — evaluate expired debates via AI
//    Original: daily 02:00 UTC
//    OPERATIONAL: no debates to resolve pre-traffic; dispatches over HTTP.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.daily(
		'debate-resolution',
		{ hourUTC: 2, minuteUTC: 0 },
		internal.debates.resolveExpiredDebates,
		{}
	);
}

// ---------------------------------------------------------------------------
// 7. Analytics Snapshot — bounded per-date coordinator + stale-run supervisor.
//    OPERATIONAL and additionally launch-tombstoned until durable contribution
//    authority exists and analytics:activateSnapshotPlane reports ready. Flip
//    the code tombstone only in a later reviewed release; the coordinator also
//    checks both durable and code-level readiness before it creates a run.
// ---------------------------------------------------------------------------
if (
	enabled('operational') &&
	ANALYTICS_CONTRIBUTION_AUTHORITY_READY &&
	ANALYTICS_SNAPSHOT_CRON_READY
) {
	crons.daily(
		'analytics-snapshot',
		{ hourUTC: 0, minuteUTC: 5 },
		internal.analytics.materializeSnapshot,
		{}
	);
	crons.interval(
		'analytics-snapshot-supervisor',
		{ minutes: 15 },
		internal.analytics.superviseSnapshotRuns,
		{}
	);
}

// ---------------------------------------------------------------------------
// 7b. Intelligence Cleanup — expire old intelligence items
//     Was previously in the analytics-snapshot slot; now its own entry.
//     ESSENTIAL: bounded-growth / retention hygiene.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'intelligence-cleanup',
		{ hourUTC: 0, minuteUTC: 15 },
		internal.intelligence.markExpired
	);
}

// ---------------------------------------------------------------------------
// 8. A/B Test Winner — check pending A/B tests and pick winners
//    Original: every 15 minutes
//    OPERATIONAL: no A/B tests without campaigns.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.interval('ab-winner', { minutes: 15 }, internal.email.pickAbWinners);
}

// ---------------------------------------------------------------------------
// 9. Scorecard Compute — weekly scorecard snapshots for decision-makers
//    Original: Sunday 03:00 UTC
//    SPECULATIVE: no consumer pre-launch.
// ---------------------------------------------------------------------------
if (enabled('speculative')) {
	crons.weekly(
		'scorecard-compute',
		{ dayOfWeek: 'sunday', hourUTC: 3, minuteUTC: 0 },
		internal.legislation.computeScorecards
	);
}

// ---------------------------------------------------------------------------
// 10. Workflow Scheduler (orphan-recovery safety net) — resume paused workflows
//     whose delay elapsed but whose native resume job was lost.
//     PRIMARY resume is event-driven: the delay-step branch of workflows.execute
//     fires ctx.scheduler.runAfter(delayMs, execute) so each paused execution
//     resumes exactly when due. This cron is now a WIDE 15-min sweep that only
//     recovers scheduler-restart orphans (same pattern as #16
//     reschedule-stuck-revocations). ESSENTIAL: cheap (96 ticks/day) and
//     correctness-protecting once an authorized essential-or-higher profile is
//     deployed. It is intentionally absent from contained pre-launch backends.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.interval('workflow-scheduler', { minutes: 15 }, internal.workflows.processScheduled);
}

// ---------------------------------------------------------------------------
// 11. Contact Cache Cleanup — expire stale resolved contacts (14-day TTL)
//     Runs daily at 01:30 UTC.
//     ESSENTIAL: cheap retention hygiene.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'contact-cache-cleanup',
		{ hourUTC: 1, minuteUTC: 30 },
		internal.resolvedContacts.cleanupExpired,
		{}
	);
}

// ---------------------------------------------------------------------------
// 12. Process Scheduled Blasts (orphan-recovery safety net) — dispatch
//     TEE-sealed blasts whose scheduled time came but whose native dispatch job
//     was lost. PRIMARY dispatch is event-driven: the future-scheduled branch of
//     blasts.sealAndScheduleBlast fires ctx.scheduler.runAt(scheduledAt,
//     dispatchScheduledBlast). claimForBlastDispatch (CAS scheduled→sending)
//     makes the native path and this sweep mutually idempotent — no double-send.
//     This cron is now a WIDE 15-min orphan-recovery sweep. ESSENTIAL: cheap and
//     correctness-protecting once an authorized essential-or-higher profile is
//     deployed; intentionally absent from contained pre-launch backends.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.interval(
		'process-scheduled-blasts',
		{ minutes: 15 },
		internal.blasts.processScheduledBlasts
	);
}

// ---------------------------------------------------------------------------
// 13. Cleanup Stale Sealed Keys — clear sealedOrgKey on stuck blasts (24h TTL)
//     Hourly at :07 to stagger off the :00 storm with daily 01:00 crons +
//     other hourly crons (interval-anchored crons can converge on :00 if
//     deployed at the same minute).
//     ESSENTIAL: sealedOrgKey TTL — key hygiene / safety.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly(
		'cleanup-sealed-keys',
		{ minuteUTC: 7 },
		internal.blastCleanup.cleanupStaleSealedKeys,
		{}
	);
}

// ---------------------------------------------------------------------------
// 14. Sweep Stuck Processing Submissions — recover from crashed delivery workers
//     A worker that claimed a submission (deliveryStatus='processing') but died
//     mid-flight leaves the submission unrecoverable — claimForDelivery refuses
//     to re-claim a processing row. Every 5 minutes, revert rows that have been
//     stuck in 'processing' for >15 minutes back to 'failed' so the next claim
//     can retry. The threshold is implemented as STUCK_THRESHOLD_MS in
//     `submissions.ts:sweepStuckProcessing` (15 min, not 5 — exceeds the
//     /anchor-proof default 10-min execution budget so a slow-but-live worker
//     isn't racially classified as stuck).
//     ESSENTIAL: crashed-worker recovery (genuinely periodic; KEEP 5m).
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.interval(
		'sweep-stuck-processing',
		{ minutes: 5 },
		internal.submissions.sweepStuckProcessing
	);
}

// ---------------------------------------------------------------------------
// 15. Retry Failed Anchors — re-schedule on-chain anchors that hit transient RPC
//     failures. Does NOT re-try 'divergent' (P0 forensic state) or 'anchored'.
//     Every 5 minutes, pick submissions with anchorStatus='failed' and retry.
//     OPERATIONAL: no failed anchors without submissions.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.interval('retry-failed-anchors', { minutes: 5 }, internal.submissions.retryFailedAnchors);
}

// ---------------------------------------------------------------------------
// 16. Reschedule Stuck Revocations — F1 closure (Stage 5).
//     Credentials with revocationStatus='pending' whose last emit attempt is
//     older than 1 hour are re-queued. Catches Convex-scheduler restart
//     orphans. Respects MAX_REVOCATION_ATTEMPTS; terminal failures flip to
//     'failed' and alert operator via the standard /api/internal/alert path.
//     ESSENTIAL: revocation-orphan recovery (F1 safety).
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.interval(
		'reschedule-stuck-revocations',
		{ minutes: 15 },
		internal.users.rescheduleStuckRevocations
	);
}

// ---------------------------------------------------------------------------
// 17. Reconcile Revocation SMT Root — (KG-2 closure).
//     Compares Convex's smtRoots.root against the on-chain RevocationRegistry
//     currentRoot. Drift indicates either (a) on-chain emit failed silently
//     after Convex committed, (b) operator wrote a divergent root through a
//     different path, or (c) the precomputed EMPTY_TREE_ROOT in the contract
//     constructor disagrees with our computed value. Every 1 hour.
//     ESSENTIAL: on-chain/Convex root drift detection (security).
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly(
		'reconcile-revocation-smt-root',
		{ minuteUTC: 13 },
		internal.revocations.reconcileSMTRoot
	);
}

// ---------------------------------------------------------------------------
// 18. Cleanup Message Generation Jobs — removes encrypted recovery envelopes
//     after their short retention window.
//     ESSENTIAL: encrypted-envelope retention expiry.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly(
		'cleanup-message-generation-jobs',
		{ minuteUTC: 21 },
		internal.messageJobs.cleanupExpired
	);
}

// ---------------------------------------------------------------------------
// 19. Boundary-cell observability (I2 — 2026-05-04). Computes the rolling
//     24 h boundary_cell_send_rate over post-H1 districtCredentials and
//     emits a Sentry alert when the rate exceeds the threshold. H1 stored
//     the cellStraddles field; I2 is what makes the field actionable.
//     ESSENTIAL: privacy boundary-cell rate alarm (KEEP hourly — i2 test
//     pins cadence).
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly(
		'monitor-boundary-cell-rate',
		{ minuteUTC: 47 },
		internal.observability.monitorBoundaryCellRate
	);
}

// ---------------------------------------------------------------------------
// 20. Alert-pipe heartbeat — fires a known-OK Sentry event daily so an
//     external monitor (Sentry's expected-interval, UptimeRobot, etc.) can
//     detect "the alert pipe itself is down" independent of /api/internal/
//     alert. Without this, a broken pipe stays silent until a real incident
//     also fails to alert. 12:23 UTC chosen for stagger.
//     ESSENTIAL: meta-monitor that detects a dead alert pipe.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'alert-pipe-heartbeat',
		{ hourUTC: 12, minuteUTC: 23 },
		internal.observability.heartbeatAlertPipe
	);
}

// ---------------------------------------------------------------------------
// 21. One-shot legacy placeholder supporter sweep. Current submission and
//     import writers encrypt before the first insert; this job exists only to
//     drain pre-cutover/operator-bootstrap rows after explicit versioned
//     activation. It advances one CAS-fenced page per tick, then a durable
//     completion tombstone makes every later invocation an O(1) no-op.
//     Scheduled at :17/:47 only when an authorized cron profile is deployed.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.cron(
		'sweep-stranded-placeholders',
		'17,47 * * * *',
		internal.supporters.sweepStrandedPlaceholders
	);
}

// ---------------------------------------------------------------------------
// 22. One-shot legacy donation placeholder sweep. Current checkout writers
//     encrypt before the first insert; explicit versioned activation drains
//     only pre-cutover/operator-bootstrap rows. Completed/refunded audit rows
//     are preserved. The CAS-fenced sweep advances one page per active tick,
//     then its durable completion tombstone makes later invocations O(1).
//     Scheduled at :23/:53 only when an authorized cron profile is deployed.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.cron(
		'sweep-stranded-donations',
		'23,53 * * * *',
		internal.donations.sweepStrandedDonations
	);
}

// ---------------------------------------------------------------------------
// 23. Agent-trace expiry — delete rows past expiresAt (TTL from SK writer,
//     default 7 days). 1000-row batches per tick (= 24k/day capacity, ~2.4x
//     headroom over a 10k events/day baseline); runs hourly at :37 to
//     stagger off the other hourly crons (:07, :13, :21, :47).
//     ESSENTIAL: TTL purge — bounded growth / retention.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly('agent-traces-expire', { minuteUTC: 37 }, internal.agentTraces.expire);
}

// ---------------------------------------------------------------------------
// 24. Webhook retry — pick up orgWebhookDeliveries with nextRetryAt due and
//     re-fire deliverWebhook. Every minute keeps the latency floor low while
//     each tick is bounded to RETRY_BATCH=50 (caps action time).
//     OPERATIONAL: no webhook deliveries without orgs.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.interval('webhook-retry', { minutes: 1 }, internal.orgWebhooks.retryPendingDeliveries);
}

// ---------------------------------------------------------------------------
// 25. orgEvents retention — daily TTL purge for the SSE event table. Rows
//     older than 7 days are dead weight; SSE consumers only read recent. Runs
//     at :47 to stagger off the other hourly crons (:07, :13, :21, :37, :47).
//     ESSENTIAL: SSE-table TTL purge — bounded growth.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.hourly('org-events-expire', { minuteUTC: 47 }, internal.orgWebhooks.expireOldEvents, {});
	crons.hourly(
		'org-webhook-deliveries-expire',
		{ minuteUTC: 53 },
		internal.orgWebhooks.expireOldDeliveryHistory,
		{}
	);
}

// ---------------------------------------------------------------------------
// 28a. Public homepage snapshots — refresh list and relation variants from one
//     bounded source plan and publish them atomically. Consolidating the former
//     list and relation jobs avoids paying twice for corpus selection and makes
//     their daily generations inseparable. 04:17 UTC avoids UTC-hour boundaries.
//     ESSENTIAL: durable freshness backstop for projection-affecting writes and
//     any missed write-driven token; request paths still read compact rows only.
// ---------------------------------------------------------------------------
if (enabled('essential')) {
	crons.daily(
		'public-homepage-snapshot-rebuild',
		{ hourUTC: 4, minuteUTC: 17 },
		internal.templates.rebuildHomepageSnapshotsForCron,
		{}
	);
}

// ---------------------------------------------------------------------------
// 29. Drain usage to billing provider — reports unreported usageRecords rows to
//     the configured provider (Noop default → truthful no-op) and stamps each
//     row reportedToProvider + providerEventId. Bounded per tick; the cadence
//     drains the backlog. The ledger owns truth — this is the only provider
//     touchpoint and is decoupled from the metered request path.
//     OPERATIONAL: nothing to report without metered API traffic.
// ---------------------------------------------------------------------------
if (enabled('operational')) {
	crons.interval('drain-usage', { minutes: 15 }, internal.metering.drainUsageToProvider, {
		_secret: process.env.INTERNAL_API_SECRET ?? ''
	});
}

export default crons;
