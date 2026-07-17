import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';

const {
	mockModerateTemplate,
	mockGetCachedPublicTemplates,
	mockServerQuery,
	mockServerMutation,
	mockGenerateBatchEmbeddings,
	mockProjectToHue
} = vi.hoisted(() => ({
	mockModerateTemplate: vi.fn(),
	mockGetCachedPublicTemplates: vi.fn(),
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn(),
	mockGenerateBatchEmbeddings: vi.fn(),
	mockProjectToHue: vi.fn()
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderateTemplate: mockModerateTemplate
}));
vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));
vi.mock('$lib/server/public-template-queries', async (importOriginal) => {
	const actual = await importOriginal<
		typeof import('$lib/server/public-template-queries')
	>();
	return {
		...actual,
		getCachedPublicTemplates: mockGetCachedPublicTemplates
	};
});
vi.mock('$lib/config/features', () => ({
	FEATURES: { CONGRESSIONAL: false }
}));
vi.mock('$lib/core/search/gemini-embeddings', () => ({
	generateBatchEmbeddings: mockGenerateBatchEmbeddings
}));
vi.mock('$lib/utils/domain-hue-projection', () => ({
	projectToHue: mockProjectToHue
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'test-internal-secret')
}));

import { GET, POST } from '../../../src/routes/api/templates/+server';
import { PublicDiscoverySnapshotNotReadyError } from '$lib/server/public-template-queries';
import { validateTemplateInputBudgets } from '../../../convex/lib/templateInputBudget';

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
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
		expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
			'public, max-age=60, stale-while-revalidate=30, stale-if-error=3600'
		);
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
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
		expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false);
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
		mockServerQuery.mockReset();
		mockServerMutation.mockReset();
		mockGenerateBatchEmbeddings.mockReset();
		mockProjectToHue.mockReset();
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
		['null delivery config', { delivery_config: null }, 'delivery_config'],
		['array delivery config', { delivery_config: [] }, 'delivery_config'],
		['scalar delivery config', { delivery_config: 'smtp' }, 'delivery_config'],
		['null CWC config', { cwc_config: null }, 'cwc_config'],
		['array CWC config', { cwc_config: [] }, 'cwc_config'],
		['scalar CWC config', { cwc_config: 42 }, 'cwc_config'],
		['null recipient config', { recipient_config: null }, 'recipient_config'],
		['array recipient config', { recipient_config: [] }, 'recipient_config'],
		['scalar recipient config', { recipient_config: true }, 'recipient_config'],
		['non-array scopes', { scopes: {} }, 'scopes'],
		['non-array jurisdictions', { jurisdictions: 'US' }, 'jurisdictions'],
		['sources object', { sources: {} }, 'sources'],
		['malformed source entry', { sources: [{ num: 1, title: 42, url: 'https://x.test', type: 'web' }] }, 'sources'],
		['oversized source string', { sources: [{ num: 1, title: 'x'.repeat(501), url: 'https://x.test', type: 'web' }] }, 'sources'],
		['javascript source URL', { sources: [{ num: 1, title: 'unsafe', url: 'javascript:alert(1)', type: 'web' }] }, 'sources'],
		['data source URL', { sources: [{ num: 1, title: 'unsafe', url: 'data:text/html,unsafe', type: 'web' }] }, 'sources'],
		['relative source URL', { sources: [{ num: 1, title: 'unsafe', url: '/relative', type: 'web' }] }, 'sources'],
		['credentialed source URL', { sources: [{ num: 1, title: 'unsafe', url: 'https://user:pass@example.com', type: 'web' }] }, 'sources'],
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
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it.each([
		[
			'combined configuration bytes',
			{
				delivery_config: { first: 'x'.repeat(4_096) },
				recipient_config: { second: 'x'.repeat(4_096) }
			},
			'recipient_config'
		],
		[
			'configuration fanout',
			{ recipient_config: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`k${i}`, true])) },
			'recipient_config'
		],
		[
			'full stored authoring bytes',
			{ research_log: Array.from({ length: 17 }, () => 'x'.repeat(1_000)) },
			'body'
		],
		[
			'public projection bytes',
			{
				message_body: 'x'.repeat(10_000),
				preview: 'x'.repeat(500),
				description: 'x'.repeat(1_000),
				domain: 'x'.repeat(200),
				topics: Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(99)}`),
				recipient_config: { note: 'x'.repeat(500) }
			},
			'body'
		],
		[
			'an unsupported geographic shape',
			{ geographic_scope: { type: 'subnational', country: 'US', locality: 'Austin', ballast: 'x' } },
			'geographic_scope'
		],
		[
			'an oversized geographic label',
			{
				geographic_scope: {
					type: 'subnational',
					country: 'US',
					locality: 'x'.repeat(201)
				}
			},
			'geographic_scope'
		]
	])('rejects %s before moderation', async (_label, patch, field) => {
		const response = await POST(postEvent({ ...VALID_TEMPLATE, ...patch }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [expect.objectContaining({ field, code: expect.stringMatching(/^VALIDATION_/) })]
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
	});

	it('maps the atomic Convex slug conflict to the existing duplicate validation response', async () => {
		mockModerateTemplate.mockResolvedValue({
			approved: true,
			summary: 'Approved by test control',
			latency_ms: 1
		});
		mockServerQuery.mockResolvedValueOnce(null);
		mockServerMutation.mockRejectedValue(new ConvexError({ code: 'TEMPLATE_SLUG_TAKEN' }));
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await POST(postEvent({ ...VALID_TEMPLATE, slug: 'shared-link' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			error: {
				field: 'slug',
				code: 'VALIDATION_DUPLICATE'
			}
		});
		expect(mockServerQuery).toHaveBeenCalledOnce();
		expect(mockServerMutation).toHaveBeenCalledOnce();
	});

	it('budgets the generated slug before moderation when the request omits one', async () => {
		const title = 'x'.repeat(100);
		const preview = VALID_TEMPLATE.preview;
		const fullResearchEntries = Array.from({ length: 15 }, () => 'x'.repeat(1_000));
		const budgetInput = (slug: string, tailLength: number) => ({
			title,
			slug,
			description: preview,
			messageBody: VALID_TEMPLATE.message_body,
			preview,
			type: VALID_TEMPLATE.type,
			deliveryMethod: VALID_TEMPLATE.deliveryMethod,
			domain: '',
			topics: [],
			sources: [],
			researchLog: [...fullResearchEntries, 'x'.repeat(tailLength)],
			deliveryConfig: {},
			cwcConfig: {},
			recipientConfig: {},
			contentHash: '0'.repeat(40),
			status: 'published',
			isPublic: true
		});
		const tailLength = Array.from({ length: 1_001 }, (_, index) => 1_000 - index).find(
			(length) =>
				validateTemplateInputBudgets(budgetInput('', length)).ok &&
				!validateTemplateInputBudgets(budgetInput(title, length)).ok
		);

		expect(tailLength).toBeDefined();
		const response = await POST(
			postEvent({
				...VALID_TEMPLATE,
				title,
				research_log: [...fullResearchEntries, 'x'.repeat(tailLength!)]
			})
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [{ field: 'body', code: 'VALIDATION_TOO_LONG' }]
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
	});

	it('rejects an empty sanitized slug before moderation or Convex I/O', async () => {
		const response = await POST(postEvent({ ...VALID_TEMPLATE, title: '!!!' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [{ field: 'slug', code: 'VALIDATION_INVALID_FORMAT' }]
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects a hyphen-only generated slug before moderation or Convex I/O', async () => {
		const response = await POST(postEvent({ ...VALID_TEMPLATE, title: '---' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [{ field: 'slug', code: 'VALIDATION_INVALID_FORMAT' }]
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
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
					...VALID_TEMPLATE,
					sources: [
						{ num: 1, title: 'HTTP source', url: 'http://example.com/source', type: 'web' },
						{ num: 2, title: 'HTTPS source', url: 'https://example.com/source', type: 'web' }
					]
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

	it('creates an approved template and runs deferred embedding work through waitUntil', async () => {
		mockModerateTemplate.mockResolvedValue({
			approved: true,
			summary: 'Approved by test control',
			latency_ms: 1
		});
		mockServerQuery.mockResolvedValue(null);
		const created = {
			_id: 'template_1',
			slug: 'protect-the-public-library',
			title: VALID_TEMPLATE.title,
			description: '',
			domain: '',
			topics: [],
			type: VALID_TEMPLATE.type,
			deliveryMethod: VALID_TEMPLATE.deliveryMethod,
			messageBody: VALID_TEMPLATE.message_body,
			sources: [],
			researchLog: [],
			preview: VALID_TEMPLATE.preview,
			deliveryConfig: {},
			cwcConfig: {},
			recipientConfig: {},
			status: 'published',
			isPublic: true,
			_creationTime: 100,
			updatedAt: 100
		};
		mockServerMutation.mockResolvedValueOnce(created).mockResolvedValueOnce(undefined);
		mockGenerateBatchEmbeddings.mockResolvedValue([
			Array.from({ length: 768 }, () => 0),
			Array.from({ length: 768 }, () => 0)
		]);
		mockProjectToHue.mockReturnValue(180);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const deferred: Promise<unknown>[] = [];
		const base = postEvent(VALID_TEMPLATE) as unknown as Record<string, unknown>;

		const response = await POST({
			...base,
			platform: {
				context: { waitUntil: (promise: Promise<unknown>) => deferred.push(promise) }
			}
		} as never);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			success: true,
			data: { template: { id: 'template_1', is_public: true, status: 'published' } }
		});
		expect(deferred).toHaveLength(1);
		await Promise.all(deferred);
		expect(mockGenerateBatchEmbeddings).toHaveBeenCalledOnce();
		expect(mockServerMutation).toHaveBeenCalledTimes(2);
		expect(mockServerMutation.mock.calls[1]?.[1]).toMatchObject({
			templateId: 'template_1',
			expectedUserId: 'user_1',
			domainHue: 180
		});
	});
});
