/**
 * Unit Tests — Delegation Grant CRUD
 *
 * Tests grant creation, listing, updating, revocation, trust tier gating,
 * and the 3-grant limit enforcement. All database calls are mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockFindMany = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockCount = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('$lib/core/db', () => ({
	prisma: {
		delegationGrant: {
			findMany: mockFindMany,
			findUnique: mockFindUnique,
			count: mockCount,
			create: mockCreate,
			update: mockUpdate
		}
	},
	db: {
		delegationGrant: {
			findMany: mockFindMany,
			findUnique: mockFindUnique,
			count: mockCount,
			create: mockCreate,
			update: mockUpdate
		}
	}
}));

vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	encryptPii: vi.fn().mockResolvedValue(null),
	decryptPii: vi.fn().mockResolvedValue('decrypted policy text')
}));

vi.mock('$app/environment', () => ({ dev: true }));

// ============================================================================
// Helpers
// ============================================================================

function makeLocals(trustTier: number, userId = 'user-1') {
	return {
		session: { userId, id: 'sess-1', createdAt: new Date(), expiresAt: new Date() },
		user: {
			id: userId,
			email: 'test@example.com',
			name: 'Test User',
			avatar: null,
			is_verified: true,
			verification_method: null,
			verified_at: null,
			trust_tier: trustTier,
			passkey_credential_id: null,
			did_key: null,
			identity_commitment: null,
			district_hash: null,
			district_verified: false,
			role: null,
			organization: null,
			location: null,
			connection: null,
			profile_completed_at: null,
			profile_visibility: 'private',
			trust_score: 0,
			reputation_tier: 'novice',
			wallet_address: null,
			wallet_type: null,
			near_account_id: null,
			near_derived_scroll_address: null,
			createdAt: new Date(),
			updatedAt: new Date()
		}
	};
}

function makeRequest(body: Record<string, unknown>) {
	return {
		json: () => Promise.resolve(body)
	} as unknown as Request;
}

// ============================================================================
// Tests
// ============================================================================

describe('Delegation Grant CRUD', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Trust Tier Gating', () => {
		it('rejects unauthenticated users', async () => {
			const { GET } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			try {
				await GET({
					locals: { session: null, user: null },
					request: new Request('http://localhost')
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(401);
			}
		});

		it('rejects Tier 2 users (below threshold)', async () => {
			const { GET } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			try {
				await GET({
					locals: makeLocals(2),
					request: new Request('http://localhost')
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(403);
			}
		});

		it('allows Tier 3 users', async () => {
			const { GET } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			mockFindMany.mockResolvedValue([]);

			const response = await GET({
				locals: makeLocals(3),
				request: new Request('http://localhost')
			} as never);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.grants).toEqual([]);
		});

		it('allows Tier 5 users', async () => {
			const { GET } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			mockFindMany.mockResolvedValue([]);

			const response = await GET({
				locals: makeLocals(5),
				request: new Request('http://localhost')
			} as never);

			expect(response.status).toBe(200);
		});
	});

	describe('Grant Creation', () => {
		it('creates a grant with valid inputs', async () => {
			const { POST } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			mockCount.mockResolvedValue(0);
			mockCreate.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				scope: 'campaign_sign',
				policyText: 'Sign climate petitions',
				issueFilter: ['climate'],
				orgFilter: [],
				maxActionsPerDay: 5,
				requireReviewAbove: 10,
				status: 'active',
				createdAt: new Date()
			});

			const response = await POST({
				locals: makeLocals(3),
				request: makeRequest({
					scope: 'campaign_sign',
					policyText: 'Sign climate petitions',
					issueFilter: ['Climate'],
					maxActionsPerDay: 5
				})
			} as never);

			expect(response.status).toBe(201);
			const data = await response.json();
			expect(data.grant.scope).toBe('campaign_sign');
			expect(mockCreate).toHaveBeenCalledOnce();
		});

		it('rejects invalid scope', async () => {
			const { POST } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			try {
				await POST({
					locals: makeLocals(3),
					request: makeRequest({ scope: 'invalid', policyText: 'test policy' })
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(400);
			}
		});

		it('enforces max 3 active grants', async () => {
			const { POST } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			mockCount.mockResolvedValue(3);

			try {
				await POST({
					locals: makeLocals(3),
					request: makeRequest({
						scope: 'full',
						policyText: 'Do everything please'
					})
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(429);
			}
		});

		it('clamps maxActionsPerDay to 1-20 range', async () => {
			const { POST } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			mockCount.mockResolvedValue(0);
			mockCreate.mockImplementation((args: { data: Record<string, unknown> }) => ({
				...args.data,
				id: 'grant-1'
			}));

			await POST({
				locals: makeLocals(3),
				request: makeRequest({
					scope: 'full',
					policyText: 'Do everything',
					maxActionsPerDay: 100
				})
			} as never);

			expect(mockCreate).toHaveBeenCalledOnce();
			const createArg = mockCreate.mock.calls[0][0];
			expect(createArg.data.maxActionsPerDay).toBe(20);
		});

		it('rejects short policy text', async () => {
			const { POST } = await import(
				'../../../src/routes/api/delegation/+server'
			);

			try {
				await POST({
					locals: makeLocals(3),
					request: makeRequest({ scope: 'full', policyText: 'hi' })
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(400);
			}
		});
	});

	describe('Grant Revocation', () => {
		it('revokes an active grant', async () => {
			const { DELETE } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				status: 'active'
			});
			mockUpdate.mockResolvedValue({});

			const response = await DELETE({
				params: { id: 'grant-1' },
				locals: makeLocals(3)
			} as never);

			expect(response.status).toBe(200);
			expect(mockUpdate).toHaveBeenCalledWith({
				where: { id: 'grant-1' },
				data: expect.objectContaining({
					status: 'revoked',
					revokedAt: expect.any(Date)
				})
			});
		});

		it('rejects revocation of another user\'s grant', async () => {
			const { DELETE } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'other-user',
				status: 'active'
			});

			try {
				await DELETE({
					params: { id: 'grant-1' },
					locals: makeLocals(3)
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(403);
			}
		});

		it('returns success for already-revoked grant', async () => {
			const { DELETE } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				status: 'revoked'
			});

			const response = await DELETE({
				params: { id: 'grant-1' },
				locals: makeLocals(3)
			} as never);

			expect(response.status).toBe(200);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});

	describe('Grant Update (PATCH)', () => {
		it('pauses an active grant', async () => {
			const { PATCH } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				status: 'active'
			});
			mockUpdate.mockResolvedValue({ id: 'grant-1', status: 'paused' });

			const response = await PATCH({
				params: { id: 'grant-1' },
				locals: makeLocals(3),
				request: makeRequest({ status: 'paused' })
			} as never);

			expect(response.status).toBe(200);
			expect(mockUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ status: 'paused' })
				})
			);
		});

		it('prevents modification of revoked grants', async () => {
			const { PATCH } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				status: 'revoked'
			});

			try {
				await PATCH({
					params: { id: 'grant-1' },
					locals: makeLocals(3),
					request: makeRequest({ status: 'active' })
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(400);
			}
		});

		it('rejects invalid status transitions', async () => {
			const { PATCH } = await import(
				'../../../src/routes/api/delegation/[id]/+server'
			);

			mockFindUnique.mockResolvedValue({
				id: 'grant-1',
				userId: 'user-1',
				status: 'active'
			});

			try {
				await PATCH({
					params: { id: 'grant-1' },
					locals: makeLocals(3),
					request: makeRequest({ status: 'expired' })
				} as never);
				expect.fail('Should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(400);
			}
		});
	});
});
