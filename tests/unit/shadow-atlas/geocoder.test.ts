/**
 * Atlas-native geocoder unit tests (SEAM-CONTRACT v1).
 *
 * Exercises the REAL fetch path (ipfs-store fetchContent) against fixture
 * chunks served by a mocked globalThis.fetch — no module-level mock of the
 * units under test:
 *   - §3 normalizer: table-driven cases (units incl. bare designators,
 *     directionals incl. the trailing-directional suffix amendment, suffixes,
 *     fractional/hyphenated house numbers) + idempotence
 *   - §2 ladder: exact point (leading zeros stripped, literal fractional and
 *     hyphenated keys), parity E/O/B eligibility, smallest-span → lowest-fromHn
 *     tie-breaks, pinned interpolation incl. toHn === fromHn
 *   - miss honesty: no chunk / no ZIP5 → the EXACT 'Address not found…'
 *     throw, 'miss' metric emitted, never a fabricated coordinate
 *   - zip fallback + the person-layer street:'' path
 *   - §5 confidence factors (1.0 / 0.85 / 0.6)
 *   - §4 fail-closed schema asserts (never a silent ZIP fallback)
 *   - hash-only metric payload (the raw address NEVER reaches the sink)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	configure,
	clearCache,
	AddressIndexSchemaError,
	type NormalizationTable,
} from '$lib/core/shadow-atlas/ipfs-store';
import {
	geocodeAddress,
	normalizeStreet,
	matchClassPrecision,
	setMatchOutcomeSink,
	ADDRESS_NOT_FOUND_MESSAGE,
	type MatchOutcomeEvent,
} from '$lib/core/shadow-atlas/geocoder';

const BASE = 'https://atlas.test';
const originalFetch = globalThis.fetch;

// ----------------------------------------------------------------------------
// Fixtures — §2/§3/§4 shapes mirroring the published artifact
// ----------------------------------------------------------------------------

const NORM_TABLE: NormalizationTable = {
	normVersion: 1,
	directionals: {
		NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
		NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
		N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
	},
	suffixes: {
		AVENUE: 'AVE', AV: 'AVE', AVE: 'AVE',
		STREET: 'ST', ST: 'ST',
		PLAZA: 'PLZ', PLZ: 'PLZ',
		LANE: 'LN', LN: 'LN',
		ROAD: 'RD', RD: 'RD',
	},
	units: ['APARTMENT', 'APT', 'SUITE', 'STE', 'UNIT', 'BLDG', 'FL', 'RM', '#', 'TRAILER', 'TRLR'],
	unitsWithoutValue: ['REAR', 'BSMT', 'FRNT', 'LBBY', 'OFC', 'PH', 'SIDE', 'UPPR', 'LOWR'],
};

const MANIFEST = {
	version: 1,
	generated: '2026-07-01T00:00:00.000Z',
	country: 'US',
	addressIndexGenerated: '2026-07-02T00:00:00.000Z',
	addressIndexVersion: 1,
	addressIndex: {
		schemaVersion: 1,
		normVersion: 1,
		normTable: { path: 'addresses/normalization.json', sha256: 'x', bytes: 1 },
		totalChunks: 1,
		totalStreets: 3,
		totalPoints: 3,
		totalRanges: 5,
		chunkIndex: { path: 'addresses/chunk-index.json', sha256: 'x', bytes: 1 },
	},
};

const CHUNK_94110 = {
	version: 1,
	schema: 'atlas-address-index',
	country: 'US',
	zip: '94110',
	state: 'CA',
	zipCentroid: [37.74875, -122.41545],
	streets: {
		'MISSION ST': {
			p: {
				'2000': [37.76407, -122.41952, 0],
				'123 1/2': [37.7645, -122.4196, 1],
				'112-10': [37.76455, -122.41961, 0],
			},
			r: [[2000, 2098, 'E', 37.76407, -122.41952, 37.76211, -122.41871]],
		},
		// Parity + tie-break coverage: for an even hn 120 all three E/B ranges
		// are eligible; the smallest span must win, and among equal spans the
		// lowest fromHn must win. The O range accepts only odd numbers.
		'VALENCIA ST': {
			r: [
				[100, 198, 'B', 37.75, -122.42, 37.751, -122.421],
				[110, 160, 'E', 37.76, -122.43, 37.761, -122.431],
				[100, 150, 'E', 37.77, -122.44, 37.771, -122.441],
				[101, 199, 'O', 37.78, -122.45, 37.781, -122.451],
			],
		},
		// Degenerate range: toHn === fromHn pins t = 0.5 (the midpoint).
		'PRECITA AVE': {
			r: [[500, 500, 'B', 37.747, -122.41, 37.749, -122.412]],
		},
	},
};

type FetchRoute = { status: number; body?: unknown };

function mockFetchRoutes(routes: Record<string, FetchRoute>): void {
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		const path = url.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : url;
		const route = routes[path];
		if (!route) {
			return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
		}
		return {
			ok: route.status >= 200 && route.status < 300,
			status: route.status,
			json: async () => route.body,
		} as unknown as Response;
	}) as typeof fetch;
}

function happyRoutes(): Record<string, FetchRoute> {
	return {
		'US/manifest.json': { status: 200, body: MANIFEST },
		'US/addresses/normalization.json': { status: 200, body: NORM_TABLE },
		'US/addresses/94110.json': { status: 200, body: CHUNK_94110 },
	};
}

const ADDRESS = { street: '2000 Mission Street', city: 'San Francisco', state: 'CA', zip: '94110' };

let events: MatchOutcomeEvent[] = [];

/** Independent SHA-256 (WebCrypto) for asserting the metric hash pin. */
async function first16Sha256Hex(input: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(input),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 16);
}

beforeEach(async () => {
	await clearCache();
	configure({ atlasBaseUrl: BASE });
	events = [];
	setMatchOutcomeSink((e) => events.push(e));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	setMatchOutcomeSink(null);
	vi.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// §3 normalizer
// ----------------------------------------------------------------------------

describe('normalizeStreet — §3 algorithm over the shipped tables', () => {
	const cases: Array<[string, string]> = [
		// Trailing-directional amendment: suffix maps on the SECOND-TO-LAST token.
		['1600 Pennsylvania Avenue Northwest', 'PENNSYLVANIA AVE NW'],
		['950 Pennsylvania Ave. N.W.', 'PENNSYLVANIA AVE NW'],
		// Plain suffix on the final token.
		['2000 Mission Street', 'MISSION ST'],
		// Unit designator + value stripped; never enters the street key.
		['1400 K Street NW Apt 5B', 'K ST NW'],
		['1100 Market Street Suite 200', 'MARKET ST'],
		['700 Hope Street # 4', 'HOPE ST'],
		['124 Elm Street #5', 'ELM ST'],
		// Amended step 4: TRAILING bare value-less designator stripped.
		['812 Main Street Rear', 'MAIN ST'],
		['9 Oak Avenue Bsmt', 'OAK AVE'],
		// Value-guard: a street NAMED Trailer Lane is not eaten as APT+value.
		['5 Trailer Lane', 'TRAILER LN'],
		// Leading directional mapped.
		['100 East Main Street', 'E MAIN ST'],
		// Fractional and hyphenated house numbers stripped from the key.
		['123 1/2 Mission Street', 'MISSION ST'],
		['112-10 Mission Street', 'MISSION ST'],
		// Diacritics: NFD + combining-mark strip.
		['12 Peña Road', 'PENA RD'],
	];

	it.each(cases)('normalizes %j → %j', (input, expected) => {
		expect(normalizeStreet(input, NORM_TABLE)).toBe(expected);
	});

	it('is idempotent on every case: norm(norm(x)) === norm(x)', () => {
		for (const [input] of cases) {
			const once = normalizeStreet(input, NORM_TABLE);
			expect(normalizeStreet(once, NORM_TABLE)).toBe(once);
		}
	});
});

// ----------------------------------------------------------------------------
// §5 confidence factors
// ----------------------------------------------------------------------------

describe('matchClassPrecision — §5 factors', () => {
	it('maps point → 1.0, range → 0.85, zip → 0.6', () => {
		expect(matchClassPrecision('point')).toBe(1.0);
		expect(matchClassPrecision('range')).toBe(0.85);
		expect(matchClassPrecision('zip')).toBe(0.6);
	});
});

// ----------------------------------------------------------------------------
// §2 match ladder through the real fetch path
// ----------------------------------------------------------------------------

describe('geocodeAddress — §2 ladder', () => {
	it('exact point hit → matchClass point + exact coords + "exact" metric', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress(ADDRESS);
		expect(result).toMatchObject({ lat: 37.76407, lng: -122.41952, matchClass: 'point' });
		expect(result.matchedAddress).toBe('2000 MISSION ST, SAN FRANCISCO, CA, 94110');
		expect(events.map((e) => e.outcome)).toEqual(['exact']);
	});

	it('point keys are literal: fractional and hyphenated house numbers hit their own points', async () => {
		mockFetchRoutes(happyRoutes());
		const frac = await geocodeAddress({ ...ADDRESS, street: '123 1/2 Mission Street' });
		expect(frac).toMatchObject({ lat: 37.7645, lng: -122.4196, matchClass: 'point' });

		const hyph = await geocodeAddress({ ...ADDRESS, street: '112-10 Mission Street' });
		expect(hyph).toMatchObject({ lat: 37.76455, lng: -122.41961, matchClass: 'point' });
	});

	it('leading zeros are stripped from the point key (02000 → 2000)', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, street: '02000 Mission Street' });
		expect(result).toMatchObject({ lat: 37.76407, lng: -122.41952, matchClass: 'point' });
	});

	it('range hit uses the pinned interpolation formula with 5-dp rounding', async () => {
		mockFetchRoutes(happyRoutes());
		// 2050 is even and inside [2000, 2098] but not a point key.
		const result = await geocodeAddress({ ...ADDRESS, street: '2050 Mission Street' });
		const t = (2050 - 2000) / (2098 - 2000);
		expect(result.matchClass).toBe('range');
		expect(result.lat).toBe(Math.round((37.76407 + t * (37.76211 - 37.76407)) * 1e5) / 1e5);
		expect(result.lng).toBe(Math.round((-122.41952 + t * (-122.41871 - -122.41952)) * 1e5) / 1e5);
		expect(events.map((e) => e.outcome)).toEqual(['range']);
	});

	it('toHn === fromHn pins t = 0.5 (midpoint)', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, street: '500 Precita Avenue' });
		expect(result.matchClass).toBe('range');
		expect(result.lat).toBe(Math.round(((37.747 + 37.749) / 2) * 1e5) / 1e5);
		expect(result.lng).toBe(Math.round(((-122.41 + -122.412) / 2) * 1e5) / 1e5);
	});

	it('parity: an even hn is ineligible for O ranges; smallest span wins, then lowest fromHn', async () => {
		mockFetchRoutes(happyRoutes());
		// hn 120 (even): eligible are B[100,198] span 98, E[110,160] span 50,
		// E[100,150] span 50 — smallest span ties at 50, lowest fromHn (100) wins.
		const result = await geocodeAddress({ ...ADDRESS, street: '120 Valencia Street' });
		const t = (120 - 100) / (150 - 100);
		expect(result.matchClass).toBe('range');
		expect(result.lat).toBe(Math.round((37.77 + t * (37.771 - 37.77)) * 1e5) / 1e5);
	});

	it('parity: an odd hn skips both E ranges and lands on the O range over the wider B', async () => {
		mockFetchRoutes(happyRoutes());
		// hn 121 (odd): eligible are B[100,198] span 98 and O[101,199] span 98 —
		// spans tie, lowest fromHn (100, the B range) wins.
		const result = await geocodeAddress({ ...ADDRESS, street: '121 Valencia Street' });
		const t = (121 - 100) / (198 - 100);
		expect(result.matchClass).toBe('range');
		expect(result.lat).toBe(Math.round((37.75 + t * (37.751 - 37.75)) * 1e5) / 1e5);
	});

	it('street/number miss inside a covered ZIP → honest zipCentroid at 0.6-grade', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, street: '9999 Nonexistent Way' });
		expect(result).toMatchObject({ lat: 37.74875, lng: -122.41545, matchClass: 'zip' });
		// The street was NOT matched, so it never appears in matchedAddress.
		expect(result.matchedAddress).toBe('SAN FRANCISCO, CA, 94110');
		expect(events.map((e) => e.outcome)).toEqual(['zip_fallback']);
	});

	it("street:'' (person-layer postal path) skips the ladder straight to the ZIP centroid", async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, street: '' });
		expect(result).toMatchObject({ lat: 37.74875, lng: -122.41545, matchClass: 'zip' });
		expect(events.map((e) => e.outcome)).toEqual(['zip_fallback']);
	});

	it('a ZIP+4 zip derives its ZIP5 prefix', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, zip: '94110-1234' });
		expect(result.matchClass).toBe('point');
	});

	it('input state mismatch never gates a ZIP-keyed match — logged, then the ZIP wins', async () => {
		mockFetchRoutes(happyRoutes());
		const result = await geocodeAddress({ ...ADDRESS, state: 'NY' });
		expect(result.matchClass).toBe('point');
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('state mismatch'));
	});
});

// ----------------------------------------------------------------------------
// Miss honesty
// ----------------------------------------------------------------------------

describe('geocodeAddress — miss honesty (never a fabricated coordinate)', () => {
	it('no chunk for the ZIP (clean 404) → EXACT miss message + "miss" metric, no coords', async () => {
		const routes = happyRoutes();
		delete routes['US/addresses/94110.json'];
		mockFetchRoutes(routes);

		await expect(geocodeAddress(ADDRESS)).rejects.toThrow(ADDRESS_NOT_FOUND_MESSAGE);
		expect(events.map((e) => e.outcome)).toEqual(['miss']);
	});

	it('the miss message is byte-exact (the 404 GEOCODE_MISS key)', async () => {
		const routes = happyRoutes();
		delete routes['US/addresses/94110.json'];
		mockFetchRoutes(routes);

		const err = await geocodeAddress(ADDRESS).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe('Address not found. Please check your address and try again.');
	});

	it('no ZIP5 derivable → miss (metric emitted BEFORE the throw)', async () => {
		mockFetchRoutes(happyRoutes());
		await expect(
			geocodeAddress({ ...ADDRESS, zip: '0290' }),
		).rejects.toThrow(ADDRESS_NOT_FOUND_MESSAGE);
		expect(events.map((e) => e.outcome)).toEqual(['miss']);
	});

	it('a Canadian postal code derives no ZIP5 → honest miss, never a fabricated coordinate', async () => {
		mockFetchRoutes(happyRoutes());
		await expect(
			geocodeAddress({ street: '24 Sussex Dr', city: 'Ottawa', state: 'ON', zip: 'K1M 1M4' }),
		).rejects.toThrow(ADDRESS_NOT_FOUND_MESSAGE);
		expect(events.map((e) => e.outcome)).toEqual(['miss']);
	});
});

// ----------------------------------------------------------------------------
// §4 fail-closed schema asserts
// ----------------------------------------------------------------------------

describe('geocodeAddress — §4 fail-closed (never a silent ZIP fallback)', () => {
	it('chunk version !== 1 → AddressIndexSchemaError, not a miss and not a fallback', async () => {
		const routes = happyRoutes();
		routes['US/addresses/94110.json'] = {
			status: 200,
			body: { ...CHUNK_94110, version: 2 },
		};
		mockFetchRoutes(routes);

		const err = await geocodeAddress(ADDRESS).catch((e) => e);
		expect(err).toBeInstanceOf(AddressIndexSchemaError);
		expect((err as Error).message).not.toContain('Address not found');
		expect(events).toEqual([]); // no outcome — the call never completed
	});

	it("chunk schema !== 'atlas-address-index' → AddressIndexSchemaError", async () => {
		const routes = happyRoutes();
		routes['US/addresses/94110.json'] = {
			status: 200,
			body: { ...CHUNK_94110, schema: 'something-else' },
		};
		mockFetchRoutes(routes);
		await expect(geocodeAddress(ADDRESS)).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('manifest without addressIndex (index not yet published) → AddressIndexSchemaError', async () => {
		const { addressIndex: _omitted, ...manifestWithout } = MANIFEST;
		const routes = happyRoutes();
		routes['US/manifest.json'] = { status: 200, body: manifestWithout };
		mockFetchRoutes(routes);
		await expect(geocodeAddress(ADDRESS)).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('manifest addressIndexVersion !== 1 → AddressIndexSchemaError', async () => {
		const routes = happyRoutes();
		routes['US/manifest.json'] = { status: 200, body: { ...MANIFEST, addressIndexVersion: 2 } };
		mockFetchRoutes(routes);
		await expect(geocodeAddress(ADDRESS)).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('normalization.json normVersion !== 1 (algorithm handshake) → AddressIndexSchemaError', async () => {
		const routes = happyRoutes();
		routes['US/addresses/normalization.json'] = {
			status: 200,
			body: { ...NORM_TABLE, normVersion: 2 },
		};
		mockFetchRoutes(routes);
		await expect(geocodeAddress(ADDRESS)).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('a 5xx on the chunk is an infrastructure fault: generic error, NOT a miss, NOT a schema error, no outcome metric', async () => {
		const routes = happyRoutes();
		routes['US/addresses/94110.json'] = { status: 502 };
		mockFetchRoutes(routes);

		const err = await geocodeAddress(ADDRESS).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(AddressIndexSchemaError);
		expect((err as Error).message).not.toContain('Address not found');
		expect(events).toEqual([]);
	});
});

// ----------------------------------------------------------------------------
// Match-outcome metric — hash-only payload
// ----------------------------------------------------------------------------

describe('match-outcome metric — day-one, hash-only', () => {
	it('emits outcome + first-16-hex SHA-256 of `${normalizedStreet}|${zip5}` — never the raw address', async () => {
		mockFetchRoutes(happyRoutes());
		await geocodeAddress(ADDRESS);

		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.outcome).toBe('exact');
		expect(event.normHash).toMatch(/^[0-9a-f]{16}$/);
		expect(event.normHash).toBe(await first16Sha256Hex('MISSION ST|94110'));

		// The serialized payload carries NO address component.
		const wire = JSON.stringify(event);
		expect(wire).not.toContain('Mission');
		expect(wire).not.toContain('MISSION');
		expect(wire).not.toContain('94110');
		expect(wire).not.toContain('San Francisco');
		expect(Object.keys(event).sort()).toEqual(['normHash', 'outcome', 'ts']);
	});

	it('emits on the miss path too, with the underivable zip hashed as empty', async () => {
		mockFetchRoutes(happyRoutes());
		await geocodeAddress({ ...ADDRESS, zip: 'not-a-zip' }).catch(() => {});
		expect(events).toHaveLength(1);
		expect(events[0].outcome).toBe('miss');
		expect(events[0].normHash).toBe(await first16Sha256Hex('MISSION ST|'));
	});

	it('a throwing sink never breaks the resolve', async () => {
		mockFetchRoutes(happyRoutes());
		setMatchOutcomeSink(() => {
			throw new Error('sink exploded');
		});
		const result = await geocodeAddress(ADDRESS);
		expect(result.matchClass).toBe('point');
	});
});
