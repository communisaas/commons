import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: {
		templates: {
			listPublic: 'templates.listPublic',
			relatednessEdges: 'templates.relatednessEdges',
			conceptRelations: 'templates.conceptRelations'
		}
	}
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));

import { load } from '../../../src/routes/+page.server';
import { clearPublicDiscoveryCache } from '$lib/server/public-discovery-cache';

function loadEvent(href: string) {
	return {
		url: new URL(href, 'https://commons.email'),
		depends: vi.fn()
	} as never;
}

describe('home page load', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		mockServerQuery.mockReset();
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.listPublic) return [{ id: 'template_1' }];
			if (ref === api.templates.relatednessEdges) {
				return [{ a: 'template_1', b: 'template_2', score: 0.9, kind: 'twin' }];
			}
			if (ref === api.templates.conceptRelations) {
				return {
					edges: [{ a: 'template_1', b: 'template_2', concept: 'libraries', kind: 'concept' }],
					conceptMap: { 'library card': 'libraries' }
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});
	});

	it.each(['/', '/?view=list', '/?view=spectrum'])(
		'skips graph queries for %s while preserving graph-shaped defaults',
		async (href) => {
			const result = (await load(loadEvent(href))) as Awaited<ReturnType<typeof load>>;

			expect(mockServerQuery).toHaveBeenCalledTimes(1);
			expect(mockServerQuery).toHaveBeenCalledWith(api.templates.listPublic, expect.any(Object));
			expect(result).toMatchObject({
				templates: [{ id: 'template_1' }],
				relationEdges: [],
				conceptRelations: { edges: [], conceptMap: {} }
			});
		}
	);

	it('loads both graph relation sources alongside templates for the graph surface', async () => {
		const pending = load(loadEvent('/?view=graph'));

		// All three reads are started before the loader awaits their shared result.
		await vi.waitFor(() => expect(mockServerQuery).toHaveBeenCalledTimes(3));
		const result = (await pending) as Awaited<ReturnType<typeof load>>;

		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.relatednessEdges, {});
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.conceptRelations, {});
		expect(result).toMatchObject({
			templates: [{ id: 'template_1' }],
			relationEdges: [{ kind: 'twin', score: 0.9 }],
			conceptRelations: {
				edges: [{ kind: 'concept', concept: 'libraries' }],
				conceptMap: { 'library card': 'libraries' }
			}
		});
	});

	it('keeps independent empty fallbacks when graph queries fail', async () => {
		mockServerQuery.mockRejectedValue(new Error('Convex unavailable'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = (await load(loadEvent('/?view=graph'))) as Awaited<ReturnType<typeof load>>;

		expect(mockServerQuery).toHaveBeenCalledTimes(3);
		expect(result).toEqual({
			templates: [],
			relationEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(consoleError).toHaveBeenCalledTimes(3);
	});
});
