/**
 * Firecrawl API Client Singleton
 *
 * HMR-safe lazy singleton for Firecrawl headless browser scraping.
 * Used for all page content fetching — renders JavaScript,
 * captures what the browser actually sees.
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

export const FIRECRAWL_REQUEST_TIMEOUT_MS = 45_000 as const;

export interface FirecrawlScrapeDocument {
	markdown?: string;
	links?: string[];
	rawHtml?: string;
	metadata?: { title?: string; statusCode?: number };
}

export class FirecrawlTransportError extends Error {
	readonly status?: number;
	readonly headers?: Record<string, string>;
	readonly code?: string;

	constructor(
		message: string,
		options: { status?: number; headers?: Record<string, string>; code?: string } = {}
	) {
		super(message);
		this.name = 'FirecrawlTransportError';
		this.status = options.status;
		this.headers = options.headers;
		this.code = options.code;
	}
}

declare global {
	// eslint-disable-next-line no-var
	var __firecrawlClient: FirecrawlApp | undefined;
}

let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlApiKey(): string {
	const key = process.env.FIRECRAWL_API_KEY;
	if (!key) {
		throw new Error(
			'FIRECRAWL_API_KEY environment variable is required. ' +
				'Get your API key at https://firecrawl.dev and add it to your .env file.'
		);
	}
	return key;
}

export function getFirecrawlClient(): FirecrawlApp {
	const isDevelopment = process.env.NODE_ENV === 'development';

	if (isDevelopment) {
		if (!global.__firecrawlClient) {
			global.__firecrawlClient = new FirecrawlApp({
				apiKey: getFirecrawlApiKey(),
				timeoutMs: FIRECRAWL_REQUEST_TIMEOUT_MS,
				maxRetries: 1
			});
		}
		return global.__firecrawlClient;
	}

	if (!firecrawlClient) {
		firecrawlClient = new FirecrawlApp({
			apiKey: getFirecrawlApiKey(),
			timeoutMs: FIRECRAWL_REQUEST_TIMEOUT_MS,
			maxRetries: 1
		});
	}
	return firecrawlClient;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('Firecrawl request aborted', 'AbortError');
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
				throw new FirecrawlTransportError(`Firecrawl response exceeded ${maxBytes} bytes`, {
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

/** Abortable, single-attempt Firecrawl scrape transport. */
export async function requestFirecrawlScrape(
	url: string,
	options: { formats: string[]; signal?: AbortSignal; timeoutMs?: number }
): Promise<FirecrawlScrapeDocument> {
	if (options.signal?.aborted) throw abortReason(options.signal);

	const controller = new AbortController();
	let timedOut = false;
	const timeoutMs = options.timeoutMs ?? FIRECRAWL_REQUEST_TIMEOUT_MS;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(
			new DOMException(`Firecrawl request timed out after ${timeoutMs}ms`, 'TimeoutError')
		);
	}, timeoutMs);
	const onAbort = () => controller.abort(abortReason(options.signal!));
	options.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const baseUrl = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(
			/\/$/u,
			''
		);
		const response = await fetch(`${baseUrl}/v2/scrape`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${getFirecrawlApiKey()}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ url, formats: options.formats }),
			signal: controller.signal
		});
		const rawBody = await readResponseTextBounded(response, 2_000_000);
		let parsed: {
			success?: boolean;
			data?: FirecrawlScrapeDocument;
			error?: unknown;
			message?: unknown;
		};
		try {
			parsed = JSON.parse(rawBody) as typeof parsed;
		} catch {
			throw new FirecrawlTransportError(
				response.ok
					? 'Firecrawl returned malformed JSON'
					: sanitizeProviderErrorMessage(
							rawBody,
							`Firecrawl request failed with HTTP ${response.status}`
						),
				{ status: response.status, headers: responseHeaders(response) }
			);
		}
		if (!response.ok || !parsed.success) {
			const message = sanitizeProviderErrorMessage(
				[parsed.error, parsed.message]
					.filter((value): value is string => typeof value === 'string' && value.length > 0)
					.join('. '),
				`Firecrawl request failed with HTTP ${response.status}`
			);
			throw new FirecrawlTransportError(message, {
				status: response.status,
				headers: responseHeaders(response)
			});
		}
		return parsed.data || {};
	} catch (error) {
		if (error instanceof FirecrawlTransportError) throw error;
		if (options.signal?.aborted) throw abortReason(options.signal);
		if (timedOut) {
			throw new FirecrawlTransportError(`Firecrawl request timed out after ${timeoutMs}ms`, {
				code: 'ETIMEDOUT'
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', onAbort);
	}
}
