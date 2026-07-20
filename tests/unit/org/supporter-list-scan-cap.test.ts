/**
 * Source-level regression for the People browser's database-cursor boundary.
 * Runtime cardinality and transaction budgets live in
 * convex/supporter-browse.convex.test.ts; these assertions prevent a future
 * refactor from quietly restoring the former 10,000-row in-memory window.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const supportersSource = readFileSync(path.resolve(process.cwd(), 'convex/supporters.ts'), 'utf8');
const browseSource = readFileSync(
	path.resolve(process.cwd(), 'convex/lib/supporterBrowse.ts'),
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

describe('supporter list cursor contract', () => {
	it('delegates the public list to one canonical bounded page helper', () => {
		const body = supportersSource.slice(
			supportersSource.indexOf('export const list = query'),
			supportersSource.indexOf('export const get = query')
		);
		expect(body).toContain('readSupporterBrowsePage(ctx');
		expect(body).not.toMatch(/\.take\(10_?000/);
		expect(body).not.toContain('.collect()');
		expect(body).toContain('nextCursor: page.continueCursor');
	});

	it('uses opaque database pagination for every supported indexed filter branch', () => {
		expect(browseSource).toContain(".withIndex('by_orgId_emailStatus_verified_browseSource'");
		expect(browseSource.match(/\.paginate\(pagination\)/g)?.length).toBeGreaterThanOrEqual(7);
		expect(browseSource).toContain('SUPPORTER_TAG_BROWSE_PROJECTION_NOT_READY');
		expect(browseSource).not.toContain('result.page.map((link) => ctx.db.get(link.supporterId))');
		expect(browseSource).not.toMatch(/findIndex\([^)]*cursor/);
		expect(browseSource).not.toMatch(/slice\([^)]*cursor/);
	});

	it('keeps route continuation one navigation to one Convex cursor', () => {
		expect(pageServerSource).toContain('paginationOpts: { cursor: cursor || null');
		expect(pageServerSource).toContain('nextCursor: convexResult.nextCursor');
		expect(pageSource).toContain("dataUrl.searchParams.set('cursor', nextCursor)");
		expect(pageSource).toContain('One navigation, one Convex continuation');
		expect(pageSource).not.toContain('scanCapped');
	});
});
