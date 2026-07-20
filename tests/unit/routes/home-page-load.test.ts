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
vi.mock('$lib/config/features', () => ({
	FEATURES: { CONGRESSIONAL: false }
}));

import { load } from '../../../src/routes/+page.server';
import { clearPublicDiscoveryCache } from '$lib/server/public-discovery-cache';
import { PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS } from '$lib/server/public-discovery-manifest-shield';

const mockSetHeaders = vi.fn();

function loadEvent(href: string) {
	return {
		url: new URL(href, 'https://commons.email'),
		depends: vi.fn(),
		setHeaders: mockSetHeaders
	} as never;
}

function publicCard(id: string) {
	return {
		id,
		slug: id,
		title: id,
		description: 'Description',
		domain: 'Civic life',
		topics: [],
		type: 'advocacy',
		deliveryMethod: 'email',
		subject: 'Subject',
		message_body: 'Message',
		preview: 'Preview',
		endorsingOrg: null,
		endorsingOrgs: [],
		endorsementCount: 0,
		coordinationScale: 0,
		isNew: false,
		hasActiveDebate: false,
		verified_sends: null,
		unique_districts: null,
		send_count: 0,
		daily_arrivals: [],
		district_counts: [],
		district_counts_suppressed_districts: 0,
		district_counts_suppressed_count: 0,
		tier_counts: [],
		delivery_config: {},
		cwc_config: null,
		recipient_config: null,
		recipientEmails: [],
		recipient_count: 0,
		campaign_id: null,
		status: 'published',
		is_public: true,
		jurisdictions: [],
		scope: null,
		scopes: [],
		createdAt: '2026-07-18T00:00:00.000Z'
	};
}

function readyQueryResult(ref: string) {
	if (ref === api.templates.publicDiscoveryManifest) {
		return {
			list: { ready: true, retiredRevision: 3, revision: 4, updatedAt: 1_800_000_000_000 },
			relations: { ready: true, retiredRevision: 8, revision: 9, updatedAt: 1_800_000_000_000 }
		};
	}
	if (ref === api.templates.publicDiscoveryList) {
		return {
			projectionVersion: 4,
			revision: 4,
			updatedAt: 1_800_000_000_000,
			templates: [publicCard('template_1')]
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
}

describe('home page load', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		mockSetHeaders.mockReset();
		mockServerQuery.mockReset();
		mockServerQuery.mockImplementation(async (ref: string) => readyQueryResult(ref));
	});

	it.each(['/', '/?view=list', '/?view=spectrum'])(
		'skips graph queries for %s while preserving graph-shaped defaults',
		async (href) => {
			const result = (await load(loadEvent(href))) as Awaited<ReturnType<typeof load>>;

			expect(mockServerQuery).toHaveBeenCalledTimes(2);
			expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryManifest, {
				_secret: expect.any(String)
			});
			expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryList, {
				_secret: expect.any(String),
				excludeCwc: true
			});
			expect(result).toMatchObject({
				templates: [{ id: 'template_1' }],
				templatesLoadFailed: false,
				relationEdges: [],
				conceptRelations: { edges: [], conceptMap: {} }
			});
		}
	);

	it('loads the atomic template-and-relations bundle for the graph surface', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryList) {
				return {
					...readyQueryResult(ref),
					templates: [publicCard('template_1'), publicCard('template_2')]
				};
			}
			return readyQueryResult(ref);
		});
		const pending = load(loadEvent('/?view=graph'));

		// The graph bundle validates both source coordinates together.
		await vi.waitFor(() => expect(mockServerQuery).toHaveBeenCalledTimes(3));
		const result = (await pending) as Awaited<ReturnType<typeof load>>;

		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryRelations, {
			_secret: expect.any(String),
			excludeCwc: true
		});
		expect(mockSetHeaders).toHaveBeenCalledOnce();
		expect(mockSetHeaders).toHaveBeenCalledWith({
			'x-public-discovery-graph': 'ready',
			'x-public-discovery-graph-generation':
				'list=4:1800000000000;relations=9:1800000000000'
		});
		expect(result).toMatchObject({
			templates: [{ id: 'template_1' }, { id: 'template_2' }],
			templatesLoadFailed: false,
			relationEdges: [{ kind: 'twin', score: 0.9 }],
			conceptRelations: {
				edges: [{ kind: 'concept', concept: 'libraries' }],
				conceptMap: { 'library card': 'libraries' }
			}
		});
	});

	it('fails the graph bundle closed when its list snapshot read fails', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryList) {
				throw new Error('List snapshot unavailable');
			}
			return readyQueryResult(ref);
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = (await load(loadEvent('/?view=graph'))) as Awaited<ReturnType<typeof load>>;

		expect(result).toMatchObject({
			templates: [],
			templatesLoadFailed: true,
			relationEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(mockSetHeaders).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it('fails the atomic graph bundle closed when its relation snapshot read fails', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryRelations) {
				throw new Error('Relation snapshot unavailable');
			}
			return readyQueryResult(ref);
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = (await load(loadEvent('/?view=graph'))) as Awaited<ReturnType<typeof load>>;

		expect(result).toEqual({
			templates: [],
			templatesLoadFailed: true,
			relationEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(mockSetHeaders).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledTimes(1);
	});

	it('returns both empty fallbacks when the shared manifest read fails', async () => {
		mockServerQuery.mockRejectedValue(new Error('Convex unavailable'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = (await load(loadEvent('/?view=graph'))) as Awaited<ReturnType<typeof load>>;

		expect(mockServerQuery).toHaveBeenCalledOnce();
		expect(result).toEqual({
			templates: [],
			templatesLoadFailed: true,
			relationEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(mockSetHeaders).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it('does not read or cache a payload before its manifest says the snapshot is ready', async () => {
		mockServerQuery.mockResolvedValue({
			list: { ready: false, retiredRevision: 0, revision: 0, updatedAt: null },
			relations: { ready: false, retiredRevision: 0, revision: 0, updatedAt: null }
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const first = await load(loadEvent('/'));
		const second = await load(loadEvent('/'));

		expect(first).toMatchObject({ templates: [], templatesLoadFailed: true });
		expect(second).toMatchObject({ templates: [], templatesLoadFailed: true });
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryManifest, {
			_secret: expect.any(String)
		});
		expect(mockServerQuery).not.toHaveBeenCalledWith(
			api.templates.publicDiscoveryList,
			expect.anything()
		);
		expect(consoleError).toHaveBeenCalledTimes(2);
	});

	it('distinguishes a valid empty published corpus from an SSR load failure', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			const result = readyQueryResult(ref);
			if (ref === api.templates.publicDiscoveryList) {
				return { ...result, templates: [] };
			}
			return result;
		});

		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [],
			templatesLoadFailed: false
		});
	});

	it('revalidates locally after 60 seconds and reloads an advanced manifest coordinate', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		let revision = 1;
		let updatedAt = 1_800_000_000_000;
		let templateId = 'before-reseed';
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return {
					list: {
						ready: true,
						retiredRevision: revision - 1,
						revision,
						updatedAt
					},
					relations: {
						ready: true,
						retiredRevision: revision - 1,
						revision,
						updatedAt
					}
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					projectionVersion: 4,
					revision,
					updatedAt,
					templates: [publicCard(templateId)]
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'before-reseed' }]
		});
		revision = 2;
		updatedAt += PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS + 1;
		templateId = 'after-reseed';
		clock.mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS + 1
		);

		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'after-reseed' }]
		});
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)
		).toHaveLength(2);
	});

	it('rejects a newer snapshot until the manifest revision catches up', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		let manifestRevision = 1;
		let manifestUpdatedAt = 100;
		const snapshotRevision = 2;
		const snapshotUpdatedAt = 200;
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return {
					list: {
						ready: true,
						retiredRevision: manifestRevision - 1,
						revision: manifestRevision,
						updatedAt: manifestUpdatedAt
					},
					relations: {
						ready: true,
						retiredRevision: manifestRevision - 1,
						revision: manifestRevision,
						updatedAt: manifestUpdatedAt
					}
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					projectionVersion: 4,
					revision: snapshotRevision,
					updatedAt: snapshotUpdatedAt,
					templates: [publicCard('new-epoch')]
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(load(loadEvent('/'))).resolves.toMatchObject({ templates: [] });
		manifestRevision = snapshotRevision;
		manifestUpdatedAt = snapshotUpdatedAt;
		clock.mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS + 1
		);
		await expect(load(loadEvent('/'))).resolves.toMatchObject({
			templates: [{ id: 'new-epoch' }]
		});
	});
});
