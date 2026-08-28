import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	api,
	mockEnforceLLMRateLimit,
	mockGenerateBatchEmbeddings,
	mockServerMutation,
	mockServerQuery
} = vi.hoisted(
	() => ({
		api: {
			templates: {
				claimEmbeddingBackfillLease: 'templates.claimEmbeddingBackfillLease',
				listMissingEmbeddings: 'templates.listMissingEmbeddings',
				updateMissingEmbeddingsForBackfill: 'templates.updateMissingEmbeddingsForBackfill',
				rebuildHomepageSnapshotsAfterBackfill:
					'templates.rebuildHomepageSnapshotsAfterBackfill',
				releaseEmbeddingBackfillLease: 'templates.releaseEmbeddingBackfillLease'
			}
		},
		mockEnforceLLMRateLimit: vi.fn(),
		mockGenerateBatchEmbeddings: vi.fn(),
		mockServerMutation: vi.fn(),
		mockServerQuery: vi.fn()
	})
);

vi.mock('$env/dynamic/private', () => ({
	env: { ADMIN_USER_IDS: 'admin-user' }
}));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));
vi.mock('$lib/core/search/gemini-embeddings', () => ({
	EMBEDDING_CONFIG: { maxInputTokens: 2048 },
	generateBatchEmbeddings: mockGenerateBatchEmbeddings,
	truncateText: (text: string, maxTokens: number) => {
		const maxChars = maxTokens * 4;
		if (text.length <= maxChars) return text;
		const truncated = text.slice(0, maxChars);
		const lastSpace = truncated.lastIndexOf(' ');
		return lastSpace > maxChars * 0.8
			? `${truncated.slice(0, lastSpace)}...`
			: `${truncated}...`;
	}
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'route-backfill-secret')
}));
vi.mock('$lib/utils/domain-hue-projection', () => ({
	projectToHue: vi.fn(() => 137)
}));
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: (...args: unknown[]) => mockEnforceLLMRateLimit(...args),
	rateLimitResponse: () => new Response('rate limited', { status: 429 })
}));

import { POST } from '../../../src/routes/api/admin/backfill-embeddings/+server';

const event = { locals: { user: { id: 'admin-user' } } } as never;

function missingTemplate(index: number) {
	return {
		_id: `template-${index}`,
		title: `Template ${index}`,
		description: 'Repair fixture',
		domain: 'civic',
		messageBody: `Body ${index}`
	};
}

describe('POST /api/admin/backfill-embeddings', () => {
	beforeEach(() => {
		mockEnforceLLMRateLimit.mockReset();
		mockEnforceLLMRateLimit.mockResolvedValue({
			allowed: true,
			remaining: 0,
			limit: 1,
			resetAt: new Date(),
			tier: 'verified'
		});
		mockGenerateBatchEmbeddings.mockReset();
		mockServerMutation.mockReset();
		mockServerQuery.mockReset();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('spends no provider reservation when the bounded missing-embedding page is empty', async () => {
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) return { acquired: true };
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation: ${ref}`);
		});
		mockServerQuery.mockResolvedValue([]);

		const response = await POST(event);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			processed: 0,
			message: 'All templates have embeddings'
		});
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
		expect(mockGenerateBatchEmbeddings).not.toHaveBeenCalled();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('claims a distributed lease and bounds one request to one 20-row batch', async () => {
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			if (ref === api.templates.updateMissingEmbeddingsForBackfill) return { updated: true };
			if (ref === api.templates.rebuildHomepageSnapshotsAfterBackfill) return {};
			throw new Error(`Unexpected mutation: ${ref}`);
		});
		// Defensively return more than the Convex contract promises: the route must
		// still spend at most one Gemini batch.
		mockServerQuery.mockResolvedValue(Array.from({ length: 25 }, (_, index) => missingTemplate(index)));
		mockGenerateBatchEmbeddings.mockResolvedValue(
			Array.from({ length: 40 }, (_, index) => [index])
		);

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({
			processed: 20,
			total_missing: 20,
			batch_cap: 20,
			may_have_more: true
		});
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.listMissingEmbeddings, {
			_secret: 'route-backfill-secret',
			limit: 20
		});
		expect(mockGenerateBatchEmbeddings).toHaveBeenCalledWith(
			expect.arrayContaining(['Template 0 Repair fixture civic', 'Template 19 Repair fixture Body 19']),
			{ taskType: 'RETRIEVAL_DOCUMENT' }
		);
		expect(mockGenerateBatchEmbeddings.mock.calls[0][0]).toHaveLength(40);
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledOnce();
		expect(mockEnforceLLMRateLimit).toHaveBeenCalledWith(event, 'embedding-backfill');

		const updates = mockServerMutation.mock.calls.filter(
			([ref]) => ref === api.templates.updateMissingEmbeddingsForBackfill
		);
		expect(updates).toHaveLength(20);
		expect(updates[0][1]).toMatchObject({
			templateId: 'template-0',
			domainHue: 137,
			leaseToken: expect.any(String)
		});
		expect(updates[19][1]).toMatchObject({
			templateId: 'template-19',
			leaseToken: expect.any(String)
		});
		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.rebuildHomepageSnapshotsAfterBackfill,
			{ _secret: 'route-backfill-secret', leaseToken: expect.any(String) }
		);

		const claim = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.claimEmbeddingBackfillLease
		)?.[1];
		const release = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.releaseEmbeddingBackfillLease
		)?.[1];
		expect(claim).toMatchObject({ _secret: 'route-backfill-secret', token: expect.any(String) });
		expect(updates.every(([, args]) => args.leaseToken === claim.token)).toBe(true);
		expect(
			mockServerMutation.mock.calls.find(
				([ref]) => ref === api.templates.rebuildHomepageSnapshotsAfterBackfill
			)?.[1].leaseToken
		).toBe(claim.token);
		expect(release).toEqual(claim);
	});

	it('stops later writes on a structured lease-loss code even when the message is redacted', async () => {
		mockServerQuery.mockResolvedValue([missingTemplate(0), missingTemplate(1)]);
		mockGenerateBatchEmbeddings.mockResolvedValue([[1], [2], [3], [4]]);
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.updateMissingEmbeddingsForBackfill) {
				throw new ConvexError({ code: 'EMBEDDING_BACKFILL_LEASE_EXPIRED' });
			}
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation: ${ref}`);
		});

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({
			processed: 0,
			total_missing: 2,
			errors: [{ stage: 'embedding_write', id: 'template-0' }]
		});
		const updates = mockServerMutation.mock.calls.filter(
			([ref]) => ref === api.templates.updateMissingEmbeddingsForBackfill
		);
		expect(updates).toHaveLength(1);
		expect(mockServerMutation).not.toHaveBeenCalledWith(
			api.templates.rebuildHomepageSnapshotsAfterBackfill,
			expect.anything()
		);
	});

	it('rejects a competing isolate before reading candidates or spending Gemini I/O', async () => {
		mockServerMutation.mockResolvedValue({ acquired: false, retryAt: 1_900_000_000_000 });

		await expect(POST(event)).rejects.toMatchObject({ status: 429 });
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockGenerateBatchEmbeddings).not.toHaveBeenCalled();
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.claimEmbeddingBackfillLease,
			expect.objectContaining({ token: expect.any(String) })
		);
	});

	it('returns processed results and releases the same lease when the immediate rebuild fails', async () => {
		mockServerQuery.mockResolvedValue([missingTemplate(0)]);
		mockGenerateBatchEmbeddings.mockResolvedValue([[1], [2]]);
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.updateMissingEmbeddingsForBackfill) return { updated: true };
			if (ref === api.templates.rebuildHomepageSnapshotsAfterBackfill) {
				throw new Error('snapshot rebuild failed');
			}
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation: ${ref}`);
		});

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({
			processed: 1,
			total_missing: 1,
			errors: [{ stage: 'snapshot_rebuild', error: 'snapshot rebuild failed' }]
		});
		const claim = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.claimEmbeddingBackfillLease
		)?.[1];
		const release = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.releaseEmbeddingBackfillLease
		)?.[1];
		expect(release).toEqual(claim);
	});

	it('isolates a poison template after a batch failure and advances healthy siblings', async () => {
		mockServerQuery.mockResolvedValue([missingTemplate(0), missingTemplate(1)]);
		mockGenerateBatchEmbeddings
			.mockRejectedValueOnce(new Error('batch contains invalid input'))
			.mockRejectedValueOnce(new Error('template 0 is invalid'))
			.mockResolvedValueOnce([[11], [12]]);
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.updateMissingEmbeddingsForBackfill) return { updated: true };
			if (ref === api.templates.rebuildHomepageSnapshotsAfterBackfill) return {};
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation: ${ref}`);
		});

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({
			processed: 1,
			total_missing: 2,
			errors: [
				{ stage: 'embedding_generation', id: 'template-0', error: 'template 0 is invalid' }
			]
		});
		expect(mockGenerateBatchEmbeddings).toHaveBeenCalledTimes(3);
		expect(mockGenerateBatchEmbeddings.mock.calls[0][0]).toHaveLength(4);
		expect(mockGenerateBatchEmbeddings.mock.calls[1][0]).toHaveLength(2);
		expect(mockGenerateBatchEmbeddings.mock.calls[1][1]).toMatchObject({ maxRetries: 1 });
		const updates = mockServerMutation.mock.calls.filter(
			([ref]) => ref === api.templates.updateMissingEmbeddingsForBackfill
		);
		expect(updates).toHaveLength(1);
		expect(updates[0][1]).toMatchObject({ templateId: 'template-1' });
		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.rebuildHomepageSnapshotsAfterBackfill,
			expect.objectContaining({ leaseToken: expect.any(String) })
		);
	});

	it.each([
		['authentication', 'Invalid GEMINI_API_KEY. Get key from the provider console.'],
		[
			'rate limit',
			'Failed to generate batch embeddings after 3 attempts: RESOURCE_EXHAUSTED: quota exceeded'
		],
		[
			'timeout',
			'Failed to generate batch embeddings after 3 attempts: Gemini API timeout after 30000ms'
		],
		['unknown provider', 'Failed to generate batch embeddings after 3 attempts: provider exploded']
	])('does not fan out a global %s failure into per-template Gemini calls', async (_label, message) => {
		mockServerQuery.mockResolvedValue([missingTemplate(0), missingTemplate(1)]);
		mockGenerateBatchEmbeddings.mockRejectedValueOnce(new Error(message));
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation after global embedding failure: ${ref}`);
		});

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({
			processed: 0,
			total_missing: 2,
			errors: [
				{ stage: 'embedding_generation', id: 'template-0', error: message },
				{ stage: 'embedding_generation', id: 'template-1', error: message }
			]
		});
		expect(mockGenerateBatchEmbeddings).toHaveBeenCalledTimes(1);
		expect(mockGenerateBatchEmbeddings.mock.calls[0][0]).toHaveLength(4);
		expect(mockServerMutation).not.toHaveBeenCalledWith(
			api.templates.updateMissingEmbeddingsForBackfill,
			expect.anything()
		);
		expect(mockServerMutation).not.toHaveBeenCalledWith(
			api.templates.rebuildHomepageSnapshotsAfterBackfill,
			expect.anything()
		);
		expect(console.warn).toHaveBeenCalledWith(
			'[backfill] Batch embedding generation failed globally; skipping per-template fallback:',
			message
		);
	});

	it('bounds oversized derived embedding text without changing the stored template', async () => {
		const oversized = { ...missingTemplate(0), messageBody: 'x'.repeat(10_000) };
		mockServerQuery.mockResolvedValue([oversized]);
		mockGenerateBatchEmbeddings.mockResolvedValue([[1], [2]]);
		mockServerMutation.mockImplementation(async (ref: string) => {
			if (ref === api.templates.claimEmbeddingBackfillLease) {
				return { acquired: true, expiresAt: Date.now() + 900_000 };
			}
			if (ref === api.templates.updateMissingEmbeddingsForBackfill) return { updated: true };
			if (ref === api.templates.rebuildHomepageSnapshotsAfterBackfill) return {};
			if (ref === api.templates.releaseEmbeddingBackfillLease) return { released: true };
			throw new Error(`Unexpected mutation: ${ref}`);
		});

		const response = await POST(event);
		await expect(response.json()).resolves.toMatchObject({ processed: 1, total_missing: 1 });
		const texts = mockGenerateBatchEmbeddings.mock.calls[0][0] as string[];
		expect(texts).toHaveLength(2);
		expect(Math.ceil(texts[1].length / 4)).toBeLessThanOrEqual(2048);
		expect(oversized.messageBody).toHaveLength(10_000);
	});
});
