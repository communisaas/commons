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

import { internalAction, internalQuery } from './_generated/server';
import { makeFunctionReference, type FunctionReference } from 'convex/server';

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

export const getBoundaryCellRate24h = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

		// Full scan of districtCredentials. No index on issuedAt today; for
		// pre-first-org volumes (<10K rows) the scan is sub-100ms. If volume
		// grows, add `.index('by_issuedAt', ['issuedAt'])` to schema.ts and
		// switch to `.withIndex('by_issuedAt', q => q.gte('issuedAt', cutoff))`.
		const rows = await ctx.db.query('districtCredentials').collect();

		let postH1Count = 0;
		let boundaryCount = 0;
		let totalRecent = 0;
		for (const row of rows) {
			if (row.issuedAt < cutoff) continue;
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

export const monitorBoundaryCellRate = internalAction({
	args: {},
	handler: async (ctx) => {
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
		const baseUrl = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
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
	},
});
