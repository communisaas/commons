import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: {
		observability: {
			servicePing: 'observability.servicePing'
		}
	}
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));

import { GET } from '../../../src/routes/api/health/+server';

const HEALTH_ENV = {
	ATLAS_BASE_URL: 'https://atlas.commons.email',
	EXPECTED_CELL_MAP_ROOT: `0x${'a'.repeat(64)}`,
	EXPECTED_CELL_MAP_DEPTH: '20'
};

function event() {
	return { platform: { env: HEALTH_ENV } } as never;
}

describe('/api/health', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
	});

	it('uses the zero-read Convex service ping and reports a healthy dependency set', async () => {
		mockServerQuery.mockResolvedValue({ ok: true });

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(mockServerQuery).toHaveBeenCalledOnce();
		expect(mockServerQuery).toHaveBeenCalledWith(api.observability.servicePing, {});
		expect(body).toMatchObject({ status: 'ok', convex: true, atlas: { status: 'ok' } });
	});

	it('returns 503 when the Convex deployment is disabled', async () => {
		mockServerQuery.mockRejectedValue(new Error('deployment disabled'));

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});
});
