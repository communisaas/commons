/**
 * GET /api/embed/scorecard/[id] — D-10 white-label de-brand.
 *
 * The scorecard embed is a shared (DM-scoped) outbound surface, so white-label
 * is opt-in per embed via `?org=<slug>`. These tests pin:
 *   - default (no org / non-white-label org) → "powered by Commons" present;
 *   - white-label org named via ?org= → the Commons attribution is dropped.
 *
 * The /dm/[id]/scorecard PAGE and /v/[hash] verification page are separate
 * surfaces and are NOT touched by this flag (asserted elsewhere).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockServerQuery } = vi.hoisted(() => ({
	mockServerQuery: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({
	api: {
		legislation: { getDmScorecard: 'legislation.getDmScorecard' },
		organizations: { getPublicBrandingBySlug: 'organizations.getPublicBrandingBySlug' }
	}
}));

import { GET } from '../../../src/routes/api/embed/scorecard/[id]/+server';

const scorecardResult = {
	canonicalSlug: 'jane-doe',
	decisionMaker: {
		_id: 'dm1',
		name: 'Jane Doe',
		title: 'Senator',
		party: 'Independent',
		district: 'District 5'
	},
	current: {
		composite: 77,
		responsiveness: 72,
		alignment: 80,
		period: { start: Date.parse('2026-03-01'), end: Date.parse('2026-03-31') }
	}
};

function buildEvent(searchParams: Record<string, string> = {}) {
	const url = new URL('http://localhost/api/embed/scorecard/dm1');
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
	return { params: { id: 'dm1' }, url } as never;
}

describe('GET /api/embed/scorecard/[id] — white-label', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('default (no ?org=) includes poweredBy: Commons', async () => {
		mockServerQuery.mockResolvedValueOnce(scorecardResult);
		const res = await GET(buildEvent());
		const body = await res.json();
		expect(body.poweredBy).toBe('Commons');
		expect(mockServerQuery).toHaveBeenCalledTimes(1); // no branding lookup
	});

	it('non-white-label org keeps poweredBy: Commons', async () => {
		mockServerQuery
			.mockResolvedValueOnce(scorecardResult)
			.mockResolvedValueOnce({ name: 'Org', brandingAccent: null, logoUrl: null, whiteLabel: false });
		const res = await GET(buildEvent({ org: 'some-org' }));
		const body = await res.json();
		expect(body.poweredBy).toBe('Commons');
	});

	it('white-label org named via ?org= DROPS poweredBy', async () => {
		mockServerQuery
			.mockResolvedValueOnce(scorecardResult)
			.mockResolvedValueOnce({
				name: 'Coalition',
				brandingAccent: '#ff5500',
				logoUrl: 'https://x/logo.png',
				whiteLabel: true
			});
		const res = await GET(buildEvent({ org: 'coalition-org' }));
		const body = await res.json();
		expect('poweredBy' in body).toBe(false);
		// The scorecard data itself is still served.
		expect(body.decisionMaker.name).toBe('Jane Doe');
		expect(body.composite).toBe(77);
	});

	it('branding-lookup failure falls back to Commons attribution (fail-safe)', async () => {
		mockServerQuery
			.mockResolvedValueOnce(scorecardResult)
			.mockRejectedValueOnce(new Error('convex down'));
		const res = await GET(buildEvent({ org: 'coalition-org' }));
		const body = await res.json();
		expect(body.poweredBy).toBe('Commons');
	});
});
