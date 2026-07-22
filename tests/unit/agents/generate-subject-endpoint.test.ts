import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnforceLLMRateLimit, mockGenerateSubjectLine, mockModeratePromptOnly } = vi.hoisted(
	() => ({
		mockEnforceLLMRateLimit: vi.fn(),
		mockGenerateSubjectLine: vi.fn(),
		mockModeratePromptOnly: vi.fn()
	})
);

vi.mock('$lib/server/llm-cost-protection', () => ({
	addRateLimitHeaders: vi.fn(),
	enforceLLMRateLimit: mockEnforceLLMRateLimit,
	getUserContext: vi.fn(() => ({ tier: 'authenticated', userId: 'test-user' })),
	logLLMOperation: vi.fn(),
	rateLimitResponse: vi.fn(
		() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
	)
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: mockModeratePromptOnly
}));

vi.mock('$lib/core/agents/agents/subject-line', () => ({
	generateSubjectLine: mockGenerateSubjectLine
}));

vi.mock('../../../src/routes/api/agents/generate-subject/$types', () => ({}));

import { POST } from '../../../src/routes/api/agents/generate-subject/+server';

function event(body: unknown, authenticated = true): any {
	return {
		locals: { session: authenticated ? { userId: 'test-user' } : null },
		request: { json: () => Promise.resolve(body) }
	};
}

describe('POST /api/agents/generate-subject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforceLLMRateLimit.mockResolvedValue({
			allowed: true,
			limit: 5,
			remaining: 4,
			resetAt: new Date()
		});
		mockModeratePromptOnly.mockResolvedValue({ safe: true });
		mockGenerateSubjectLine.mockResolvedValue({
			data: { needs_clarification: false, subject_line: 'Fund Public Transit' },
			tokenUsage: undefined
		});
	});

	it('admits guest requests through the shared limiter instead of an auth wall', async () => {
		const requestEvent = event({ message: 'Fund public transit' }, false);
		const response = await POST(requestEvent);

		expect(response.status).toBe(200);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(requestEvent, 'subject-line');
	});

	it('rejects malformed JSON before reserving provider work', async () => {
		const candidate: any = {
			locals: { session: { userId: 'test-user' } },
			request: { json: () => Promise.reject(new SyntaxError('bad json')) }
		};

		const response = await POST(candidate);

		expect(response.status).toBe(400);
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockModeratePromptOnly).not.toHaveBeenCalled();
		expect(mockGenerateSubjectLine).not.toHaveBeenCalled();
	});

	it.each([
		['a missing message', {}],
		['a non-string message', { message: 42 }],
		['a null body', null],
		['an oversized message', { message: 'x'.repeat(16_001) }]
	])('rejects %s before reserving provider work', async (_label, body) => {
		const response = await POST(event(body));

		expect(response.status).toBe(400);
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateSubjectLine).not.toHaveBeenCalled();
	});

	it('accepts a multibyte message inside the shipped subject allowance', async () => {
		const message = '\u5b89'.repeat(6_000);
		const requestEvent = event({ message });
		const response = await POST(requestEvent);

		expect(response.status).toBe(200);
		expect(mockGenerateSubjectLine).toHaveBeenCalledWith({
			description: message,
			conversationContext: undefined,
			previousInteractionId: undefined,
			clarificationAnswers: undefined
		});
	});

	it('accepts a message at the shipped subject allowance', async () => {
		const message = 'x'.repeat(16_000);
		const requestEvent = event({ message });
		const response = await POST(requestEvent);

		expect(response.status).toBe(200);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(requestEvent, 'subject-line');
		expect(mockModeratePromptOnly).toHaveBeenCalledWith(message);
		expect(mockGenerateSubjectLine).toHaveBeenCalledWith({
			description: message,
			conversationContext: undefined,
			previousInteractionId: undefined,
			clarificationAnswers: undefined
		});
	});

	it('performs no moderation or Gemini work when admission is rejected', async () => {
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: false });

		const response = await POST(event({ message: 'Fund public transit' }));

		expect(response.status).toBe(429);
		expect(mockModeratePromptOnly).not.toHaveBeenCalled();
		expect(mockGenerateSubjectLine).not.toHaveBeenCalled();
	});

	it('preserves the authenticated subject-generation flow', async () => {
		const requestEvent = event({ message: 'Fund public transit' });
		const response = await POST(requestEvent);

		expect(response.status).toBe(200);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(requestEvent, 'subject-line');
		expect(mockModeratePromptOnly).toHaveBeenCalledWith('Fund public transit');
		expect(mockGenerateSubjectLine).toHaveBeenCalledOnce();
	});
});
