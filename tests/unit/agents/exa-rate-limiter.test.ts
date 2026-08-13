import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	ExaRateLimiter,
	SEARCH_CONFIG,
	CONTENTS_CONFIG,
	type RateLimitConfig
} from '$lib/server/exa/rate-limiter';

// Fast config for testing (no real delays)
const TEST_CONFIG: RateLimitConfig = {
	maxRps: 2,
	maxRetries: 3,
	baseDelayMs: 10,
	maxDelayMs: 50,
	circuitBreakerThreshold: 3,
	circuitBreakerResetMs: 100
};

describe('ExaRateLimiter', () => {
	let limiter: ExaRateLimiter;

	beforeEach(() => {
		limiter = new ExaRateLimiter(TEST_CONFIG);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('execute', () => {
		it('executes function successfully on first try', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(result.data).toBe('success');
			expect(result.attempts).toBe(1);
			expect(result.wasRateLimited).toBe(false);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('retries on rate limit error (429)', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('429 Too Many Requests'))
				.mockResolvedValueOnce('success after retry');

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(result.data).toBe('success after retry');
			expect(result.attempts).toBe(2);
			expect(result.wasRateLimited).toBe(true);
		});

		it('retries on rate limit keyword in error message', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('rate limit exceeded'))
				.mockResolvedValueOnce('recovered');

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(result.wasRateLimited).toBe(true);
		});

		it('returns failure after exhausting retries', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('429 rate limit'));

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain('retries exhausted');
			expect(result.attempts).toBe(TEST_CONFIG.maxRetries);
			expect(result.wasRateLimited).toBe(true);
		});

		it('does not retry non-rate-limit errors', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Network error'));

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toBe('Network error');
			expect(result.attempts).toBe(1);
			expect(result.wasRateLimited).toBe(false);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('scrubs and bounds provider messages before returning or logging them', async () => {
			const googleKey = `AIza${'a'.repeat(35)}`;
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const fn = vi
				.fn()
				.mockRejectedValue(
					new Error(`provider\r\n${googleKey}\u0000 ${'\ud83d\udea8'.repeat(10_000)}`)
				);

			const result = await limiter.execute(fn, 'test-context');
			const logged = consoleSpy.mock.calls.flat().map(String).join(' ');

			expect(new TextEncoder().encode(result.error ?? '').byteLength).toBeLessThanOrEqual(512);
			expect(result.error).not.toContain(googleKey);
			expect(result.error).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
			expect(logged).not.toContain(googleKey);
			expect(logged).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
			consoleSpy.mockRestore();
		});

		it('marks status-less transport failures as completion-unknown', async () => {
			const fn = vi.fn().mockRejectedValue(Object.assign(new Error('socket reset'), {
				code: 'ECONNRESET'
			}));

			const result = await limiter.execute(fn, 'test-context');

			expect(result).toMatchObject({
				success: false,
				attempts: 1,
				completionUnknown: true,
				reason: 'non_retryable'
			});
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('does not start another paid call when aborted during Retry-After backoff', async () => {
			const controller = new AbortController();
			const fn = vi.fn().mockRejectedValue(
				Object.assign(new Error('limited'), {
					status: 429,
					headers: { 'retry-after': '30' }
				})
			);

			const resultPromise = limiter.execute(fn, 'test-context', controller.signal);
			await vi.advanceTimersByTimeAsync(0);
			expect(fn).toHaveBeenCalledTimes(1);
			controller.abort();
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.reason).toBe('aborted');
			expect(result.attempts).toBe(1);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('honors Retry-After but caps it to the reviewed maximum delay', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(
					Object.assign(new Error('limited'), {
						status: 429,
						headers: { 'retry-after': '3600' }
					})
				)
				.mockResolvedValueOnce('recovered');

			const resultPromise = limiter.execute(fn, 'test-context');
			await vi.advanceTimersByTimeAsync(TEST_CONFIG.maxDelayMs - 1);
			expect(fn).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe('circuit breaker', () => {
		it('opens after consecutive failures', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Server error'));

			// Trigger enough failures to open the circuit
			for (let i = 0; i < TEST_CONFIG.circuitBreakerThreshold; i++) {
				const resultPromise = limiter.execute(fn, 'test');
				await vi.runAllTimersAsync();
				await resultPromise;
			}

			const state = limiter.getState();
			expect(state.circuitState).toBe('open');
		});

		it('fails fast when circuit is open', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Server error'));

			// Open the circuit
			for (let i = 0; i < TEST_CONFIG.circuitBreakerThreshold; i++) {
				const resultPromise = limiter.execute(fn, 'test');
				await vi.runAllTimersAsync();
				await resultPromise;
			}

			fn.mockClear();

			// Should fail immediately without calling fn
			const resultPromise = limiter.execute(fn, 'test');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain('circuit breaker open');
			expect(result.attempts).toBe(0);
			expect(fn).not.toHaveBeenCalled();
		});

		it('transitions to half-open after reset time', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Server error'));

			// Open the circuit
			for (let i = 0; i < TEST_CONFIG.circuitBreakerThreshold; i++) {
				const resultPromise = limiter.execute(fn, 'test');
				await vi.runAllTimersAsync();
				await resultPromise;
			}

			expect(limiter.getState().circuitState).toBe('open');

			// Advance past reset time
			vi.advanceTimersByTime(TEST_CONFIG.circuitBreakerResetMs + 10);

			// Now it should allow one request through (half-open)
			fn.mockResolvedValueOnce('recovered');
			const resultPromise = limiter.execute(fn, 'test');
			await vi.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(limiter.getState().circuitState).toBe('closed');
		});

		it('resets to closed on success', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('fail'))
				.mockRejectedValueOnce(new Error('fail'))
				.mockResolvedValueOnce('success');

			// Two failures
			for (let i = 0; i < 2; i++) {
				const resultPromise = limiter.execute(fn, 'test');
				await vi.runAllTimersAsync();
				await resultPromise;
			}

			expect(limiter.getState().consecutiveFailures).toBe(2);

			// One success should reset
			const resultPromise = limiter.execute(fn, 'test');
			await vi.runAllTimersAsync();
			await resultPromise;

			expect(limiter.getState().consecutiveFailures).toBe(0);
		});
	});

	describe('executeStaggered', () => {
		it('executes all functions and returns ordered results', async () => {
			const fns = [
				vi.fn().mockResolvedValue('a'),
				vi.fn().mockResolvedValue('b'),
				vi.fn().mockResolvedValue('c')
			];

			const resultsPromise = limiter.executeStaggered(fns, 'test');
			await vi.runAllTimersAsync();
			const results = await resultsPromise;

			expect(results).toHaveLength(3);
			expect(results[0].data).toBe('a');
			expect(results[1].data).toBe('b');
			expect(results[2].data).toBe('c');
		});

		it('handles mixed success and failure', async () => {
			const fns = [
				vi.fn().mockResolvedValue('success'),
				vi.fn().mockRejectedValue(new Error('failed')),
				vi.fn().mockResolvedValue('also success')
			];

			const resultsPromise = limiter.executeStaggered(fns, 'test');
			await vi.runAllTimersAsync();
			const results = await resultsPromise;

			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(false);
			expect(results[2].success).toBe(true);
		});

		it('returns empty array for empty input', async () => {
			const resultsPromise = limiter.executeStaggered([], 'test');
			await vi.runAllTimersAsync();
			const results = await resultsPromise;

			expect(results).toEqual([]);
		});
	});

	describe('reset', () => {
		it('resets all state', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('fail'));

			// Cause some state changes
			for (let i = 0; i < 2; i++) {
				const resultPromise = limiter.execute(fn, 'test');
				await vi.runAllTimersAsync();
				await resultPromise;
			}

			expect(limiter.getState().consecutiveFailures).toBeGreaterThan(0);

			limiter.reset();

			const state = limiter.getState();
			expect(state.consecutiveFailures).toBe(0);
			expect(state.circuitState).toBe('closed');
			expect(state.circuitOpenedAt).toBeNull();
			expect(state.requestTimestamps).toEqual([]);
		});
	});
});

describe('Default Configurations', () => {
	it('SEARCH_CONFIG has conservative RPS to stay under 5 QPS limit', () => {
		expect(SEARCH_CONFIG.maxRps).toBeLessThanOrEqual(5);
		expect(SEARCH_CONFIG.maxRps).toBeGreaterThan(0);
	});

	it('CONTENTS_CONFIG has conservative RPS to stay under 50 QPS limit', () => {
		expect(CONTENTS_CONFIG.maxRps).toBeLessThanOrEqual(50);
		expect(CONTENTS_CONFIG.maxRps).toBeGreaterThan(0);
	});

	it('configs have reasonable retry settings', () => {
		expect(SEARCH_CONFIG.maxRetries).toBeGreaterThanOrEqual(2);
		expect(CONTENTS_CONFIG.maxRetries).toBeGreaterThanOrEqual(1);
	});
});
