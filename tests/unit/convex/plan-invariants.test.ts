/**
 * Plan-limit and metered-usage invariants.
 *
 * Request-time capped scans were replaced by exact lifetime-minus-period
 * projections. Reads fail closed while that projection is absent or stale,
 * and bounded cursor workers rebuild the source history. These tests pin that
 * architecture, plus the fact that the plan table is declared exactly once.
 *
 * Source-scanned (not imported) because convex/subscriptions.ts pulls in the
 * Convex server runtime, which vitest cannot import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const n = (s: string) => Number(s.replace(/_/g, ''));

describe('plan-limit invariants', () => {
	const limitsSrc = readFileSync(join(process.cwd(), 'convex/lib/planLimits.ts'), 'utf8');
	const subsSrc = readFileSync(join(process.cwd(), 'convex/subscriptions.ts'), 'utf8');
	const plansSrc = readFileSync(join(process.cwd(), 'src/lib/server/billing/plans.ts'), 'utf8');
	const usageSrc = readFileSync(join(process.cwd(), 'convex/planUsage.ts'), 'utf8');

	it('declares the verified-action column once, in the shared plan table', () => {
		const convexLimits = [...limitsSrc.matchAll(/maxVerifiedActions:\s*([0-9_]+)/g)].map((m) =>
			n(m[1])
		);
		expect(convexLimits).toEqual([0, 1_000, 5_000, 10_000]);
		// Neither consumer restates the column — they read the shared table.
		expect(plansSrc).not.toMatch(/maxVerifiedActions:\s*[0-9]/);
		expect(subsSrc).not.toMatch(/maxVerifiedActions:\s*[0-9]/);
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
