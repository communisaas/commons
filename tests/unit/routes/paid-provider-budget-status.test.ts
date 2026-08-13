import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetUserContext, mockReadStatus } = vi.hoisted(() => ({
	mockGetUserContext: vi.fn(),
	mockReadStatus: vi.fn()
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	getUserContext: mockGetUserContext
}));

vi.mock('$lib/server/paid-provider-budget-client', () => ({
	readPaidProviderBudgetStatus: mockReadStatus
}));

import { GET } from '../../../src/routes/api/admin/paid-provider-budget/+server';

function event() {
	return {
		locals: {},
		platform: { env: {} },
		request: new Request('https://commons.email/api/admin/paid-provider-budget')
	} as never;
}

describe('/api/admin/paid-provider-budget', () => {
	beforeEach(() => {
		mockGetUserContext.mockReset();
		mockReadStatus.mockReset();
	});

	it('returns only the authenticated enrolled operator current read-only budget view', async () => {
		mockGetUserContext.mockReturnValue({
			isAuthenticated: true,
			providerTier: 'operator',
			userId: 'launch-operator'
		});
		mockReadStatus.mockResolvedValue({
			schema: 1,
			realm: 'production',
			global: { daily: { used: 400, remaining: 600 } },
			operatorReserve: { daily: { used: 100, protectedRemaining: 150 } }
		});

		const response = await GET(event());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('cdn-cache-control')).toBe('no-store');
		await expect(response.json()).resolves.toMatchObject({
			schema: 1,
			global: { daily: { used: 400, remaining: 600 } }
		});
		expect(mockReadStatus).toHaveBeenCalledWith({
			event: expect.anything(),
			identifier: 'launch-operator'
		});
	});

	it.each([
		[
			'unauthenticated',
			{ isAuthenticated: false, providerTier: 'authenticated', userId: null },
			401
		],
		[
			'ordinary authenticated',
			{ isAuthenticated: true, providerTier: 'verified', userId: 'ordinary-user' },
			403
		]
	] as const)('rejects %s callers before touching the Durable Object', async (_label, context, code) => {
		mockGetUserContext.mockReturnValue(context);

		const response = await GET(event());

		expect(response.status).toBe(code);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(mockReadStatus).not.toHaveBeenCalled();
	});

	it('fails closed when the private status protocol is unavailable', async () => {
		mockGetUserContext.mockReturnValue({
			isAuthenticated: true,
			providerTier: 'operator',
			userId: 'launch-operator'
		});
		mockReadStatus.mockResolvedValue(null);

		const response = await GET(event());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: 'Paid-provider budget status unavailable'
		});
	});
});
