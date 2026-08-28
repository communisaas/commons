/**
 * The HTTP-side API rate-limit gate is a proof check only. The global slot is
 * consumed atomically with API-key authentication in Convex, so a second
 * Worker-local limiter would both double-charge requests and split state by
 * isolate.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Id } from '../../../convex/_generated/dataModel';

vi.mock('$lib/server/api-v1/response', () => ({
	apiError: (code: string, message: string, status: number) =>
		new Response(JSON.stringify({ data: null, error: { code, message } }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
}));

import { checkApiPlanRateLimit } from '../../../src/lib/server/api-v1/rate-limit';
import type { ApiKeyContext } from '../../../src/lib/server/api-v1/auth';

function consumedContext(overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
	return {
		orgId: 'org-1' as Id<'organizations'>,
		keyId: 'key-1' as Id<'apiKeys'>,
		scopes: ['read'],
		planSlug: 'inactive',
		rateLimitConsumed: true,
		rateLimit: { limit: 100, remaining: 99, resetAt: 1_800_000_000_000 },
		...overrides
	};
}

describe('checkApiPlanRateLimit', () => {
	it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE'])(
		'accepts an atomic consumption proof for %s (no inactive read bypass)',
		async (method) => {
			await expect(checkApiPlanRateLimit(consumedContext(), { method })).resolves.toBeNull();
		}
	);

	it('fails closed when a legacy or forged context has no global proof', async () => {
		const { rateLimitConsumed: _consumed, ...legacyFields } = consumedContext();
		const legacy = legacyFields as ApiKeyContext;

		const response = await checkApiPlanRateLimit(legacy);
		expect(response?.status).toBe(503);
		await expect(response?.json()).resolves.toMatchObject({
			error: { code: 'RATE_LIMITER_UNAVAILABLE' }
		});
	});
});
