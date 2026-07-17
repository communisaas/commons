import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockModerateTemplate, mockGetCachedPublicTemplates } = vi.hoisted(() => ({
	mockModerateTemplate: vi.fn(),
	mockGetCachedPublicTemplates: vi.fn()
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderateTemplate: mockModerateTemplate
}));
vi.mock('convex-sveltekit', () => ({
	serverQuery: vi.fn(),
	serverMutation: vi.fn()
}));
vi.mock('$lib/server/public-template-queries', () => {
	class PublicDiscoverySnapshotNotReadyError extends Error {
		constructor(readonly family: 'list' | 'relations') {
			super(`PUBLIC_DISCOVERY_SNAPSHOT_NOT_READY:${family}`);
			this.name = 'PublicDiscoverySnapshotNotReadyError';
		}
	}
	return {
		getCachedPublicTemplates: mockGetCachedPublicTemplates,
		PublicDiscoverySnapshotNotReadyError
	};
});
vi.mock('$lib/config/features', () => ({
	FEATURES: { CONGRESSIONAL: false }
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

import { GET, POST } from '../../../src/routes/api/templates/+server';
import { PublicDiscoverySnapshotNotReadyError } from '$lib/server/public-template-queries';

const VALID_TEMPLATE = {
	title: 'Protect the public library',
	message_body: 'Please preserve funding for the public library.',
	preview: 'Preserve public-library funding',
	type: 'petition',
	deliveryMethod: 'email'
};

function getEvent() {
	return {
		url: new URL('https://commons.email/api/templates'),
		platform: undefined
	} as never;
}

function postEvent(template: Record<string, unknown>) {
	return {
		request: new Request('https://commons.email/api/templates', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(template)
		}),
		locals: {
			user: { id: 'user_1', is_verified: false, trust_score: 100 }
		}
	} as never;
}

describe('GET /api/templates public discovery contract', () => {
	beforeEach(() => {
		mockGetCachedPublicTemplates.mockReset();
	});

	it('applies the congressional visibility gate and cache headers to success only', async () => {
		mockGetCachedPublicTemplates.mockResolvedValue([{ id: 'template_1' }]);

		const response = await GET(getEvent());

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain('max-age=60');
		expect(mockGetCachedPublicTemplates).toHaveBeenCalledWith(
			{ url: new URL('https://commons.email/api/templates'), platform: undefined },
			true
		);
		await expect(response.json()).resolves.toMatchObject({
			success: true,
			data: [{ id: 'template_1' }]
		});
	});

	it('preserves the historical empty-list response while a snapshot is cold', async () => {
		mockGetCachedPublicTemplates.mockRejectedValue(
			new PublicDiscoverySnapshotNotReadyError('list')
		);

		const response = await GET(getEvent());

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain('max-age=60');
		await expect(response.json()).resolves.toEqual({ success: true, data: [] });
	});

	it('returns non-cacheable 503 JSON for an unexpected discovery failure', async () => {
		mockGetCachedPublicTemplates.mockRejectedValue(new Error('Convex disabled'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await GET(getEvent());

		expect(response.status).toBe(503);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			error: { code: 'SERVER_DATABASE' }
		});
	});
});

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
		['description object', { description: {} }, 'description'],
		['domain object', { domain: {} }, 'domain'],
		['sources object', { sources: {} }, 'sources'],
		['malformed source entry', { sources: [{ num: 1, title: 42, url: 'https://x.test', type: 'web' }] }, 'sources'],
		['oversized source string', { sources: [{ num: 1, title: 'x'.repeat(501), url: 'https://x.test', type: 'web' }] }, 'sources'],
		['non-string research entry', { research_log: [42] }, 'research_log'],
		['oversized research entry', { research_log: ['x'.repeat(1_001)] }, 'research_log']
	])('rejects a malformed optional %s before moderation', async (_label, patch, field) => {
		const response = await POST(postEvent({ ...VALID_TEMPLATE, ...patch }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [expect.objectContaining({ field })]
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
				body: JSON.stringify(VALID_TEMPLATE)
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
