import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const seed = readFileSync('convex/seed.ts', 'utf8');

describe('seed read bounds', () => {
	it('keeps fixture reconciliation and PII migration reads bounded', () => {
		const source = seed.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		expect(source).not.toContain('.collect()');
		expect(seed).toContain('SEED_RECONCILIATION_ROW_LIMIT = 128');
		expect(seed).toContain('.take(SEED_RECONCILIATION_ROW_LIMIT + 1)');
		expect(seed).toContain('SEED_RECONCILIATION_LIMIT_EXCEEDED');
	});
});
