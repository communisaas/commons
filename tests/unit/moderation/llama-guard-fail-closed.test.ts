import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { GROQ_API_KEY: 'test-groq-key' }
}));

import { classifySafety } from '$lib/core/server/moderation/llama-guard';
import { detectPromptInjection } from '$lib/core/server/moderation/prompt-guard';

afterEach(() => vi.restoreAllMocks());

describe('Groq safety classifier availability boundary', () => {
	it('fails closed on a non-rate-limit provider error', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('provider unavailable', { status: 503 })
		);
		await expect(classifySafety('Civic content')).rejects.toThrow(/unavailable/);
	});

	it('fails closed on a missing or malformed model decision', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ choices: [] }), {
				headers: { 'content-type': 'application/json' },
				status: 200
			})
		);
		await expect(classifySafety('Civic content')).rejects.toThrow(/invalid response/);
	});

	it('fails closed when the model says unsafe without valid hazard codes', async () => {
		for (const modelDecision of ['unsafe', 'unsafe,S15']) {
			vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
				new Response(
					JSON.stringify({ choices: [{ message: { content: modelDecision } }] }),
					{
						headers: { 'content-type': 'application/json' },
						status: 200
					}
				)
			);
			await expect(classifySafety('Civic content')).rejects.toThrow(/invalid response/);
		}
	});

	it('rejects prefixed and out-of-range prompt scores instead of partially parsing them', async () => {
		for (const modelDecision of ['0.4 trailing', '1.1']) {
			vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
				new Response(
					JSON.stringify({ choices: [{ message: { content: modelDecision } }] }),
					{
						headers: { 'content-type': 'application/json' },
						status: 200
					}
				)
			);
			await expect(detectPromptInjection('Civic content')).resolves.toMatchObject({
				safe: false,
				score: -1
			});
		}
	});

	it('never truncates an oversized prompt into a provider request', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await expect(detectPromptInjection('x'.repeat(2_001))).rejects.toThrow(/2000/);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
