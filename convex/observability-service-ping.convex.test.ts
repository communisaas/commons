/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const INTERNAL_SECRET = 'observability-readiness-secret-32-byte-padding';

type TransactionMetrics = {
	bytesRead: { used: number };
	documentsRead: { used: number };
	databaseQueries: { used: number };
};

describe('observability service ping', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', INTERNAL_SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('fails loudly when the manifest singleton invariant is violated', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			for (const revision of [1, 2]) {
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					listRevision: revision,
					relationsReady: true,
					relationsRevision: revision
				});
			}
		});

		await expect(t.query(api.observability.servicePing, {})).rejects.toThrow();
	});

	it('proves indexed data-plane readability without hydrating an application row', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1
			})
		);

		const observed = await t.query(async (ctx) => {
			const value = await ctx.runQuery(api.observability.servicePing, {});
			const metrics = await (
				ctx as unknown as {
					meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
				}
			).meta.getTransactionMetrics();
			return { value, metrics };
		});

		expect(observed.value).toEqual({
			ok: true,
			storageReadable: true
		});
		expect(observed.metrics.bytesRead.used).toBeLessThan(2_000);
		expect(observed.metrics.documentsRead.used).toBe(1);
		expect(observed.metrics.databaseQueries.used).toBe(1);
	});

	it('keeps producer health and refresh timing behind the internal-secret boundary', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				relationsReady: true,
				relationsRevision: 1
			})
		);

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: 'anonymous' })
		).rejects.toThrow('Unauthorized');
		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toEqual({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});
	});

	it('reports a durable public-discovery producer failure without extra reads', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 3,
				listFailureAt: 123,
				listFailureCode: 'PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:all',
				relationsReady: true,
				relationsRevision: 3
			})
		);

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoveryManifestPresent: true,
			discoveryProducerHealthy: false,
			discoveryProducerOverdueAt: null
		});
	});

	it('returns deterministic readiness and overdue coordinates without reading the clock', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				listDirtyAt: 100,
				listRefreshScheduledAt: 1_000,
				relationsReady: false,
				relationsRevision: 0
			})
		);

		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoveryProducerHealthy: false,
			discoveryProducerOverdueAt: 1_000 + 15 * 60 * 1000
		});
	});
});
