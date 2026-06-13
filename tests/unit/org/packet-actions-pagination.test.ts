/**
 * fetchAllPacketActions walks every page of the paginated
 * `campaigns.getActionsForPacket` query and concatenates them — so packet /
 * analytics computation gets the FULL action set without the per-query
 * `.collect()` scan-cliff and without dropping any row across a page boundary.
 *
 * The Convex query is now cursor-paginated (sub-class A must-enumerate); this
 * mocks `serverQuery` to page a fixture larger than one page and pins that the
 * loop resumes from `continueCursor` until `isDone` and returns the whole set.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: { campaigns: { getActionsForPacket: 'campaigns.getActionsForPacket' } }
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));

import { fetchAllPacketActions, type PacketAction } from '../../../src/lib/server/packet-actions';

type Id = Parameters<typeof fetchAllPacketActions>[0];
const CAMPAIGN = 'campaign_1' as unknown as Id;

function action(i: number): PacketAction {
	return {
		verified: i % 2 === 0,
		engagementTier: 0,
		districtHash: `d${i % 7}`,
		h3Cell: null,
		messageHash: null,
		sentAt: 1_700_000_000_000 + i,
		trustTier: null,
		compositionMode: null,
		atlasVersion: null
	};
}

/**
 * Wire the mock to page `total` actions in chunks of `pageSize`, honoring the
 * cursor (encoded as the absolute start index). `isDone` on the final page.
 */
function pageFixture(total: number, pageSize: number) {
	const rows = Array.from({ length: total }, (_, i) => action(i));
	mockServerQuery.mockImplementation(
		async (_ref: unknown, args: { cursor: string | null; numItems: number }) => {
			const start = args.cursor ? Number(args.cursor) : 0;
			// The loop requests numItems=4000; clamp the fixture page to pageSize so
			// the test can force multiple pages regardless of the requested size.
			const end = Math.min(start + pageSize, total);
			const page = rows.slice(start, end);
			const isDone = end >= total;
			return { actions: page, continueCursor: isDone ? null : String(end), isDone };
		}
	);
	return rows;
}

describe('fetchAllPacketActions (cursor loop over paginated query)', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
	});

	it('concatenates every page in order — nothing dropped across boundaries', async () => {
		pageFixture(2350, 1000); // 3 pages: 1000 + 1000 + 350
		const all = await fetchAllPacketActions(CAMPAIGN);
		expect(all).toHaveLength(2350);
		expect(all[0].sentAt).toBe(1_700_000_000_000);
		expect(all[2349].sentAt).toBe(1_700_000_000_000 + 2349);
		// Exactly 3 query roundtrips (page boundaries respected).
		expect(mockServerQuery).toHaveBeenCalledTimes(3);
		// Second call resumed from the first page's continueCursor ('1000').
		expect(mockServerQuery.mock.calls[1][1]).toMatchObject({ cursor: '1000' });
	});

	it('a single-page campaign makes exactly one roundtrip', async () => {
		pageFixture(120, 1000);
		const all = await fetchAllPacketActions(CAMPAIGN);
		expect(all).toHaveLength(120);
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery.mock.calls[0][1]).toMatchObject({ cursor: null });
	});

	it('an empty campaign returns no actions in one roundtrip', async () => {
		pageFixture(0, 1000);
		const all = await fetchAllPacketActions(CAMPAIGN);
		expect(all).toHaveLength(0);
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
	});

	it('stops on isDone even if continueCursor is non-null (defensive)', async () => {
		// Final page reports isDone=true; the loop must not request another page.
		mockServerQuery.mockResolvedValueOnce({
			actions: [action(0), action(1)],
			continueCursor: '2',
			isDone: true
		});
		const all = await fetchAllPacketActions(CAMPAIGN);
		expect(all).toHaveLength(2);
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
	});
});
