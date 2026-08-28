/**
 * Exa Search API Client Singleton
 * @module exa-client
 *
 * Provides an HMR-safe Exa client that handles:
 * - Development mode (global caching across Vite hot reloads)
 * - Production mode (standard module-level singleton)
 * - Lazy initialization — no import-time side effects
 */

import Exa from 'exa-js';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

export const EXA_REQUEST_TIMEOUT_MS = 15_000 as const;

export class ExaTransportError extends Error {
	readonly status?: number;
	readonly headers?: Record<string, string>;
	readonly code?: string;

	constructor(
		message: string,
		options: { status?: number; headers?: Record<string, string>; code?: string } = {}
	) {
		super(message);
		this.name = 'ExaTransportError';
		this.status = options.status;
		this.headers = options.headers;
		this.code = options.code;
	}
}

// Global cache for development HMR safety
// In dev, Vite may reload modules but we want to preserve the client instance
declare global {
	// eslint-disable-next-line no-var
	var __exaClient: Exa | undefined;
}

// Module-level cache for production
let exaClient: Exa | null = null;

/**
 * Get Exa API key from environment (lazy to avoid build-time errors)
 */
function getExaApiKey(): string {
	const key = process.env.EXA_API_KEY;
	if (!key) {
		throw new Error(
			'EXA_API_KEY environment variable is required. ' +
				'Get your API key at https://dashboard.exa.ai and add it to your .env file.'
		);
	}
	return key;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('Exa request aborted', 'AbortError');
}

function responseHeaders(response: Response): Record<string, string> {
	const retryAfter = response.headers.get('retry-after');
	return retryAfter
		? { 'retry-after': sanitizeProviderErrorMessage(retryAfter, 'invalid').slice(0, 128) }
		: {};
}

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {
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
			if (bytes > maxBytes) {
				await reader.cancel('response body limit exceeded');
				throw new ExaTransportError(`Exa response exceeded ${maxBytes} bytes`, {
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

function boundedErrorMessage(response: Response, body: string): string {
	if (!body) return `Exa request failed with HTTP ${response.status}`;
	try {
		const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
		const pieces = [parsed.error, parsed.message].filter(
			(value): value is string => typeof value === 'string' && value.length > 0
		);
		return sanitizeProviderErrorMessage(
			pieces.join('. '),
			`Exa request failed with HTTP ${response.status}`
		);
	} catch {
		return sanitizeProviderErrorMessage(body, `Exa request failed with HTTP ${response.status}`);
	}
}

/**
 * Abortable Exa transport for the paid search/contents paths. exa-js 2.11 does
 * not expose AbortSignal, so these two calls use the documented JSON endpoints
 * directly rather than racing a still-running SDK promise against a timer.
 */
export async function requestExa<T>(
	endpoint: '/search' | '/contents',
	body: Record<string, unknown>,
	options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
	if (options.signal?.aborted) throw abortReason(options.signal);

	const controller = new AbortController();
	let timedOut = false;
	const timeoutMs = options.timeoutMs ?? EXA_REQUEST_TIMEOUT_MS;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(
			new DOMException(`Exa request timed out after ${timeoutMs}ms`, 'TimeoutError')
		);
	}, timeoutMs);
	const onAbort = () => controller.abort(abortReason(options.signal!));
	options.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const baseUrl = (process.env.EXA_API_URL || 'https://api.exa.ai').replace(/\/$/u, '');
		const response = await fetch(`${baseUrl}${endpoint}`, {
			method: 'POST',
			headers: {
				'x-api-key': getExaApiKey(),
				'content-type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});

		if (!response.ok) {
			const errorBody = await readResponseTextBounded(response, 64 * 1024);
			throw new ExaTransportError(boundedErrorMessage(response, errorBody), {
				status: response.status,
				headers: responseHeaders(response)
			});
		}
		const responseBody = await readResponseTextBounded(response, 1024 * 1024);
		try {
			return JSON.parse(responseBody) as T;
		} catch {
			throw new ExaTransportError('Exa returned malformed JSON', { status: response.status });
		}
	} catch (error) {
		if (error instanceof ExaTransportError) throw error;
		if (options.signal?.aborted) throw abortReason(options.signal);
		if (timedOut) {
			throw new ExaTransportError(`Exa request timed out after ${timeoutMs}ms`, {
				code: 'ETIMEDOUT'
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * Get the Exa client instance
 *
 * Returns a singleton Exa client, creating one lazily on first call.
 * In development, the instance is cached on `globalThis` to survive HMR.
 * In production, a module-level variable is used.
 *
 * @returns Exa client instance
 *
 * @example
 * import { getExaClient } from '$lib/server/exa';
 *
 * const exa = getExaClient();
 * const results = await exa.search('latest AI research');
 */
export function getExaClient(): Exa {
	const isDevelopment = process.env.NODE_ENV === 'development';

	if (isDevelopment) {
		if (!global.__exaClient) {
			global.__exaClient = new Exa(getExaApiKey());
		}
		return global.__exaClient;
	}

	if (!exaClient) {
		exaClient = new Exa(getExaApiKey());
	}
	return exaClient;
}
