import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverQuery } from 'convex-sveltekit';
import { countSmsAudience } from '$lib/server/sms/audience';

vi.mock('convex-sveltekit', () => ({ serverQuery: vi.fn() }));

const queryMock = vi.mocked(serverQuery);

beforeEach(() => {
	queryMock.mockReset();
});

describe('bounded SMS audience orchestration', () => {
	it('uses the exact write-maintained scalar in one query for an unfiltered 10k audience', async () => {
		queryMock.mockResolvedValueOnce({
			pageCount: 10_000,
			continueCursor: null,
			isDone: true,
			scannedCount: 0,
			batchLimit: 100,
			source: 'organizations.supporterStats.smsDispatchEligible'
		});

		await expect(countSmsAudience('exact-org')).resolves.toEqual({
			eligibleCount: 10_000,
			batchLimit: 100,
			hasMoreThanBatchLimit: true,
			source: 'organizations.supporterStats.smsDispatchEligible'
		});
		expect(queryMock).toHaveBeenCalledTimes(1);
	});

	it('carries a cursor through 100 sparse pages without rebuilding a prior page', async () => {
		queryMock.mockImplementation(async (_query, args) => {
			const cursor = (args as { cursor: string | null }).cursor;
			const pageIndex = cursor === null ? 0 : Number(cursor.slice('cursor-'.length));
			const isDone = pageIndex === 99;
			return {
				pageCount: pageIndex % 10 === 9 ? 1 : 0,
				continueCursor: isDone ? null : `cursor-${pageIndex + 1}`,
				isDone,
				scannedCount: 100,
				batchLimit: 100,
				source: 'sms.pageSmsRecipients'
			};
		});

		await expect(
			countSmsAudience('sparse-org', { tags: ['tag-id' as never] })
		).resolves.toMatchObject({ eligibleCount: 10 });
		expect(queryMock).toHaveBeenCalledTimes(100);
		const cursors = queryMock.mock.calls.map(([, args]) => (args as { cursor: string | null }).cursor);
		expect(cursors[0]).toBeNull();
		expect(new Set(cursors).size).toBe(100);
		expect(cursors[99]).toBe('cursor-99');
	});

	it('fails closed instead of truncating an audience above the 10k envelope', async () => {
		queryMock.mockResolvedValueOnce({
			pageCount: 10_001,
			continueCursor: null,
			isDone: true,
			scannedCount: 0,
			batchLimit: 100,
			source: 'organizations.supporterStats.smsDispatchEligible'
		});
		await expect(countSmsAudience('too-large')).rejects.toThrow(
			'SMS_AUDIENCE_COHORT_TOO_LARGE'
		);
	});

	it('rejects a non-advancing cursor', async () => {
		queryMock.mockResolvedValueOnce({
			pageCount: 0,
			continueCursor: 'same',
			isDone: false,
			scannedCount: 100,
			batchLimit: 100,
			source: 'sms.pageSmsRecipients'
		});
		queryMock.mockResolvedValueOnce({
			pageCount: 0,
			continueCursor: 'same',
			isDone: false,
			scannedCount: 100,
			batchLimit: 100,
			source: 'sms.pageSmsRecipients'
		});
		await expect(countSmsAudience('stuck')).rejects.toThrow(
			'SMS_AUDIENCE_CURSOR_DID_NOT_ADVANCE'
		);
	});
});
