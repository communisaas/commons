import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: {
		templates: {
			publicDiscoveryManifest: 'templates.publicDiscoveryManifest',
			publicDiscoveryList: 'templates.publicDiscoveryList',
			publicDiscoveryRelations: 'templates.publicDiscoveryRelations'
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
			if (ref === api.templates.publicDiscoveryManifest) {
				return {
					list: { ready: true, revision: 4, updatedAt: 1_800_000_000_000 },
					relations: { ready: true, revision: 9, updatedAt: 1_800_000_000_000 }
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					revision: 4,
					updatedAt: 1_800_000_000_000,
					templates: [{ id: 'template_1' }]
				};
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					revision: 9,
					updatedAt: 1_800_000_000_000,
					twinEdges: [{ a: 'template_1', b: 'template_2', score: 0.9, kind: 'twin' }],
					conceptRelations: {
						edges: [
							{
								a: 'template_1',
								b: 'template_2',
								concept: 'libraries',
								kind: 'concept'
							}
						],
						conceptMap: { 'library card': 'libraries' }
					}
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});
	});

	it.each(['/', '/?view=list', '/?view=spectrum'])(
		'skips graph queries for %s while preserving graph-shaped defaults',
		async (href) => {
			const result = (await load(loadEvent(href))) as Awaited<ReturnType<typeof load>>;

			expect(mockServerQuery).toHaveBeenCalledTimes(2);
				expect(mockServerQuery).toHaveBeenCalledWith(
					api.templates.publicDiscoveryManifest,
					{}
				);
			expect(mockServerQuery).toHaveBeenCalledWith(
				api.templates.publicDiscoveryList,
				expect.any(Object)
			);
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

		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryRelations, {});
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

		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			templates: [],
			relationEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(consoleError).toHaveBeenCalledTimes(2);
	});

	it('does not read or cache a payload before its manifest says the snapshot is ready', async () => {
		mockServerQuery.mockResolvedValue({
			list: { ready: false, revision: 0, updatedAt: null },
			relations: { ready: false, revision: 0, updatedAt: null }
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const first = await load(loadEvent('/'));
		const second = await load(loadEvent('/'));

		expect(first).toMatchObject({ templates: [] });
		expect(second).toMatchObject({ templates: [] });
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryManifest, {});
		expect(mockServerQuery).not.toHaveBeenCalledWith(
			api.templates.publicDiscoveryList,
			expect.anything()
		);
		expect(consoleError).toHaveBeenCalledTimes(2);
	});

	it('reloads a payload when updatedAt changes even if a reseed reuses the revision number', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		let updatedAt = 1_800_000_000_000;
		let templateId = 'before-reseed';
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return {
					list: { ready: true, revision: 1, updatedAt },
					relations: { ready: true, revision: 1, updatedAt }
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return { revision: 1, updatedAt, templates: [{ id: templateId }] };
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'before-reseed' }]
		});
		updatedAt += 60_001;
		templateId = 'after-reseed';
		clock.mockReturnValue(1_800_000_060_001);

		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'after-reseed' }]
		});
		expect(mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)).toHaveLength(2);
	});

	it('rejects a same-revision snapshot from a newer epoch than the cached manifest', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		let manifestUpdatedAt = 100;
		const snapshotUpdatedAt = 200;
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return {
					list: { ready: true, revision: 1, updatedAt: manifestUpdatedAt },
					relations: { ready: true, revision: 1, updatedAt: manifestUpdatedAt }
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					revision: 1,
					updatedAt: snapshotUpdatedAt,
					templates: [{ id: 'new-epoch' }]
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(load(loadEvent('/'))).resolves.toMatchObject({ templates: [] });
		manifestUpdatedAt = snapshotUpdatedAt;
		clock.mockReturnValue(1_800_000_060_001);
		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'new-epoch' }]
		});
	});
});
