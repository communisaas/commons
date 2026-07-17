import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockGenerateBatchEmbeddings, mockServerMutation, mockServerQuery } = vi.hoisted(
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
	generateBatchEmbeddings: mockGenerateBatchEmbeddings
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'route-backfill-secret')
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
		mockGenerateBatchEmbeddings.mockReset();
		mockServerMutation.mockReset();
		mockServerQuery.mockReset();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
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

		const updates = mockServerMutation.mock.calls.filter(
			([ref]) => ref === api.templates.updateMissingEmbeddingsForBackfill
		);
		expect(updates).toHaveLength(20);
		expect(updates[0][1]).toMatchObject({ templateId: 'template-0' });
		expect(updates[19][1]).toMatchObject({ templateId: 'template-19' });
		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.rebuildHomepageSnapshotsAfterBackfill,
			{ _secret: 'route-backfill-secret' }
		);

		const claim = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.claimEmbeddingBackfillLease
		)?.[1];
		const release = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.releaseEmbeddingBackfillLease
		)?.[1];
		expect(claim).toMatchObject({ _secret: 'route-backfill-secret', token: expect.any(String) });
		expect(release).toEqual(claim);
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

	it('releases the same lease token when a post-write immediate rebuild fails', async () => {
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

		await expect(POST(event)).rejects.toThrow('snapshot rebuild failed');
		const claim = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.claimEmbeddingBackfillLease
		)?.[1];
		const release = mockServerMutation.mock.calls.find(
			([ref]) => ref === api.templates.releaseEmbeddingBackfillLease
		)?.[1];
		expect(release).toEqual(claim);
	});
});
