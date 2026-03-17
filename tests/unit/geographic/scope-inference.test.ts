/**
 * Unit Tests: Geographic scope inference endpoint
 * Tests POST /api/geographic/infer-scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const { mockFuzzyMatch, mockRateLimiterCheck } = vi.hoisted(() => ({
	mockFuzzyMatch: vi.fn(),
	mockRateLimiterCheck: vi.fn()
}));

vi.mock('$lib/utils/fuzzy-scope-matcher', () => ({
	fuzzyMatch: (...args: any[]) => mockFuzzyMatch(...args)
}));

vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({
		check: (...args: any[]) => mockRateLimiterCheck(...args)
	})
}));

vi.mock('@sveltejs/kit', () => ({
	json: (data: unknown, init?: { status?: number }) =>
		new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: { 'Content-Type': 'application/json' }
		}),
	error: (status: number, message: string) => {
		const e = new Error(message);
		(e as any).status = status;
		throw e;
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockRateLimiterCheck.mockResolvedValue({ allowed: true, remaining: 19, limit: 20, reset: 0 });
});

// =============================================================================
// Tests
// =============================================================================

describe('POST /api/geographic/infer-scope', () => {
	it('requires authentication', async () => {
		const { POST } = await import(
			'../../../src/routes/api/geographic/infer-scope/+server.ts'
		);

		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: 'test' })
			}),
			locals: {}
		} as any);

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBe('Authentication required');
	});

	it('returns fuzzy match result for valid text', async () => {
		mockFuzzyMatch.mockReturnValue({
			pattern: 'nyc',
			canonical: 'New York',
			country: 'US',
			scopeLevel: 'locality',
			confidence: 0.9
		});

		const { POST } = await import(
			'../../../src/routes/api/geographic/infer-scope/+server.ts'
		);

		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: 'nyc', countryCode: 'US' })
			}),
			locals: { user: { id: 'user-1' } }
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.data.match).toBeDefined();
		expect(body.data.match.canonical).toBe('New York');
	});

	it('returns null match when no pattern found', async () => {
		mockFuzzyMatch.mockReturnValue(null);

		const { POST } = await import(
			'../../../src/routes/api/geographic/infer-scope/+server.ts'
		);

		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: 'xyzabc123' })
			}),
			locals: { user: { id: 'user-1' } }
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data.match).toBeNull();
	});

	it('rejects requests without text', async () => {
		const { POST } = await import(
			'../../../src/routes/api/geographic/infer-scope/+server.ts'
		);

		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			}),
			locals: { user: { id: 'user-1' } }
		} as any);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe('text is required');
	});

	it('truncates input in response for safety', async () => {
		mockFuzzyMatch.mockReturnValue(null);

		const { POST } = await import(
			'../../../src/routes/api/geographic/infer-scope/+server.ts'
		);

		const longText = 'a'.repeat(500);
		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: longText })
			}),
			locals: { user: { id: 'user-1' } }
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data.input.length).toBeLessThanOrEqual(200);
	});
});
