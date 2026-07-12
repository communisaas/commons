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
	it('executes without database reads', async () => {
		const t = convexTest({ schema, modules });

		const observed = await t.query(async (ctx) => {
			const value = await ctx.runQuery(api.observability.servicePing, {});
			const metrics = await (
				ctx as unknown as {
					meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
				}
			).meta.getTransactionMetrics();
			return { value, metrics };
		});

		expect(observed.value).toEqual({ ok: true });
		expect(observed.metrics.bytesRead.used).toBe(0);
		expect(observed.metrics.documentsRead.used).toBe(0);
		expect(observed.metrics.databaseQueries.used).toBe(0);
	});
});
