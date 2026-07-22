import { env } from '$env/dynamic/private';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

export const GROQ_REQUEST_TIMEOUT_MS = 30_000 as const;
export const GROQ_RESPONSE_MAX_BYTES = 64 * 1024;

export class GroqTransportError extends Error {
	readonly status?: number;
	readonly code?: string;
	readonly responseBody?: string;

	constructor(
		message: string,
		options: { status?: number; code?: string; responseBody?: string } = {}
	) {
		super(message);
		this.name = 'GroqTransportError';
		this.status = options.status;
		this.code = options.code;
		this.responseBody = options.responseBody;
	}
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('Groq request aborted', 'AbortError');
}

async function readResponseTextBounded(response: Response): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > GROQ_RESPONSE_MAX_BYTES) {
				await reader.cancel('response body limit exceeded');
				throw new GroqTransportError(`Groq response exceeded ${GROQ_RESPONSE_MAX_BYTES} bytes`, {
					status: response.status
				});
			}
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

/** One abortable, deadline-bound Groq call with no implicit retry. */
export async function requestGroqChatCompletion<T>(
	body: Record<string, unknown>,
	options: { signal?: AbortSignal } = {}
): Promise<T> {
	const apiKey = env.GROQ_API_KEY;
	if (!apiKey) throw new GroqTransportError('GROQ_API_KEY not configured');
	if (options.signal?.aborted) throw abortReason(options.signal);

	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException('Groq request timed out', 'TimeoutError'));
	}, GROQ_REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort(abortReason(options.signal!));
	options.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});
		const responseBody = await readResponseTextBounded(response);
		let parsed: unknown;
		try {
			parsed = JSON.parse(responseBody);
		} catch {
			throw new GroqTransportError(
				response.ok ? 'Groq returned unparseable JSON' : `GROQ ${response.status}`,
				{
					status: response.status,
					responseBody: sanitizeProviderErrorMessage(responseBody, 'Groq response unavailable')
				}
			);
		}
		if (!response.ok) {
			const providerCode =
				parsed && typeof parsed === 'object' && 'error' in parsed
					? (parsed as { error?: { code?: unknown } }).error?.code
					: undefined;
			throw new GroqTransportError(`GROQ ${response.status}`, {
				status: response.status,
				code:
					typeof providerCode === 'string'
						? sanitizeProviderErrorMessage(providerCode, 'unknown_provider_error')
						: undefined,
				responseBody: sanitizeProviderErrorMessage(responseBody, 'Groq response unavailable')
			});
		}
		return parsed as T;
	} catch (error) {
		if (error instanceof GroqTransportError) throw error;
		if (options.signal?.aborted) throw abortReason(options.signal);
		if (timedOut) {
			throw new GroqTransportError(`Groq request timed out after ${GROQ_REQUEST_TIMEOUT_MS}ms`, {
				code: 'ETIMEDOUT'
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', onAbort);
	}
}
