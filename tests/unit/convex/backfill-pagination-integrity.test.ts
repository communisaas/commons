import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backfill = readFileSync('convex/backfill.ts', 'utf8');

	describe('legacy backfill pagination integrity', () => {
	it('never advances a five-page cursor while retaining only one page of work', () => {
		const source = backfill.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		expect(source).not.toContain('numItems: limit * 5');
		expect(source).toContain('numItems: pageSize');
		expect(backfill).not.toContain('needsWork.slice(0, limit)');
	});

	it('bounds row, byte, page-size, and cursor inputs on legacy scans', () => {
		expect(backfill).toContain('BACKFILL_PAGE_SIZE_MAX = 100');
		expect(backfill).toContain('BACKFILL_CURSOR_MAX_BYTES = 2_048');
		expect(backfill).toContain('maximumRowsRead: pageSize + 1');
		expect(backfill).toContain('maximumBytesRead: BACKFILL_PAGE_MAX_BYTES');
		expect(backfill).toContain("throw new Error('BACKFILL_PAGE_SPLIT_REQUIRED')");
	});
});
