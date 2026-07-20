import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('convex/authOps.ts', 'utf8');

describe('retired authOps session reader', () => {
	it('fails before clock, authorization, or database work', () => {
		const start = source.indexOf('export const validateSession = query');
		const end = source.indexOf('export const backfillTokenIdentifier = mutation', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const block = source.slice(start, end);
		expect(block).toContain('AUTHOPS_VALIDATE_SESSION_RETIRED');
		expect(block).not.toContain('Date.now');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('authOpsDb(ctx)');
		expect(block).not.toContain('requireInternalSecret');
	});
});
