/**
 * Exa API Rate Limiter
 *
 * NOTE: On CF Workers, rate limiting state resets per-isolate. Proactive
 * throttling within a single request still works. Circuit breaker across
 * requests does not.
 *
 * Provides intelligent rate limit handling for Exa API calls:
 * - Proactive throttling to stay under QPS limits
 * - Reactive retry with exponential backoff on 429 responses
 * - Circuit breaker to prevent cascading failures
 *
 * Rate Limits (from Exa docs):
 * - /search: 5 QPS
 * - /contents: 50 QPS
 * - Overall default: ~10 RPS
 *
 * @module exa/rate-limiter
 */

import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
	/** Maximum requests per second for this endpoint */
	maxRps: number;
	/** Maximum total attempts, including the initial request */
	maxRetries: number;
	/** Base delay in ms for exponential backoff */
	baseDelayMs: number;
	/** Maximum delay in ms (cap for exponential growth) */
	maxDelayMs: number;
	/** Circuit breaker: failures before opening */
	circuitBreakerThreshold: number;
	/** Circuit breaker: time to stay open before half-open */
	circuitBreakerResetMs: number;
}

export interface RateLimitState {
	/** Timestamps of recent requests (sliding window) */
	requestTimestamps: number[];
	/** Current circuit breaker state */
	circuitState: 'closed' | 'open' | 'half-open';
	/** When circuit breaker opened */
	circuitOpenedAt: number | null;
	/** Consecutive failures count */
	consecutiveFailures: number;
}

export interface RetryResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	attempts: number;
	wasRateLimited: boolean;
	/** True when no provider response proved whether the request completed. */
	completionUnknown?: boolean;
	reason?: 'aborted' | 'circuit_open' | 'non_retryable' | 'rate_limit_exhausted';
}

// ============================================================================
// Default Configurations
// ============================================================================

export const SEARCH_CONFIG: RateLimitConfig = {
	maxRps: 4, // Stay under 5 QPS limit with margin
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 10000,
	circuitBreakerThreshold: 5,
	circuitBreakerResetMs: 30000
};

export const CONTENTS_CONFIG: RateLimitConfig = {
	maxRps: 40, // Stay under 50 QPS limit with margin
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 5000,
	circuitBreakerThreshold: 3,
	circuitBreakerResetMs: 15000
};

// ============================================================================
// Rate Limiter Class
// ============================================================================

export class ExaRateLimiter {
	private state: RateLimitState = {
		requestTimestamps: [],
		circuitState: 'closed',
		circuitOpenedAt: null,
		consecutiveFailures: 0
	};

	constructor(private config: RateLimitConfig) {}

	/**
	 * Execute a function with rate limiting and retry logic.
	 *
	 * @param fn - Async function to execute
	 * @param context - Description for logging
	 * @returns Result with success status and data or error
	 */
	async execute<T>(
		fn: () => Promise<T>,
		context: string,
		signal?: AbortSignal
	): Promise<RetryResult<T>> {
		if (signal?.aborted) return this.abortedResult(0, false);

		// Check circuit breaker
		if (this.isCircuitOpen()) {
			console.warn(`[exa-rate-limit] Circuit OPEN for ${context}, failing fast`);
			return {
				success: false,
				error: 'Service temporarily unavailable (circuit breaker open)',
				attempts: 0,
				wasRateLimited: false,
				reason: 'circuit_open'
			};
		}

		let attempts = 0;
		let wasRateLimited = false;

		while (attempts < this.config.maxRetries) {
			// Proactive throttling: wait if we're at RPS limit
			if (!(await this.throttle(signal))) return this.abortedResult(attempts, false);
			if (signal?.aborted) return this.abortedResult(attempts, false);

			attempts++;

			try {
				// Record request timestamp
				this.recordRequest();

				const result = await fn();

				// Success: reset circuit breaker state
				this.onSuccess();

				return {
					success: true,
					data: result,
					attempts,
					wasRateLimited
				};
			} catch (error) {
				if (signal?.aborted || this.isAbortError(error)) {
					return this.abortedResult(attempts, true);
				}
				const isRateLimit = this.isRateLimitError(error);

				if (isRateLimit) {
					wasRateLimited = true;
					if (attempts >= this.config.maxRetries) break;
					const delay = this.calculateBackoff(attempts, error);

					console.warn(
						`[exa-rate-limit] Rate limited on ${context} (attempt ${attempts}/${this.config.maxRetries}), ` +
							`waiting ${delay}ms before retry`
					);

					if (!(await this.sleep(delay, signal))) {
						return this.abortedResult(attempts, false);
					}
					continue;
				}

				// Non-rate-limit error: record failure and don't retry
				this.onFailure();

				const message = sanitizeProviderErrorMessage(error);
				console.error(`[exa-rate-limit] Non-retryable error on ${context}: ${message}`);

				return {
					success: false,
					error: message,
					attempts,
					wasRateLimited,
					completionUnknown: this.isCompletionUnknown(error),
					reason: 'non_retryable'
				};
			}
		}

		// Exhausted retries
		this.onFailure();
		console.error(`[exa-rate-limit] Exhausted ${this.config.maxRetries} retries for ${context}`);

		return {
			success: false,
			error: `Rate limit retries exhausted after ${attempts} attempts`,
			attempts,
			wasRateLimited: true,
			completionUnknown: false,
			reason: 'rate_limit_exhausted'
		};
	}

	/**
	 * Execute multiple functions with staggered timing to avoid rate limits.
	 *
	 * @param fns - Array of async functions to execute
	 * @param context - Description for logging
	 * @returns Array of results (maintains order)
	 */
	async executeStaggered<T>(
		fns: Array<() => Promise<T>>,
		context: string,
		signal?: AbortSignal
	): Promise<Array<RetryResult<T>>> {
		const results: Array<RetryResult<T>> = [];
		const staggerDelayMs = Math.ceil(1000 / this.config.maxRps);

		for (let i = 0; i < fns.length; i++) {
			// Stagger requests to stay under RPS limit
			if (i > 0) {
				if (!(await this.sleep(staggerDelayMs, signal))) {
					results.push(this.abortedResult(0, false));
					break;
				}
			}

			const result = await this.execute(fns[i], `${context}[${i}]`, signal);
			results.push(result);
		}

		return results;
	}

	// ==========================================================================
	// Private Methods
	// ==========================================================================

	/**
	 * Proactive throttling: wait if we've hit RPS limit in sliding window
	 */
	private async throttle(signal?: AbortSignal): Promise<boolean> {
		const now = Date.now();
		const windowStart = now - 1000;

		// Clean old timestamps
		this.state.requestTimestamps = this.state.requestTimestamps.filter((ts) => ts > windowStart);

		// If at limit, wait until oldest request exits the window
		if (this.state.requestTimestamps.length >= this.config.maxRps) {
			const oldestInWindow = Math.min(...this.state.requestTimestamps);
			const waitMs = oldestInWindow + 1000 - now + 50; // +50ms buffer

			if (waitMs > 0) {
				console.debug(`[exa-rate-limit] Throttling: waiting ${waitMs}ms to stay under RPS limit`);
				return this.sleep(waitMs, signal);
			}
		}
		return true;
	}

	/**
	 * Record a request timestamp for the sliding window
	 */
	private recordRequest(): void {
		this.state.requestTimestamps.push(Date.now());
	}

	/**
	 * Check if error is a rate limit (429) response
	 */
	private isRateLimitError(error: unknown): boolean {
		const status = this.errorStatus(error);
		if (status === 429) return true;

		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			// Exa rate limit errors contain these patterns
			return (
				message.includes('429') ||
				message.includes('rate limit') ||
				message.includes('too many requests')
			);
		}

		return false;
	}

	private errorStatus(error: unknown): number | undefined {
		if (!error || typeof error !== 'object') return undefined;
		for (const field of ['status', 'statusCode'] as const) {
			const value = (error as Record<string, unknown>)[field];
			if (typeof value === 'number' && Number.isFinite(value)) return value;
		}
		return undefined;
	}

	private errorCode(error: unknown): string | undefined {
		if (!error || typeof error !== 'object') return undefined;
		const value = (error as Record<string, unknown>).code;
		return typeof value === 'string' ? value.toUpperCase() : undefined;
	}

	private isAbortError(error: unknown): boolean {
		return error instanceof Error && error.name === 'AbortError';
	}

	/**
	 * Without an HTTP response, a transport failure may have happened after the
	 * paid provider accepted the request. Callers must not launch a fallback or
	 * retry that could overlap it.
	 */
	private isCompletionUnknown(error: unknown): boolean {
		if (this.errorStatus(error) !== undefined) return false;
		const code = this.errorCode(error);
		if (
			code &&
			['ABORT_ERR', 'ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_ABORTED'].includes(code)
		) {
			return true;
		}
		// Be conservative for every status-less failure. Fixed call sites do not
		// pass user-authored provider options, so these are transport-ambiguous.
		return true;
	}

	/**
	 * Calculate backoff delay with exponential growth and jitter
	 */
	private calculateBackoff(attempt: number, error: unknown): number {
		// Check for Retry-After header
		const retryAfterMs = this.extractRetryAfterMs(error);
		if (retryAfterMs !== null) {
			return Math.min(retryAfterMs, this.config.maxDelayMs);
		}

		// Exponential backoff: base * 2^(attempt-1) + jitter
		const exponential = this.config.baseDelayMs * Math.pow(2, attempt - 1);
		const jitter = Math.random() * 200; // 0-200ms jitter
		const delay = Math.min(exponential + jitter, this.config.maxDelayMs);

		return Math.round(delay);
	}

	/**
	 * Extract Retry-After header value if present
	 */
	private extractRetryAfterMs(error: unknown): number | null {
		if (error && typeof error === 'object') {
			// Check for headers object
			const headers = (error as { headers?: Record<string, string> | Headers }).headers;
			if (headers) {
				const retryAfter =
					typeof Headers !== 'undefined' && headers instanceof Headers
						? headers.get('retry-after')
						: (headers as Record<string, string>)['retry-after'] ||
							(headers as Record<string, string>)['Retry-After'];
				if (retryAfter) {
					const seconds = Number(retryAfter);
					if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
					const retryDate = Date.parse(retryAfter);
					if (Number.isFinite(retryDate)) return Math.max(0, retryDate - Date.now());
				}
			}
		}
		return null;
	}

	/**
	 * Check if circuit breaker is open
	 */
	private isCircuitOpen(): boolean {
		if (this.state.circuitState === 'closed') {
			return false;
		}

		if (this.state.circuitState === 'open') {
			// Check if we should transition to half-open
			const openDuration = Date.now() - (this.state.circuitOpenedAt || 0);
			if (openDuration >= this.config.circuitBreakerResetMs) {
				console.debug('[exa-rate-limit] Circuit transitioning to HALF-OPEN');
				this.state.circuitState = 'half-open';
				return false; // Allow one request through
			}
			return true;
		}

		// half-open: allow request through
		return false;
	}

	/**
	 * Handle successful request
	 */
	private onSuccess(): void {
		this.state.consecutiveFailures = 0;
		if (this.state.circuitState !== 'closed') {
			console.debug('[exa-rate-limit] Circuit CLOSED after successful request');
			this.state.circuitState = 'closed';
			this.state.circuitOpenedAt = null;
		}
	}

	/**
	 * Handle failed request
	 */
	private onFailure(): void {
		this.state.consecutiveFailures++;

		if (
			this.state.circuitState === 'closed' &&
			this.state.consecutiveFailures >= this.config.circuitBreakerThreshold
		) {
			console.warn(
				`[exa-rate-limit] Circuit OPEN after ${this.state.consecutiveFailures} consecutive failures`
			);
			this.state.circuitState = 'open';
			this.state.circuitOpenedAt = Date.now();
		} else if (this.state.circuitState === 'half-open') {
			// Failed in half-open state: reopen circuit
			console.warn('[exa-rate-limit] Circuit re-OPENED after failure in half-open state');
			this.state.circuitState = 'open';
			this.state.circuitOpenedAt = Date.now();
		}
	}

	/**
	 * Sleep helper
	 */
	private sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) return Promise.resolve(false);
		return new Promise((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => {
				if (timer !== undefined) clearTimeout(timer);
				resolve(false);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			timer = setTimeout(() => {
				signal?.removeEventListener('abort', onAbort);
				resolve(true);
			}, ms);
		});
	}

	private abortedResult<T>(attempts: number, completionUnknown: boolean): RetryResult<T> {
		return {
			success: false,
			error: 'Request aborted',
			attempts,
			wasRateLimited: false,
			completionUnknown,
			reason: 'aborted'
		};
	}

	/**
	 * Get current state (for monitoring/debugging)
	 */
	getState(): Readonly<RateLimitState> {
		return { ...this.state };
	}

	/**
	 * Reset state (for testing)
	 */
	reset(): void {
		this.state = {
			requestTimestamps: [],
			circuitState: 'closed',
			circuitOpenedAt: null,
			consecutiveFailures: 0
		};
	}
}

// ============================================================================
// Singleton Instances
// ============================================================================

// Global instances for HMR safety
declare global {
	// eslint-disable-next-line no-var
	var __exaSearchRateLimiter: ExaRateLimiter | undefined;
	// eslint-disable-next-line no-var
	var __exaContentsRateLimiter: ExaRateLimiter | undefined;
}

/**
 * Get rate limiter for search operations
 */
export function getSearchRateLimiter(): ExaRateLimiter {
	if (process.env.NODE_ENV === 'development') {
		if (!global.__exaSearchRateLimiter) {
			global.__exaSearchRateLimiter = new ExaRateLimiter(SEARCH_CONFIG);
		}
		return global.__exaSearchRateLimiter;
	}

	// Module-level singleton for production
	return searchRateLimiter;
}

/**
 * Get rate limiter for content operations
 */
export function getContentsRateLimiter(): ExaRateLimiter {
	if (process.env.NODE_ENV === 'development') {
		if (!global.__exaContentsRateLimiter) {
			global.__exaContentsRateLimiter = new ExaRateLimiter(CONTENTS_CONFIG);
		}
		return global.__exaContentsRateLimiter;
	}

	return contentsRateLimiter;
}

// Production singletons
const searchRateLimiter = new ExaRateLimiter(SEARCH_CONFIG);
const contentsRateLimiter = new ExaRateLimiter(CONTENTS_CONFIG);
