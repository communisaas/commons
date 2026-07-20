/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import positionsSource from '../../../convex/positions.ts?raw';
import schemaSource from '../../../convex/schema.ts?raw';
import routeSource from '../../../src/routes/api/deliveries/record/+server.ts?raw';

function block(symbol: string, next: string): string {
	const start = positionsSource.indexOf(`export const ${symbol}`);
	const end = positionsSource.indexOf(next, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return positionsSource.slice(start, end);
}

describe('direct delivery history bounds', () => {
	it('retires unused unbounded history readers before I/O', () => {
		for (const [symbol, next, code] of [
			['getDeliveries', '/**\n * Get all deliveries', 'POSITION_DELIVERY_HISTORY_RETIRED'],
			['getUserDeliveries', '/**\n * Get engagement', 'POSITION_USER_DELIVERY_HISTORY_RETIRED']
		] as const) {
			const source = block(symbol, next);
			expect(source).toContain(code);
			expect(source).not.toContain('ctx.db');
			expect(source).not.toContain('.collect(');
		}
	});

	it('deduplicates each bounded recipient through an exact composite index', () => {
		const source = block('recordDirectDeliveries', '/**\n * Get full engagement');
		expect(schemaSource).toContain(".index('by_templateId_pseudonymousId_recipientKey', [");
		expect(positionsSource).toContain('DIRECT_DELIVERY_RECIPIENT_MAX = 20');
		expect(source).toContain('DIRECT_DELIVERY_INPUT_MAX_BYTES');
		expect(source).toContain('by_templateId_pseudonymousId_recipientKey');
		expect(source).toContain('.take(2)');
		expect(source).not.toContain('.collect(');
		expect(routeSource).toContain('DIRECT_DELIVERY_RECIPIENT_MAX = 20');
	});
});
