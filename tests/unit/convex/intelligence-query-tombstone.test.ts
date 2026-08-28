import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('convex/intelligence.ts', 'utf8');

describe('retired intelligence recent query', () => {
	it('fails before clock, authorization, or database work', () => {
		const start = source.indexOf('export const getRecent = query');
		const end = source.indexOf('// MUTATIONS', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const block = source.slice(start, end);
		expect(block).toContain('INTELLIGENCE_GET_RECENT_RETIRED');
		expect(block).not.toContain('Date.now');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('requireAuth');
	});
});
