import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '$convex/_generated/dataModel';
import type { CampaignReadModelBundle } from '$lib/server/campaign-read-model';

const mocks = vi.hoisted(() => ({
	serverQuery: vi.fn(),
	materialize: vi.fn((state: unknown) => state),
	getInternalSecret: vi.fn(() => 'test-internal-secret')
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mocks.serverQuery }));
vi.mock('$lib/convex', () => ({
	api: { campaigns: { getReadModelBundle: 'campaigns:getReadModelBundle' } },
	getRuntimeConvexUrl: () => 'https://default-convex.example'
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mocks.getInternalSecret
}));
vi.mock('$lib/server/campaign-read-model', () => ({
	materializeCampaignReadModel: mocks.materialize
}));

import { loadCampaignReadModelBundleCached } from '$lib/server/verification-packet';

const NOW = 1_800_000_000_000;

function bundle(revision: number): CampaignReadModelBundle {
	return {
		revision,
		updatedAt: NOW + revision,
		packet: { total: revision } as CampaignReadModelBundle['packet'],
		analytics: { delivery: { sent: revision } } as CampaignReadModelBundle['analytics'],
		suppression: {
			districts: 0,
			districtActions: 0,
			cells: 0,
			cellActions: 0,
			hours: 0
		}
	};
}

function source(value: CampaignReadModelBundle) {
	return { state: value, debate: null };
}

function context(origin: string, backend?: string) {
	return {
		url: new URL(`${origin}/org/test/campaigns/test`),
		...(backend
			? { platform: { env: { PUBLIC_CONVEX_URL: backend } } as unknown as App.Platform }
			: {})
	};
}

function installEdgeCache() {
	const entries = new Map<string, string>();
	const match = vi.fn(async (request: Request) => {
		const value = entries.get(request.url);
		return value === undefined ? undefined : new Response(value);
	});
	const put = vi.fn(async (request: Request, response: Response) => {
		entries.set(request.url, await response.text());
	});
	vi.stubGlobal('caches', { default: { match, put } });
	return { entries, match, put };
}

describe('private campaign read-model cache', () => {
	beforeEach(() => {
		mocks.serverQuery.mockReset();
		mocks.materialize.mockClear();
		mocks.getInternalSecret.mockClear();
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		vi.stubGlobal('caches', undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('singleflights concurrent misses and reuses the fresh in-isolate value', async () => {
		const expected = bundle(1);
		mocks.serverQuery.mockResolvedValue(source(expected));
		const campaignId = 'campaign-cache-singleflight' as Id<'campaigns'>;
		const orgId = 'org-cache-singleflight' as Id<'organizations'>;
		const cacheContext = context('https://singleflight.example');

		const [first, second] = await Promise.all([
			loadCampaignReadModelBundleCached(campaignId, orgId, cacheContext),
			loadCampaignReadModelBundleCached(campaignId, orgId, cacheContext)
		]);
		const third = await loadCampaignReadModelBundleCached(campaignId, orgId, cacheContext);

		expect(first).toBe(expected);
		expect(second).toBe(expected);
		expect(third).toBe(expected);
		expect(mocks.serverQuery).toHaveBeenCalledOnce();
		expect(mocks.getInternalSecret).toHaveBeenCalledOnce();
	});

	it('hard-refreshes after 30 seconds even if an edge entry outlives its header', async () => {
		const edge = installEdgeCache();
		mocks.serverQuery
			.mockResolvedValueOnce(source(bundle(1)))
			.mockResolvedValueOnce(source(bundle(2)));
		const campaignId = 'campaign-cache-expiry' as Id<'campaigns'>;
		const orgId = 'org-cache-expiry' as Id<'organizations'>;
		const cacheContext = context('https://expiry.example');

		await expect(
			loadCampaignReadModelBundleCached(campaignId, orgId, cacheContext)
		).resolves.toMatchObject({ revision: 1 });
		expect(edge.put).toHaveBeenCalledOnce();
		expect(edge.entries.size).toBe(1);

		vi.mocked(Date.now).mockReturnValue(NOW + 30_001);
		await expect(
			loadCampaignReadModelBundleCached(campaignId, orgId, cacheContext)
		).resolves.toMatchObject({ revision: 2 });
		expect(edge.match).toHaveBeenCalledTimes(2);
		expect(mocks.serverQuery).toHaveBeenCalledTimes(2);
	});

	it('isolates cache entries by origin, Convex backend, organization, and campaign', async () => {
		mocks.serverQuery
			.mockResolvedValueOnce(source(bundle(1)))
			.mockResolvedValueOnce(source(bundle(2)))
			.mockResolvedValueOnce(source(bundle(3)));
		const campaignId = 'campaign-cache-identity' as Id<'campaigns'>;
		const orgA = 'org-cache-a' as Id<'organizations'>;
		const orgB = 'org-cache-b' as Id<'organizations'>;

		await loadCampaignReadModelBundleCached(
			campaignId,
			orgA,
			context('https://tenant.example', 'https://backend-a.example')
		);
		await loadCampaignReadModelBundleCached(
			campaignId,
			orgB,
			context('https://tenant.example', 'https://backend-a.example')
		);
		await loadCampaignReadModelBundleCached(
			campaignId,
			orgA,
			context('https://tenant.example', 'https://backend-b.example')
		);

		expect(mocks.serverQuery).toHaveBeenCalledTimes(3);
		expect(mocks.serverQuery.mock.calls.map(([, args]) => args.orgId)).toEqual([orgA, orgB, orgA]);
	});
});
