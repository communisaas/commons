/**
 * Unit Tests: Direct Delivery Recording
 *
 * Tests the stance-agnostic delivery recording path:
 * - POST /api/deliveries/record — SvelteKit endpoint
 * - recordDirectDeliveries — Convex mutation (via mock)
 * - getUserDeliveries — Convex query (via mock)
 *
 * Delivery persistence is keyed on pseudonymousId (HMAC-SHA256 of user.id),
 * available at tier 1+. No stance registration required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockServerQuery,
	mockServerMutation,
	mockComputePseudonymousId
} = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn(),
	mockComputePseudonymousId: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			getById: 'users.getById',
			getShadowAtlasRegistration: 'users.getShadowAtlasRegistration'
		},
		positions: {
			recordDirectDeliveries: 'positions.recordDirectDeliveries',
			getUserDeliveries: 'positions.getUserDeliveries'
		}
	}
}));

vi.mock('$lib/core/privacy/pseudonymous-id', () => ({
	computePseudonymousId: mockComputePseudonymousId
}));

// Import handler AFTER mocks
import { POST as recordDelivery } from '../../../src/routes/api/deliveries/record/+server';

// =============================================================================
// HELPERS
// =============================================================================

function buildJsonRequest(body: Record<string, unknown>, url = 'http://localhost/api/deliveries/record'): Request {
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
		url: overrides.url ?? new URL('http://localhost/api/deliveries/record'),
		...overrides
	} as any;
}

const validRecipients = [
	{ name: 'Sen. Jane Smith', email: 'jane@senate.gov', deliveryMethod: 'email' }
];

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/deliveries/record', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockComputePseudonymousId.mockReturnValue('pseudo-abc123');
		// Default: Shadow Atlas lookup returns null (tier 1 user, no district)
		mockServerQuery.mockResolvedValue(null);
		mockServerMutation.mockResolvedValue({ created: 1 });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Auth gate
	// =========================================================================

	it('returns 401 without authentication', async () => {
		const response = await recordDelivery(buildEventArgs({
			locals: { session: null },
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Authentication required');
	});

	it('returns 401 without session userId', async () => {
		const response = await recordDelivery(buildEventArgs({
			locals: { session: {} },
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));
		expect(response.status).toBe(401);
	});

	// =========================================================================
	// Input validation
	// =========================================================================

	it('returns 400 for missing templateId', async () => {
		const response = await recordDelivery(buildEventArgs({
			body: { recipients: validRecipients }
		}));
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toContain('templateId');
	});

	it('returns 400 for empty recipients array', async () => {
		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: [] }
		}));
		expect(response.status).toBe(400);
	});

	it('returns 400 for recipient without name', async () => {
		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: [{ deliveryMethod: 'email' }] }
		}));
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toContain('name');
	});

	it('returns 400 for invalid deliveryMethod', async () => {
		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: [{ name: 'Rep', deliveryMethod: 'pigeon' }] }
		}));
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toContain('deliveryMethod');
	});

	// =========================================================================
	// Salt failure
	// =========================================================================

	it('returns generic 500 on missing salt (no env var name leak)', async () => {
		mockComputePseudonymousId.mockImplementation(() => {
			throw new Error('SUBMISSION_ANONYMIZATION_SALT must be configured');
		});

		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));
		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Service configuration error');
		// Must NOT leak the env var name
		expect(data.error).not.toContain('SUBMISSION_ANONYMIZATION_SALT');
	});

	// =========================================================================
	// Successful delivery recording
	// =========================================================================

	it('records delivery and returns created count', async () => {
		mockServerMutation.mockResolvedValueOnce({ created: 2 });

		const response = await recordDelivery(buildEventArgs({
			body: {
				templateId: 'tmpl-1',
				recipients: [
					{ name: 'Sen. Smith', email: 's@gov', deliveryMethod: 'email' },
					{ name: 'Rep. Jones', email: 'j@gov', deliveryMethod: 'email' }
				]
			}
		}));

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.created).toBe(2);

		// Verify pseudonymousId was passed to mutation
		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({
				pseudonymousId: 'pseudo-abc123',
				templateId: 'tmpl-1',
				recipients: expect.arrayContaining([
					expect.objectContaining({ name: 'Sen. Smith', deliveryMethod: 'email' })
				])
			})
		);
	});

	it('computes pseudonymousId from session userId', async () => {
		await recordDelivery(buildEventArgs({
			locals: { session: { userId: 'user-42' } },
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));

		expect(mockComputePseudonymousId).toHaveBeenCalledWith('user-42');
	});

	// =========================================================================
	// Shadow Atlas district backfill
	// =========================================================================

	it('backfills districtCode from Shadow Atlas when available', async () => {
		mockServerQuery
			.mockResolvedValueOnce({ congressionalDistrict: 'CA-12' }); // getShadowAtlasRegistration

		await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));

		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({ districtCode: 'CA-12' })
		);
	});

	it('records delivery without district when Shadow Atlas fails', async () => {
		mockServerQuery.mockRejectedValueOnce(new Error('Atlas down'));

		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));

		expect(response.status).toBe(200);
		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({ districtCode: undefined })
		);
	});

	it('records delivery without district when user has no registration', async () => {
		mockServerQuery.mockResolvedValueOnce(null);

		const response = await recordDelivery(buildEventArgs({
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));

		expect(response.status).toBe(200);
		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({ districtCode: undefined })
		);
	});
});
