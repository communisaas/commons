/**
 * v1 listSupporters truncation-signal contract.
 *
 * convex/v1api.ts `listSupporters` scans a bounded window
 * (SUPPORTER_SCAN_LIMIT rows) ordered newest-first. An org with more rows than
 * the cap saturates the window and the oldest rows fall outside it. When that
 * happens the returned `total` reflects only the scanned window, not the org's
 * true count — so the response carries `truncated: true` and the `scanLimit`
 * that produced it, letting an integrator tell a capped page from a complete
 * enumeration instead of trusting `total` as authoritative.
 *
 * convex-test isn't wired in this repo, so this mirrors the handler's
 * scan/filter/derive logic against an in-memory list (same MockConvex pattern
 * as reconcile-skip-counter.test.ts) and pins the envelope shape the HTTP
 * route at src/routes/api/v1/supporters/+server.ts forwards into `meta`.
 */

import { describe, it, expect } from 'vitest';

const SUPPORTER_SCAN_LIMIT = 10_000;

interface SupporterRow {
	_id: string;
	verified: boolean;
}

/**
 * Mirror of convex/v1api.ts `listSupporters`: take(scanLimit) over rows ordered
 * desc, derive `truncated` from window saturation, apply filters, paginate by
 * cursor, and return total = filtered window length.
 */
function listSupporters(
	allRowsNewestFirst: SupporterRow[],
	args: { limit: number; cursor?: string; verified?: boolean }
) {
	const scanLimit = SUPPORTER_SCAN_LIMIT;
	const scanned = allRowsNewestFirst.slice(0, scanLimit);
	const truncated = scanned.length >= scanLimit;

	let filtered = scanned;
	if (args.verified !== undefined) {
		filtered = filtered.filter((s) => s.verified === args.verified);
	}

	const total = filtered.length;

	let startIdx = 0;
	if (args.cursor) {
		const idx = filtered.findIndex((s) => s._id === args.cursor);
		if (idx >= 0) startIdx = idx + 1;
	}
	const page = filtered.slice(startIdx, startIdx + args.limit + 1);
	const hasMore = page.length > args.limit;
	const items = page.slice(0, args.limit);
	const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

	return { items, cursor: nextCursor, hasMore, total, truncated, scanLimit };
}

function makeRows(n: number): SupporterRow[] {
	return Array.from({ length: n }, (_, i) => ({ _id: `sup_${i}`, verified: i % 2 === 0 }));
}

describe('v1 listSupporters truncation signal', () => {
	it('flags truncated + carries scanLimit when the org exceeds the scan cap', () => {
		const result = listSupporters(makeRows(15_000), { limit: 50 });
		expect(result.truncated).toBe(true);
		expect(result.scanLimit).toBe(SUPPORTER_SCAN_LIMIT);
		// total reflects only the scanned window, never the true 15K.
		expect(result.total).toBe(SUPPORTER_SCAN_LIMIT);
		expect(result.total).not.toBe(15_000);
	});

	it('reports a complete enumeration as not truncated', () => {
		const result = listSupporters(makeRows(42), { limit: 50 });
		expect(result.truncated).toBe(false);
		expect(result.scanLimit).toBe(SUPPORTER_SCAN_LIMIT);
		expect(result.total).toBe(42);
		expect(result.hasMore).toBe(false);
	});

	it('treats an org sitting exactly on the cap as truncated (cannot prove completeness)', () => {
		const result = listSupporters(makeRows(SUPPORTER_SCAN_LIMIT), { limit: 50 });
		expect(result.truncated).toBe(true);
	});

	it('handles the zero-supporter org', () => {
		const result = listSupporters([], { limit: 50 });
		expect(result.truncated).toBe(false);
		expect(result.total).toBe(0);
		expect(result.items).toHaveLength(0);
		expect(result.cursor).toBeNull();
	});

	it('still derives truncation from the raw window even when filters shrink total below the cap', () => {
		// 15K rows, half verified → filtered total ~5K, but the scan still
		// saturated, so the page is not a complete enumeration of verified rows.
		const result = listSupporters(makeRows(15_000), { limit: 50, verified: true });
		expect(result.truncated).toBe(true);
		expect(result.total).toBeLessThan(SUPPORTER_SCAN_LIMIT);
	});

	it('paginates within the in-window set via cursor', () => {
		const rows = makeRows(120);
		const first = listSupporters(rows, { limit: 50 });
		expect(first.items).toHaveLength(50);
		expect(first.hasMore).toBe(true);
		expect(first.cursor).toBe('sup_49');

		const second = listSupporters(rows, { limit: 50, cursor: first.cursor! });
		expect(second.items[0]._id).toBe('sup_50');
		expect(second.truncated).toBe(false);
	});
});
