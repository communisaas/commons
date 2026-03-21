/**
 * Unit Tests: STANCE_POSITIONS feature gate + position endpoints
 *
 * Tests the position registration, count, confirm-send, batch-register,
 * and engagement-by-district endpoints which are all gated behind
 * FEATURES.STANCE_POSITIONS.
 *
 * Test groups:
 * 1. Feature gate (STANCE_POSITIONS = false) — all endpoints throw 404
 * 2. Feature gate passthrough (STANCE_POSITIONS = true) — gate passes, auth enforced
 * 3. Position registration — validation, upsert, template lookup
 * 4. Position count — public aggregate counts
 * 5. Engagement by district — k-anonymity threshold
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockUserFindUnique,
	mockTemplateFindUnique,
	mockShadowAtlasFindFirst,
	mockPositionRegistrationFindUnique,
	mockPositionRegistrationCreate,
	mockPositionRegistrationCount,
	mockPositionRegistrationGroupBy,
	mockPositionDeliveryCreate,
	mockPositionDeliveryCreateMany,
	mockRegisterPosition,
	mockGetPositionCounts,
	mockGetEngagementByDistrict,
	mockConfirmMailtoSend,
	mockBatchRegisterDeliveries
} = vi.hoisted(() => ({
	mockFeatures: {
		DEBATE: true as boolean,
		CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: false as boolean,
		WALLET: true,
		ANALYTICS_EXPANDED: true,
		AB_TESTING: true,
		PUBLIC_API: false
	},
	mockUserFindUnique: vi.fn(),
	mockTemplateFindUnique: vi.fn(),
	mockShadowAtlasFindFirst: vi.fn(),
	mockPositionRegistrationFindUnique: vi.fn(),
	mockPositionRegistrationCreate: vi.fn(),
	mockPositionRegistrationCount: vi.fn(),
	mockPositionRegistrationGroupBy: vi.fn(),
	mockPositionDeliveryCreate: vi.fn(),
	mockPositionDeliveryCreateMany: vi.fn(),
	mockRegisterPosition: vi.fn(),
	mockGetPositionCounts: vi.fn(),
	mockGetEngagementByDistrict: vi.fn(),
	mockConfirmMailtoSend: vi.fn(),
	mockBatchRegisterDeliveries: vi.fn()
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: mockFeatures
}));

vi.mock('$lib/core/db', () => ({
	prisma: {
		user: { findUnique: mockUserFindUnique },
		template: { findUnique: mockTemplateFindUnique },
		shadowAtlasRegistration: { findFirst: mockShadowAtlasFindFirst },
		positionRegistration: {
			findUnique: mockPositionRegistrationFindUnique,
			create: mockPositionRegistrationCreate,
			count: mockPositionRegistrationCount,
			groupBy: mockPositionRegistrationGroupBy
		},
		positionDelivery: {
			create: mockPositionDeliveryCreate,
			createMany: mockPositionDeliveryCreateMany
		}
	}
}));

vi.mock('$lib/services/positionService', () => ({
	registerPosition: mockRegisterPosition,
	getPositionCounts: mockGetPositionCounts,
	getEngagementByDistrict: mockGetEngagementByDistrict,
	confirmMailtoSend: mockConfirmMailtoSend,
	batchRegisterDeliveries: mockBatchRegisterDeliveries
}));

// Import handlers AFTER mocks
import { POST as registerPositionHandler } from '../../../src/routes/api/positions/register/+server';
import { GET as getCount } from '../../../src/routes/api/positions/count/[templateId]/+server';
import { POST as confirmSend } from '../../../src/routes/api/positions/confirm-send/+server';
import { POST as batchRegister } from '../../../src/routes/api/positions/batch-register/+server';
import { GET as getEngagement } from '../../../src/routes/api/positions/engagement-by-district/[templateId]/+server';

// =============================================================================
// HELPERS
// =============================================================================

function buildJsonRequest(body: Record<string, unknown>, url = 'http://localhost/api/positions/register'): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function buildEventArgs(overrides: Record<string, unknown> = {}) {
	return {
		request: buildJsonRequest(overrides.body as Record<string, unknown> ?? {}),
		locals: overrides.locals ?? { session: { userId: 'user-1' } },
		params: overrides.params ?? {},
		url: overrides.url ?? new URL('http://localhost/api/positions/register'),
		...overrides
	} as any;
}

// =============================================================================
// TESTS
// =============================================================================

describe('STANCE_POSITIONS feature gate', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	// =========================================================================
	// Group 1: Feature gate (STANCE_POSITIONS = false) — all throw 404
	// =========================================================================
	describe('when STANCE_POSITIONS = false', () => {
		beforeEach(() => {
			mockFeatures.STANCE_POSITIONS = false;
		});

		it('POST /api/positions/register throws 404', async () => {
			await expect(
				registerPositionHandler(buildEventArgs({
					body: { templateId: 't1', stance: 'support', identityCommitment: 'ic1' }
				}))
			).rejects.toThrow();
		});

		it('GET /api/positions/count/[templateId] throws 404', async () => {
			await expect(
				getCount({
					params: { templateId: 'tmpl-1' },
					url: new URL('http://localhost/api/positions/count/tmpl-1')
				} as any)
			).rejects.toThrow();
		});

		it('POST /api/positions/confirm-send throws 404', async () => {
			await expect(
				confirmSend(buildEventArgs({
					body: { templateId: 't1' }
				}))
			).rejects.toThrow();
		});

		it('POST /api/positions/batch-register throws 404', async () => {
			await expect(
				batchRegister(buildEventArgs({
					body: { registrationId: 'r1', recipients: [{ name: 'Rep', deliveryMethod: 'cwc' }] }
				}))
			).rejects.toThrow();
		});

		it('GET /api/positions/engagement-by-district/[templateId] throws 404', async () => {
			await expect(
				getEngagement({
					params: { templateId: 'tmpl-1' },
					url: new URL('http://localhost/api/positions/engagement-by-district/tmpl-1')
				} as any)
			).rejects.toThrow();
		});
	});

	// =========================================================================
	// Group 2: Feature gate passthrough (STANCE_POSITIONS = true)
	// =========================================================================
	describe('when STANCE_POSITIONS = true', () => {
		beforeEach(() => {
			mockFeatures.STANCE_POSITIONS = true;
		});

		it('POST /api/positions/register without auth returns 401', async () => {
			const response = await registerPositionHandler(buildEventArgs({
				locals: { session: null },
				body: { templateId: 't1', stance: 'support' }
			}));
			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error).toBe('Authentication required');
		});

		it('GET /api/positions/count/[templateId] returns position counts (public endpoint)', async () => {
			mockGetPositionCounts.mockResolvedValueOnce({ support: 5, oppose: 2, districts: 3 });

			const response = await getCount({
				params: { templateId: 'tmpl-1' },
				url: new URL('http://localhost/api/positions/count/tmpl-1')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toEqual({ support: 5, oppose: 2, districts: 3 });
		});
	});

	// =========================================================================
	// Group 3: Position registration (STANCE_POSITIONS = true)
	// =========================================================================
	describe('position registration', () => {
		beforeEach(() => {
			mockFeatures.STANCE_POSITIONS = true;
		});

		it('valid registration returns { registrationId, isNew: true, count }', async () => {
			mockUserFindUnique.mockResolvedValueOnce({ identity_commitment: 'ic-abc' });
			mockTemplateFindUnique.mockResolvedValueOnce({ id: 'tmpl-1' });
			mockShadowAtlasFindFirst.mockResolvedValueOnce(null);
			mockRegisterPosition.mockResolvedValueOnce({ id: 'reg-1', isNew: true });
			mockGetPositionCounts.mockResolvedValueOnce({ support: 1, oppose: 0, districts: 0 });

			const response = await registerPositionHandler(buildEventArgs({
				body: { templateId: 'tmpl-1', stance: 'support' }
			}));

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.registrationId).toBe('reg-1');
			expect(data.isNew).toBe(true);
			expect(data.count).toEqual({ support: 1, oppose: 0, districts: 0 });
		});

		it('duplicate registration returns { registrationId, isNew: false, count }', async () => {
			mockUserFindUnique.mockResolvedValueOnce({ identity_commitment: 'ic-abc' });
			mockTemplateFindUnique.mockResolvedValueOnce({ id: 'tmpl-1' });
			mockShadowAtlasFindFirst.mockResolvedValueOnce(null);
			mockRegisterPosition.mockResolvedValueOnce({ id: 'reg-1', isNew: false });
			mockGetPositionCounts.mockResolvedValueOnce({ support: 5, oppose: 3, districts: 2 });

			const response = await registerPositionHandler(buildEventArgs({
				body: { templateId: 'tmpl-1', stance: 'oppose' }
			}));

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.registrationId).toBe('reg-1');
			expect(data.isNew).toBe(false);
			expect(data.count).toEqual({ support: 5, oppose: 3, districts: 2 });
		});

		it('missing templateId returns 400', async () => {
			const response = await registerPositionHandler(buildEventArgs({
				body: { stance: 'support' }
			}));

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/templateId/);
		});

		it('invalid stance returns 400', async () => {
			const response = await registerPositionHandler(buildEventArgs({
				body: { templateId: 'tmpl-1', stance: 'neutral' }
			}));

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/stance/);
		});

		it('user without identity_commitment returns 403', async () => {
			mockUserFindUnique.mockResolvedValueOnce({ identity_commitment: null });

			const response = await registerPositionHandler(buildEventArgs({
				body: { templateId: 'tmpl-1', stance: 'support' }
			}));

			expect(response.status).toBe(403);
			const data = await response.json();
			expect(data.error).toMatch(/Identity verification required/);
		});

		it('template not found returns 404', async () => {
			mockUserFindUnique.mockResolvedValueOnce({ identity_commitment: 'ic-abc' });
			mockTemplateFindUnique.mockResolvedValueOnce(null);

			const response = await registerPositionHandler(buildEventArgs({
				body: { templateId: 'nonexistent', stance: 'support' }
			}));

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error).toMatch(/Template not found/);
		});
	});

	// =========================================================================
	// Group 4: Position count (STANCE_POSITIONS = true)
	// =========================================================================
	describe('position count', () => {
		beforeEach(() => {
			mockFeatures.STANCE_POSITIONS = true;
		});

		it('returns { support, oppose, districts } for valid template', async () => {
			mockGetPositionCounts.mockResolvedValueOnce({ support: 10, oppose: 4, districts: 5 });

			const response = await getCount({
				params: { templateId: 'tmpl-1' },
				url: new URL('http://localhost/api/positions/count/tmpl-1')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toEqual({ support: 10, oppose: 4, districts: 5 });
		});

		it('returns zeros for template with no positions', async () => {
			mockGetPositionCounts.mockResolvedValueOnce({ support: 0, oppose: 0, districts: 0 });

			const response = await getCount({
				params: { templateId: 'tmpl-empty' },
				url: new URL('http://localhost/api/positions/count/tmpl-empty')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toEqual({ support: 0, oppose: 0, districts: 0 });
		});
	});

	// =========================================================================
	// Group 5: Engagement by district (STANCE_POSITIONS = true)
	// =========================================================================
	describe('engagement by district', () => {
		beforeEach(() => {
			mockFeatures.STANCE_POSITIONS = true;
		});

		it('returns district breakdown', async () => {
			mockTemplateFindUnique.mockResolvedValueOnce({ id: 'tmpl-1', is_public: true });
			mockGetEngagementByDistrict.mockResolvedValueOnce({
				template_id: 'tmpl-1',
				districts: [
					{
						district_code: 'CA-12',
						support: 8,
						oppose: 2,
						total: 10,
						support_percent: 80,
						is_user_district: false
					},
					{
						district_code: 'NY-03',
						support: 5,
						oppose: 4,
						total: 9,
						support_percent: 56,
						is_user_district: false
					}
				],
				aggregate: {
					total_districts: 2,
					total_positions: 19,
					total_support: 13,
					total_oppose: 6
				}
			});

			const response = await getEngagement({
				params: { templateId: 'tmpl-1' },
				url: new URL('http://localhost/api/positions/engagement-by-district/tmpl-1')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.template_id).toBe('tmpl-1');
			expect(data.districts).toHaveLength(2);
			expect(data.districts[0].district_code).toBe('CA-12');
			expect(data.aggregate.total_positions).toBe(19);
		});

		it('filters districts with < 3 positions (k-anonymity)', async () => {
			// The k-anonymity threshold is applied inside getEngagementByDistrict service.
			// The endpoint passes through whatever the service returns.
			// So we mock the service to return already-filtered data.
			mockTemplateFindUnique.mockResolvedValueOnce({ id: 'tmpl-1', is_public: true });
			mockGetEngagementByDistrict.mockResolvedValueOnce({
				template_id: 'tmpl-1',
				districts: [
					{
						district_code: 'CA-12',
						support: 5,
						oppose: 1,
						total: 6,
						support_percent: 83,
						is_user_district: false
					}
					// TX-07 had only 2 positions — filtered out by service
				],
				aggregate: {
					total_districts: 2,
					total_positions: 8,
					total_support: 6,
					total_oppose: 2
				}
			});

			const response = await getEngagement({
				params: { templateId: 'tmpl-1' },
				url: new URL('http://localhost/api/positions/engagement-by-district/tmpl-1')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			// Only 1 district returned (the one above threshold)
			expect(data.districts).toHaveLength(1);
			expect(data.districts[0].district_code).toBe('CA-12');
			// aggregate still reflects all districts including filtered ones
			expect(data.aggregate.total_districts).toBe(2);
		});

		it('returns empty districts for template with no engagement', async () => {
			mockTemplateFindUnique.mockResolvedValueOnce({ id: 'tmpl-1', is_public: true });
			mockGetEngagementByDistrict.mockResolvedValueOnce(null);

			const response = await getEngagement({
				params: { templateId: 'tmpl-1' },
				url: new URL('http://localhost/api/positions/engagement-by-district/tmpl-1')
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.districts).toEqual([]);
			expect(data.aggregate.total_positions).toBe(0);
		});
	});
});
