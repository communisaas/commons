/**
 * convex/supporters.ts `list` surfaces scan-cap truncation honestly.
 *
 * `list` does `.order('desc').take(MAX_SCAN)` over the `by_orgId` index
 * (newest-first) and then filters/sorts in memory. Above MAX_SCAN it drops the
 * overflow — now the OLDEST rows, so the 10K window is the most recent
 * supporters the page's notice truthfully describes. The response carries
 * `truncated` (true when the scan saturated the cap) plus `scanLimit`,
 * mirroring the v1 API envelope, so the page warns instead of presenting a 10K
 * window as the complete roster.
 *
 * convex-test isn't wired in this repo (see v1-supporters-truncation.test.ts),
 * so this mirrors the handler's take/derive logic against in-memory rows and
 * source-pins the Convex return + the page banner.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_SCAN = 10_000;

interface Row {
	_id: string;
	_creationTime: number;
}

/**
 * Mirror of convex/supporters.ts `list`: take(MAX_SCAN + 1) as a truncation
 * sentinel, derive `truncated` from `> MAX_SCAN` (an org sitting at exactly the
 * cap is complete, not truncated), drop the sentinel row from the working set,
 * return `{ hasMore, truncated, scanLimit }`.
 */
function list(allRows: Row[], pageLimit = 50) {
	const scanned = allRows.slice(0, MAX_SCAN + 1);
	const scanCapped = scanned.length > MAX_SCAN;
	const allDocs = scanned.slice(0, MAX_SCAN);

	const sorted = [...allDocs].sort((a, b) => b._creationTime - a._creationTime);
	const page = sorted.slice(0, pageLimit + 1);
	const hasMore = page.length > pageLimit;

	return { hasMore, truncated: scanCapped, scanLimit: MAX_SCAN };
}

function makeRows(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({ _id: `sup_${i}`, _creationTime: i }));
}

describe('supporter list scan-cap signal', () => {
	it('flags truncated + carries scanLimit when the org saturates the scan cap', () => {
		const result = list(makeRows(15_000));
		expect(result.truncated).toBe(true);
		expect(result.scanLimit).toBe(MAX_SCAN);
	});

	it('reports a small org as not truncated', () => {
		const result = list(makeRows(42));
		expect(result.truncated).toBe(false);
		expect(result.scanLimit).toBe(MAX_SCAN);
	});

	it('treats an org sitting exactly on the cap as NOT truncated (the sentinel +1 row proves completeness)', () => {
		const result = list(makeRows(MAX_SCAN));
		expect(result.truncated).toBe(false);
	});

	it('flags truncated as soon as the org exceeds the cap by one', () => {
		const result = list(makeRows(MAX_SCAN + 1));
		expect(result.truncated).toBe(true);
	});

	it('handles the zero-supporter org', () => {
		const result = list([]);
		expect(result.truncated).toBe(false);
		expect(result.hasMore).toBe(false);
	});
});

describe('source wiring (Convex envelope + page banner)', () => {
	const convexSource = readFileSync(
		path.resolve(process.cwd(), 'convex/supporters.ts'),
		'utf8'
	);
	const pageSource = readFileSync(
		path.resolve(process.cwd(), 'src/routes/org/[slug]/supporters/+page.svelte'),
		'utf8'
	);
	const pageServerSource = readFileSync(
		path.resolve(process.cwd(), 'src/routes/org/[slug]/supporters/+page.server.ts'),
		'utf8'
	);

	it('list takes the sentinel +1 row, derives the cap from > MAX_SCAN, and returns truncated + scanLimit', () => {
		const body = convexSource.slice(
			convexSource.indexOf('export const list = query'),
			convexSource.indexOf('export const get = query')
		);
		expect(body).toContain('.take(MAX_SCAN + 1)');
		expect(body).toContain('scanned.length > MAX_SCAN');
		expect(body).toContain('truncated: scanCapped');
		expect(body).toContain('scanLimit: MAX_SCAN');
	});

	it('the page-server forwards the cap flag into page data', () => {
		expect(pageServerSource).toContain('scanCapped: convexResult.truncated');
		expect(pageServerSource).toContain('scanLimit: convexResult.scanLimit');
	});

	it('the page shows a quiet, accurate banner when the list is capped', () => {
		expect(pageSource).toContain('scanCapped');
		expect(pageSource).toContain('most recent supporters');
		// The banner must NOT imply filtering reaches beyond the loaded window.
		expect(pageSource).not.toContain('refine filters to narrow');
	});

	it('does not break the existing list envelope consumers depend on', () => {
		const body = convexSource.slice(
			convexSource.indexOf('export const list = query'),
			convexSource.indexOf('export const get = query')
		);
		expect(body).toContain('supporters,');
		expect(body).toContain('nextCursor,');
		expect(body).toContain('hasMore,');
	});
});
