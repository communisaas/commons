/**
 * Tests for enforceInternalRateLimit — the 429 cap on /api/internal/* endpoints.
 *
 * The underlying SlidingWindowRateLimiter is stateful (per-process Map). Each
 * test uses a different endpoint name so state doesn't leak across cases.
 */
import { describe, it, expect } from 'vitest';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';

describe('enforceInternalRateLimit', () => {
	it('allows requests under the cap', async () => {
		// 5 requests against a cap of 10 — all should pass
		for (let i = 0; i < 5; i++) {
			await expect(
				enforceInternalRateLimit({ endpoint: 'alert', maxRequests: 10, windowMs: 60_000 })
			).resolves.toBeUndefined();
		}
	});

	it('throws 429 when cap is exceeded', async () => {
		// Cap of 2; third call must throw
		await enforceInternalRateLimit({
			endpoint: 'anchor-proof',
			maxRequests: 2,
			windowMs: 60_000
		});
		await enforceInternalRateLimit({
			endpoint: 'anchor-proof',
			maxRequests: 2,
			windowMs: 60_000
		});
		await expect(
			enforceInternalRateLimit({ endpoint: 'anchor-proof', maxRequests: 2, windowMs: 60_000 })
		).rejects.toMatchObject({ status: 429 });
	});

	it('isolates counters across endpoints', async () => {
		// Fill one endpoint to its cap, a different endpoint must still be allowed.
		await enforceInternalRateLimit({
			endpoint: 'anchor-incidents',
			maxRequests: 1,
			windowMs: 60_000
		});
		await expect(
			enforceInternalRateLimit({
				endpoint: 'anchor-incidents',
				maxRequests: 1,
				windowMs: 60_000
			})
		).rejects.toMatchObject({ status: 429 });

		// 'alert' has its own bucket and should still accept — even though
		// earlier `alert` tests in this file have consumed from it, we set
		// a high cap here to ensure independence of keys, not timing.
		await expect(
			enforceInternalRateLimit({ endpoint: 'alert', maxRequests: 1000, windowMs: 60_000 })
		).resolves.toBeUndefined();
	});
});
