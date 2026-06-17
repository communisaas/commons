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
 * 10. workflow-scheduler     — every 1 min
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ---------------------------------------------------------------------------
// 1. Legislation Sync — fetch Congress.gov → embed → score → alert → sync
//    Original: every 6 hours
// ---------------------------------------------------------------------------
crons.interval(
  "legislation-sync",
  { hours: 6 },
  internal.legislation.syncPipeline,
  { source: "federal", limit: 50 },
);

// ---------------------------------------------------------------------------
// 2. Process Bounce Reports — SMTP probes via Reacher + auto-resolve stale
//    Original: every 5 minutes
// ---------------------------------------------------------------------------
crons.interval(
  "process-bounces",
  { minutes: 5 },
  internal.email.processBounceReports,
);

// ---------------------------------------------------------------------------
// 3. Vote Tracker — fetch roll call votes → correlate → generate receipts
//    Original: every 2 hours
// ---------------------------------------------------------------------------
crons.interval(
  "vote-tracker",
  { hours: 2 },
  internal.legislation.trackVotes,
);

// ---------------------------------------------------------------------------
// 4. Alert Digest — weekly email digest of pending legislative alerts
//    Original: Monday 14:00 UTC
// ---------------------------------------------------------------------------
crons.weekly(
  "alert-digest",
  { dayOfWeek: "monday", hourUTC: 14, minuteUTC: 0 },
  internal.email.sendAlertDigests,
);

// ---------------------------------------------------------------------------
// 5. Cleanup Expired Witnesses — NULL out PII from expired submissions
//    01:11 UTC (off :00 to avoid colliding with workflow-scheduler /
//    process-scheduled-blasts / process-bounces / sweep-stuck-processing
//    minute-cadence crons that align on :00).
// ---------------------------------------------------------------------------
crons.daily(
  "cleanup-witness",
  { hourUTC: 1, minuteUTC: 11 },
  internal.submissions.cleanupExpiredWitnesses,
);

// ---------------------------------------------------------------------------
// 6. Debate Auto-Resolution — evaluate expired debates via AI
//    Original: daily 02:00 UTC
// ---------------------------------------------------------------------------
crons.daily(
  "debate-resolution",
  { hourUTC: 2, minuteUTC: 0 },
  internal.debates.resolveExpiredDebates,
);

// ---------------------------------------------------------------------------
// 7. Analytics Snapshot — materialize noisy snapshots + rate limit cleanup
//    Original: daily 00:05 UTC
// ---------------------------------------------------------------------------
crons.daily(
  "analytics-snapshot",
  { hourUTC: 0, minuteUTC: 5 },
  internal.analytics.materializeSnapshot,
);

// ---------------------------------------------------------------------------
// 7b. Intelligence Cleanup — expire old intelligence items
//     Was previously in the analytics-snapshot slot; now its own entry.
// ---------------------------------------------------------------------------
crons.daily(
  "intelligence-cleanup",
  { hourUTC: 0, minuteUTC: 15 },
  internal.intelligence.markExpired,
);

// ---------------------------------------------------------------------------
// 8. A/B Test Winner — check pending A/B tests and pick winners
//    Original: every 15 minutes
// ---------------------------------------------------------------------------
crons.interval(
  "ab-winner",
  { minutes: 15 },
  internal.email.pickAbWinners,
);

// ---------------------------------------------------------------------------
// 9. Scorecard Compute — weekly scorecard snapshots for decision-makers
//    Original: Sunday 03:00 UTC
// ---------------------------------------------------------------------------
crons.weekly(
  "scorecard-compute",
  { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 0 },
  internal.legislation.computeScorecards,
);

// ---------------------------------------------------------------------------
// 10. Workflow Scheduler — resume paused workflows whose delay has elapsed
//     Original: every 1 minute
// ---------------------------------------------------------------------------
crons.interval(
  "workflow-scheduler",
  { minutes: 1 },
  internal.workflows.processScheduled,
);

// ---------------------------------------------------------------------------
// 11. Contact Cache Cleanup — expire stale resolved contacts (14-day TTL)
//     Runs daily at 01:30 UTC.
// ---------------------------------------------------------------------------
crons.daily(
  "contact-cache-cleanup",
  { hourUTC: 1, minuteUTC: 30 },
  internal.resolvedContacts.cleanupExpired,
);

// ---------------------------------------------------------------------------
// 12. Process Scheduled Blasts — trigger TEE-sealed blasts whose time has come
//     Runs every 1 minute.
// ---------------------------------------------------------------------------
crons.interval(
  "process-scheduled-blasts",
  { minutes: 1 },
  internal.blasts.processScheduledBlasts,
);

// ---------------------------------------------------------------------------
// 13. Cleanup Stale Sealed Keys — clear sealedOrgKey on stuck blasts (24h TTL)
//     Hourly at :07 to stagger off the :00 storm with daily 01:00 crons +
//     other hourly crons (interval-anchored crons can converge on :00 if
//     deployed at the same minute).
// ---------------------------------------------------------------------------
crons.hourly(
  "cleanup-sealed-keys",
  { minuteUTC: 7 },
  internal.blastCleanup.cleanupStaleSealedKeys,
);

// ---------------------------------------------------------------------------
// 14. Sweep Stuck Processing Submissions — recover from crashed delivery workers
//     A worker that claimed a submission (deliveryStatus='processing') but died
//     mid-flight leaves the submission unrecoverable — claimForDelivery refuses
//     to re-claim a processing row. Every 2 minutes, revert rows that have been
//     stuck in 'processing' for >15 minutes back to 'failed' so the next claim
//     can retry. The threshold is implemented as STUCK_THRESHOLD_MS in
//     `submissions.ts:sweepStuckProcessing` (15 min, not 5 — exceeds the
//     /anchor-proof default 10-min execution budget so a slow-but-live worker
//     isn't racially classified as stuck).
// ---------------------------------------------------------------------------
crons.interval(
  "sweep-stuck-processing",
  { minutes: 2 },
  internal.submissions.sweepStuckProcessing,
);

// ---------------------------------------------------------------------------
// 15. Retry Failed Anchors — re-schedule on-chain anchors that hit transient RPC
//     failures. Does NOT re-try 'divergent' (P0 forensic state) or 'anchored'.
//     Every 5 minutes, pick submissions with anchorStatus='failed' and retry.
// ---------------------------------------------------------------------------
crons.interval(
  "retry-failed-anchors",
  { minutes: 5 },
  internal.submissions.retryFailedAnchors,
);

// ---------------------------------------------------------------------------
// 16. Reschedule Stuck Revocations — F1 closure (Stage 5).
//     Credentials with revocationStatus='pending' whose last emit attempt is
//     older than 1 hour are re-queued. Catches Convex-scheduler restart
//     orphans. Respects MAX_REVOCATION_ATTEMPTS; terminal failures flip to
//     'failed' and alert operator via the standard /api/internal/alert path.
// ---------------------------------------------------------------------------
crons.interval(
  "reschedule-stuck-revocations",
  { minutes: 15 },
  internal.users.rescheduleStuckRevocations,
);

// ---------------------------------------------------------------------------
// 17. Reconcile Revocation SMT Root — (KG-2 closure).
//     Compares Convex's smtRoots.root against the on-chain RevocationRegistry
//     currentRoot. Drift indicates either (a) on-chain emit failed silently
//     after Convex committed, (b) operator wrote a divergent root through a
//     different path, or (c) the precomputed EMPTY_TREE_ROOT in the contract
//     constructor disagrees with our computed value. Every 1 hour.
// ---------------------------------------------------------------------------
crons.hourly(
  "reconcile-revocation-smt-root",
  { minuteUTC: 13 },
  internal.revocations.reconcileSMTRoot,
);

// ---------------------------------------------------------------------------
// 18. Cleanup Message Generation Jobs — removes encrypted recovery envelopes
//     after their short retention window.
// ---------------------------------------------------------------------------
crons.hourly(
  "cleanup-message-generation-jobs",
  { minuteUTC: 21 },
  internal.messageJobs.cleanupExpired,
);

// ---------------------------------------------------------------------------
// 19. Boundary-cell observability (I2 — 2026-05-04). Computes the rolling
//     24 h boundary_cell_send_rate over post-H1 districtCredentials and
//     emits a Sentry alert when the rate exceeds the threshold. H1 stored
//     the cellStraddles field; I2 is what makes the field actionable.
// ---------------------------------------------------------------------------
crons.hourly(
  "monitor-boundary-cell-rate",
  { minuteUTC: 47 },
  internal.observability.monitorBoundaryCellRate,
);

// ---------------------------------------------------------------------------
// 20. Alert-pipe heartbeat — fires a known-OK Sentry event daily so an
//     external monitor (Sentry's expected-interval, UptimeRobot, etc.) can
//     detect "the alert pipe itself is down" independent of /api/internal/
//     alert. Without this, a broken pipe stays silent until a real incident
//     also fails to alert. 12:23 UTC chosen for stagger.
// ---------------------------------------------------------------------------
crons.daily(
  "alert-pipe-heartbeat",
  { hourUTC: 12, minuteUTC: 23 },
  internal.observability.heartbeatAlertPipe,
);

// ---------------------------------------------------------------------------
// 21. Sweep stranded placeholder supporters — recover from crashed
//     submitAction/importWithEncryption invocations that inserted a row with
//     `encryptedEmail: ""` but never landed the follow-up patchEncryptedPii
//     ciphertext. Deletes rows >15 min old still in the placeholder state.
//     Bounds the PII-triple invariant violation to "one lost
//     submission" instead of "permanent zombie row". Every 30 minutes,
//     staggered to :17 so it's well off the :00 storm.
// ---------------------------------------------------------------------------
crons.cron(
  "sweep-stranded-placeholders",
  "17,47 * * * *",
  internal.supporters.sweepStrandedPlaceholders,
);

// ---------------------------------------------------------------------------
// 22. Sweep stranded donation placeholders — recover from crashed
//     processCheckout invocations that inserted a donation row with
//     `encryptedEmail: ""` but never landed the follow-up
//     `patchEncryptedPii`. Parallels the supporters sweep + cross-tick
//     checkpoint pattern. Donation-specific: rows in `completed`/`refunded`
//     status are PRESERVED (money moved, audit trail must survive).
//     Threshold 30 min — Stripe sessions expire after 24 h so a
//     30-min-old pending row that never patched is genuinely stranded.
//     Runs at :23/:53 (staggered off supporters sweep).
// ---------------------------------------------------------------------------
crons.cron(
  "sweep-stranded-donations",
  "23,53 * * * *",
  internal.donations.sweepStrandedDonations,
);

// ---------------------------------------------------------------------------
// 23. Agent-trace expiry — delete rows past expiresAt (TTL from SK writer,
//     default 7 days). 1000-row batches per tick (= 24k/day capacity, ~2.4x
//     headroom over a 10k events/day baseline); runs hourly at :37 to
//     stagger off the other hourly crons (:07, :13, :21, :47).
// ---------------------------------------------------------------------------
crons.hourly(
  "agent-traces-expire",
  { minuteUTC: 37 },
  internal.agentTraces.expire,
);

// ---------------------------------------------------------------------------
// 24. Webhook retry — pick up orgWebhookDeliveries with nextRetryAt due and
//     re-fire deliverWebhook. Every minute keeps the latency floor low while
//     each tick is bounded to RETRY_BATCH=50 (caps action time).
// ---------------------------------------------------------------------------
crons.interval(
  "webhook-retry",
  { minutes: 1 },
  internal.orgWebhooks.retryPendingDeliveries,
);

// ---------------------------------------------------------------------------
// 25. orgEvents retention — daily TTL purge for the SSE event table. Rows
//     older than 7 days are dead weight; SSE consumers only read recent. Runs
//     at :47 to stagger off the other hourly crons (:07, :13, :21, :37, :47).
// ---------------------------------------------------------------------------
crons.hourly(
  "org-events-expire",
  { minuteUTC: 47 },
  internal.orgWebhooks.expireOldEvents,
);

// ---------------------------------------------------------------------------
// 26. Reputation tier recompute (T10-1) — nightly sweep. Recomputes
//     reputationTier from users.actionCount against the threshold table. Also
//     migrates legacy 'verified'/'novice' strings (pre-T10-3) into the new
//     threshold-derived values. Runs at 03:11 UTC to avoid the other UTC-day
//     boundary work concentrated near midnight.
// ---------------------------------------------------------------------------
crons.daily(
  "reputation-recompute",
  { hourUTC: 3, minuteUTC: 11 },
  internal.users.recomputeAllReputationTiers,
  {},
);

// ---------------------------------------------------------------------------
// 27. Relatedness calibration recompute — nightly refit of the public-corpus
//     centroid + threshold the template relatedness query normalizes against,
//     so the measured-twin edges track the corpus as it grows rather than
//     freezing today's common-mode. Pure Convex compute, no external cost.
//     03:23 UTC to stagger off reputation-recompute (03:11) and the other
//     UTC-day-boundary crons clustered near midnight.
// ---------------------------------------------------------------------------
crons.daily(
  "relatedness-calibration-recompute",
  { hourUTC: 3, minuteUTC: 23 },
  internal.templates.recomputeRelatednessCalibration,
  {},
);

// ---------------------------------------------------------------------------
// 28. Tag-concept embedding backfill — embed any newly authored / edited tags
//     so the tag-concept clustering (which folds synonyms and grounds the
//     concept edges) tracks the corpus as it grows. Embeds only the tags that
//     lack a vector, so the Gemini cost is a trivial one-time-per-tag charge.
//     03:41 UTC to stagger off the calibration recompute and the midnight crons.
// ---------------------------------------------------------------------------
crons.daily(
  "tag-concept-embedding-backfill",
  { hourUTC: 3, minuteUTC: 41 },
  internal.templates.backfillTagEmbeddings,
  {},
);

export default crons;
