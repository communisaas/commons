/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SNAPSHOT_DATE = Date.parse('2026-07-18T00:00:00.000Z');

describe('analytics privacy launch gate', () => {
	it('cannot activate, publish, or materialize without durable contribution authority', async () => {
		const t = convexTest({ schema, modules });
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const result = await t.mutation(internal.analytics.migrateSnapshotPlane, {
				scheduleContinuation: false
			});
			if (result.status === 'migrated') break;
			if (attempt === 9) throw new Error('analytics migration did not finish');
		}

		await expect(t.query(internal.analytics.snapshotPlaneStatus, {})).resolves.toMatchObject({
			status: 'migrated',
			ready: false,
			contributionAuthorityReady: false
		});
		await expect(t.mutation(internal.analytics.activateSnapshotPlane, {})).rejects.toThrow(
			'ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY'
		);

		// Even a stale or manually corrupted durable `ready` marker cannot bypass
		// the code-level privacy gate.
		await t.run(async (ctx) => {
			const migration = await ctx.db
				.query('analyticsSnapshotMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'analytics-snapshot-plane-v1'))
				.unique();
			if (!migration) throw new Error('migration missing');
			await ctx.db.patch(migration._id, { status: 'ready' });
		});
		await expect(
			t.mutation(internal.analytics.materializeSnapshot, { snapshotDate: SNAPSHOT_DATE })
		).resolves.toMatchObject({
			success: false,
			message: 'ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY'
		});
		await expect(
			t.query(internal.analytics.readSnapshotPage, { snapshotDate: SNAPSHOT_DATE })
		).rejects.toThrow('ANALYTICS_SNAPSHOT_PLANE_NOT_READY');
	});
});
