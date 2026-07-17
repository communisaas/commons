import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Template } from '$lib/types/template';

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
	mockApiGet: vi.fn(),
	mockApiPost: vi.fn()
}));

vi.mock('$lib/core/api', () => ({
	api: {
		get: mockApiGet,
		post: mockApiPost,
		put: vi.fn(),
		delete: vi.fn()
	}
}));

import { templateStore } from '$lib/stores/templates.svelte';

function ssrTemplate(id: string, title = id): Record<string, unknown> {
	return { id, slug: id, title };
}

function fullTemplate(id: string): Template {
	return {
		id,
		slug: id,
		title: id,
		description: 'Description',
		domain: 'Civic life',
		type: 'advocacy',
		deliveryMethod: 'email',
		message_body: 'Message',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: true,
		status: 'published',
		is_public: true,
		send_count: 0,
		preview: 'Preview',
		createdAt: '2026-07-18T00:00:00.000Z',
		updatedAt: '2026-07-18T00:00:00.000Z'
	};
}

describe('template store SSR reconciliation', () => {
	beforeEach(() => {
		templateStore.reset();
		mockApiGet.mockReset();
		mockApiPost.mockReset();
	});

	it('replaces an initialized list when a later page load carries a new generation', () => {
		templateStore.hydrateFromSSR([ssrTemplate('before', 'Before')]);
		templateStore.hydrateFromSSR([ssrTemplate('after', 'After')]);

		expect(templateStore.templates.map(({ id, title }) => ({ id, title }))).toEqual([
			{ id: 'after', title: 'After' }
		]);
		expect(templateStore.selectedId).toBe('after');
	});

	it('preserves a selection that still exists in the new SSR list', () => {
		templateStore.hydrateFromSSR([ssrTemplate('first'), ssrTemplate('selected')]);
		templateStore.selectTemplate('selected');
		templateStore.hydrateFromSSR([ssrTemplate('selected', 'Updated'), ssrTemplate('new')]);

		expect(templateStore.selectedId).toBe('selected');
		expect(templateStore.templates[0]?.title).toBe('Updated');
	});

	it('clears stale rows and selection for a valid empty published corpus', () => {
		templateStore.hydrateFromSSR([ssrTemplate('stale')]);
		templateStore.hydrateFromSSR([]);

		expect(templateStore.templates).toEqual([]);
		expect(templateStore.selectedId).toBeNull();
		expect(templateStore.initialized).toBe(true);
	});

	it('does not let an older client fallback overwrite later authoritative SSR data', async () => {
		let resolveFallback!: (value: unknown) => void;
		mockApiGet.mockReturnValue(
			new Promise((resolve) => {
				resolveFallback = resolve;
			})
		);

		const fallback = templateStore.fetchTemplates();
		templateStore.hydrateFromSSR([ssrTemplate('authoritative')]);
		resolveFallback({ success: true, data: [ssrTemplate('late-fallback')] });
		await fallback;

		expect(templateStore.templates.map(({ id }) => id)).toEqual(['authoritative']);
		expect(templateStore.loading).toBe(false);
	});

	it('settles loading when a local creation supersedes an older fallback', async () => {
		let resolveFallback!: (value: unknown) => void;
		mockApiGet.mockReturnValue(
			new Promise((resolve) => {
				resolveFallback = resolve;
			})
		);
		const created = fullTemplate('created-locally');
		mockApiPost.mockResolvedValue({ success: true, data: { template: created } });

		const fallback = templateStore.fetchTemplates();
		const { id: _id, ...draft } = created;
		await templateStore.addTemplate(draft);

		expect(templateStore.templates.map(({ id }) => id)).toEqual(['created-locally']);
		expect(templateStore.loading).toBe(false);
		expect(templateStore.initialized).toBe(true);

		resolveFallback({ success: true, data: [fullTemplate('late-fallback')] });
		await fallback;

		expect(templateStore.templates.map(({ id }) => id)).toEqual(['created-locally']);
		expect(templateStore.loading).toBe(false);
	});

});
