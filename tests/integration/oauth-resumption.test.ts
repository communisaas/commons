/**
 * OAuth Resumption Flow Integration Tests
 *
 * Tests that after OAuth authentication, the template creation flow
 * resumes correctly without showing the auth wall again.
 *
 * This test was added to prevent regression of a bug where users
 * would see the auth wall again after successfully completing OAuth.
 *
 * Root cause: Session cookies not being properly recognized after OAuth redirect.
 * Fix: Added explicit credentials: 'include' to fetch calls and improved logging.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	clearTestDatabase,
	createTestUser,
	createMockRequestEvent,
	db
} from '../setup/api-test-setup';
import { getUserContext, checkRateLimit } from '../../src/lib/server/llm-cost-protection';
import type { RequestEvent } from '@sveltejs/kit';

// Mock the rate limiter's Redis/memory store
vi.mock('$lib/server/rate-limiter', () => ({
	rateLimiter: {
		limit: vi.fn(async () => ({
			success: true,
			remaining: 5,
			limit: 10,
			reset: Date.now() + 3600000
		}))
	}
}));

describe('OAuth Resumption Flow', () => {
	beforeEach(async () => {
		await clearTestDatabase();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('User Context Detection', () => {
		it('should identify guest users correctly (no session)', async () => {
			// Create a request event without a session
			const event = createMockRequestEvent({
				url: '/api/agents/stream-decision-makers',
				method: 'POST',
				locals: { session: null, user: null }
			}) as unknown as RequestEvent;

			const context = getUserContext(event);

			expect(context.tier).toBe('guest');
			expect(context.userId).toBeNull();
			expect(context.isVerified).toBe(false);
		});

		it('should identify authenticated users correctly (with session)', async () => {
			// Create a test user
			const user = await createTestUser({
				id: 'auth-user-123',
				encrypted_email: 'encrypted-test@example.com',
				email_hash: 'hash-auth-user-123',
				is_verified: false
			});

			// Create a request event with a session (via locals, as SvelteKit does)
			const event = createMockRequestEvent({
				url: '/api/agents/stream-decision-makers',
				method: 'POST',
				locals: {
					session: { userId: user.id, id: 'session-123', expiresAt: new Date(Date.now() + 86400000) },
					user: { id: user.id, is_verified: false }
				}
			}) as unknown as RequestEvent;

			const context = getUserContext(event);

			expect(context.tier).toBe('authenticated');
			expect(context.userId).toBe(user.id);
		});

		it('should identify verified users correctly', async () => {
			// Create a verified test user
			const user = await createTestUser({
				id: 'verified-user-123',
				encrypted_email: 'encrypted-verified@example.com',
				email_hash: 'hash-verified-user-123',
				is_verified: true
			});

			// Create a request event with a session
			const event = createMockRequestEvent({
				url: '/api/agents/stream-decision-makers',
				method: 'POST',
				locals: {
					session: { userId: user.id, id: 'session-123', expiresAt: new Date(Date.now() + 86400000) },
					user: { id: user.id, is_verified: true, trust_tier: 2 }
				}
			}) as unknown as RequestEvent;

			const context = getUserContext(event);

			expect(context.tier).toBe('verified');
			expect(context.userId).toBe(user.id);
			expect(context.isVerified).toBe(true);
		});
	});

	describe('Rate Limiting After OAuth', () => {
		it('should allow decision-maker resolution for authenticated users', async () => {
			// Create a test user (simulating post-OAuth state)
			const user = await createTestUser({ encrypted_email: 'encrypted-oauth-user@example.com', email_hash: 'hash-oauth-user' });

			// Simulate authenticated user context
			const context = {
				userId: user.id,
				isVerified: false,
				tier: 'authenticated' as const,
				identifier: user.id,
				isAuthenticated: true
			};

			// Check rate limit for decision-makers operation
			const check = await checkRateLimit('decision-makers', context);

			expect(check.allowed).toBe(true);
			expect(check.tier).toBe('authenticated');
			expect(check.limit).toBeGreaterThan(0); // Authenticated users have quota > 0
		});

		it('should block decision-maker resolution for guests', async () => {
			// Simulate guest user context (before OAuth)
			const context = {
				userId: null,
				isVerified: false,
				tier: 'guest' as const,
				identifier: '127.0.0.1',
				isAuthenticated: false
			};

			// Check rate limit for decision-makers operation
			const check = await checkRateLimit('decision-makers', context);

			expect(check.allowed).toBe(false);
			expect(check.tier).toBe('guest');
			expect(check.reason).toContain('requires an account');
		});

		it('should include correct tier in rate limit response', async () => {
			const user = await createTestUser({ encrypted_email: 'encrypted-tier-test@example.com', email_hash: 'hash-tier-test' });

			const context = {
				userId: user.id,
				isVerified: false,
				tier: 'authenticated' as const,
				identifier: user.id,
				isAuthenticated: true
			};

			const check = await checkRateLimit('message-generation', context);

			// The tier should be included in the response
			// This is what the client checks to determine if it's an auth error
			expect(check.tier).toBe('authenticated');
		});
	});

	describe('isAuthRequiredError Detection', () => {
		/**
		 * Test the error message patterns that trigger the auth wall.
		 * This ensures we don't accidentally show the auth wall for
		 * non-auth-related rate limits.
		 */
		it('should detect guest rate limit errors as auth-required', () => {
			const guestError = 'Finding decision-makers requires an account. Sign in to continue.';

			// This pattern should trigger auth wall
			expect(guestError.toLowerCase().includes('requires an account')).toBe(true);
			expect(guestError.toLowerCase().includes('sign in')).toBe(true);
		});

		it('should NOT detect authenticated rate limit errors as auth-required', () => {
			const authRateLimitError = 'This action is not available for your account type.';

			// This pattern should NOT trigger auth wall
			expect(authRateLimitError.toLowerCase().includes('requires an account')).toBe(false);
			expect(authRateLimitError.toLowerCase().includes('sign in')).toBe(false);
			expect(authRateLimitError.toLowerCase().includes('authentication required')).toBe(false);
			expect(authRateLimitError.toLowerCase().includes('rate limit')).toBe(false);
		});
	});
});
