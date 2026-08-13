import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnforceLLMRateLimit, mockGenerateEmbedding } = vi.hoisted(() => ({
	mockEnforceLLMRateLimit: vi.fn(),
	mockGenerateEmbedding: vi.fn()
}));

vi.mock('$lib/core/search/gemini-embeddings', () => ({
	generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args)
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: (...args: unknown[]) => mockEnforceLLMRateLimit(...args),
	rateLimitResponse: () => new Response('rate limited', { status: 429 })
}));

import { POST } from '../../../src/routes/api/embeddings/generate/+server';

function eventWithRequest(request: Request, authenticated = true) {
	return {
		request,
		locals: { user: authenticated ? { id: 'user_1' } : null }
	} as never;
}

function event(body: unknown, authenticated = true) {
	return eventWithRequest(
		new Request('https://commons.email/api/embeddings/generate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		authenticated
	);
}

describe('POST /api/embeddings/generate provider boundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true });
		mockGenerateEmbedding.mockResolvedValue([0.1, 0.2]);
	});

	it('rejects unauthenticated requests before reading or reserving provider work', async () => {
		const candidate = event({ text: 'public transit' }, false) as unknown as {
			request: Request;
		};
		const readerSpy = vi.spyOn(candidate.request.body!, 'getReader');

		await expect(POST(candidate as never)).rejects.toMatchObject({ status: 401 });
		expect(readerSpy).not.toHaveBeenCalled();
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it('rejects malformed JSON before reserving provider work', async () => {
		const candidate = eventWithRequest(
			new Request('https://commons.email/api/embeddings/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"text":'
			})
		);

		await expect(POST(candidate)).rejects.toMatchObject({ status: 400 });
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it.each([
		['an extra field', { text: 'public transit', ignored: true }],
		['a missing text field', {}],
		['a non-string text field', { text: 42 }],
		['a null body', null],
		['an array body', [{ text: 'public transit' }]]
	])('rejects %s before reserving provider work', async (_label, body) => {
		await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it.each([
		['whitespace-only text', '   '],
		['one-character text', ' x '],
		['text over 8000 characters', 'x'.repeat(8_001)]
	])('rejects %s before reserving provider work', async (_label, text) => {
		await expect(POST(event({ text }))).rejects.toMatchObject({ status: 400 });
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it('rejects an oversized streamed body before reserving provider work', async () => {
		const candidate = eventWithRequest(
			new Request('https://commons.email/api/embeddings/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'x'.repeat(49 * 1024) })
			})
		);

		await expect(POST(candidate)).rejects.toMatchObject({ status: 413 });
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});

	it('reserves the reviewed operation immediately before Gemini', async () => {
		const candidate = event({ text: '  public transit  ' });
		const response = await POST(candidate);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ embedding: [0.1, 0.2] });
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(candidate, 'embeddings');
		expect(mockGenerateEmbedding).toHaveBeenCalledWith(
			'public transit',
			expect.objectContaining({
				taskType: 'RETRIEVAL_QUERY',
				signal: expect.any(AbortSignal)
			})
		);
		expect(mockEnforceLLMRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
			mockGenerateEmbedding.mock.invocationCallOrder[0]
		);
	});

	it('performs no Gemini call when the shared coordinator rejects admission', async () => {
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: false });

		const response = await POST(event({ text: 'public transit' }));

		expect(response.status).toBe(429);
		expect(mockGenerateEmbedding).not.toHaveBeenCalled();
	});
});
