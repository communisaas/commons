/**
 * I2 — Boundary-cell observability.
 *
 * Convex internal queries / actions can't easily be unit-imported (Convex
 * runtime + generated types). Static-source assertions pin the contract,
 * mirroring H3 / I1 patterns. The behavioral guarantees we care about:
 *   - Denominator excludes legacy rows (no `cellStraddles` field)
 *     [H0r honesty: "unknown" is not "false"]
 *   - Threshold + minimum-denominator are explicit, not magic
 *   - Alert payload carries aggregate counts only — NO user IDs / hashes
 *   - Cron schedule wires `monitorBoundaryCellRate` to fire hourly
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

describe('I2 — observability module', () => {
	const observabilityPath = path.resolve(ROOT, 'convex/observability.ts');

	it('exports the boundary-cell rate query and the monitor action', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		expect(source).toMatch(/export const getBoundaryCellRate24h = internalQuery/);
		expect(source).toMatch(/export const monitorBoundaryCellRate = internalAction/);
	});

	it('excludes legacy rows (cellStraddles undefined) from the denominator', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		// The handler must skip rows where cellStraddles is undefined. Pin the
		// guard textually; an audit that finds someone counting legacy rows
		// fires this test.
		expect(source).toMatch(/if \(row\.cellStraddles === undefined\) continue/);
	});

	it('uses an explicit BOUNDARY_RATE_ALERT_THRESHOLD constant', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		expect(source).toMatch(/BOUNDARY_RATE_ALERT_THRESHOLD\s*=\s*0\.28/);
	});

	it('uses an explicit MIN_DENOMINATOR_FOR_ALERT to suppress noisy low-volume alerts', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		expect(source).toMatch(/MIN_DENOMINATOR_FOR_ALERT\s*=\s*50/);
	});

	it('alert payload contains aggregate counts only — no user IDs / hashes / addresses', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		// Locate the JSON.stringify body of the fetch alert call. We require
		// only aggregate fields and forbid any per-user fields.
		const alertCallStart = source.indexOf('/api/internal/alert');
		expect(alertCallStart).toBeGreaterThan(0);
		const alertWindow = source.slice(alertCallStart, alertCallStart + 1600);
		// Allowed (aggregate counts):
		expect(alertWindow).toMatch(/rate/);
		expect(alertWindow).toMatch(/boundaryCount/);
		expect(alertWindow).toMatch(/postH1Count/);
		expect(alertWindow).toMatch(/totalRecent/);
		expect(alertWindow).toMatch(/threshold/);
		expect(alertWindow).toMatch(/periodMs/);
		// Forbidden (PII):
		expect(alertWindow).not.toMatch(/\buserId\b/);
		expect(alertWindow).not.toMatch(/credentialHash/);
		expect(alertWindow).not.toMatch(/identityCommitment/);
		expect(alertWindow).not.toMatch(/\baddress\b/);
		expect(alertWindow).not.toMatch(/\bemail\b/);
	});

	it('alert fetch is bounded by AbortSignal.timeout (no hung requests)', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		// Same hardening as H3 — alert emission must be bounded so a stuck
		// alert endpoint doesn't pin the cron action.
		expect(source).toMatch(/signal:\s*AbortSignal\.timeout\(/);
	});

	it('action gracefully no-ops when alert env vars are unset (does not crash the cron)', async () => {
		const source = await fs.readFile(observabilityPath, 'utf8');
		// Pattern: read CONVEX_SITE_URL + INTERNAL_API_SECRET, return early
		// with `missing_alert_env` if either is missing. A cron that throws
		// here would be retried indefinitely without surfacing the actual
		// problem — better to log and move on.
		expect(source).toMatch(/CONVEX_SITE_URL/);
		expect(source).toMatch(/INTERNAL_API_SECRET/);
		expect(source).toMatch(/missing_alert_env/);
	});
});

describe('I2 — cron schedule', () => {
	const cronsPath = path.resolve(ROOT, 'convex/crons.ts');

	it('wires monitorBoundaryCellRate to fire hourly', async () => {
		const source = await fs.readFile(cronsPath, 'utf8');
		expect(source).toMatch(/monitor-boundary-cell-rate/);
		expect(source).toMatch(/internal\.observability\.monitorBoundaryCellRate/);
		// Anchor the cadence: hourly. If someone tunes this to e.g. minutes:5
		// they should see this test bark — the threshold + 24h window were
		// designed for hourly cadence, not high-frequency polling.
		const crontStart = source.indexOf('monitor-boundary-cell-rate');
		const cronWindow = source.slice(crontStart - 200, crontStart + 200);
		expect(cronWindow).toMatch(/\{\s*hours:\s*1\s*\}/);
	});
});
