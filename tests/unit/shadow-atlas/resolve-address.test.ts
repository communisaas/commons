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
 *   - the geocode step is atlas-native: the address-index chunk fetch (mocked ipfs-store)
 *     feeds the real §2 match ladder — no third-party geocoding call exists to mock
 *
 * Pure unit test: h3-js, the IPFS store (district chunks AND address-index chunks), and
 * the cell-tree snapshot are all mocked. No real h3 / IPFS / crypto-WASM runs.
 *
 * NOTE ON CONFIG: this file lives under tests/, covered by the default vitest.config.ts
 * include (tests/** + convex/**):
 *   npx vitest run tests/unit/shadow-atlas/resolve-address.test.ts
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
	mockLatLngToCell,
	mockGetChunkForCell,
	mockGetOfficialsForDistrict,
	mockGetManifestVintage,
	mockGetAddressChunk,
	mockGetNormalizationTable,
	mockIsIPFSConfigured
} = vi.hoisted(() => ({
	mockLatLngToCell: vi.fn(),
	mockGetChunkForCell: vi.fn(),
	mockGetOfficialsForDistrict: vi.fn(),
	mockGetManifestVintage: vi.fn(),
	mockGetAddressChunk: vi.fn(),
	mockGetNormalizationTable: vi.fn(),
	mockIsIPFSConfigured: vi.fn()
}));

// Empty private env → SHADOW_ATLAS_API_URL falls back to its localhost default; nothing
// here performs network I/O — every atlas store read (district chunks, address-index
// chunks, normalization table, manifest clocks) is mocked below.
vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('h3-js', () => ({
	latLngToCell: (...args: unknown[]) => mockLatLngToCell(...args)
}));

vi.mock('$lib/core/shadow-atlas/ipfs-store', async (importOriginal) => {
	// Re-export the REAL error classes: client.ts's infra-vs-miss-vs-schema classifier
	// discriminates on them with `instanceof`, so the mock must preserve class identity.
	const actual = await importOriginal<typeof import('$lib/core/shadow-atlas/ipfs-store')>();
	return {
		ContentNotFoundError: actual.ContentNotFoundError,
		AddressIndexSchemaError: actual.AddressIndexSchemaError,
		getMerkleSnapshot: vi.fn(),
		isIPFSConfigured: (...args: unknown[]) => mockIsIPFSConfigured(...args),
		getChunkForCell: (...args: unknown[]) => mockGetChunkForCell(...args),
		getOfficialsForDistrict: (...args: unknown[]) => mockGetOfficialsForDistrict(...args),
		getManifestVintage: (...args: unknown[]) => mockGetManifestVintage(...args),
		getAddressChunk: (...args: unknown[]) => mockGetAddressChunk(...args),
		getNormalizationTable: (...args: unknown[]) => mockGetNormalizationTable(...args),
		clearCache: vi.fn()
	};
});

vi.mock('$lib/core/shadow-atlas/cell-tree-snapshot', () => ({
	deserializeCellTreeSnapshot: vi.fn(),
	computeClientCellProof: vi.fn(),
	validateSnapshotRoot: vi.fn()
}));

const { resolveAddress, AtlasInfraError } = await import('$lib/core/shadow-atlas/client');
const { AddressIndexSchemaError } = await import('$lib/core/shadow-atlas/ipfs-store');
const { setMatchOutcomeSink, ADDRESS_NOT_FOUND_MESSAGE } = await import(
	'$lib/core/shadow-atlas/geocoder'
);

const ADDRESS = {
	street: '1 Civic Center Plaza',
	city: 'San Francisco',
	state: 'CA',
	zip: '94102',
	country: 'US' as const
};

/** §3 tables (shipped-data shape) — enough for the fixture streets below. */
const NORM_TABLE = {
	normVersion: 1,
	directionals: { NORTH: 'N', N: 'N', NORTHWEST: 'NW', NW: 'NW' },
	suffixes: { PLAZA: 'PLZ', PLZ: 'PLZ', STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE' },
	units: ['APT', 'STE', 'UNIT', '#'],
	unitsWithoutValue: ['REAR', 'BSMT']
};

/**
 * §2 address chunk for ZIP 94102:
 *  - '1 Civic Center Plaza' → exact point (matchClass point, factor 1.0)
 *  - '1450 Market Street'   → parity range  (matchClass range, factor 0.85)
 *  - any other street       → zipCentroid   (matchClass zip,   factor 0.6)
 */
const ADDRESS_CHUNK = {
	version: 1,
	schema: 'atlas-address-index',
	country: 'US',
	zip: '94102',
	state: 'CA',
	zipCentroid: [37.77926, -122.41924],
	streets: {
		'CIVIC CENTER PLZ': {
			p: { '1': [37.7793, -122.4193, 0] }
		},
		'MARKET ST': {
			r: [[1400, 1498, 'E', 37.7793, -122.4193, 37.7751, -122.4172]]
		}
	}
};

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
		mockGetNormalizationTable.mockResolvedValue(NORM_TABLE);
		mockGetAddressChunk.mockResolvedValue(ADDRESS_CHUNK);
		// Silence the (hash-only) match-outcome metric in test output.
		setMatchOutcomeSink(() => {});
	});

	afterEach(() => {
		setMatchOutcomeSink(null);
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
			source: 'atlas-address-index',
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
		// The multi-type view misses in lockstep: no chunk → no boundary types.
		expect(result.districts).toEqual([]);
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
		// The staleness guard passes districts through untouched — never drops or mutates it.
		expect(result.districts.length).toBe(1);
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
		// The multi-type view misses in lockstep on a clean coverage miss.
		expect(result.districts).toEqual([]);
		// Geocode still succeeded — a degraded resolution is a SUCCESS, not a throw.
		expect(result.geocode.lat).toBeCloseTo(37.7793);
	});

	it('(h) headline confidence follows the geocode matchClass precision on clean hits: point→1.0, range→0.85, zip→0.6', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		// Exact house-number point (housenumber-grade).
		expect((await resolveAddress(ADDRESS)).confidence).toBe(1.0);

		// Parity-matched range interpolation (street-grade).
		const range = await resolveAddress({ ...ADDRESS, street: '1450 Market Street' });
		expect(range.confidence).toBe(0.85);

		// Street unknown to the index → honest ZIP centroid (locality floor,
		// never a fabricated 1.0).
		const zipGrade = await resolveAddress({ ...ADDRESS, street: '9999 Nonexistent Way' });
		expect(zipGrade.confidence).toBe(0.6);
		// geocode.confidence carries the SAME precision factor — the geocode's
		// own placement grade, not a prominence score.
		expect(zipGrade.geocode.confidence).toBe(0.6);
		expect(zipGrade.geocode.lat).toBeCloseTo(37.77926);
	});

	it('(i) staleness guard composes AFTER the precision factor: point-grade geocode + resolved manifest with unknown vintage → 0.4 clamp', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		// Manifest RESOLVED but carries no usable vintage — the genuine known-unknown.
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: null,
			generated: null,
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS); // exact point hit → factor 1.0

		// Factor gives min(1.0, 1.0) = 1.0; the guard then clamps min(1.0, 0.4) = 0.4.
		expect(result.confidence).toBe(0.4);
		expect(result.warning).toBe('boundary vintage unknown');
		expect(result.district?.id).toBe('CA-01'); // resolved address never discarded
	});

	it('(j) a geocode miss (no address chunk for the ZIP) throws the EXACT GEOCODE_MISS message — never a fabricated coordinate', async () => {
		mockGetAddressChunk.mockResolvedValue(null);

		await expect(resolveAddress(ADDRESS)).rejects.toThrow(ADDRESS_NOT_FOUND_MESSAGE);
		// Byte-exact: src/routes/api/v1/resolve-address/+server.ts keys its 404
		// GEOCODE_MISS mapping on this string.
		const err = await resolveAddress(ADDRESS).catch((e) => e);
		expect((err as Error).message).toBe('Address not found. Please check your address and try again.');
		expect(err).not.toBeInstanceOf(AtlasInfraError);
	});

	it('(k) an address-index infra fault (5xx/timeout) surfaces as AtlasInfraError — never billed as a miss', async () => {
		mockGetAddressChunk.mockRejectedValue(new Error('All content sources failed for US/addresses/94102.json: r2 returned 503'));

		await expect(resolveAddress(ADDRESS)).rejects.toThrow(AtlasInfraError);
	});

	it('(l) an address-index schema mismatch propagates as a plain fail-closed error — neither an outage nor a miss', async () => {
		mockGetAddressChunk.mockRejectedValue(
			new AddressIndexSchemaError('Address chunk 94102 schema mismatch: version=2 schema=atlas-address-index')
		);

		const err = await resolveAddress(ADDRESS).catch((e) => e);
		expect(err).toBeInstanceOf(AddressIndexSchemaError);
		expect(err).not.toBeInstanceOf(AtlasInfraError);
		expect((err as Error).message).not.toContain('Address not found');
	});

	it("(m) the person-layer street:'' postal path resolves zip-grade (0.6 factor) without a street match", async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress({ ...ADDRESS, street: '' });

		expect(result.geocode.lat).toBeCloseTo(37.77926);
		expect(result.geocode.confidence).toBe(0.6);
		expect(result.confidence).toBe(0.6); // min(districtConfidence 1.0, zip factor 0.6)
		expect(result.district?.id).toBe('CA-01');
	});

	it('(n) a multi-slot chunk projects EVERY populated served type into districts, slot-ordered, congressional first', async () => {
		// Realistic 24-slot chunk: congressional + state senate/house + county +
		// unified school + township populated (rural-MN shape), everything else empty.
		const slots: (string | null)[] = new Array(24).fill(null);
		slots[0] = 'cd-2708';
		slots[2] = 'sldu-27011';
		slots[3] = 'sldl-2711B';
		slots[4] = 'county-27115';
		slots[7] = 'unsd-2742750';
		slots[20] = 'cousub-2711532984';
		mockGetChunkForCell.mockResolvedValue(slots);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		expect(result.districts).toHaveLength(6);
		// Canonical slot order, congressional first.
		expect(result.districts.map((d) => d.district_type)).toEqual([
			'congressional',
			'state-senate',
			'state-house',
			'county',
			'unified-school',
			'township'
		]);
		// Congressional wire entry uses the DISPLAY code — identical id to the legacy field.
		expect(result.districts[0]).toEqual({
			id: 'MN-08',
			geoid: '2708',
			name: "Minnesota's 8th Congressional District",
			jurisdiction: 'congressional',
			district_type: 'congressional'
		});
		expect(result.districts[0].id).toBe(result.district?.id);
		// Non-congressional entries keep the substrate id + stripped GEOID + label-based name.
		expect(result.districts[1]).toEqual({
			id: 'sldu-27011',
			geoid: '27011',
			name: 'State Senate 27011',
			jurisdiction: 'state-senate',
			district_type: 'state-senate'
		});
		// Alphanumeric TIGER GEOIDs survive the prefix strip intact.
		expect(result.districts[2].geoid).toBe('2711B');
		expect(result.districts[2].name).toBe('State House/Assembly 2711B');
	});

	it('(o) a populated slot OUTSIDE the served allowlist is never emitted — disclosure gates the wire', async () => {
		const slots: (string | null)[] = new Array(24).fill(null);
		slots[0] = 'cd-0601';
		slots[11] = 'water-9999999'; // defined type, zero live coverage → not served
		mockGetChunkForCell.mockResolvedValue(slots);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		// Only the congressional entry surfaces; the unserved type cannot reach the
		// wire before the coverage table discloses it.
		expect(result.districts).toHaveLength(1);
		expect(result.districts[0].district_type).toBe('congressional');
	});

	it('(q) chunk present but slot 0 empty: primary-miss semantics unchanged while non-congressional types still surface', async () => {
		mockGetChunkForCell.mockResolvedValue([null, null, 'sldu-27011']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		// The PRIMARY miss stays keyed to slot 0: district null, confidence 0, loud warning.
		expect(result.district).toBeNull();
		expect(result.confidence).toBe(0);
		expect(result.warning).toBe('district lookup miss');
		// ...while the populated state-senate boundary still surfaces honestly.
		expect(result.districts).toEqual([
			{
				id: 'sldu-27011',
				geoid: '27011',
				name: 'State Senate 27011',
				jurisdiction: 'state-senate',
				district_type: 'state-senate'
			}
		]);
	});

	it('(s) a single-element legacy chunk emits exactly one districts entry mirroring the legacy district', async () => {
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockGetManifestVintage.mockResolvedValue({
			tigerVintage: 'TIGER2024',
			generated: '2024-09-01T00:00:00.000Z',
			officialsGenerated: null
		});

		const result = await resolveAddress(ADDRESS);

		expect(result.districts).toEqual([
			{
				id: 'CA-01',
				geoid: '0601',
				name: "California's 1st Congressional District",
				jurisdiction: 'congressional',
				district_type: 'congressional'
			}
		]);
	});
});
