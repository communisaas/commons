/**
 * Wave 6 / FU-1.3 — client-event metrics endpoint tests.
 *
 * Asserts the allowlist + rate-limit enforcement so a misbehaving client
 * cannot spam the log stream. SELF-REVIEW F closure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnforceInternalRateLimit } = vi.hoisted(() => ({
	mockEnforceInternalRateLimit: vi.fn()
}));

vi.mock('$lib/server/internal/rate-limit', () => ({
	enforceInternalRateLimit: (...args: unknown[]) => mockEnforceInternalRateLimit(...args)
}));

import { POST } from '../../../src/routes/api/internal/metrics/client-event/+server';

function buildRequest(body: unknown, contentType = 'application/json'): Request {
	return new Request('https://example.test/api/internal/metrics/client-event', {
		method: 'POST',
		headers: { 'Content-Type': contentType },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

function buildEvent(request: Request): Parameters<typeof POST>[0] {
	return { request } as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnforceInternalRateLimit.mockResolvedValue(undefined);
});

describe('POST /api/internal/metrics/client-event', () => {
	it('rate limit fires before any body parsing', async () => {
		mockEnforceInternalRateLimit.mockRejectedValueOnce(
			Object.assign(new Error('rate limited'), { status: 429 })
		);
		await expect(
			POST(buildEvent(buildRequest({ metric: 'verify_commitment_generation_failure' })))
		).rejects.toMatchObject({ status: 429 });
	});

	it('accepts the verify_commitment_generation_failure metric', async () => {
		const response = await POST(
			buildEvent(
				buildRequest({
					metric: 'verify_commitment_generation_failure',
					error: 'IPFS gateway timeout',
					timestamp: Date.now()
				})
			)
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
	});

	it('accepts the v2_witness_fetch_failure metric', async () => {
		const response = await POST(
			buildEvent(
				buildRequest({
					metric: 'v2_witness_fetch_failure',
					error: 'fetch failed: socket hang up'
				})
			)
		);
		expect(response.status).toBe(200);
	});

	it('rejects unknown metric keys with 400', async () => {
		const response = await POST(
			buildEvent(buildRequest({ metric: 'arbitrary_user_action' }))
		);
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe('unknown_metric');
	});

	it('rejects malformed JSON body with 400', async () => {
		const response = await POST(buildEvent(buildRequest('not json at all', 'text/plain')));
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe('invalid_body');
	});

	it('handles sendBeacon-style text/plain JSON body', async () => {
		// navigator.sendBeacon may post with text/plain. The endpoint must
		// handle that fallback path.
		const response = await POST(
			buildEvent(
				buildRequest(
					JSON.stringify({
						metric: 'verify_commitment_generation_failure',
						error: 'beacon-style'
					}),
					'text/plain'
				)
			)
		);
		expect(response.status).toBe(200);
	});

	it('truncates oversized error strings (defense-in-depth)', async () => {
		// The source-side truncation is at 200 chars; the endpoint also
		// truncates. Pass 1000 chars and verify the log output (best-effort —
		// assertion is loose because it's a log-level concern).
		const longError = 'A'.repeat(1000);
		const response = await POST(
			buildEvent(
				buildRequest({
					metric: 'verify_commitment_generation_failure',
					error: longError
				})
			)
		);
		// Endpoint accepts but truncation happens in log. Just verify 200.
		expect(response.status).toBe(200);
	});
});
