/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import segmentsSource from '../../../convex/segments.ts?raw';

function exportedBlock(symbol: string, next: string): string {
	const start = segmentsSource.indexOf(`export const ${symbol}`);
	const end = segmentsSource.indexOf(next, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return segmentsSource.slice(start, end);
}

describe('segment matching projection boundary', () => {
	it('matches one byte-bounded supporter page from compact tag/action projections', () => {
		const block = exportedBlock('getMatchingSupportersPage', '/**\n * Internal mutation: bulk-apply');
		expect(segmentsSource).toContain('SEGMENT_PAGE_SIZE = 100');
		expect(block).toContain('boundedSegmentFilter(filters)');
		expect(block).toContain('assertSupporterBrowseReady(ctx)');
		expect(block).toContain('assertSupporterAudienceActionReady(ctx)');
		expect(block).toContain('maximumBytesRead: SEGMENT_PAGE_MAX_BYTES');
		expect(block).toContain('SUPPORTER_AUDIENCE_ACTION_VERSION');
		expect(block).toContain('audienceActionProjectionOverflow');
		expect(block).not.toContain('campaignActions');
		expect(block).not.toContain('supporterTags');
		expect(block).not.toContain('.collect(');
	});

	it('bounds the organization tag dictionary by its writer-enforced envelope', () => {
		const block = exportedBlock('getOrgTagsInternal', '/**\n * Export supporters');
		expect(block).toContain('.take(MAX_ORG_TAGS + 1)');
		expect(block).toContain('ORG_TAG_LIMIT_EXCEEDED');
		expect(block).not.toContain('.collect(');
	});
});
