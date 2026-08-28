import { describe, expect, it } from 'vitest';
import {
	MAX_AUDIENCE_FILTER_BYTES,
	normalizeEmailAudienceFilter,
	normalizeSmsAudienceFilter
} from '../../../convex/_audienceFilters';

function hash(index: number): string {
	return index.toString(16).padStart(64, '0');
}

describe('audience filter input envelopes', () => {
	it('accepts a normal closed email filter under the serialized byte cap', () => {
		expect(
			normalizeEmailAudienceFilter({
				tagIds: ['tag-id'],
				segmentIds: ['segment-id'],
				includeEmailHashes: [hash(1), hash(2)],
				verified: 'verified'
			})
		).toMatchObject({ verified: 'verified', includeEmailHashes: [hash(1), hash(2)] });
	});

	it('rejects a combined hash input above 512 KiB even when each array is below its item cap', () => {
		const includeEmailHashes = Array.from({ length: 4_000 }, (_, index) => hash(index));
		const excludeEmailHashes = Array.from({ length: 4_000 }, (_, index) => hash(index + 4_000));
		expect(
			new TextEncoder().encode(JSON.stringify({ includeEmailHashes, excludeEmailHashes })).byteLength
		).toBeGreaterThan(MAX_AUDIENCE_FILTER_BYTES);
		expect(() =>
			normalizeEmailAudienceFilter({ includeEmailHashes, excludeEmailHashes })
		).toThrow('EMAIL_AUDIENCE_FILTER_TOO_LARGE');
	});

	it('measures identifier limits in UTF-8 bytes, not JavaScript code units', () => {
		expect(() => normalizeSmsAudienceFilter({ tags: ['界'.repeat(64)] })).toThrow(
			'SMS_AUDIENCE_TAG_FILTERS_INVALID'
		);
	});

	it('accounts for the entire raw SMS object before ignoring unknown input', () => {
		expect(() =>
			normalizeSmsAudienceFilter({ tags: ['tag-id'], padding: 'x'.repeat(512 * 1024) })
		).toThrow('SMS_AUDIENCE_FILTER_TOO_LARGE');
	});
});
