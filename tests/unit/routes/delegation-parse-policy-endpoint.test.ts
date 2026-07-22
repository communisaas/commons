import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnforceLLMRateLimit, mockParsePolicy } = vi.hoisted(() => ({
	mockEnforceLLMRateLimit: vi.fn(),
	mockParsePolicy: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: { DELEGATION: true } }));
vi.mock('$lib/server/delegation/parse-policy', () => ({
	parsePolicy: (...args: unknown[]) => mockParsePolicy(...args)
}));
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: (...args: unknown[]) => mockEnforceLLMRateLimit(...args),
	rateLimitResponse: () => new Response('rate limited', { status: 429 })
}));

import { POST } from '../../../src/routes/api/delegation/parse-policy/+server';

function event(policyText: unknown, trustTier = 3) {
	return {
		request: new Request('https://commons.email/api/delegation/parse-policy', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ policyText })
		}),
		locals: {
			session: { userId: 'user_1' },
			user: { id: 'user_1', trust_tier: trustTier }
		}
	} as never;
}

describe('POST /api/delegation/parse-policy provider boundary', () => {
	beforeEach(() => {
		mockEnforceLLMRateLimit.mockReset();
		mockParsePolicy.mockReset();
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true });
		mockParsePolicy.mockResolvedValue({ maxActionsPerDay: 2, scope: 'district' });
	});

	it('bounds and validates input before reserving provider capacity', async () => {
		await expect(POST(event('x'.repeat(5_001)))).rejects.toMatchObject({ status: 400 });
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockParsePolicy).not.toHaveBeenCalled();
	});

	it('requires trust tier 3 before reading or reserving provider work', async () => {
		const candidate = event('Only environmental actions', 2) as unknown as {
			request: Request;
		};
		const textSpy = vi.spyOn(candidate.request, 'text');

		await expect(POST(candidate as never)).rejects.toMatchObject({ status: 403 });
		expect(textSpy).not.toHaveBeenCalled();
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
	});

	it('reserves the reviewed operation immediately before the Gemini parser', async () => {
		const candidate = event('Only environmental actions in my district');
		const response = await POST(candidate);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			policy: { maxActionsPerDay: 2, scope: 'district' }
		});
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(candidate, 'delegation-policy');
		expect(mockEnforceLLMRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
			mockParsePolicy.mock.invocationCallOrder[0]
		);
	});

	it('accepts policy text inside the shipped delegation allowance', async () => {
		const policyText = 'x'.repeat(4_500);
		const candidate = event(policyText);

		const response = await POST(candidate);

		expect(response.status).toBe(200);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(candidate, 'delegation-policy');
		expect(mockParsePolicy).toHaveBeenCalledWith(policyText);
	});

	it('accepts multibyte policy text inside the shipped delegation allowance', async () => {
		const policyText = '\u5b89'.repeat(3_000);
		const candidate = event(policyText);

		const response = await POST(candidate);

		expect(response.status).toBe(200);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(candidate, 'delegation-policy');
		expect(mockParsePolicy).toHaveBeenCalledWith(policyText);
	});

	it('performs no Gemini call when the shared coordinator rejects admission', async () => {
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: false });

		const response = await POST(event('Only environmental actions in my district'));

		expect(response.status).toBe(429);
		expect(mockParsePolicy).not.toHaveBeenCalled();
	});
});
