/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TransactionMetrics = {
	bytesRead: { used: number };
	documentsRead: { used: number };
	databaseQueries: { used: number };
};

describe('observability service ping', () => {
	it('proves indexed data-plane readability without hydrating an application row', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: false,
				listRevision: 0,
				relationsReady: false,
				relationsRevision: 0
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
			storageReadable: true,
			discoveryManifestPresent: true
		});
		expect(observed.metrics.bytesRead.used).toBeLessThan(2_000);
		expect(observed.metrics.documentsRead.used).toBe(1);
		expect(observed.metrics.databaseQueries.used).toBe(1);
	});
});
