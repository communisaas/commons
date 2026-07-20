import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const features = readFileSync('src/lib/config/features.ts', 'utf8');
const client = readFileSync('src/lib/core/analytics/client.ts', 'utf8');
const route = readFileSync('src/routes/api/analytics/increment/+server.ts', 'utf8');
const convex = readFileSync('convex/analytics.ts', 'utf8');

describe('analytics ingestion launch gate', () => {
	it('stops browser and HTTP ingestion before traffic can spend Convex I/O', () => {
		expect(features).toContain('ANALYTICS_INGESTION: false');
		expect(client).toContain('!FEATURES.ANALYTICS_INGESTION');
		const routeGate = route.indexOf('if (!FEATURES.ANALYTICS_INGESTION)');
		expect(routeGate).toBeGreaterThan(0);
		expect(routeGate).toBeLessThan(route.indexOf('await request.json()'));
	});

	it('also rejects direct server-secret writer calls before aggregate reads', () => {
		const writer = convex.slice(
			convex.indexOf('export const incrementBatch'),
			convex.indexOf('// =============================================================================\n// SNAPSHOT MIGRATION')
		);
		const gate = writer.indexOf('if (!ANALYTICS_CONTRIBUTION_AUTHORITY_READY)');
		expect(gate).toBeGreaterThan(0);
		expect(gate).toBeLessThan(writer.indexOf("query('analytics')"));
	});
});
