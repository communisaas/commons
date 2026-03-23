/**
 * Unit tests for OAuth Security (oauth-security.ts)
 *
 * Tests validateOAuthSession and checkAnalyticsPermission — the API-level
 * authorization layer that protects analytics endpoints using OAuth sessions.
 *
 * Security properties tested:
 * - Session extraction from cookies (auth-session cookie parsing)
 * - Missing/malformed cookie rejection
 * - Expired session rejection
 * - Permission checks based on user activity (templates, campaigns)
 * - Endpoint-specific authorization (sheaf-fusion, test-clustering, create-test-data)
 * - Rate limit constant verification
 * - Error isolation (catch-all returns { valid: false })
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockSessionFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock('$lib/core/db', () => ({
	db: {
		session: {
			findUnique: (...args: unknown[]) => mockSessionFindUnique(...args)
		},
		user: {
			findUnique: (...args: unknown[]) => mockUserFindUnique(...args)
		}
	}
}));

import {
	validateOAuthSession,
	checkAnalyticsPermission,
	OAUTH_RATE_LIMITS
} from '$lib/core/auth/oauth-security';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(cookieHeader?: string): Request {
	const headers = new Headers();
	if (cookieHeader !== undefined) {
		headers.set('cookie', cookieHeader);
	}
	return new Request('https://example.com/api/analytics', { headers });
}

function makeSessionRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'session-abc-123',
		userId: 'user-001',
		expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 1 day from now
		...overrides
	};
}

function makeUserRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'user-001',
		templates: [],
		campaigns: [],
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('oauth-security', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// =========================================================================
	// validateOAuthSession
	// =========================================================================

	describe('validateOAuthSession', () => {
		describe('missing cookies', () => {
			it('should return invalid when no cookie header exists', async () => {
				const request = makeRequest(); // No cookie header at all

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('No session cookie');
			});

			it('should return invalid when cookie header is empty string', async () => {
				const request = makeRequest('');

				const result = await validateOAuthSession(request);

				// Empty string is falsy, so "No session cookie"
				expect(result.valid).toBe(false);
				expect(result.error).toBe('No session cookie');
			});
		});

		describe('missing auth-session cookie', () => {
			it('should return invalid when other cookies exist but not auth-session', async () => {
				const request = makeRequest('theme=dark; lang=en');

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('No auth session found');
			});

			it('should return invalid for similar but incorrect cookie names', async () => {
				const request = makeRequest('auth_session=some-value; session=other');

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('No auth session found');
			});

			it('should return invalid for "auth-sessions" (extra s)', async () => {
				const request = makeRequest('auth-sessions=some-value');

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('No auth session found');
			});
		});

		describe('session extraction from cookies', () => {
			it('should extract session ID from auth-session cookie', async () => {
				const request = makeRequest('auth-session=my-session-id-123');
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({ id: 'my-session-id-123' })
				);

				await validateOAuthSession(request);

				expect(mockSessionFindUnique).toHaveBeenCalledWith({
					where: { id: 'my-session-id-123' }
				});
			});

			it('should extract session from multiple cookies', async () => {
				const request = makeRequest(
					'theme=dark; auth-session=abc-session; lang=en'
				);
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({ id: 'abc-session' })
				);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(true);
				expect(mockSessionFindUnique).toHaveBeenCalledWith(
					expect.objectContaining({
						where: { id: 'abc-session' }
					})
				);
			});

			it('should handle session ID with special characters', async () => {
				const sessionId = 'a1b2c3d4e5f6789012345678';
				const request = makeRequest(`auth-session=${sessionId}`);
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({ id: sessionId })
				);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(true);
			});

			it('should stop at semicolon when extracting session value', async () => {
				const request = makeRequest('auth-session=session123; other=val');
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({ id: 'session123' })
				);

				await validateOAuthSession(request);

				expect(mockSessionFindUnique).toHaveBeenCalledWith(
					expect.objectContaining({
						where: { id: 'session123' }
					})
				);
			});
		});

		describe('invalid session in database', () => {
			it('should return invalid when session not found in database', async () => {
				const request = makeRequest('auth-session=nonexistent');
				mockSessionFindUnique.mockResolvedValue(null);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Invalid session');
			});
		});

		describe('expired session', () => {
			it('should return invalid when session is expired', async () => {
				const request = makeRequest('auth-session=expired-session');
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({
						expiresAt: new Date(Date.now() - 1000) // expired 1 second ago
					})
				);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Session expired');
			});

			it('should treat session expiring exactly now as expired', async () => {
				const now = new Date();
				const request = makeRequest('auth-session=now-session');
				// expiresAt < new Date() — if expiresAt === current time, comparison depends
				// on timing; set it to 1ms before to ensure it's reliably expired
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({
						expiresAt: new Date(now.getTime() - 1)
					})
				);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Session expired');
			});

			it('should return invalid for session that expired long ago', async () => {
				const request = makeRequest('auth-session=old-session');
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({
						expiresAt: new Date('2024-01-01')
					})
				);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Session expired');
			});
		});

		describe('valid session', () => {
			it('should return valid with user data for active session', async () => {
				const request = makeRequest('auth-session=valid-session');
				const sessionRecord = makeSessionRecord({
					id: 'valid-session',
					userId: 'user-42',
					expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
				});
				mockSessionFindUnique.mockResolvedValue(sessionRecord);

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(true);
				expect(result.user_id).toBe('user-42');
				expect(result.session_expires).toEqual(sessionRecord.expiresAt);
				expect(result.error).toBeUndefined();
			});

			it('should include session expiry date in the response', async () => {
				const futureDate = new Date('2027-01-01');
				const request = makeRequest('auth-session=future-session');
				mockSessionFindUnique.mockResolvedValue(
					makeSessionRecord({ expiresAt: futureDate })
				);

				const result = await validateOAuthSession(request);

				expect(result.session_expires).toEqual(futureDate);
			});
		});

		describe('error handling', () => {
			it('should catch database errors and return invalid', async () => {
				const request = makeRequest('auth-session=crash-session');
				mockSessionFindUnique.mockRejectedValue(new Error('DB crash'));

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Session validation failed');
			});

			it('should catch non-Error exceptions and return invalid', async () => {
				const request = makeRequest('auth-session=string-error');
				mockSessionFindUnique.mockRejectedValue('some string error');

				const result = await validateOAuthSession(request);

				expect(result.valid).toBe(false);
				expect(result.error).toBe('Session validation failed');
			});
		});
	});

	// =========================================================================
	// checkAnalyticsPermission
	// =========================================================================

	describe('checkAnalyticsPermission', () => {
		describe('user not found', () => {
			it('should deny access when user does not exist', async () => {
				mockUserFindUnique.mockResolvedValue(null);

				const result = await checkAnalyticsPermission('user-nonexistent', 'sheaf-fusion');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('User not found');
			});
		});

		describe('sheaf-fusion endpoint', () => {
			it('should allow user with templates', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({
						templates: [{ id: 'tmpl-1' }],
						campaigns: []
					})
				);

				const result = await checkAnalyticsPermission('user-001', 'sheaf-fusion');

				expect(result.allowed).toBe(true);
				expect(result.reason).toBeUndefined();
			});

			it('should allow user with campaigns', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({
						templates: [],
						campaigns: [{ id: 'camp-1' }]
					})
				);

				const result = await checkAnalyticsPermission('user-001', 'sheaf-fusion');

				expect(result.allowed).toBe(true);
			});

			it('should allow user with both templates and campaigns', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({
						templates: [{ id: 'tmpl-1' }],
						campaigns: [{ id: 'camp-1' }]
					})
				);

				const result = await checkAnalyticsPermission('user-001', 'sheaf-fusion');

				expect(result.allowed).toBe(true);
			});

			it('should deny inactive user (no templates or campaigns)', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates: [], campaigns: [] })
				);

				const result = await checkAnalyticsPermission('user-001', 'sheaf-fusion');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Must be active user to access data fusion');
			});
		});

		describe('test-clustering endpoint', () => {
			it('should allow any logged-in user', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates: [], campaigns: [] })
				);

				const result = await checkAnalyticsPermission('user-001', 'test-clustering');

				expect(result.allowed).toBe(true);
			});

			it('should allow inactive users (no templates or campaigns)', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates: [], campaigns: [] })
				);

				const result = await checkAnalyticsPermission('user-001', 'test-clustering');

				expect(result.allowed).toBe(true);
				expect(result.reason).toBeUndefined();
			});
		});

		describe('create-test-data endpoint', () => {
			it('should allow developer users (>5 templates)', async () => {
				const templates = Array.from({ length: 6 }, (_, i) => ({ id: `tmpl-${i}` }));
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(true);
			});

			it('should allow users with exactly 6 templates', async () => {
				const templates = Array.from({ length: 6 }, (_, i) => ({ id: `tmpl-${i}` }));
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(true);
			});

			it('should deny users with exactly 5 templates (boundary)', async () => {
				const templates = Array.from({ length: 5 }, (_, i) => ({ id: `tmpl-${i}` }));
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Admin access required');
			});

			it('should deny users with 0 templates', async () => {
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates: [] })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Admin access required');
			});

			it('should deny users with 4 templates', async () => {
				const templates = Array.from({ length: 4 }, (_, i) => ({ id: `tmpl-${i}` }));
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(false);
			});

			it('should allow users with many templates (10)', async () => {
				const templates = Array.from({ length: 10 }, (_, i) => ({ id: `tmpl-${i}` }));
				mockUserFindUnique.mockResolvedValue(
					makeUserRecord({ templates })
				);

				const result = await checkAnalyticsPermission('user-001', 'create-test-data');

				expect(result.allowed).toBe(true);
			});
		});

		describe('unknown endpoint', () => {
			it('should deny access for unknown endpoints', async () => {
				mockUserFindUnique.mockResolvedValue(makeUserRecord());

				const result = await checkAnalyticsPermission('user-001', 'unknown-endpoint');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Unknown endpoint');
			});

			it('should deny access for empty endpoint', async () => {
				mockUserFindUnique.mockResolvedValue(makeUserRecord());

				const result = await checkAnalyticsPermission('user-001', '');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Unknown endpoint');
			});
		});

		describe('error handling', () => {
			it('should return denied on database error', async () => {
				mockUserFindUnique.mockRejectedValue(new Error('Connection lost'));

				const result = await checkAnalyticsPermission('user-001', 'sheaf-fusion');

				expect(result.allowed).toBe(false);
				expect(result.reason).toBe('Permission check failed');
			});

			it('should not leak error details in the reason', async () => {
				mockUserFindUnique.mockRejectedValue(
					new Error('FATAL: password authentication failed')
				);

				const result = await checkAnalyticsPermission('user-001', 'test-clustering');

				expect(result.reason).toBe('Permission check failed');
				expect(result.reason).not.toContain('password');
			});
		});

		describe('database query', () => {
			it('should query the correct user with templates and campaigns', async () => {
				mockUserFindUnique.mockResolvedValue(makeUserRecord());

				await checkAnalyticsPermission('user-42', 'test-clustering');

				expect(mockUserFindUnique).toHaveBeenCalledWith({
					where: { id: 'user-42' },
					include: {
						templates: { select: { id: true } },
						campaigns: { select: { id: true } }
					}
				});
			});
		});
	});

	// =========================================================================
	// OAUTH_RATE_LIMITS
	// =========================================================================

	describe('OAUTH_RATE_LIMITS', () => {
		it('should define rate limits for sheaf-fusion', () => {
			expect(OAUTH_RATE_LIMITS['sheaf-fusion']).toBe(5);
		});

		it('should define rate limits for test-clustering', () => {
			expect(OAUTH_RATE_LIMITS['test-clustering']).toBe(10);
		});

		it('should define rate limits for create-test-data', () => {
			expect(OAUTH_RATE_LIMITS['create-test-data']).toBe(1);
		});

		it('should have higher limits for lighter operations', () => {
			expect(OAUTH_RATE_LIMITS['test-clustering']).toBeGreaterThan(
				OAUTH_RATE_LIMITS['sheaf-fusion']
			);
			expect(OAUTH_RATE_LIMITS['sheaf-fusion']).toBeGreaterThan(
				OAUTH_RATE_LIMITS['create-test-data']
			);
		});

		it('should define exactly 3 rate limits', () => {
			expect(Object.keys(OAUTH_RATE_LIMITS)).toHaveLength(3);
		});
	});
});
