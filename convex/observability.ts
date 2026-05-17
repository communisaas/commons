/**
 * I2 — Boundary-cell observability.
 *
 * H1 stores `cellStraddles` on `districtCredentials`. Storage ≠ monitoring.
 * Without an alert, a deploy regression that misroutes every address to the
 * boundary path would only be detectable via end-of-quarter metrics review,
 * which is too slow.
 *
 * This module:
 *   - `getBoundaryCellRate24h` (internalQuery): computes the boundary-cell
 *     send rate over the trailing 24 h on credentials that carry the H1
 *     `cellStraddles` field. Legacy rows (pre-H1) are excluded from the
 *     denominator — H0r honesty: "unknown" is not a synonym for "false."
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

import { internalAction, internalQuery, type ActionCtx } from './_generated/server';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { captureToSentry } from './_sentry';

// Break circular type inference between the action and the query in the same
// file (mirrors the revocations.ts pattern). Calling `internal.observability.*`
// from monitorBoundaryCellRate would create a self-referential type.
const getBoundaryCellRate24hRef = makeFunctionReference<'query'>(
	'observability:getBoundaryCellRate24h',
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
	}
>;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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

export const getBoundaryCellRate24h = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

		// Range scan via `by_issuedAt` reads only credentials issued within
		// the 24h window — bounded by window-rate, not table cardinality.
		// Previous `.collect()` would hit Convex's row-scan cap somewhere
		// between 5K-16K active credentials and throw silently in the
		// hourly cron, killing the boundary alert precisely when there are
		// enough users for boundary mistakes to matter.
		let postH1Count = 0;
		let boundaryCount = 0;
		let totalRecent = 0;
		for await (const row of ctx.db
			.query('districtCredentials')
			.withIndex('by_issuedAt', (q) => q.gte('issuedAt', cutoff))) {
			totalRecent++;
			// H0r CRITICAL: only rows with cellStraddles defined contribute to
			// the denominator. Legacy rows (undefined) are "unknown," not "no
			// boundary issue." Including them as 0 would bias the rate down.
			if (row.cellStraddles === undefined) continue;
			postH1Count++;
			if (row.cellStraddles === true) boundaryCount++;
		}

		const rate = postH1Count > 0 ? boundaryCount / postH1Count : null;
		return {
			rate,
			boundaryCount,
			postH1Count,
			totalRecent,
			periodMs: TWENTY_FOUR_HOURS_MS,
		};
	},
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
			return await runMonitorBoundaryCellRate(ctx);
		} catch (err) {
			await captureToSentry(err, {
				action: 'monitorBoundaryCellRate',
				level: 'error',
			});
			throw err;
		}
	},
});

async function runMonitorBoundaryCellRate(ctx: ActionCtx): Promise<unknown> {
		const stats = await ctx.runQuery(getBoundaryCellRate24hRef, {});

		// Insufficient signal — log silently, do NOT alert (would just
		// generate noise during low-volume periods like fresh deploys).
		if (stats.postH1Count < MIN_DENOMINATOR_FOR_ALERT) {
			console.debug(
				'[observability] boundary-cell rate skipped (insufficient denominator)',
				{
					postH1Count: stats.postH1Count,
					minRequired: MIN_DENOMINATOR_FOR_ALERT,
				},
			);
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
							'x-internal-secret': internalSecretCov,
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
								periodMs: stats.periodMs,
							},
						}),
						signal: AbortSignal.timeout(10_000),
					});
				} catch (err) {
					console.error(
						'[observability] coverage-low alert failed:',
						err instanceof Error ? err.message : String(err),
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
				postH1Count: stats.postH1Count,
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
				{ rate, threshold: BOUNDARY_RATE_ALERT_THRESHOLD },
			);
			return {
				alerted: false,
				reason: 'missing_alert_env',
				stats,
			};
		}

		// Alert payload — aggregate counts only. NO user IDs, hashes, addresses.
		try {
			const res = await fetch(`${baseUrl}/api/internal/alert`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-internal-secret': internalSecret,
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
						periodMs: stats.periodMs,
					},
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) {
				console.error(
					`[observability] alert emission failed: HTTP ${res.status}`,
				);
				return { alerted: false, reason: 'alert_http_error', stats };
			}
		} catch (err) {
			console.error(
				'[observability] alert fetch failed:',
				err instanceof Error ? err.message : String(err),
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
				'[observability] heartbeat: alert env missing; logged here but not emitted to Sentry',
			);
			return { ok: false, reason: 'missing_alert_env' };
		}
		try {
			const res = await fetch(`${baseUrl}/api/internal/alert`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-internal-secret': internalSecret,
				},
				body: JSON.stringify({
					code: 'HEARTBEAT_DAILY',
					message: 'Daily alert-pipe heartbeat — if you see this, /api/internal/alert is reachable from Convex',
					severity: 'warning',
					context: { emittedAt: Date.now() },
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) {
				console.error(`[observability] heartbeat: HTTP ${res.status}`);
				return { ok: false, reason: 'http_error' };
			}
			return { ok: true };
		} catch (err) {
			console.error(
				'[observability] heartbeat: fetch failed:',
				err instanceof Error ? err.message : String(err),
			);
			return { ok: false, reason: 'fetch_failed' };
		}
	},
});
