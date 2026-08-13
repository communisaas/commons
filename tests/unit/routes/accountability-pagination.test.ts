import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockServerQuery } = vi.hoisted(() => ({
	api: {
		legislation: {
			exportScorecards: 'legislation.exportScorecards',
			exportReceiptsByOrg: 'legislation.exportReceiptsByOrg',
			listMyReceipts: 'legislation.listMyReceipts'
		}
	},
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/config/features', () => ({ FEATURES: { LEGISLATION: true } }));

import { GET as exportScorecards } from '../../../src/routes/api/org/[slug]/scorecards/export/+server';
import { GET as exportReceipts } from '../../../src/routes/api/org/[slug]/dm/receipts/export.csv/+server';
import { load as loadProfileReceipts } from '../../../src/routes/profile/receipts/+page.server';

describe('accountability cursor/export routes', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
	});

	it('exports one scorecard page and publishes the only valid continuation cursor', async () => {
		mockServerQuery.mockResolvedValue({
			scorecards: [
				{
					name: '=FORMULA()',
					title: 'Representative',
					district: 'CA-01',
					reportsReceived: 10,
					reportsOpened: 5,
					verifyLinksClicked: 2,
					repliesLogged: 1,
					relevantVotes: 3,
					alignedVotes: 2,
					alignmentRate: 0.5,
					avgResponseTime: 84,
					lastContactDate: '2026-07-19',
					score: 63
				}
			],
			meta: { nextCursor: 'next/score==', hasMore: true }
		});

		const response = await exportScorecards({
			params: { slug: 'example-org' },
			url: new URL('https://commons.test/api/org/example-org/scorecards/export?format=csv&cursor=old'),
			locals: { user: { id: 'user-1' } }
		} as never);

		expect(mockServerQuery).toHaveBeenCalledWith(api.legislation.exportScorecards, {
			slug: 'example-org',
			cursor: 'old',
			limit: 100
		});
		expect(response.headers.get('x-export-complete')).toBe('false');
		expect(response.headers.get('x-next-cursor')).toBe('next/score==');
		expect(response.headers.get('link')).toContain('cursor=next%2Fscore%3D%3D');
		expect(await response.text()).toContain("'=FORMULA()");
	});

	it('exports one receipt page through the dedicated bounded query', async () => {
		mockServerQuery.mockResolvedValue({
			items: [
				{
					id: 'receipt-1',
					decisionMakerId: 'dm-1',
					dmName: '@formula',
					billId: 'bill-1',
					attestationDigest: 'hash',
					verifiedCount: 5,
					totalCount: 5,
					districtCount: 3,
					alignment: 0.5,
					causalityClass: 'moderate',
					proofDeliveredAt: 1,
					proofVerifiedAt: null,
					anchorCid: null,
					anchorRoot: null
				}
			],
			nextCursor: 'next-receipt'
		});

		const response = await exportReceipts({
			params: { slug: 'example-org' },
			url: new URL(
				'https://commons.test/api/org/example-org/dm/receipts/export.csv?cursor=prior&limit=999'
			),
			locals: { user: { id: 'user-1' } }
		} as never);

		expect(mockServerQuery).toHaveBeenCalledWith(api.legislation.exportReceiptsByOrg, {
			slug: 'example-org',
			cursor: 'prior',
			limit: 100
		});
		expect(response.headers.get('x-next-cursor')).toBe('next-receipt');
		expect(await response.text()).toContain("'@formula");
	});

	it('forwards the opaque profile cursor without rereading prior receipts', async () => {
		mockServerQuery.mockResolvedValue({
			items: [],
			total: null,
			nextCursor: null
		});
		await loadProfileReceipts({
			url: new URL('https://commons.test/profile/receipts?cursor=profile%2Fpage%3D%3D'),
			locals: { user: { id: 'user-1' } }
		} as never);
		expect(mockServerQuery).toHaveBeenCalledWith(api.legislation.listMyReceipts, {
			cursor: 'profile/page==',
			limit: 20
		});
	});
});
