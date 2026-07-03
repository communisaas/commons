/**
 * resolveAddress return-shape tests.
 *
 * Asserts the honest provenance + two-clock contract of the AddressResolutionResult:
 *   - a clean district hit carries structured provenance and confidence 1.0
 *   - boundaryAsOf (boundary-geometry clock) and officialsAsOf (officials-sync clock) are
 *     two DISTINCT fields — the boundary value is never copied into officials, nor vice versa
 *   - an absent/'unknown' TIGER vintage yields boundaryAsOf null — never a fabricated,
 *     borrowed, or current-time date
 *   - a district miss is a loud, low-confidence (0) geocode-only success: district null
 *
 * Pure unit test: h3-js, the IPFS store, the cell-tree snapshot, and Nominatim's HTTP call
 * are all mocked. No real h3 / IPFS / crypto-WASM runs.
 *
 * NOTE ON CONFIG: this file lives under src/, which the default vitest.config.ts does NOT
 * include (it scans tests/** + convex/**). Run it under the config whose include is src/**:
 *   npx vitest run --config vite.config.ts src/lib/core/shadow-atlas/resolve-address.test.ts
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
	mockLatLngToCell,
	mockGetChunkForCell,
	mockGetOfficialsForDistrict,
	mockGetManifestVintage,
	mockIsIPFSConfigured
} = vi.hoisted(() => ({
	mockLatLngToCell: vi.fn(),
	mockGetChunkForCell: vi.fn(),
	mockGetOfficialsForDistrict: vi.fn(),
	mockGetManifestVintage: vi.fn(),
	mockIsIPFSConfigured: vi.fn()
}));

// Empty private env → NOMINATIM_URL falls back to the localhost default; we never hit it
// because global fetch is mocked below.
vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('h3-js', () => ({
	latLngToCell: (...args: unknown[]) => mockLatLngToCell(...args)
}));

vi.mock('$lib/core/shadow-atlas/ipfs-store', async (importOriginal) => {
	// Re-export the REAL ContentNotFoundError: client.ts's infra-vs-miss classifier
	// discriminates on it with `instanceof`, so the mock must preserve class identity.
	const actual = await importOriginal<typeof import('$lib/core/shadow-atlas/ipfs-store')>();
	return {
		ContentNotFoundError: actual.ContentNotFoundError,
		getMerkleSnapshot: vi.fn(),
		isIPFSConfigured: (...args: unknown[]) => mockIsIPFSConfigured(...args),
		getChunkForCell: (...args: unknown[]) => mockGetChunkForCell(...args),
		getOfficialsForDistrict: (...args: unknown[]) => mockGetOfficialsForDistrict(...args),
		getManifestVintage: (...args: unknown[]) => mockGetManifestVintage(...args),
		clearCache: vi.fn()
	};
});

vi.mock('$lib/core/shadow-atlas/cell-tree-snapshot', () => ({
	deserializeCellTreeSnapshot: vi.fn(),
	computeClientCellProof: vi.fn(),
	validateSnapshotRoot: vi.fn()
}));

const { resolveAddress, AtlasInfraError } = await import('$lib/core/shadow-atlas/client');

const ADDRESS = {
	street: '1 Civic Center Plaza',
	city: 'San Francisco',
	state: 'CA',
	zip: '94102',
	country: 'US' as const
};

/**
 * Stub Nominatim's /search response with a single geocoded match.
 *
 * `place_rank` defaults to 30 (house/rooftop-grade). Pass `{}` to simulate an
 * instance that omits the field entirely (must map to the conservative floor).
 *
 * SOURCE-POPULATION PIN: the stub REFUSES a request that does not carry
 * `format=jsonv2`. Nominatim only emits `place_rank` under jsonv2 — under
 * plain `json` the field is absent in prod and every resolution flattens to
 * the 0.6 floor while a permissive fixture (supplying place_rank regardless)
 * stays green. Reverting the format therefore fails these tests loudly.
 */
function mockNominatimHit(opts: { place_rank?: number } = { place_rank: 30 }): void {
	globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/search') && !url.includes('format=jsonv2')) {
			throw new Error(
				`Nominatim stub: expected format=jsonv2 (place_rank is absent under plain json), got: ${url}`
			);
		}
		return {
			ok: true,
			status: 200,
			json: async () => [
				{
					lat: '37.7793',
					lon: '-122.4193',
					display_name: 'San Francisco, CA, 94102',
					importance: 0.9,
					...(opts.place_rank !== undefined ? { place_rank: opts.place_rank } : {})
				}
			]
		} as unknown as Response;
	});
}

const OFFICIALS_FILE = {
	officials: [
		{
			id: 'P000197',
			name: 'Jane Rep',
			party: 'D',
			chamber: 'house',
			state: 'CA',
			district: '01',
			phone: '202-555-0100',
			contact_form_url: null,
			website_url: null,
			is_voting: true,
			delegate_type: null
		}
	]
};

describe('resolveAddress return shape — provenance + two-clock honesty', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLatLngToCell.mockReturnValue('872830828ffffff');
		mockIsIPFSConfigured.mockReturnValue(true);
		mockGetOfficialsForDistrict.mockResolvedValue(OFFICIALS_FILE);
		mockNominatimHit();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('(a) clean hit carries provenance + confidence 1.0 + boundaryAsOf from manifest.generated + officialsAsOf field present', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']); // → CA-01
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		expect(result.district).toEqual({
			id: 'CA-01',
			name: "California's 1st Congressional District",
			jurisdiction: 'congressional',
			district_type: 'congressional'
		});
		expect(result.provenance).toEqual({
			source: 'nominatim',
			tigerVintage: 'TIGER2024'
		});
		expect(result.confidence).toBe(1.0);
		expect(result.boundaryAsOf).toBe('2024-09-01T00:00:00.000Z');
		// officialsAsOf is a present field (not undefined) even when honestly null.
		expect(result).toHaveProperty('officialsAsOf');
		expect(result.officialsAsOf).toBeNull();
		// The retired `vintage` field is gone.
		expect(result).not.toHaveProperty('vintage');
	});

	it('(b) boundaryAsOf and officialsAsOf are distinct fields — boundary is never copied into officials', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		// Boundary clock is set from manifest.generated...
		expect(result.boundaryAsOf).toBe('2024-09-01T00:00:00.000Z');
		// ...but the officials clock stays honestly null — the boundary value is NOT borrowed.
		expect(result.officialsAsOf).toBeNull();
		expect(result.officialsAsOf).not.toBe(result.boundaryAsOf);
	});

	it("(c) tigerVintage null/'unknown'/absent → boundaryAsOf null with no fabricated date", async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);

		// Case 1: tigerVintage null (even though manifest still has a `generated` value —
		// the boundary clock must NOT borrow it without a real vintage).
		mockGetManifestVintage.mockResolvedValueOnce({
			tigerVintage: null,
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});
		let result = await resolveAddress(ADDRESS);
		expect(result.boundaryAsOf).toBeNull();
		expect(result.provenance.tigerVintage).toBe('unknown');

		// Case 2: getManifestVintage degrades 'unknown' → null upstream (its documented
		// contract), so the client sees tigerVintage null → boundaryAsOf null.
		mockGetManifestVintage.mockResolvedValueOnce({
			tigerVintage: null,
			generated: null,
			officialsGenerated: null
		});
		result = await resolveAddress(ADDRESS);
		expect(result.boundaryAsOf).toBeNull();

		// Case 3: fields absent entirely → boundaryAsOf null, never fabricated.
		mockGetManifestVintage.mockResolvedValueOnce({
			tigerVintage: null,
			generated: null,
			officialsGenerated: null
		});
		result = await resolveAddress(ADDRESS);
		// null is the honest unknown — never a fabricated, borrowed, or current-time date.
		expect(result.boundaryAsOf).toBeNull();
	});

	it('(d) district miss → confidence 0 + district null (loud miss, not a confident geocode-only success)', async () => {
		// No chunk for this cell → lookupDistrict throws → caught → districtMissed.
		mockGetChunkForCell.mockResolvedValue(undefined);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		expect(result.district).toBeNull();
		expect(result.confidence).toBe(0);
		// Geocode still succeeded — a degraded resolution is a SUCCESS, not a throw.
		expect(result.geocode.lat).toBeCloseTo(37.7793);
		expect(result.officials).toBeNull();
	});

	it('(e) a manifest fetch failure DEGRADES clocks to null — a fully-resolved address is NOT discarded; only geocoding throws', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']); // district resolves fine → CA-01
		// getManifestVintage REJECTS (transient R2/IPFS hiccup) — must be caught + degraded.
		mockGetManifestVintage.mockRejectedValueOnce(new Error('R2/manifest unreachable'));

		// Geocode + district + officials all succeeded; the manifest failure must NOT throw.
		const result = await resolveAddress(ADDRESS);

		expect(result.district?.id).toBe('CA-01'); // resolved result preserved, not discarded
		expect(result.boundaryAsOf).toBeNull(); // clocks degrade honestly to null
		expect(result.officialsAsOf).toBeNull();
		expect(result.provenance.tigerVintage).toBe('unknown');
		expect(result.confidence).toBe(1.0); // a clean district hit stays trusted
	});

	it('(f) a non-404 chunk-fetch failure (infra fault) propagates as AtlasInfraError — never converted into a district miss', async () => {
		// R2/IPFS answered 502 — the store FAILED; this is not "no coverage here".
		mockGetChunkForCell.mockRejectedValue(new Error('R2 returned 502 for US/districts/832830fffffffff.json'));

		await expect(resolveAddress(ADDRESS)).rejects.toThrow(AtlasInfraError);
		// AtlasInfraError extends Error, so generic catch sites keep catching it.
		await expect(resolveAddress(ADDRESS)).rejects.toBeInstanceOf(Error);
	});

	it('(g) a clean all-404 (null chunk) stays an honest coverage miss — resolves with district null + confidence 0, no throw', async () => {
		mockGetChunkForCell.mockResolvedValue(null);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		expect(result.district).toBeNull();
		expect(result.confidence).toBe(0);
		// Geocode still succeeded — a degraded resolution is a SUCCESS, not a throw.
		expect(result.geocode.lat).toBeCloseTo(37.7793);
	});

	it('(h) headline confidence follows Nominatim place_rank precision on clean hits: 30→1.0, 26→0.85, absent→0.6', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		mockNominatimHit({ place_rank: 30 }); // house/rooftop-grade
		expect((await resolveAddress(ADDRESS)).confidence).toBe(1.0);

		mockNominatimHit({ place_rank: 26 }); // street centroid
		expect((await resolveAddress(ADDRESS)).confidence).toBe(0.85);

		mockNominatimHit({}); // rank absent → conservative floor, never a fabricated 1.0
		const absent = await resolveAddress(ADDRESS);
		expect(absent.confidence).toBe(0.6);
		// geocode.confidence stays the prominence-based `importance` value — the
		// precision curve gates the headline confidence only.
		expect(absent.geocode.confidence).toBe(0.9);
	});

	it('(i) staleness guard composes AFTER the precision curve: place_rank 30 + resolved manifest with unknown vintage → 0.4 clamp', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		// Manifest RESOLVED but carries no usable vintage — the genuine known-unknown.
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: null,
			generated: null,
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS); // place_rank 30 via beforeEach default

		// Curve gives min(1.0, 1.0) = 1.0; the guard then clamps min(1.0, 0.4) = 0.4.
		expect(result.confidence).toBe(0.4);
		expect(result.warning).toBe('boundary vintage unknown');
		expect(result.district?.id).toBe('CA-01'); // resolved address never discarded
	});
});
