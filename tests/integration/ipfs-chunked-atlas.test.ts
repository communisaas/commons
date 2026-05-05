/**
 * I3 (#22) — Chunked-atlas R2 read path integration tests.
 *
 * Pre-I3: only `sanitizePathSegment` had unit coverage; the actual fetch +
 * cache + error-mapping pipeline through `ipfs-store.ts` was not exercised.
 * That's the gap #22 has tracked since the storacha sunset migration.
 *
 * These tests mock `global.fetch` with realistic R2 responses and exercise
 * the full read path:
 *   - manifest read → cache hit on repeat
 *   - chunk-for-cell with H3 parent computation
 *   - district index O(1) lookup
 *   - 404 → null mapping
 *   - network error → throw
 *
 * Test isolation: `vi.resetModules()` ensures each test gets a fresh module
 * load (caches reset). `clearCache()` is called in afterEach as belt-and-
 * suspenders for tests that share a single import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ATLAS_BASE_URL = 'https://atlas.commons.example';

interface FetchMockResponse {
	status: number;
	body?: unknown;
}

const fetchMock = vi.fn();

beforeEach(() => {
	vi.resetModules();
	fetchMock.mockReset();
	globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	vi.restoreAllMocks();
});

function mockResponse({ status, body }: FetchMockResponse): Response {
	return new Response(body !== undefined ? JSON.stringify(body) : null, {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

async function importStore(): Promise<typeof import('$lib/core/shadow-atlas/ipfs-store')> {
	const mod = await import('$lib/core/shadow-atlas/ipfs-store');
	mod.configure({ atlasBaseUrl: ATLAS_BASE_URL, ipfsCid: '' });
	await mod.clearCache();
	return mod;
}

describe('ipfs-store chunked-atlas R2 read path', () => {
	describe('getManifest', () => {
		it('fetches manifest.json from the configured R2 base URL', async () => {
			const store = await importStore();
			const manifest = {
				version: 'v20260503',
				totalChunks: 977,
				chunks: { '832830fffffffff': 'chunk-1' },
			};
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: manifest }));

			const result = await store.getManifest('US');
			expect(result.version).toBe('v20260503');
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock.mock.calls[0][0]).toMatch(
				new RegExp(`^${ATLAS_BASE_URL.replace(/[.*]/g, '\\$&')}.*US/manifest\\.json`),
			);
		});

		it('caches manifest reads (second call does not fetch)', async () => {
			const store = await importStore();
			fetchMock.mockResolvedValueOnce(
				mockResponse({ status: 200, body: { version: 'v1', totalChunks: 0, chunks: {} } }),
			);

			await store.getManifest('US');
			await store.getManifest('US');

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('rejects path-traversal attempts in country code', async () => {
			const store = await importStore();
			await expect(store.getManifest('../etc')).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('getChunkForCell', () => {
		// h3-js latLngToCell is deterministic; we use the real lib here.
		// cellToParent('872830828ffffff', 3) = '832830fffffffff' on h3-js v4.
		const SF_CELL = '872830828ffffff';

		it('fetches the chunk file via cellToParent path and returns the cell slots', async () => {
			const store = await importStore();
			const expectedSlots = ['cd-0612', 'CA', null, ...Array(21).fill(null)];
			const chunk = { cells: { [SF_CELL]: expectedSlots } };
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: chunk }));

			const slots = await store.getChunkForCell(SF_CELL, 'US');
			expect(slots).toEqual(expectedSlots);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			// The URL must include the h3-derived parent key. We don't pin the
			// exact parent (that's an h3-js implementation detail) but assert
			// the path shape.
			const url = fetchMock.mock.calls[0][0] as string;
			expect(url).toMatch(/US\/districts\/[0-9a-f]+\.json$/);
		});

		it('returns null when the chunk does not contain the requested cell', async () => {
			const store = await importStore();
			fetchMock.mockResolvedValueOnce(
				mockResponse({ status: 200, body: { cells: { 'other-cell': [] } } }),
			);
			const slots = await store.getChunkForCell(SF_CELL, 'US');
			expect(slots).toBeNull();
		});

		it('returns null on 404 (chunk not yet published) without throwing', async () => {
			const store = await importStore();
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 404 }));
			const slots = await store.getChunkForCell(SF_CELL, 'US');
			expect(slots).toBeNull();
		});

		it('caches chunks by parent key (second cell in same chunk does not refetch)', async () => {
			const store = await importStore();
			const chunk = {
				cells: {
					[SF_CELL]: ['cd-0612', 'CA'],
					'872830829ffffff': ['cd-0613', 'CA'],
				},
			};
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: chunk }));

			const a = await store.getChunkForCell(SF_CELL, 'US');
			const b = await store.getChunkForCell('872830829ffffff', 'US');

			expect(a?.[0]).toBe('cd-0612');
			expect(b?.[0]).toBe('cd-0613');
			// Both cells share the same H3 parent at res-3, so a single fetch
			// serves both. If this fails, the cache key construction broke.
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe('getOfficialsForDistrict', () => {
		it('fetches officials by district code', async () => {
			const store = await importStore();
			const officials = {
				district_code: 'CA-12',
				officials: [{ name: 'Test', chamber: 'house', party: 'D' }],
			};
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: officials }));

			const result = await store.getOfficialsForDistrict('CA-12', 'US');
			expect(result?.district_code).toBe('CA-12');
			const url = fetchMock.mock.calls[0][0] as string;
			expect(url).toMatch(/US\/officials\/CA-12\.json$/);
		});

		it('returns null when the district has no officials file (404)', async () => {
			const store = await importStore();
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 404 }));
			const result = await store.getOfficialsForDistrict('CA-99', 'US');
			expect(result).toBeNull();
		});
	});

	describe('getDistrictIndex', () => {
		it('fetches the per-country district index', async () => {
			const store = await importStore();
			const index = {
				slots: {
					'0': { 'cd-0612': ['832830fffffffff'] },
				},
			};
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: index }));

			const result = await store.getDistrictIndex('US');
			expect(result).not.toBeNull();
			expect(fetchMock.mock.calls[0][0]).toMatch(/US\/district-index\.json$/);
		});

		it('returns null when atlas is not configured', async () => {
			vi.resetModules();
			const mod = await import('$lib/core/shadow-atlas/ipfs-store');
			// Don't configure — isConfigured() returns false.
			const result = await mod.getDistrictIndex('US');
			expect(result).toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('error mapping', () => {
		it('throws (does NOT silently null) on 5xx server error', async () => {
			const store = await importStore();
			fetchMock.mockResolvedValueOnce(mockResponse({ status: 503 }));
			// 5xx is a real failure — the read path must surface it so the caller
			// can retry or alert. Silent null would mask outages.
			await expect(store.getManifest('US')).rejects.toThrow();
		});

		it('throws on network failure (fetch reject)', async () => {
			const store = await importStore();
			fetchMock.mockRejectedValueOnce(new Error('network unreachable'));
			await expect(store.getManifest('US')).rejects.toThrow();
		});
	});

	describe('path traversal hardening', () => {
		it('refuses district codes containing path-traversal segments', async () => {
			const store = await importStore();
			await expect(
				store.getOfficialsForDistrict('../../../etc/passwd', 'US'),
			).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
