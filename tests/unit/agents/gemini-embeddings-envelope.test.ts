import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmbedContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
	GoogleGenAI: class {
		models = { embedContent: mockEmbedContent };
	}
}));

import {
	EMBEDDING_CONFIG,
	generateBatchEmbeddings,
	generateEmbedding
} from '$lib/core/search/gemini-embeddings';

describe('Gemini embedding provider envelope', () => {
	const vector = (value: number) => Array.from({ length: 768 }, () => value);

	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-key';
		mockEmbedContent.mockReset();
	});

	it('uses the SDK abort/timeout path with hidden retries disabled', async () => {
		const controller = new AbortController();
		mockEmbedContent.mockResolvedValueOnce({ embeddings: [{ values: vector(0.1) }] });

		await expect(
			generateEmbedding('bounded query', {
				taskType: 'RETRIEVAL_QUERY',
				signal: controller.signal
			})
		).resolves.toEqual(vector(0.1));

		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
		expect(mockEmbedContent).toHaveBeenCalledWith({
			model: EMBEDDING_CONFIG.model,
			contents: ['bounded query'],
			config: {
				outputDimensionality: EMBEDDING_CONFIG.dimensions,
				taskType: 'RETRIEVAL_QUERY',
				httpOptions: {
					timeout: EMBEDDING_CONFIG.timeout,
					retryOptions: { attempts: 1 }
				},
				abortSignal: controller.signal
			}
		});
	});

	it.each([
		new DOMException('timed out', 'AbortError'),
		Object.assign(new Error('quota'), { code: 'RESOURCE_EXHAUSTED' }),
		new Error('unknown transport failure')
	])('never duplicates an ambiguous or rejected embedding request', async (failure) => {
		mockEmbedContent.mockRejectedValueOnce(failure);

		await expect(generateEmbedding('bounded query')).rejects.toThrow(/after 1 attempt/u);
		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
	});

	it('bounds and sanitizes provider-controlled embedding errors', async () => {
		const googleKey = `AIza${'a'.repeat(35)}`;
		mockEmbedContent.mockRejectedValueOnce(
			new Error(`embedding\r\n${googleKey}\u0000 ${'\ud83d\udea8'.repeat(10_000)}`)
		);

		let failure: Error | undefined;
		try {
			await generateEmbedding('bounded query');
		} catch (error) {
			if (error instanceof Error) failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		const message = failure?.message ?? '';
		expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(512);
		expect(message).not.toContain(googleKey);
		expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
	});

	it('uses one SDK call for a whole bounded batch', async () => {
		mockEmbedContent.mockResolvedValueOnce({
			embeddings: [{ values: vector(0.1) }, { values: vector(0.2) }]
		});

		await expect(generateBatchEmbeddings(['first', 'second'])).resolves.toEqual([
			vector(0.1),
			vector(0.2)
		]);
		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
		expect(mockEmbedContent.mock.calls[0][0].config.httpOptions.retryOptions).toEqual({
			attempts: 1
		});
	});

	it('rejects any attempt to widen the one-call embedding envelope', async () => {
		await expect(
			generateEmbedding('bounded query', { maxRetries: 2 } as never)
		).rejects.toThrow(/exactly one attempt/u);
		expect(mockEmbedContent).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'short', values: [0.1, 0.2] },
		{ label: 'long', values: Array.from({ length: 769 }, () => 0.1) },
		{ label: 'NaN', values: [...vector(0.1).slice(0, 767), Number.NaN] },
		{ label: 'Infinity', values: [...vector(0.1).slice(0, 767), Number.POSITIVE_INFINITY] }
	])('rejects a $label provider vector before it reaches storage', async ({ values }) => {
		mockEmbedContent.mockResolvedValueOnce({ embeddings: [{ values }] });

		await expect(generateEmbedding('bounded query')).rejects.toThrow(
			/after 1 attempt.*(?:exactly 768|non-finite)/u
		);
		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
	});

	it('rejects one malformed vector in a batch before returning any vectors', async () => {
		mockEmbedContent.mockResolvedValueOnce({
			embeddings: [{ values: vector(0.1) }, { values: [0.2] }]
		});

		await expect(generateBatchEmbeddings(['first', 'second'])).rejects.toThrow(
			/Embedding 1 must contain exactly 768/u
		);
		expect(mockEmbedContent).toHaveBeenCalledTimes(1);
	});
});
