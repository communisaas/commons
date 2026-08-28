/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import submissionsSource from '../../../convex/submissions.ts?raw';

function block(symbol: string, next: string): string {
	const start = submissionsSource.indexOf(`export const ${symbol}`);
	const end = submissionsSource.indexOf(next, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return submissionsSource.slice(start, end);
}

describe('submission backfill transaction bounds', () => {
	it('pages every trust-tier source mutation by rows and bytes', () => {
		const source = block('_patchTrustTierForPseudonymousId', '/**\n * Backfill trustTier');
		expect(source).toContain('.paginate({');
		expect(source).toContain('maximumRowsRead: SUBMISSION_BACKFILL_PAGE_ROWS + 1');
		expect(source).toContain('maximumBytesRead: SUBMISSION_BACKFILL_PAGE_BYTES');
		expect(source).toContain("page.pageStatus === 'SplitRequired'");
		expect(source).not.toContain('.collect(');
	});

	it('derives template aggregates from bounded read pages and a validated final patch', () => {
		const read = block('_readTemplateAggregatePage', '/**\n * Internal: persist');
		const write = block('_backfillOneTemplate', '/**\n * Backfill per-template');
		expect(read).toContain('.paginate({');
		expect(read).toContain('SUBMISSION_BACKFILL_PAGE_BYTES');
		expect(read).not.toContain('.collect(');
		expect(write).toContain('TEMPLATE_AGGREGATE_BACKFILL_INPUT_INVALID');
		expect(write).toContain('syncCompactPublicDiscoveryProjection');
		expect(write).toContain('markPublicDiscoveryListDirty');
		expect(write).not.toContain('.collect(');
	});
});
