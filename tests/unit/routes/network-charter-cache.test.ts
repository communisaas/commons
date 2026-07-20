import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: { networks: { getPublicCharter: 'networks.getPublicCharter' } }
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/config/features', () => ({ FEATURES: { NETWORKS: true } }));

import { load } from '../../../src/routes/n/[slug]/+page.server';

const charter = {
	_id: 'network_1',
	name: 'Public coalition',
	slug: 'public-coalition',
	applicableCountries: ['US'],
	mission: 'Build public proof.',
	principles: [],
	charterText: null,
	charterPublishedAt: 1_800_000_000_000,
	charterHash: 'a'.repeat(64),
	ownerOrg: { name: 'Owner', slug: 'owner' },
	founders: []
};

function loadEvent(user: unknown, setHeaders: ReturnType<typeof vi.fn>) {
	return {
		params: { slug: charter.slug },
		locals: { user },
		setHeaders
	} as never;
}

describe('immutable network charter cache boundary', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockServerQuery.mockResolvedValue(charter);
	});

	it('places only anonymous immutable charter responses in the shared cache', async () => {
		const setHeaders = vi.fn();
		const result = await load(loadEvent(null, setHeaders));

		expect(mockServerQuery).toHaveBeenCalledWith(api.networks.getPublicCharter, {
			_secret: expect.any(String),
			slug: charter.slug
		});
		expect(setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'public, max-age=300, s-maxage=31536000, stale-if-error=604800'
		});
		expect(result).toEqual({ network: charter });
	});

	it('never shares a response whose root layout may contain user data', async () => {
		const setHeaders = vi.fn();
		await load(loadEvent({ id: 'user_1' }, setHeaders));

		expect(setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'private, no-store, max-age=0'
		});
	});
});
