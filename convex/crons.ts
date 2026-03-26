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
//    Original: daily 01:00 UTC
// ---------------------------------------------------------------------------
crons.daily(
  "cleanup-witness",
  { hourUTC: 1, minuteUTC: 0 },
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

export default crons;
