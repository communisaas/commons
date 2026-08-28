/**
 * Unit Tests: Direct Delivery Recording
 *
 * Tests the stance-agnostic delivery recording path:
 * - POST /api/deliveries/record — SvelteKit endpoint
 * - recordDirectDeliveries — Convex mutation (via mock)
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
		positions: {
			recordDirectDeliveries: 'positions.recordDirectDeliveries'
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

function buildJsonRequest(body: unknown, url = 'http://localhost/api/deliveries/record'): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function buildEventArgs(overrides: Record<string, unknown> = {}) {
	return {
		request: buildJsonRequest(overrides.body ?? {}),
		locals: overrides.locals ?? { session: { userId: 'user-1' } },
		params: overrides.params ?? {},
		url: overrides.url ?? new URL('http://localhost/api/deliveries/record'),
		...overrides
	} as any;
}

const validRecipients = [{ name: 'Sen. Jane Smith', deliveryMethod: 'email' }];

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/deliveries/record', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockComputePseudonymousId.mockReturnValue('a'.repeat(64));
		mockServerMutation.mockResolvedValue({ created: 1, existing: 0, duplicates: 0 });
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

	it('authenticates before reading an untrusted request body', async () => {
		const text = vi.fn(async () => {
			throw new Error('body should not be read');
		});
		const response = await recordDelivery(
			buildEventArgs({
				locals: { session: null },
				request: { method: 'POST', headers: new Headers(), body: null, text }
			})
		);
		expect(response.status).toBe(401);
		expect(text).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
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

	it('rejects unknown top-level and recipient fields, including plaintext email', async () => {
		for (const body of [
			{ templateId: 'tmpl-1', recipients: validRecipients, ignored: true },
			{
				templateId: 'tmpl-1',
				recipients: [
					{
						name: 'Sen. Jane Smith',
						deliveryMethod: 'email',
						email: 'jane@example.gov'
					}
				]
			}
		]) {
			const response = await recordDelivery(buildEventArgs({ body }));
			expect(response.status).toBe(400);
		}
		expect(mockComputePseudonymousId).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects more than 20 recipients before application or Convex work', async () => {
		const response = await recordDelivery(
			buildEventArgs({
				body: {
					templateId: 'tmpl-1',
					recipients: Array.from({ length: 21 }, (_, index) => ({
						name: `Recipient ${index}`,
						deliveryMethod: 'recorded'
					}))
				}
			})
		);
		expect(response.status).toBe(400);
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('streams and rejects an oversized body before parsing or Convex work', async () => {
		const response = await recordDelivery(
			buildEventArgs({
				request: buildJsonRequest({
					templateId: 'tmpl-1',
					recipients: [{ name: 'x'.repeat(17_000), deliveryMethod: 'email' }]
				})
			})
		);
		expect(response.status).toBe(413);
		expect(mockComputePseudonymousId).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
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
		mockServerMutation.mockResolvedValueOnce({ created: 2, existing: 0, duplicates: 0 });

		const response = await recordDelivery(buildEventArgs({
			body: {
				templateId: 'tmpl-1',
				recipients: [
					{ name: 'Sen. Smith', deliveryMethod: 'email' },
					{ name: 'Rep. Jones', deliveryMethod: 'email' }
				]
			}
		}));

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.created).toBe(2);
		expect(response.headers.get('cache-control')).toBe('private, no-store');

		// Verify pseudonymousId was passed to mutation
		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({
				pseudonymousId: 'a'.repeat(64),
				templateId: 'tmpl-1',
				recipients: expect.arrayContaining([
					expect.objectContaining({ name: 'Sen. Smith', deliveryMethod: 'email' })
				])
			})
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation.mock.calls[0]?.[1]).not.toHaveProperty('districtCode');
	});

	it('canonicalizes and deduplicates recipient aliases before Convex', async () => {
		mockServerMutation.mockResolvedValueOnce({ created: 1, existing: 0, duplicates: 1 });
		const response = await recordDelivery(
			buildEventArgs({
				body: {
					templateId: 'tmpl-1',
					recipients: [
						{ name: '  Rep. Jos\u00e9   Smith ', deliveryMethod: 'email' },
						{ name: 'rep jose smith', deliveryMethod: 'email' }
					]
				}
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ created: 1, existing: 0, duplicates: 1 });
		expect(mockServerMutation).toHaveBeenCalledWith(
			'positions.recordDirectDeliveries',
			expect.objectContaining({
				recipients: [{ name: 'Rep. Jos\u00e9 Smith', deliveryMethod: 'email' }]
			})
		);
	});

	it.each([
		['rate admission', 'DIRECT_DELIVERY_RATE_LIMITED', 429],
		['lifetime cap', 'DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED', 409],
		['private template', 'DIRECT_DELIVERY_TEMPLATE_INELIGIBLE', 404],
		['oversized Convex envelope', 'DIRECT_DELIVERY_INPUT_TOO_LARGE', 413]
	])('maps %s failures without leaking Convex details', async (_name, code, status) => {
		mockServerMutation.mockRejectedValueOnce(new Error(code));
		const response = await recordDelivery(
			buildEventArgs({ body: { templateId: 'tmpl-1', recipients: validRecipients } })
		);
		expect(response.status).toBe(status);
		expect(JSON.stringify(await response.json())).not.toContain(code);
	});

	it('computes pseudonymousId from session userId', async () => {
		await recordDelivery(buildEventArgs({
			locals: { session: { userId: 'user-42' } },
			body: { templateId: 'tmpl-1', recipients: validRecipients }
		}));

		expect(mockComputePseudonymousId).toHaveBeenCalledWith('user-42');
	});

});
