import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Template } from '$lib/types/template';

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
	mockApiGet: vi.fn(),
	mockApiPost: vi.fn()
}));

vi.mock('$lib/core/api', () => ({
	api: {
		get: mockApiGet,
		post: mockApiPost
	}
}));

import { templateStore } from '$lib/stores/templates.svelte';

const STORE_SOURCE = readFileSync(
	path.resolve(process.cwd(), 'src/lib/stores/templates.svelte.ts'),
	'utf-8'
);
const ROUTE_SOURCE = readFileSync(
	path.resolve(process.cwd(), 'src/routes/api/templates/+server.ts'),
	'utf-8'
);

/** Every HTTP verb the client store actually invokes on the shared api client. */
function storeVerbs(src: string): Set<string> {
	const verbs = new Set<string>();
	for (const match of src.matchAll(/api\.(get|post|put|patch|delete)\s*\(/g)) {
		verbs.add(match[1].toLowerCase());
	}
	return verbs;
}

/** Every HTTP verb the SvelteKit route file exports a handler for. */
function routeHandlers(src: string): Set<string> {
	const handlers = new Set<string>();
	for (const match of src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE):\s*RequestHandler/gm)) {
		handlers.add(match[1].toLowerCase());
	}
	return handlers;
}

function isGrounded(store: Set<string>, handlers: Set<string>): boolean {
	return store.size > 0 && [...store].every((verb) => handlers.has(verb));
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

describe('template store client surface', () => {
	beforeEach(() => {
		templateStore.reset();
		mockApiGet.mockReset();
		mockApiPost.mockReset();
	});

	it('exposes no mutation method that targets a route the server does not serve', () => {
		expect('updateTemplate' in templateStore).toBe(false);
		expect('deleteTemplate' in templateStore).toBe(false);
	});

	it('issues no PUT, PATCH or DELETE call from the store module', () => {
		expect(STORE_SOURCE).not.toContain('api.put(');
		expect(STORE_SOURCE).not.toContain('api.patch(');
		expect(STORE_SOURCE).not.toContain('api.delete(');
	});

	describe('route contract', () => {
		it('grounds every store verb in an exported route handler', () => {
			const verbs = storeVerbs(STORE_SOURCE);
			const handlers = routeHandlers(ROUTE_SOURCE);

			expect(verbs.size).toBeGreaterThan(0);
			expect([...verbs].sort()).toEqual(['get', 'post']);
			expect([...handlers].sort()).toEqual(['get', 'post']);
			expect(isGrounded(verbs, handlers)).toBe(true);
		});

		it('rejects a store verb with no matching handler', () => {
			const ungroundedStore = `
				const templatesApi = {
					async list() { return api.get('/templates'); },
					async touch(id: string) { return api.patch(\`/templates/\${id}\`, {}); }
				};
			`;
			const twoVerbRoute = [
				'export const GET: RequestHandler = async () => {};',
				'export const POST: RequestHandler = async () => {};'
			].join('\n');

			const verbs = storeVerbs(ungroundedStore);
			const handlers = routeHandlers(twoVerbRoute);

			expect([...verbs].sort()).toEqual(['get', 'patch']);
			expect([...handlers].sort()).toEqual(['get', 'post']);
			expect(isGrounded(verbs, handlers)).toBe(false);
		});
	});

	it('still reads the template list over the surviving GET transport', async () => {
		mockApiGet.mockResolvedValue({ success: true, data: [fullTemplate('listed')], status: 200 });

		await templateStore.fetchTemplates();

		expect(mockApiGet).toHaveBeenCalledWith('/templates');
		expect(templateStore.templates.map(({ id }) => id)).toEqual(['listed']);
	});

	it('still creates a template over the surviving POST transport', async () => {
		const created = fullTemplate('created');
		mockApiPost.mockResolvedValue({
			success: true,
			data: { template: created },
			status: 200
		});

		const { id: _id, ...draft } = created;
		await templateStore.addTemplate(draft);

		expect(mockApiPost).toHaveBeenCalledWith('/templates', draft, { showToast: false });
		expect(mockApiPost.mock.calls[0][0]).toBe('/templates');
		expect(templateStore.templates.map(({ id }) => id)).toEqual(['created']);
	});
});
