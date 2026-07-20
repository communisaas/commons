import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHashApiKey, mockServerMutation, mockGetInternalSecret } = vi.hoisted(() => ({
	mockHashApiKey: vi.fn(),
	mockServerMutation: vi.fn(),
	mockGetInternalSecret: vi.fn()
}));

vi.mock('$lib/core/security/api-key', () => ({ hashApiKey: mockHashApiKey }));
vi.mock('convex-sveltekit', () => ({ serverMutation: mockServerMutation }));
vi.mock('$lib/server/internal/secret-auth', () => ({ getInternalSecret: mockGetInternalSecret }));
vi.mock('$lib/convex', () => ({
	api: { v1api: { authenticateApiKey: 'v1api:authenticateApiKey' } }
}));

import { authenticateApiKey } from '../../../src/lib/server/api-v1/auth';
import {
	getApiV1RateTierSignal,
	withApiV1RateTierSignal
} from '../../../src/lib/server/api-v1/rate-tier-signal';

function request(token = 'ck_live_0123456789abcdef0123456789abcdef') {
	return new Request('https://commons.example/api/v1/events', {
		headers: { Authorization: `Bearer ${token}` }
	});
}

describe('authenticateApiKey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHashApiKey.mockResolvedValue('sha256-key');
		mockGetInternalSecret.mockReturnValue('internal-secret');
	});

	it('authenticates and consumes one global slot in a single mutation', async () => {
		mockServerMutation.mockResolvedValue({
			status: 'allowed',
			orgId: 'org-1',
			keyId: 'key-1',
			scopes: ['read'],
			planSlug: 'inactive',
			limit: 100,
			remaining: 99,
			resetAt: 1_800_000_000_000
		});

		await expect(authenticateApiKey(request())).resolves.toEqual({
			orgId: 'org-1',
			keyId: 'key-1',
			scopes: ['read'],
			planSlug: 'inactive',
			rateLimitConsumed: true,
			rateLimit: { limit: 100, remaining: 99, resetAt: 1_800_000_000_000 }
		});
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		expect(mockServerMutation).toHaveBeenCalledWith('v1api:authenticateApiKey', {
			_secret: 'internal-secret',
			keyHash: 'sha256-key'
		});
	});

	it('maps an exhausted atomic bucket to the public 429 envelope', async () => {
		mockServerMutation.mockResolvedValue({
			status: 'rate_limited',
			planSlug: 'inactive',
			limit: 100,
			remaining: 0,
			resetAt: 1_800_000_000_000,
			retryAfter: 17
		});

		const response = await authenticateApiKey(request());
		expect(response).toBeInstanceOf(Response);
		expect((response as Response).status).toBe(429);
		await expect((response as Response).json()).resolves.toMatchObject({
			error: { code: 'RATE_LIMITED' }
		});
	});

	it('records the exact plan tier for the canonical edge response hop', async () => {
		mockServerMutation.mockResolvedValue({
			status: 'allowed',
			orgId: 'org-1',
			keyId: 'key-1',
			scopes: ['read'],
			planSlug: 'organization',
			limit: 1_000,
			remaining: 999,
			resetAt: 1_800_000_000_000
		});
		await withApiV1RateTierSignal(async () => {
			await authenticateApiKey(request());
			expect(getApiV1RateTierSignal()).toBe('organization');
		});
	});

	it('records an invalid-key signal only after exact Convex authentication', async () => {
		mockServerMutation.mockResolvedValue(null);
		await withApiV1RateTierSignal(async () => {
			const response = await authenticateApiKey(request());
			expect((response as Response).status).toBe(401);
			expect(getApiV1RateTierSignal()).toBe('invalid');
		});
	});

	it('does not touch Convex for a malformed Authorization header', async () => {
		const response = await authenticateApiKey(
			new Request('https://commons.example/api/v1/events', {
				headers: { Authorization: 'Basic nope' }
			})
		);
		expect(response).toBeInstanceOf(Response);
		expect((response as Response).status).toBe(401);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects prefixed lookalikes before hashing or Convex', async () => {
		const response = await authenticateApiKey(request('ck_live_attacker'));
		expect((response as Response).status).toBe(401);
		expect(mockHashApiKey).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});
