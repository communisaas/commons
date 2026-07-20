/**
 * Plan-limit and metered-usage invariants (D4).
 *
 * Request-time capped scans were replaced by exact lifetime-minus-period
 * projections. Reads fail closed while that projection is absent or stale,
 * and bounded cursor workers rebuild the source history. These tests pin that
 * architecture and the duplicated plan-limit mirror.
 *
 * Source-scanned (not imported) because convex/subscriptions.ts pulls in the
 * Convex server runtime, which vitest cannot import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const n = (s: string) => Number(s.replace(/_/g, ''));

function maxVerifiedActions(src: string): number {
	const vals = [...src.matchAll(/maxVerifiedActions:\s*([0-9_]+)/g)].map((m) => n(m[1]));
	expect(vals.length, 'expected maxVerifiedActions literals in source').toBeGreaterThan(0);
	return Math.max(...vals);
}

describe('plan-limit invariants', () => {
	const subsSrc = readFileSync(join(process.cwd(), 'convex/subscriptions.ts'), 'utf8');
	const plansSrc = readFileSync(join(process.cwd(), 'src/lib/server/billing/plans.ts'), 'utf8');
	const usageSrc = readFileSync(join(process.cwd(), 'convex/planUsage.ts'), 'utf8');

	it('keeps verified-action limits identical in both canonical plan maps', () => {
		const convexLimits = [...subsSrc.matchAll(/maxVerifiedActions:\s*([0-9_]+)/g)].map((m) =>
			n(m[1])
		);
		const serverLimits = [...plansSrc.matchAll(/maxVerifiedActions:\s*([0-9_]+)/g)].map((m) =>
			n(m[1])
		);
		expect(convexLimits).toEqual([0, 1_000, 5_000, 10_000]);
		expect(serverLimits).toEqual(convexLimits);
		expect(maxVerifiedActions(subsSrc)).toBe(maxVerifiedActions(plansSrc));
	});

	it('reads exact projected usage and fails closed at the plan limit when not ready', () => {
		const readStart = subsSrc.indexOf('export async function readProjectedPlanUsage');
		const readEnd = subsSrc.indexOf('// =============================================================================', readStart);
		expect(readStart).toBeGreaterThan(-1);
		expect(readEnd).toBeGreaterThan(readStart);
		const read = subsSrc.slice(readStart, readEnd);
		expect(read).toContain('isPlanUsageMigrationReady(migration)');
		expect(read).toContain('projectedPlanUsageForPeriod(org, periodStart)');
		expect(read).toContain('verifiedActions: limits.maxVerifiedActions');
		expect(read).toContain("failureCode: migration?.failureCode ?? 'PLAN_USAGE_MIGRATION_NOT_READY'");
		expect(read).not.toContain("query('campaignActions')");
		expect(read).not.toContain('.collect()');
	});

	it('rebuilds verified usage through bounded cursor pages without a saturation clamp', () => {
		const migrationStart = usageSrc.indexOf('async function scanSourcePage');
		const migrationEnd = usageSrc.indexOf('async function subscriptionForOrg', migrationStart);
		expect(migrationStart).toBeGreaterThan(-1);
		expect(migrationEnd).toBeGreaterThan(migrationStart);
		const migration = usageSrc.slice(migrationStart, migrationEnd);
		expect(migration).toContain("withIndex('by_orgId_verified_sentAt'");
		expect(migration).toContain('numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS');
		expect(migration).toContain('maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1');
		expect(migration).toContain('maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES');
		expect(migration).toContain('sourceCursor: page.isDone ? undefined : page.continueCursor');
		expect(migration).not.toContain('VERIFIED_ACTION_PERIOD_SCAN_CAP');
		expect(migration).not.toContain('Math.min(metered.length');
	});
});
