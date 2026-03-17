/**
 * Unit Tests: Campaign geographic targeting API
 * Tests PATCH /api/v1/campaigns/:id with targetJurisdiction + targetCountry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockAuthenticateApiKey,
	mockRequireScope,
	mockRequirePublicApi,
	mockCheckApiPlanRateLimit,
	mockDbCampaignFindFirst,
	mockDbCampaignFindMany,
	mockDbCampaignCount,
	mockDbCampaignCreate,
	mockDbCampaignUpdate,
	mockDbTemplateFindFirst
} = vi.hoisted(() => ({
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockRequirePublicApi: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockDbCampaignFindFirst: vi.fn(),
	mockDbCampaignFindMany: vi.fn(),
	mockDbCampaignCount: vi.fn(),
	mockDbCampaignCreate: vi.fn(),
	mockDbCampaignUpdate: vi.fn(),
	mockDbTemplateFindFirst: vi.fn()
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: { PUBLIC_API: true }
}));

vi.mock('$lib/core/db', () => ({
	db: {
		campaign: {
			findFirst: (...args: any[]) => mockDbCampaignFindFirst(...args),
			findMany: (...args: any[]) => mockDbCampaignFindMany(...args),
			count: (...args: any[]) => mockDbCampaignCount(...args),
			create: (...args: any[]) => mockDbCampaignCreate(...args),
			update: (...args: any[]) => mockDbCampaignUpdate(...args)
		},
		template: {
			findFirst: (...args: any[]) => mockDbTemplateFindFirst(...args)
		}
	}
}));

vi.mock('$lib/server/api-v1/auth', () => ({
	authenticateApiKey: (...args: any[]) => mockAuthenticateApiKey(...args),
	requireScope: (...args: any[]) => mockRequireScope(...args)
}));

vi.mock('$lib/server/api-v1/gate', () => ({
	requirePublicApi: (...args: any[]) => mockRequirePublicApi(...args)
}));

vi.mock('$lib/server/api-v1/rate-limit', () => ({
	checkApiPlanRateLimit: (...args: any[]) => mockCheckApiPlanRateLimit(...args)
}));

vi.mock('$lib/server/api-v1/response', () => ({
	apiOk: (data: unknown, meta?: unknown, status = 200) =>
		new Response(JSON.stringify({ data, meta }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		}),
	apiError: (code: string, message: string, status: number) =>
		new Response(JSON.stringify({ error: { code, message } }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		}),
	parsePagination: (url: URL) => ({
		cursor: url.searchParams.get('cursor') || null,
		limit: parseInt(url.searchParams.get('limit') || '50', 10)
	})
}));

vi.mock('$lib/server/geographic/types', async () => {
	const actual = await vi.importActual('$lib/server/geographic/types');
	return actual;
});

vi.mock('@sveltejs/kit', () => ({
	json: (data: unknown, init?: { status?: number }) =>
		new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: { 'Content-Type': 'application/json' }
		}),
	error: (status: number, message: string) => {
		const e = new Error(message);
		(e as any).status = status;
		throw e;
	}
}));

const defaultAuth = { orgId: 'org-1', keyId: 'key-1', scopes: ['write'], planSlug: 'organization' };

function makeCampaign(overrides: Record<string, unknown> = {}) {
	return {
		id: 'camp-1',
		orgId: 'org-1',
		type: 'LETTER',
		title: 'Test Campaign',
		body: null,
		status: 'DRAFT',
		templateId: null,
		debateEnabled: false,
		debateThreshold: 50,
		targetJurisdiction: null,
		targetCountry: 'US',
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		_count: { actions: 0, deliveries: 0 },
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
	mockRequireScope.mockReturnValue(null);
	mockRequirePublicApi.mockReturnValue(undefined);
	mockCheckApiPlanRateLimit.mockResolvedValue(null);
});

// =============================================================================
// PATCH /api/v1/campaigns/:id — targeting fields
// =============================================================================

describe('PATCH /api/v1/campaigns/:id — geographic targeting', () => {
	it('updates targetJurisdiction and targetCountry', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(makeCampaign());
		mockDbCampaignUpdate.mockResolvedValue(makeCampaign({
			targetJurisdiction: 'uk-constituency',
			targetCountry: 'GB',
			updatedAt: new Date('2026-03-12T11:00:00Z')
		}));

		const { PATCH } = await import('../../../src/routes/api/v1/campaigns/[id]/+server');
		const response = await PATCH({
			request: new Request('http://localhost', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({ targetJurisdiction: 'uk-constituency', targetCountry: 'GB' })
			}),
			params: { id: 'camp-1' },
			url: new URL('http://localhost/api/v1/campaigns/camp-1')
		} as any);

		expect(response.status).toBe(200);
		expect(mockDbCampaignUpdate).toHaveBeenCalledWith({
			where: { id: 'camp-1' },
			data: expect.objectContaining({
				targetJurisdiction: 'uk-constituency',
				targetCountry: 'GB'
			})
		});
	});

	it('rejects invalid jurisdiction type', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(makeCampaign());

		const { PATCH } = await import('../../../src/routes/api/v1/campaigns/[id]/+server');
		const response = await PATCH({
			request: new Request('http://localhost', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({ targetJurisdiction: 'invalid-jurisdiction' })
			}),
			params: { id: 'camp-1' },
			url: new URL('http://localhost/api/v1/campaigns/camp-1')
		} as any);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.message).toContain('Invalid jurisdiction');
	});

	it('rejects invalid country code', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(makeCampaign());

		const { PATCH } = await import('../../../src/routes/api/v1/campaigns/[id]/+server');
		const response = await PATCH({
			request: new Request('http://localhost', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({ targetCountry: 'XX' })
			}),
			params: { id: 'camp-1' },
			url: new URL('http://localhost/api/v1/campaigns/camp-1')
		} as any);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.message).toContain('Invalid country code');
	});

	it('allows setting targetJurisdiction to null', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(makeCampaign({ targetJurisdiction: 'uk-constituency' }));
		mockDbCampaignUpdate.mockResolvedValue(makeCampaign({ updatedAt: new Date() }));

		const { PATCH } = await import('../../../src/routes/api/v1/campaigns/[id]/+server');
		const response = await PATCH({
			request: new Request('http://localhost', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({ targetJurisdiction: null })
			}),
			params: { id: 'camp-1' },
			url: new URL('http://localhost/api/v1/campaigns/camp-1')
		} as any);

		expect(response.status).toBe(200);
		expect(mockDbCampaignUpdate).toHaveBeenCalledWith({
			where: { id: 'camp-1' },
			data: expect.objectContaining({ targetJurisdiction: null })
		});
	});
});

// =============================================================================
// POST /api/v1/campaigns — with targeting
// =============================================================================

describe('POST /api/v1/campaigns — with geographic targeting', () => {
	it('creates campaign with targetJurisdiction and targetCountry', async () => {
		mockDbCampaignCreate.mockResolvedValue(makeCampaign({
			targetJurisdiction: 'ca-riding',
			targetCountry: 'CA'
		}));

		const { POST } = await import('../../../src/routes/api/v1/campaigns/+server');
		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({
					title: 'Canada Campaign',
					type: 'LETTER',
					targetJurisdiction: 'ca-riding',
					targetCountry: 'CA'
				})
			}),
			url: new URL('http://localhost/api/v1/campaigns')
		} as any);

		expect(response.status).toBe(201);
		const body = await response.json();
		expect(body.data.targetJurisdiction).toBe('ca-riding');
		expect(body.data.targetCountry).toBe('CA');
	});

	it('defaults to US when targetCountry not specified', async () => {
		mockDbCampaignCreate.mockResolvedValue(makeCampaign());

		const { POST } = await import('../../../src/routes/api/v1/campaigns/+server');
		await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
				body: JSON.stringify({ title: 'US Campaign', type: 'LETTER' })
			}),
			url: new URL('http://localhost/api/v1/campaigns')
		} as any);

		expect(mockDbCampaignCreate).toHaveBeenCalledWith({
			data: expect.objectContaining({
				targetJurisdiction: null,
				targetCountry: 'US'
			})
		});
	});
});

// =============================================================================
// GET /api/v1/campaigns — includes targeting fields
// =============================================================================

describe('GET /api/v1/campaigns — targeting fields in response', () => {
	it('includes targetJurisdiction and targetCountry in list response', async () => {
		mockDbCampaignFindMany.mockResolvedValue([
			makeCampaign({ targetJurisdiction: 'au-electorate', targetCountry: 'AU' })
		]);
		mockDbCampaignCount.mockResolvedValue(1);

		const { GET } = await import('../../../src/routes/api/v1/campaigns/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/campaigns')
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data[0].targetJurisdiction).toBe('au-electorate');
		expect(body.data[0].targetCountry).toBe('AU');
	});
});
