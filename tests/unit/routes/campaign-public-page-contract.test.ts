import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockGetInternalSecret, mockServerAction, mockServerQuery } = vi.hoisted(() => ({
	api: {
		campaigns: {
			getPublicAny: 'campaigns.getPublicAny',
			submitAction: 'campaigns.submitAction'
		}
	},
	mockGetInternalSecret: vi.fn(() => 'campaign-page-test-secret'),
	mockServerAction: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	serverQuery: mockServerQuery,
	serverAction: mockServerAction
}));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));
vi.mock('$env/dynamic/private', () => ({
	env: { PUBLIC_BASE_URL: 'https://example.test' }
}));

import { load } from '../../../src/routes/c/[slug]/+page.server';

const CAMPAIGN_ID = 'campaign_abc123';

/** A stored target as it actually lives in Convex — a recipient dossier. */
function storedTarget() {
	return {
		name: 'Council Office',
		email: 'clerk@city.example',
		title: 'Clerk',
		district: 'X',
		decisionMakerId: 'dm_1'
	};
}

function publicCampaign(overrides: Record<string, unknown> = {}) {
	return {
		_id: CAMPAIGN_ID,
		title: 'Fund the library',
		type: 'LETTER',
		status: 'ACTIVE',
		body: 'Please fund the library.',
		orgName: 'Neighbors United',
		orgSlug: 'neighbors-united',
		orgAvatar: 'https://cdn.example.test/a.png',
		verifiedActionCount: 42,
		targets: [storedTarget()],
		...overrides
	};
}

async function runLoad() {
	return (await load({
		params: { slug: CAMPAIGN_ID }
	} as never)) as {
		campaign: {
			id: string;
			orgAvatar: string | null;
			targets: { name: string; title: string | null }[] | null;
		};
		stats: { verifiedActions: number; uniqueDistricts: number | null };
		baseUrl: string;
	};
}

function campaignPageSource(): string {
	return readFileSync(resolve(process.cwd(), 'src/routes/c/[slug]/+page.svelte'), 'utf8');
}

describe('public campaign page load contract', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockServerAction.mockReset();
	});

	it('returns the stats and branding the component renders', async () => {
		mockServerQuery.mockResolvedValue(publicCampaign());

		const result = await runLoad();

		expect(result.stats.verifiedActions).toBe(42);
		expect('uniqueDistricts' in result.stats).toBe(true);
		expect(result.campaign.orgAvatar).toBe('https://cdn.example.test/a.png');
	});

	it('never leaks recipient contact detail into the public payload', async () => {
		mockServerQuery.mockResolvedValue(publicCampaign());

		const result = await runLoad();
		const serialized = JSON.stringify(result);

		expect(serialized).not.toContain('@');
		expect(serialized).not.toContain('clerk@city.example');
		expect(serialized).not.toContain('decisionMakerId');
		expect(serialized).not.toContain('district');
		expect(Object.keys(result.campaign.targets![0]).sort()).toEqual(['name', 'title']);
	});

	it('coerces the sub-K-floor null count to zero', async () => {
		mockServerQuery.mockResolvedValue(publicCampaign({ verifiedActionCount: null }));

		const result = await runLoad();

		expect(result.stats.verifiedActions).toBe(0);
	});

	it('issues exactly one Convex query and never reaches for getStats', async () => {
		mockServerQuery.mockResolvedValue(publicCampaign());

		await runLoad();

		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery.mock.calls[0][0]).toBe(api.campaigns.getPublicAny);
	});

	it('keeps the component bound to fields the loader actually returns', async () => {
		mockServerQuery.mockResolvedValue(publicCampaign());

		const result = await runLoad();
		const source = campaignPageSource();

		const roots = new Set<string>();
		for (const match of source.matchAll(/\bdata\.([A-Za-z_$][\w$]*)/g)) {
			roots.add(match[1]);
		}
		expect(roots.size).toBeGreaterThan(0);
		for (const root of roots) {
			expect(Object.keys(result)).toContain(root);
		}

		const campaignFields = new Set<string>();
		for (const match of source.matchAll(/\bdata\.campaign\.([A-Za-z_$][\w$]*)/g)) {
			campaignFields.add(match[1]);
		}
		expect(campaignFields.size).toBeGreaterThan(0);
		for (const field of campaignFields) {
			expect(Object.keys(result.campaign)).toContain(field);
		}

		expect(source).not.toContain('debateSignal');
		expect(source).not.toContain('type ViewData');
		expect(source).not.toContain('DebateMarketCard');
	});
});
