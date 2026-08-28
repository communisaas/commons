import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, mockPacket } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockPacket: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: vi.fn()
}));

vi.mock('$lib/convex', () => ({
	api: {
		campaigns: {
			getForOrgPage: 'campaigns.getForOrgPage'
		}
	}
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: { ANALYTICS_EXPANDED: false }
}));

vi.mock('$lib/server/verification-packet', () => ({
	loadCampaignReadModelBundleCached: mockPacket
}));

import { load } from '../../../src/routes/org/[slug]/campaigns/[id]/+page.server';

function campaignResult() {
	return {
		campaign: {
			_id: 'campaign_1',
			title: 'Campaign',
			type: 'LETTER',
			status: 'DRAFT',
			body: null,
			templateId: 'template_selected',
			templateTitle: 'Selected template',
			debateEnabled: false,
			debateThreshold: 50,
			debateId: null,
			targets: null,
			targetCountry: 'US',
			targetJurisdiction: null,
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_000_001
		},
		templates: [{ _id: 'template_selected', title: 'Selected template' }],
		templatePagination: {
			isDone: false,
			continueCursor: 'next/cursor==',
			pageStatus: null
		},
		debate: null,
		actionCount: null,
		memberRole: 'editor'
	};
}

describe('campaign detail template pagination', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockPacket.mockReset();
	});

	it('passes the cursor to the bounded query and publishes explicit navigation', async () => {
		mockServerQuery.mockResolvedValue(campaignResult());

		const result = (await load({
			params: { slug: 'test-org', id: 'campaign_1' },
			url: new URL(
				'https://commons.email/org/test-org/campaigns/campaign_1?view=edit&templateCursor=current%2Fcursor%3D%3D'
			),
			parent: async () => ({
				org: { id: 'org_1', slug: 'test-org' },
				membership: { role: 'editor' }
			}),
			platform: undefined
		} as never)) as Exclude<Awaited<ReturnType<typeof load>>, void>;

		expect(mockServerQuery).toHaveBeenCalledWith('campaigns.getForOrgPage', {
			slug: 'test-org',
			campaignId: 'campaign_1',
			templatePaginationOpts: { numItems: 50, cursor: 'current/cursor==' }
		});
		expect(result.templatePagination).toEqual({
			isFirstPage: false,
			isDone: false,
			firstPageUrl: '/org/test-org/campaigns/campaign_1?view=edit',
			nextPageUrl:
				'/org/test-org/campaigns/campaign_1?view=edit&templateCursor=next%2Fcursor%3D%3D'
		});
		expect(result.templates).toEqual([{ id: 'template_selected', title: 'Selected template' }]);
	});
});
