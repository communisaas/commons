import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { GROQ_API_KEY: 'test-groq-key' }
}));

import { classifySafety } from '$lib/core/server/moderation/llama-guard';
import { detectPromptInjection } from '$lib/core/server/moderation/prompt-guard';
import {
	GROQ_REQUEST_TIMEOUT_MS,
	GROQ_RESPONSE_MAX_BYTES,
	GroqTransportError,
	requestGroqChatCompletion
} from '$lib/core/server/moderation/groq-transport';

function completion(content: string): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function abortablePendingFetch(
	_input: string | URL | Request,
	init?: RequestInit
): Promise<Response> {
	return new Promise((_resolve, reject) => {
		const signal = init?.signal;
		if (!signal) return;
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('Groq provider call envelope', () => {
	it('uses tiny stage-specific output ceilings and an abort signal', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(completion('0.1'))
			.mockResolvedValueOnce(completion('safe'));

		await expect(detectPromptInjection('Civic content')).resolves.toMatchObject({ safe: true });
		await expect(classifySafety('Civic content')).resolves.toMatchObject({ safe: true });

		const promptRequest = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
		const safetyRequest = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
		expect(promptRequest.max_tokens).toBe(16);
		expect(safetyRequest.max_tokens).toBe(64);
		expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
		expect(fetchSpy.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('actively aborts one hung call at the reviewed deadline', async () => {
		vi.useFakeTimers();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(abortablePendingFetch);
		const request = requestGroqChatCompletion({ model: 'test', messages: [] });
		const rejection = expect(request).rejects.toMatchObject({ code: 'ETIMEDOUT' });

		await vi.advanceTimersByTimeAsync(GROQ_REQUEST_TIMEOUT_MS);

		await rejection;
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('propagates owner cancellation and never starts a second call', async () => {
		const controller = new AbortController();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(abortablePendingFetch);
		const result = classifySafety('Civic content', { signal: controller.signal });
		controller.abort(new DOMException('request closed', 'AbortError'));

		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('fails closed without buffering an oversized provider response', async () => {
		const oversized = JSON.stringify({
			choices: [{ message: { content: 'x'.repeat(GROQ_RESPONSE_MAX_BYTES) } }]
		});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } })
		);

		await expect(classifySafety('Civic content')).rejects.toThrow(/unavailable/u);
	});

	it('scrubs provider-controlled Groq error codes, body fragments, and prompt-guard logs', async () => {
		const groqKey = `gsk_${'g'.repeat(48)}`;
		const body = () =>
			new Response(
				JSON.stringify({
					error: {
						code: `model_permission_blocked_org\r\n${groqKey}\u0000 ${'x'.repeat(10_000)}`
					}
				}),
				{ status: 403, headers: { 'content-type': 'application/json' } }
			);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => body());

		let failure: GroqTransportError | undefined;
		try {
			await requestGroqChatCompletion({ model: 'test', messages: [] });
		} catch (error) {
			if (error instanceof GroqTransportError) failure = error;
		}

		expect(failure).toBeInstanceOf(GroqTransportError);
		for (const value of [failure?.code ?? '', failure?.responseBody ?? '']) {
			expect(new TextEncoder().encode(value).byteLength).toBeLessThanOrEqual(512);
			expect(value).not.toContain(groqKey);
			expect(value).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
		}

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(detectPromptInjection('Civic content')).resolves.toMatchObject({
			safe: false,
			score: -1
		});
		const logged = consoleSpy.mock.calls.flat().map(String).join(' ');
		expect(logged).not.toContain(groqKey);
		expect(logged).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
	});

	it('scrubs invalid successful Groq output and unknown transport errors before logging', async () => {
		const bearer = `Bearer ${'b'.repeat(48)}`;
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(completion(`invalid\r\n${bearer}\u0000 ${'x'.repeat(10_000)}`))
			.mockRejectedValueOnce(
				new Error(`transport\r\n${bearer}\u0000 ${'\ud83d\udea8'.repeat(10_000)}`)
			);

		await expect(detectPromptInjection('Civic content')).resolves.toMatchObject({
			safe: false,
			score: -1
		});
		await expect(classifySafety('Civic content')).rejects.toThrow(
			'Safety moderation service unavailable'
		);

		const logValues = consoleSpy.mock.calls.flat().map(String);
		expect(logValues.join(' ')).not.toContain(bearer);
		expect(logValues.join(' ')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
		expect(
			logValues.every((value) => new TextEncoder().encode(value).byteLength <= 1_024)
		).toBe(true);
	});
});
