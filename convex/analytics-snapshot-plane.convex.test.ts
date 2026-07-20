/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

vi.mock('./lib/analyticsPrivacyGate', () => ({
	ANALYTICS_CONTRIBUTION_AUTHORITY_READY: true
}));

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const SNAPSHOT_DATE = Date.parse('2026-07-18T00:00:00.000Z');

async function migrateAndActivate(t: Harness): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const result = await t.mutation(internal.analytics.migrateSnapshotPlane, {
			scheduleContinuation: false
		});
		if (result.status === 'blocked') throw new Error(result.failureCode ?? 'migration blocked');
		if (result.status === 'migrated' || result.status === 'ready') break;
		if (attempt === 49) throw new Error('analytics migration did not finish');
	}
	await expect(t.mutation(internal.analytics.activateSnapshotPlane, {})).resolves.toMatchObject({
		status: 'ready'
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('bounded analytics snapshot plane', () => {
	it('materializes and cleans multiple pages once while hiding partial snapshots', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			for (let index = 0; index < 19; index += 1) {
				const templateId = `template-${String(index).padStart(2, '0')}`;
				await ctx.db.insert('analytics', {
					recordType: 'aggregate',
					date: SNAPSHOT_DATE,
					metric: 'template_view',
					dimensionKey: `${templateId}||||`,
					templateId,
					count: index + 1,
					updatedAt: NOW - 1
				});
			}
		});

		await migrateAndActivate(t);
		await expect(
			t.mutation(internal.analytics.materializeSnapshot, { snapshotDate: SNAPSHOT_DATE })
		).resolves.toMatchObject({
			success: true,
			snapshotsCreated: 0,
			message: 'ANALYTICS_SNAPSHOT_SCHEDULED'
		});

		await expect(
			t.query(internal.analytics.readSnapshotPage, { snapshotDate: SNAPSHOT_DATE })
		).rejects.toThrow('ANALYTICS_SNAPSHOT_DATE_NOT_READY');

		const run = await t.run((ctx) =>
			ctx.db
				.query('analyticsSnapshotRuns')
				.withIndex('by_snapshotDate', (q) => q.eq('snapshotDate', SNAPSHOT_DATE))
				.unique()
		);
		expect(run).not.toBeNull();
		await t.mutation(internal.analytics.continueSnapshotRun, {
			runId: run!._id,
			runToken: run!.runToken
		});
		await expect(
			t.query(internal.analytics.readSnapshotPage, { snapshotDate: SNAPSHOT_DATE })
		).rejects.toThrow('ANALYTICS_SNAPSHOT_DATE_NOT_READY');
		const firstPage = await t.run((ctx) =>
			ctx.db
				.query('analytics')
				.withIndex('by_recordType_date', (q) =>
					q.eq('recordType', 'snapshot').eq('date', SNAPSHOT_DATE)
				)
				.collect()
		);
		expect(firstPage).toHaveLength(8);
		const firstPageNoise = new Map(
			firstPage.map((row) => [row.snapshotIdentity, row.noisyCount] as const)
		);

		// Rewind only the coordinator cursor to model an at-least-once page retry.
		// Existing rows must validate against the same HMAC-derived noise and the
		// budget spend must remain bound to this one run.
		await t.run((ctx) => ctx.db.patch(run!._id, { cursor: undefined }));
		await expect(
			t.mutation(internal.analytics.continueSnapshotRun, {
				runId: run!._id,
				runToken: run!.runToken
			})
		).resolves.toMatchObject({ status: 'running', snapshotsCreated: 8 });
		const replayedFirstPage = await t.run((ctx) =>
			ctx.db
				.query('analytics')
				.withIndex('by_recordType_date', (q) =>
					q.eq('recordType', 'snapshot').eq('date', SNAPSHOT_DATE)
				)
				.collect()
		);
		expect(replayedFirstPage).toHaveLength(8);
		for (const row of replayedFirstPage) {
			expect(row.noisyCount).toBe(firstPageNoise.get(row.snapshotIdentity));
		}

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const evidence = await t.run(async (ctx) => {
			const completedRun = await ctx.db.get(run!._id);
			const aggregates = await ctx.db
				.query('analytics')
				.withIndex('by_recordType_date', (q) =>
					q.eq('recordType', 'aggregate').eq('date', SNAPSHOT_DATE)
				)
				.collect();
			const snapshots = await ctx.db
				.query('analytics')
				.withIndex('by_recordType_date', (q) =>
					q.eq('recordType', 'snapshot').eq('date', SNAPSHOT_DATE)
				)
				.collect();
			const budgets = await ctx.db
				.query('privacyBudgets')
				.withIndex('by_budgetIdentity', (q) =>
					q.eq('budgetIdentity', `analytics-budget-v1:system:${SNAPSHOT_DATE}:system`)
				)
				.collect();
			return { completedRun, aggregates, snapshots, budgets };
		});

		expect(evidence.completedRun).toMatchObject({
			status: 'ready',
			phase: 'complete',
			budgetClaimed: true,
			snapshotsCreated: 19,
			aggregatesDeleted: 19
		});
		expect(evidence.aggregates).toHaveLength(0);
		expect(evidence.snapshots).toHaveLength(19);
		expect(new Set(evidence.snapshots.map((row) => row.snapshotIdentity)).size).toBe(19);
		expect(evidence.snapshots.every((row) => row.sourceAggregateId !== undefined)).toBe(true);
		expect(evidence.snapshots.every((row) => row.noiseSeed === undefined)).toBe(true);
		expect(evidence.budgets).toHaveLength(1);
		expect(evidence.budgets[0]).toMatchObject({
			consumed: 1,
			spendIdentity: `analytics-snapshot-run-v1:${SNAPSHOT_DATE}`,
			snapshotRunId: run!._id
		});

		const visible = await t.query(internal.analytics.readSnapshotPage, {
			snapshotDate: SNAPSHOT_DATE,
			limit: 50
		});
		expect(visible.page).toHaveLength(19);
		expect(visible.isDone).toBe(true);
		expect(visible).not.toHaveProperty('runIdentity');
		expect(Object.keys(visible.page[0]).sort()).toEqual(
			['epsilonSpent', 'metric', 'noisyCount', 'snapshotDate', 'templateId'].sort()
		);
		for (const snapshot of visible.page) {
			expect(snapshot).not.toHaveProperty('noiseSeed');
			expect(snapshot).not.toHaveProperty('sourceAggregateId');
			expect(snapshot).not.toHaveProperty('snapshotIdentity');
			expect(snapshot).not.toHaveProperty('aggregateIdentity');
			expect(snapshot).not.toHaveProperty('planeVersion');
			expect(snapshot).not.toHaveProperty('_id');
			expect(snapshot).not.toHaveProperty('_creationTime');
		}

		await expect(
			t.mutation(internal.analytics.materializeSnapshot, { snapshotDate: SNAPSHOT_DATE })
		).resolves.toMatchObject({
			success: true,
			snapshotsCreated: 19,
			budgetSpent: 1,
			message: 'ANALYTICS_SNAPSHOT_ALREADY_READY'
		});
		const budgetsAfterReplay = await t.run((ctx) =>
			ctx.db
				.query('privacyBudgets')
				.withIndex('by_budgetIdentity', (q) =>
					q.eq('budgetIdentity', `analytics-budget-v1:system:${SNAPSHOT_DATE}:system`)
				)
				.collect()
		);
		expect(budgetsAfterReplay).toHaveLength(1);
		expect(budgetsAfterReplay[0].consumed).toBe(1);
	});

	it('blocks migration on a legacy partial snapshot instead of deleting its source', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await ctx.db.insert('analytics', {
				recordType: 'snapshot',
				snapshotDate: SNAPSHOT_DATE,
				metric: 'template_use',
				dimensionKey: 'legacy||||',
				templateId: 'legacy',
				noisyCount: 4,
				epsilon: 1,
				epsilonSpent: 1,
				noiseSeed: '00112233445566778899aabbccddeeff',
				updatedAt: NOW - 1
			});
			await ctx.db.insert('analytics', {
				recordType: 'aggregate',
				date: SNAPSHOT_DATE,
				metric: 'template_use',
				dimensionKey: 'legacy||||',
				templateId: 'legacy',
				count: 4,
				updatedAt: NOW - 1
			});
		});

		let blocked: { status: string; failureCode?: string | null } | null = null;
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const result = await t.mutation(internal.analytics.migrateSnapshotPlane, {
				scheduleContinuation: false
			});
			if (result.status === 'blocked') {
				blocked = result;
				break;
			}
		}
		expect(blocked).toMatchObject({
			status: 'blocked',
			failureCode: 'ANALYTICS_LEGACY_PARTIAL_SNAPSHOT_REQUIRES_RECONCILIATION'
		});
		await expect(
			t.query(internal.analytics.readSnapshotPage, { snapshotDate: SNAPSHOT_DATE })
		).rejects.toThrow('ANALYTICS_SNAPSHOT_PLANE_NOT_READY');
		const aggregateCount = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('analytics')
				.withIndex('by_recordType_date', (q) =>
					q.eq('recordType', 'aggregate').eq('date', SNAPSHOT_DATE)
				)
				.collect();
			return rows.length;
		});
		expect(aggregateCount).toBe(1);
	});

	it('resumes an adopted legacy page without retaining or requiring a published seed', async () => {
		const t = convexTest({ schema, modules });
		const firstSeed = '11112222333344445555666677778888';
		const secondSeed = '9999aaaabbbbccccddddeeeeffff0000';
		await t.run(async (ctx) => {
			for (const [templateId, noiseSeed] of [
				['first', firstSeed],
				['second', secondSeed]
			] as const) {
				await ctx.db.insert('analytics', {
					recordType: 'snapshot',
					snapshotDate: SNAPSHOT_DATE,
					metric: 'template_view',
					dimensionKey: `${templateId}||||`,
					templateId,
					noisyCount: 3,
					epsilon: 1,
					epsilonSpent: 1,
					noiseSeed,
					updatedAt: NOW - 1
				});
			}
			await ctx.db.insert('privacyBudgets', {
				metric: 'system',
				epsilon: 10,
				consumed: 1,
				windowStart: SNAPSHOT_DATE,
				windowEnd: SNAPSHOT_DATE + 86_400_000,
				updatedAt: NOW - 1
			});
		});

		await expect(
			t.mutation(internal.analytics.migrateSnapshotPlane, {
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'blocked', failureCode: 'ANALYTICS_LEGACY_RUN_DIVERGED' });
		const partiallyAdopted = await t.run((ctx) =>
			ctx.db
				.query('analytics')
				.withIndex('by_recordType', (q) => q.eq('recordType', 'snapshot'))
				.order('asc')
				.collect()
		);
		expect(partiallyAdopted[0].noiseSeed).toBeUndefined();
		expect(partiallyAdopted[1].noiseSeed).toBe(secondSeed);

		await t.run((ctx) => ctx.db.patch(partiallyAdopted[1]._id, { noiseSeed: firstSeed }));
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const result = await t.mutation(internal.analytics.migrateSnapshotPlane, {
				retryBlocked: attempt === 0,
				scheduleContinuation: false
			});
			if (result.status === 'blocked') throw new Error(result.failureCode ?? 'migration blocked');
			if (result.status === 'migrated') break;
			if (attempt === 9) throw new Error('analytics migration did not finish');
		}
		await expect(t.mutation(internal.analytics.activateSnapshotPlane, {})).resolves.toMatchObject({
			status: 'ready'
		});
		const adopted = await t.run((ctx) =>
			ctx.db
				.query('analytics')
				.withIndex('by_recordType', (q) => q.eq('recordType', 'snapshot'))
				.collect()
		);
		expect(adopted).toHaveLength(2);
		expect(adopted.every((row) => row.noiseSeed === undefined)).toBe(true);
		const published = await t.query(internal.analytics.readSnapshotPage, {
			snapshotDate: SNAPSHOT_DATE
		});
		expect(published.page).toHaveLength(2);
		expect(published.page.every((row) => !('noiseSeed' in row))).toBe(true);
	});

	it('supervises one expired coordinator lease without creating a second run', async () => {
		const t = convexTest({ schema, modules });
		await migrateAndActivate(t);
		const runId = await t.run((ctx) =>
			ctx.db.insert('analyticsSnapshotRuns', {
				runIdentity: `analytics-snapshot-run-v1:${SNAPSHOT_DATE}`,
				snapshotDate: SNAPSHOT_DATE,
				status: 'running',
				phase: 'materialize',
				runToken: 'stale-run-token',
				noiseSeed: 'ffeeddccbbaa99887766554433221100',
				budgetClaimed: false,
				snapshotsCreated: 0,
				aggregatesDeleted: 0,
				scannedRows: 0,
				restarts: 0,
				leaseExpiresAt: NOW - 1,
				startedAt: NOW - 60_000,
				updatedAt: NOW - 60_000
			})
		);

		await expect(t.mutation(internal.analytics.superviseSnapshotRuns, {})).resolves.toMatchObject({
			scanned: 1,
			restarted: 1,
			blocked: 0
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await expect(t.run((ctx) => ctx.db.get(runId))).resolves.toMatchObject({
			status: 'ready',
			phase: 'complete',
			restarts: 1,
			budgetClaimed: false
		});
		const runCount = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('analyticsSnapshotRuns')
				.withIndex('by_snapshotDate', (q) => q.eq('snapshotDate', SNAPSHOT_DATE))
				.collect();
			return rows.length;
		});
		expect(runCount).toBe(1);
	});
});
