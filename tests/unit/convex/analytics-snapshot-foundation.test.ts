import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const analytics = readFileSync(resolve(process.cwd(), 'convex/analytics.ts'), 'utf8');
const schema = readFileSync(resolve(process.cwd(), 'convex/schema.ts'), 'utf8');
const crons = readFileSync(resolve(process.cwd(), 'convex/crons.ts'), 'utf8');
const privacyGate = readFileSync(
	resolve(process.cwd(), 'convex/lib/analyticsPrivacyGate.ts'),
	'utf8'
);
const analyticsRunbook = readFileSync(
	resolve(process.cwd(), 'docs/development/analytics.md'),
	'utf8'
);
const deploymentRunbook = readFileSync(
	resolve(process.cwd(), 'docs/development/deployment.md'),
	'utf8'
);
const cronRunbook = readFileSync(resolve(process.cwd(), 'docs/development/cron-setup.md'), 'utf8');
const cronProfileRunbook = readFileSync(
	resolve(process.cwd(), 'docs/ops/CRON-PROFILES.md'),
	'utf8'
);
const snapshotArchitecture = readFileSync(
	resolve(process.cwd(), 'src/lib/core/analytics/SNAPSHOT-ARCHITECTURE.md'),
	'utf8'
);

function tableSection(table: string, nextHeading: string): string {
	const start = schema.indexOf(`${table}: defineTable(`);
	const end = schema.indexOf(nextHeading, start);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return schema.slice(start, end);
}

describe('analytics snapshot launch foundation', () => {
	it('keeps every analytics runtime read bounded and retires the action fan-out', () => {
		expect(analytics).not.toContain('.collect(');
		expect(analytics).not.toContain('internalAction');
		expect(analytics).not.toContain('getAllAggregates');
		expect(analytics).not.toContain('storeSnapshot');
		expect(analytics).not.toContain('deleteAggregatesForDate');
		expect(analytics).not.toContain('updatePrivacyBudget');
		expect(analytics).not.toContain('checkBudget');

		expect(analytics).toContain('export const ANALYTICS_SNAPSHOT_PAGE_ROWS = 8');
		expect(analytics).toContain('export const ANALYTICS_SNAPSHOT_PAGE_BYTES = 512 * 1_024');
		expect(analytics).toContain('export const ANALYTICS_SNAPSHOT_MAX_WRITES = 20');
		expect(analytics).toContain('maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1');
		expect(analytics).toContain('maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES');
		expect(analytics).toContain("withIndex('by_recordType_date'");
	});

	it('pins exact canonical identities and fails multiplicity closed', () => {
		const analyticsTable = tableSection('analytics', '// PRIVACY BUDGETS');
		for (const index of [
			".index('by_recordType_date', ['recordType', 'date'])",
			".index('by_recordType_date_metric_dimension', ['recordType', 'date', 'metric', 'dimensionKey'])",
			".index('by_aggregateIdentity', ['aggregateIdentity'])",
			".index('by_snapshotIdentity', ['snapshotIdentity'])"
		]) {
			expect(analyticsTable).toContain(index);
		}

		expect(analytics).toContain('MAX_DIMENSION_KEY_BYTES = 1_024');
		expect(analytics).toContain('MAX_IDENTITY_BYTES = 1_536');
		expect(analytics).toContain(".withIndex('by_recordType_date_metric_dimension'");
		expect(analytics).toContain("throw new Error('ANALYTICS_AGGREGATE_IDENTITY_DIVERGED')");
		expect(analytics).toContain("throw new Error('ANALYTICS_SNAPSHOT_IDENTITY_DIVERGED')");
		expect(analytics.match(/\.take\(2\)/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
	});

	it('binds deterministic noise and the one budget spend to one durable run', () => {
		const privacyBudgets = tableSection('privacyBudgets', '// Singleton cutover state');
		const snapshotRuns = tableSection('analyticsSnapshotRuns', '// ENCRYPTED DELIVERY DATA');

		expect(analytics).toContain("{ name: 'HMAC', hash: 'SHA-256' }");
		expect(analytics).toContain("crypto.subtle.sign('HMAC'");
		expect(analytics).toContain(
			'`analytics-laplace-v${ANALYTICS_PLANE_VERSION}\\u0000${runIdentity}\\u0000${rowIdentity}`'
		);
		expect(analytics).not.toContain('stableUint32');
		expect(analytics).not.toContain('0x811c9dc5');
		expect(analytics).toContain('spendIdentity: run.runIdentity');
		expect(analytics).toContain('snapshotRunId: run._id');
		expect(analytics).toContain('existing.consumed !== SERVER_EPSILON');
		expect(privacyBudgets).toContain(".index('by_budgetIdentity', ['budgetIdentity'])");
		expect(privacyBudgets).toContain(".index('by_spendIdentity', ['spendIdentity'])");
		expect(snapshotRuns).toContain(".index('by_runIdentity', ['runIdentity'])");
		expect(snapshotRuns).toContain(".index('by_snapshotDate', ['snapshotDate'])");
	});

	it('keeps partial snapshots invisible and deletes source only with exact evidence', () => {
		const readerStart = analytics.indexOf('export const readSnapshotPage');
		const reader = analytics.slice(readerStart);
		expect(readerStart).toBeGreaterThanOrEqual(0);
		expect(reader).toContain("migrationRows[0].status !== 'ready'");
		expect(reader).toContain("migrationRows[0].phase !== 'complete'");
		expect(reader).toContain("runs[0].status !== 'ready'");
		expect(reader).toContain("runs[0].phase !== 'complete'");
		expect(reader).toContain('page: publishedPage');
		expect(reader).toContain('const publishedPage = page.page.map');
		expect(reader.slice(reader.lastIndexOf('return {'))).not.toContain('runIdentity:');
		const publishedReturn = reader.slice(
			reader.indexOf('// This is an intentionally narrow publication DTO'),
			reader.indexOf('};', reader.indexOf('// This is an intentionally narrow publication DTO'))
		);
		for (const secret of [
			'noiseSeed',
			'sourceAggregateId',
			'snapshotIdentity',
			'aggregateIdentity',
			'planeVersion',
			'_id',
			'_creationTime'
		]) {
			expect(publishedReturn).not.toMatch(new RegExp(`\\b${secret}\\s*:`));
		}

		const cleanupStart = analytics.indexOf("run.phase === 'cleanup'");
		const cleanupEnd = analytics.indexOf('// SUPERVISION, OPERATOR RESUME', cleanupStart);
		const cleanup = analytics.slice(cleanupStart, cleanupEnd);
		expect(cleanupStart).toBeGreaterThanOrEqual(0);
		expect(cleanup).toContain('snapshots.length !== 1');
		expect(cleanup).toContain('snapshots[0].sourceAggregateId !== row._id');
		expect(cleanup.indexOf('ANALYTICS_CLEANUP_SNAPSHOT_EVIDENCE_MISSING')).toBeLessThan(
			cleanup.indexOf('await ctx.db.delete(row._id)')
		);
	});

	it('keeps both analytics jobs behind the static post-cutover tombstone', () => {
		expect(crons).toContain('const ANALYTICS_SNAPSHOT_CRON_READY = false');
		expect(privacyGate).toContain('export const ANALYTICS_CONTRIBUTION_AUTHORITY_READY = false');
		expect(analytics).toContain("throw new Error('ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY')");
		const sourceFile = ts.createSourceFile(
			'convex/crons.ts',
			crons,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);
		const conditionsByJob = new Map<string, string[]>();
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				for (const argument of node.arguments) {
					if (
						ts.isStringLiteral(argument) &&
						['analytics-snapshot', 'analytics-snapshot-supervisor'].includes(argument.text)
					) {
						const conditions: string[] = [];
						for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
							if (ts.isIfStatement(parent)) conditions.push(parent.expression.getText(sourceFile));
						}
						conditionsByJob.set(
							argument.text,
							conditions.map((condition) => condition.replace(/\s+/g, ' '))
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);

		for (const job of ['analytics-snapshot', 'analytics-snapshot-supervisor']) {
			expect(conditionsByJob.get(job)).toEqual([
				"enabled('operational') && ANALYTICS_CONTRIBUTION_AUTHORITY_READY && ANALYTICS_SNAPSHOT_CRON_READY"
			]);
		}
	});

	it('documents the exact migrate, activate, observe, and separate cron release gates', () => {
		for (const runbook of [analyticsRunbook, deploymentRunbook]) {
			expect(runbook).toContain("analytics:migrateSnapshotPlane");
			expect(runbook).toContain("analytics:snapshotPlaneStatus");
			expect(runbook).toContain("analytics:activateSnapshotPlane");
			expect(runbook).toContain('ANALYTICS_SNAPSHOT_CRON_READY');
			expect(runbook).toContain('ANALYTICS_CONTRIBUTION_AUTHORITY_READY');
			expect(runbook).toMatch(/durable.{0,80}contribution/is);
			expect(runbook).toMatch(/status.{0,20}migrated/is);
			expect(runbook).toMatch(/status.{0,20}ready/is);
		}
		for (const runbook of [cronRunbook, cronProfileRunbook, snapshotArchitecture]) {
			expect(runbook).toContain('ANALYTICS_CONTRIBUTION_AUTHORITY_READY');
			expect(runbook).toContain('ANALYTICS_SNAPSHOT_CRON_READY');
			expect(runbook).toMatch(/CRON_PROFILE.{0,120}(cannot|insufficient)/is);
		}
	});
});
