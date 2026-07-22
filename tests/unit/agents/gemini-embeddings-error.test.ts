import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockEmbedContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => {
	class MockGoogleGenAI {
		models = { embedContent: mockEmbedContent };
		constructor(_opts: { apiKey: string }) {}
	}
	return { GoogleGenAI: MockGoogleGenAI };
});

import { generateEmbedding } from '$lib/core/search/gemini-embeddings';

describe('generateEmbedding provider error sanitization', () => {
	beforeEach(() => {
		mockEmbedContent.mockReset();
		process.env.GEMINI_API_KEY = 'test-api-key';
	});

	it('redacts credentials from INVALID_ARGUMENT errors', async () => {
		const googleKey = `AIza${'a'.repeat(35)}`;
		mockEmbedContent.mockRejectedValue(
			Object.assign(new Error(`bad request: ${googleKey}`), { code: 'INVALID_ARGUMENT' })
		);

		const rejection = await generateEmbedding('hello').catch((error: unknown) => error);

		expect(rejection).toBeInstanceOf(Error);
		const message = (rejection as Error).message;
		expect(message).toContain('Invalid input');
		expect(message).toContain('[redacted-credential]');
		expect(message).not.toContain(googleKey);
	});

	it('redacts credentials from final-attempt failures', async () => {
		const bearer = `Bearer ${'b'.repeat(48)}`;
		mockEmbedContent.mockRejectedValue(new Error(`upstream 500: ${bearer}`));

		const rejection = await generateEmbedding('hello', { maxRetries: 1 }).catch(
			(error: unknown) => error
		);

		expect(rejection).toBeInstanceOf(Error);
		const message = (rejection as Error).message;
		expect(message).toContain('[redacted-credential]');
		expect(message).not.toContain(bearer);
	});
});
