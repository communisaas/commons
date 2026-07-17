import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
	PublicDiscoverySnapshotContractError,
	PublicDiscoverySnapshotNotReadyError,
	getCachedPublicRelations,
	getCachedPublicTemplates
} from '$lib/server/public-template-queries';
import {
	clearPublicDiscoveryCache,
	getCachedPublicData
} from '$lib/server/public-discovery-cache';

const URL = new globalThis.URL('https://commons.example/');
const CONTEXT = { url: URL };

function contextWithKv() {
	const entries = new Map<string, string>();
	const kv = {
		get: vi.fn(async (key: string) => {
			const value = entries.get(key);
			return value === undefined ? null : JSON.parse(value);
		}),
		put: vi.fn(async (key: string, value: string) => {
			entries.set(key, value);
		}),
		list: vi.fn(async ({ prefix = '' }: { prefix?: string } = {}) => ({
			keys: [...entries.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((name) => ({ name })),
			list_complete: true,
			cacheStatus: null
		}))
	} as unknown as KVNamespace;
	return {
		url: URL,
		platform: { env: { PUBLIC_DISCOVERY_KV: kv } } as App.Platform,
		kvEntries: entries
	};
}

function manifest(
	list: { ready: boolean; revision: number; updatedAt: number | null },
	relations = list
) {
	return { list, relations };
}

function publicCard(id: string) {
	return {
		id,
		delivery_config: {},
		cwc_config: null,
		recipient_config: null,
		recipientEmails: [],
		recipient_count: 0
	};
}

function listSnapshot(revision: number, updatedAt: number, id: string) {
	return {
		projectionVersion: 4,
		revision,
		updatedAt,
		templates: [publicCard(id)]
	};
}

describe('public template snapshot queries', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		mockServerQuery.mockReset();
		vi.stubGlobal('caches', undefined);
		vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('serves a payload LKG when the manifest control-plane query is unavailable', async () => {
		const context = contextWithKv();
		const kvList = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_KV?.list!);
		await getCachedPublicData(
			'templates:exclude-cwc=1',
			{ ...context, revision: '4:100' },
			async () => [{ id: 'known-good' }]
		);
		kvList.mockClear();
		// Model a new Worker isolate: no module-local cache and no local edge entry.
		clearPublicDiscoveryCache();
		mockServerQuery.mockRejectedValue(new Error('manifest unavailable'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			{ id: 'known-good' }
		]);
		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			{ id: 'known-good' }
		]);
		expect(mockServerQuery).toHaveBeenCalledTimes(2);
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryManifest, {});
		expect(warn).toHaveBeenCalledWith(
			'[public-template-queries] manifest unavailable; serving templates:exclude-cwc=1 last-known-good:',
			'manifest unavailable'
		);
		expect(kvList).toHaveBeenCalledTimes(1);
	});

	it('does not bypass an authoritative not-ready manifest with an old payload', async () => {
		await getCachedPublicData(
			'templates:exclude-cwc=1',
			{ ...CONTEXT, revision: '4:100' },
			async () => [{ id: 'revoked-or-unready' }]
		);
		mockServerQuery.mockResolvedValue(
			manifest({ ready: false, revision: 0, updatedAt: null })
		);

		await expect(getCachedPublicTemplates(CONTEXT, true)).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotNotReadyError
		);
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery).not.toHaveBeenCalledWith(
			api.templates.publicDiscoveryList,
			expect.anything()
		);
	});

	it('refreshes the manifest and reuses the observed list snapshot across a publish race', async () => {
		let manifestReads = 0;
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				manifestReads += 1;
				const generation = manifestReads === 1 ? { revision: 1, updatedAt: 100 } : { revision: 2, updatedAt: 200 };
				return manifest({ ready: true, ...generation });
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(2, 200, 'new-generation');
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicTemplates(CONTEXT, true)).resolves.toEqual([
			publicCard('new-generation')
		]);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryManifest)
		).toHaveLength(2);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)
		).toHaveLength(1);
	});

	it('does not let an older list LKG suppress publish-race recovery', async () => {
		await getCachedPublicData(
			'templates:exclude-cwc=1',
			{ ...CONTEXT, revision: '1:100' },
			async () => [{ id: 'older-lkg' }]
		);
		let manifestReads = 0;
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				manifestReads += 1;
				const generation =
					manifestReads === 1
						? { revision: 2, updatedAt: 200 }
						: { revision: 3, updatedAt: 300 };
				return manifest({ ready: true, ...generation });
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(3, 300, 'current');
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicTemplates(CONTEXT, true)).resolves.toEqual([
			publicCard('current')
		]);
		expect(manifestReads).toBe(2);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)
		).toHaveLength(1);
	});

	it('reloads the payload when a second publish overtakes the observed snapshot', async () => {
		let manifestReads = 0;
		let listReads = 0;
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				manifestReads += 1;
				const generation =
					manifestReads === 1 ? { revision: 1, updatedAt: 100 } : { revision: 3, updatedAt: 300 };
				return manifest({ ready: true, ...generation });
			}
			if (ref === api.templates.publicDiscoveryList) {
				listReads += 1;
				return listReads === 1
					? listSnapshot(2, 200, 'overtaken')
					: listSnapshot(3, 300, 'current');
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicTemplates(CONTEXT, true)).resolves.toEqual([
			publicCard('current')
		]);
		expect(manifestReads).toBe(2);
		expect(listReads).toBe(2);
	});

	it.each([
		['legacy projection version', { projectionVersion: 3 }],
		['raw recipient config', { recipient_config: { recipients: ['private'] } }],
		['recipient address', { recipientEmails: ['private@example.test'] }],
		['non-array object-list field', { jurisdictions: { private: 'value' } }],
		['malformed object-list element', { scopes: [['private@example.test']] }]
	] as const)('rejects %s before the list payload can enter KV', async (_label, patch) => {
		const context = contextWithKv();
		const kvPut = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_KV?.put!);
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return manifest({ ready: true, revision: 4, updatedAt: 400 });
			}
			if (ref === api.templates.publicDiscoveryList) {
				const snapshot = listSnapshot(4, 400, 'unsafe');
				if ('projectionVersion' in patch) Object.assign(snapshot, patch);
				else Object.assign(snapshot.templates[0], patch);
				return snapshot;
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicTemplates(context, false)).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotContractError
		);
		expect(
			kvPut.mock.calls.some(([key]) => String(key).includes('templates%3Aexclude-cwc%3D0'))
		).toBe(false);
	});

	it('allowlists list cards before returning or persisting them', async () => {
		const context = contextWithKv();
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return manifest({ ready: true, revision: 4, updatedAt: 400 });
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					...listSnapshot(4, 400, 'safe'),
					templates: [
						{
							...publicCard('safe'),
							authorEmail: 'private@example.test',
							delivery_config: { webhookSecret: 'private' },
							cwc_config: { account: 'private' },
							endorsingOrg: {
								name: 'Public Org',
								slug: 'public-org',
								avatar: null,
								ownerEmail: 'private@example.test'
							}
						}
					]
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicTemplates(context, false)).resolves.toEqual([
			{
				...publicCard('safe'),
				endorsingOrg: { name: 'Public Org', slug: 'public-org', avatar: null }
			}
		]);
		const persisted = [...context.kvEntries.values()].join('\n');
		expect(persisted).not.toContain('private@example.test');
		expect(persisted).not.toContain('webhookSecret');
		expect(persisted).not.toContain('ownerEmail');
	});

	it('refreshes the manifest and reuses the observed relation snapshot across a publish race', async () => {
		let manifestReads = 0;
		const relations = {
			revision: 7,
			updatedAt: 700,
			twinEdges: [{ a: 'a', b: 'b', score: 0.8, kind: 'twin' }],
			conceptRelations: { edges: [], conceptMap: {} }
		};
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				manifestReads += 1;
				const generation = manifestReads === 1 ? { revision: 6, updatedAt: 600 } : { revision: 7, updatedAt: 700 };
				return manifest(
					{ ready: true, revision: 1, updatedAt: 100 },
					{ ready: true, ...generation }
				);
			}
			if (ref === api.templates.publicDiscoveryRelations) return relations;
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicRelations(CONTEXT, true)).resolves.toEqual(relations);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryManifest)
		).toHaveLength(2);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryRelations)
		).toHaveLength(1);
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryRelations, {
			excludeCwc: true
		});
	});

	it('allowlists relation payloads before returning or persisting them', async () => {
		const context = contextWithKv();
		const safeRelations = {
			revision: 8,
			updatedAt: 800,
			twinEdges: [{ a: 'a', b: 'b', score: 0.8, kind: 'twin' as const }],
			conceptRelations: {
				edges: [{ a: 'a', b: 'b', concept: 'libraries', kind: 'concept' as const }],
				conceptMap: { library: 'libraries' }
			}
		};
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return manifest(
					{ ready: true, revision: 1, updatedAt: 100 },
					{ ready: true, revision: 8, updatedAt: 800 }
				);
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					...safeRelations,
					recipientEmails: ['private@example.test'],
					twinEdges: [
						{ ...safeRelations.twinEdges[0], recipientEmail: 'private@example.test' }
					]
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicRelations(context, true)).resolves.toEqual(safeRelations);
		const persisted = [...context.kvEntries.values()].join('\n');
		expect(persisted).not.toContain('private@example.test');
		expect(persisted).not.toContain('recipientEmail');
	});

	it('rejects malformed relation fields before they can enter KV', async () => {
		const context = contextWithKv();
		const kvPut = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_KV?.put!);
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return manifest(
					{ ready: true, revision: 1, updatedAt: 100 },
					{ ready: true, revision: 9, updatedAt: 900 }
				);
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					revision: 9,
					updatedAt: 900,
					twinEdges: [{ a: 'a', b: 'b', score: Number.NaN, kind: 'twin' }],
					conceptRelations: { edges: [], conceptMap: {} }
				};
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicRelations(context, false)).rejects.toMatchObject({
			name: 'PublicDiscoverySnapshotContractError',
			family: 'relations'
		});
		expect(
			kvPut.mock.calls.some(([key]) => String(key).includes('relations%3Acombined'))
		).toBe(false);
	});
});
