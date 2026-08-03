import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddHeaders, mockEnforce, mockModerate, mockRateLimitResponse } = vi.hoisted(() => ({
	mockAddHeaders: vi.fn(),
	mockEnforce: vi.fn(),
	mockModerate: vi.fn(),
	mockRateLimitResponse: vi.fn(
		() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
	)
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderatePersonalization: mockModerate
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	addRateLimitHeaders: mockAddHeaders,
	enforceLLMRateLimit: mockEnforce,
	rateLimitResponse: mockRateLimitResponse
}));

vi.mock('../../../src/routes/api/moderation/personalization/$types', () => ({}));

import { POST } from '../../../src/routes/api/moderation/personalization/+server';

function event(body: unknown, authenticated = false, parse = vi.fn(() => Promise.resolve(body))): any {
	return {
		locals: { session: authenticated ? { userId: 'user-1' } : null },
		request: { json: parse }
	};
}

describe('POST /api/moderation/personalization provider boundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforce.mockResolvedValue({
			allowed: true,
			limit: 10,
			remaining: 9,
			resetAt: new Date(),
			tier: 'authenticated'
		});
		mockModerate.mockResolvedValue({ approved: true, summary: 'Approved', latency_ms: 1 });
	});

	it('rejects guests before parsing or provider admission', async () => {
		const parse = vi.fn(() => Promise.resolve({ text: 'My family relies on this bus route.' }));
		const response = await POST(event(undefined, false, parse));
		expect(response.status).toBe(401);
		expect(parse).not.toHaveBeenCalled();
		expect(mockEnforce).not.toHaveBeenCalled();
		expect(mockModerate).not.toHaveBeenCalled();
	});

	it('rejects oversized authenticated input before admission or Groq', async () => {
		const response = await POST(event({ text: 'x'.repeat(2_001) }, true));
		expect(response.status).toBe(400);
		expect(mockEnforce).not.toHaveBeenCalled();
		expect(mockModerate).not.toHaveBeenCalled();
	});

	it.each(['', '   \n\t'])('resolves empty personalization locally without draining admission', async (text) => {
		const response = await POST(event({ text }, true));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			approved: true,
			summary: 'Empty personalization — skipped'
		});
		expect(mockEnforce).not.toHaveBeenCalled();
		expect(mockModerate).not.toHaveBeenCalled();
	});

	it('admits an authenticated request before invoking Groq', async () => {
		const response = await POST(event({ text: 'My family relies on this bus route.' }, true));
		expect(response.status).toBe(200);
		expect(mockEnforce).toHaveBeenCalledWith(expect.anything(), 'moderation-personalization');
		expect(mockEnforce.mock.invocationCallOrder[0]).toBeLessThan(
			mockModerate.mock.invocationCallOrder[0]
		);
		expect(mockModerate).toHaveBeenCalledTimes(1);
	});

	it('never invokes Groq when authenticated admission is denied', async () => {
		mockEnforce.mockResolvedValue({ allowed: false });
		const response = await POST(event({ text: 'My family relies on this bus route.' }, true));
		expect(response.status).toBe(429);
		expect(mockModerate).not.toHaveBeenCalled();
	});

	it('keeps the browser send path fail-closed after repeated moderation failures', () => {
		// The gate is shared by every send surface, so the fail-closed policy is
		// pinned where it lives rather than in one of the surfaces that call it.
		const gate = readFileSync('src/lib/utils/personal-connection.ts', 'utf8');
		expect(gate).not.toContain('sending without moderation');
		expect(gate).not.toContain('allowing sends with audit log');
		expect(gate).toContain('Content moderation is temporarily unavailable');

		const actionBar = readFileSync(
			'src/lib/components/template-browser/parts/ActionBar.svelte',
			'utf8'
		);
		expect(actionBar).not.toContain('sending without moderation');
		expect(actionBar).not.toContain('allowing sends with audit log');
		expect(actionBar).toContain('moderatePersonalConnection(');
	});
});
