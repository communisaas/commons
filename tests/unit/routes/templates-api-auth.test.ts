import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockModerateTemplate } = vi.hoisted(() => ({
	mockModerateTemplate: vi.fn()
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderateTemplate: mockModerateTemplate
}));
vi.mock('convex-sveltekit', () => ({
	serverQuery: vi.fn(),
	serverMutation: vi.fn()
}));
vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplates: vi.fn()
}));
vi.mock('$lib/core/search/gemini-embeddings', () => ({
	generateBatchEmbeddings: vi.fn()
}));
vi.mock('$lib/utils/domain-hue-projection', () => ({
	projectToHue: vi.fn()
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'test-internal-secret')
}));

import { POST } from '../../../src/routes/api/templates/+server';

describe('POST /api/templates authoring cost gate', () => {
	beforeEach(() => {
		mockModerateTemplate.mockReset();
	});

	it('rejects an unauthenticated request before parsing or moderation', async () => {
		const response = await POST({
			request: new Request('https://commons.email/api/templates', {
				method: 'POST',
				body: 'not-json'
			}),
			locals: { user: null }
		} as never);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			error: { code: 'AUTH_REQUIRED' }
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
	});

	it.each([
		['a missing trust score', { id: 'user_1', is_verified: false }],
		['a below-threshold trust score', { id: 'user_1', is_verified: false, trust_score: 99 }]
	])('rejects an authenticated user with %s before parsing or moderation', async (_label, user) => {
		const response = await POST({
			request: new Request('https://commons.email/api/templates', {
				method: 'POST',
				body: 'not-json'
			}),
			locals: { user }
		} as never);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			error: { code: 'INSUFFICIENT_TRUST' }
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
	});

	it('allows the trust-score boundary to reach mocked moderation', async () => {
		mockModerateTemplate.mockResolvedValue({
			approved: false,
			rejection_reason: 'test control',
			summary: 'Rejected by the mocked moderation control',
			latency_ms: 1
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await POST({
			request: new Request('https://commons.email/api/templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: 'Protect the public library',
					message_body: 'Please preserve funding for the public library.',
					preview: 'Preserve public-library funding',
					type: 'petition',
					deliveryMethod: 'email'
				})
			}),
			locals: {
				user: { id: 'user_1', is_verified: false, trust_score: 100 }
			}
		} as never);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			error: { code: 'CONTENT_FLAGGED' }
		});
		expect(mockModerateTemplate).toHaveBeenCalledOnce();
		expect(mockModerateTemplate).toHaveBeenCalledWith({
			title: 'Protect the public library',
			message_body: 'Please preserve funding for the public library.'
		});
	});
});
