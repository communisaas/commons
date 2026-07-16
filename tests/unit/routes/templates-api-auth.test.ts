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
});
