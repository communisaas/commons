/**
 * SEAM-CONTRACT v2 §1 — oversized-ZIP5 stub+shard split, consumer side.
 *
 * Exercises the REAL fetch path (ipfs-store fetchContent) against a mocked
 * globalThis.fetch serving a stub + shard files, asserting:
 *   - a v2 stub triggers exactly one extra fetch (the shard the requested
 *     street hashes into via stableStreetShard) — never more than 2 fetches
 *     total for the address chunk
 *   - the shard the geocoder actually reads matches the shared
 *     stableStreetShard vectors (committed byte-identical to voter-protocol)
 *   - an unsplit v1 chunk still resolves in exactly 1 fetch (no regression)
 *   - schemaVersion 1 and 2 both resolve; an unrecognized version fails closed
 *   - a missing shard (stub says N shards, shard file 404s) fails closed as
 *     AddressIndexSchemaError, never silently falls back
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	configure,
	clearCache,
	getAddressChunk,
	AddressIndexSchemaError,
	type NormalizationTable,
} from '$lib/core/shadow-atlas/ipfs-store';
import { geocodeAddress, setMatchOutcomeSink, type MatchOutcomeEvent } from '$lib/core/shadow-atlas/geocoder';
import { stableStreetShard } from '$lib/core/shadow-atlas/street-shard';
import sharedVectors from '$lib/core/shadow-atlas/shared-vectors/stable-street-shard.vectors.json';

const BASE = 'https://atlas.test';
const originalFetch = globalThis.fetch;

const NORM_TABLE: NormalizationTable = {
	normVersion: 1,
	directionals: {},
	suffixes: { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE' },
	units: [],
	unitsWithoutValue: [],
};

function manifestWithSchemaVersion(schemaVersion: number) {
	return {
		version: 1,
		generated: '2026-07-01T00:00:00.000Z',
		country: 'US',
		addressIndexGenerated: '2026-07-02T00:00:00.000Z',
		addressIndexVersion: 1,
		addressIndex: {
			schemaVersion,
			normVersion: 1,
			normTable: { path: 'addresses/normalization.json', sha256: 'x', bytes: 1 },
			totalChunks: 1,
			totalStreets: 3,
			totalPoints: 0,
			totalRanges: 3,
			chunkIndex: { path: 'addresses/chunk-index.json', sha256: 'x', bytes: 1 },
		},
	};
}

// A 4-shard oversized ZIP. Shard indices computed via the same
// stableStreetShard the producer uses — see compute in the test below for
// the byte-identical cross-check against the shared vectors.
const SHARDS = 4;
// Runtime validation is SHAPE-only (byte-verification lives in the §6 gate),
// so structurally-valid pins suffice here; values are per-shard distinct.
const SHARD_PINS = Array.from({ length: SHARDS }, (_, i) => ({
	bytes: 128_000 + i,
	sha256: String(i).repeat(64).slice(0, 64),
}));
const STUB_94999 = {
	v: 2,
	schema: 'atlas-address-index',
	country: 'US',
	zip: '94999',
	state: 'CA',
	zipCentroid: [37.7, -122.4],
	shards: SHARDS,
	shardHashes: SHARD_PINS,
};

function shardFileFor(shardIdx: number, streets: Record<string, unknown>) {
	return { v: 2, zip: '94999', shard: shardIdx, shards: SHARDS, streets };
}

const MISSION_SHARD = stableStreetShard('MISSION ST', SHARDS);
const VALENCIA_SHARD = stableStreetShard('VALENCIA ST', SHARDS);

const SHARD_FILES: Record<number, ReturnType<typeof shardFileFor>> = {};
SHARD_FILES[MISSION_SHARD] = shardFileFor(MISSION_SHARD, {
	'MISSION ST': { r: [[2000, 2098, 'E', 37.76407, -122.41952, 37.76211, -122.41871]] },
});
if (VALENCIA_SHARD !== MISSION_SHARD) {
	SHARD_FILES[VALENCIA_SHARD] = shardFileFor(VALENCIA_SHARD, {
		'VALENCIA ST': { r: [[100, 198, 'B', 37.75, -122.42, 37.751, -122.421]] },
	});
} else {
	// Same shard — merge streets into the one file (still one fetch either way).
	SHARD_FILES[MISSION_SHARD].streets['VALENCIA ST'] = {
		r: [[100, 198, 'B', 37.75, -122.42, 37.751, -122.421]],
	};
}

type FetchRoute = { status: number; body?: unknown };
let fetchCallCount = 0;

function mockFetchRoutes(routes: Record<string, FetchRoute>): void {
	fetchCallCount = 0;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
		fetchCallCount++;
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

function splitRoutes(): Record<string, FetchRoute> {
	const routes: Record<string, FetchRoute> = {
		'US/manifest.json': { status: 200, body: manifestWithSchemaVersion(2) },
		'US/addresses/normalization.json': { status: 200, body: NORM_TABLE },
		'US/addresses/94999.json': { status: 200, body: STUB_94999 },
	};
	for (const [idx, file] of Object.entries(SHARD_FILES)) {
		routes[`US/addresses/94999.${idx}.json`] = { status: 200, body: file };
	}
	return routes;
}

let events: MatchOutcomeEvent[] = [];

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

describe('oversized ZIP5 split (§1 v2) — consumer resolution', () => {
	it('resolves a street from a sharded ZIP in exactly 2 fetches for the chunk (stub + 1 shard)', async () => {
		mockFetchRoutes(splitRoutes());
		const result = await geocodeAddress({
			street: '2000 Mission Street',
			city: 'San Francisco',
			state: 'CA',
			zip: '94999',
		});
		expect(result.matchClass).toBe('range');
		expect(result.lat).toBeCloseTo(37.76407, 4);

		// manifest + normalization + stub + exactly one shard = 4 total fetches.
		expect(fetchCallCount).toBe(4);
	});

	it('the shard fetched matches stableStreetShard(normalizedStreet, shards) — the exact producer computation', async () => {
		mockFetchRoutes(splitRoutes());
		await geocodeAddress({
			street: '2000 Mission Street',
			city: 'San Francisco',
			state: 'CA',
			zip: '94999',
		});
		const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
		const shardCalls = calls.filter((u) => /94999\.\d+\.json$/.test(u));
		expect(shardCalls).toEqual([`${BASE}/US/addresses/94999.${MISSION_SHARD}.json`]);
	});

	it('unsplit v1 chunk still resolves in 1 fetch for the chunk itself (no regression)', async () => {
		mockFetchRoutes({
			'US/manifest.json': { status: 200, body: manifestWithSchemaVersion(1) },
			'US/addresses/normalization.json': { status: 200, body: NORM_TABLE },
			'US/addresses/10001.json': {
				status: 200,
				body: {
					version: 1,
					schema: 'atlas-address-index',
					country: 'US',
					zip: '10001',
					state: 'NY',
					zipCentroid: [40.75, -73.99],
					streets: { 'MAIN ST': { r: [[1, 99, 'O', 40.75, -73.99, 40.751, -73.991]] } },
				},
			},
		});
		const result = await geocodeAddress({
			street: '1 Main Street',
			city: 'New York',
			state: 'NY',
			zip: '10001',
		});
		expect(result.matchClass).toBe('range');
		// manifest + normalization + 1 chunk fetch = 3 total; no second address fetch.
		expect(fetchCallCount).toBe(3);
	});

	it('schemaVersion 2 in the manifest is accepted (not just 1)', async () => {
		mockFetchRoutes(splitRoutes());
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).resolves.toBeDefined();
	});

	it('an unrecognized schemaVersion (3) fails closed as AddressIndexSchemaError', async () => {
		const routes = splitRoutes();
		routes['US/manifest.json'] = { status: 200, body: manifestWithSchemaVersion(3) };
		mockFetchRoutes(routes);
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('stub names N shards but the shard file 404s → fail-closed AddressIndexSchemaError, never a silent fallback', async () => {
		const routes = splitRoutes();
		delete routes[`US/addresses/94999.${MISSION_SHARD}.json`];
		mockFetchRoutes(routes);
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).rejects.toBeInstanceOf(AddressIndexSchemaError);
		// A schema fault is never counted as a match-outcome miss.
		expect(events).toEqual([]);
	});

	it('no street key on a split ZIP → empty street map, ZERO shard fetches (never an arbitrary shard)', async () => {
		mockFetchRoutes(splitRoutes());
		// Legacy 2-arg call form: a caller with no street must NOT receive one
		// arbitrary shard's partial streets masquerading as the whole ZIP.
		const chunk = await getAddressChunk('94999', 'US');
		expect(chunk).not.toBeNull();
		expect(chunk!.zip).toBe('94999');
		expect(chunk!.zipCentroid).toEqual(STUB_94999.zipCentroid);
		expect(chunk!.streets).toEqual({});
		const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
		expect(calls.filter((u) => /94999\.\d+\.json$/.test(u))).toEqual([]);
	});

	it('a stub with NO shardHashes fails closed — unpinned shards are never fetched', async () => {
		const routes = splitRoutes();
		const { shardHashes: _dropped, ...unpinnedStub } = STUB_94999;
		routes['US/addresses/94999.json'] = { status: 200, body: unpinnedStub };
		mockFetchRoutes(routes);
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).rejects.toBeInstanceOf(AddressIndexSchemaError);
		// Fail-closed BEFORE any shard fetch: manifest + normalization + stub only.
		const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
		expect(calls.filter((u) => /94999\.\d+\.json$/.test(u))).toEqual([]);
	});

	it('a stub whose shardHashes count disagrees with shards fails closed', async () => {
		const routes = splitRoutes();
		routes['US/addresses/94999.json'] = {
			status: 200,
			body: { ...STUB_94999, shardHashes: SHARD_PINS.slice(0, SHARDS - 1) },
		};
		mockFetchRoutes(routes);
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('a malformed shardHashes pin (bad hex, zero bytes) fails closed', async () => {
		for (const badPin of [
			{ bytes: 0, sha256: SHARD_PINS[0].sha256 }, // zero bytes
			{ bytes: 128_000, sha256: 'not-hex' }, // malformed hash
			{ bytes: 128_000, sha256: SHARD_PINS[0].sha256.slice(0, 63) }, // short hash
		]) {
			await clearCache();
			const routes = splitRoutes();
			routes['US/addresses/94999.json'] = {
				status: 200,
				body: { ...STUB_94999, shardHashes: [badPin, ...SHARD_PINS.slice(1)] },
			};
			mockFetchRoutes(routes);
			await expect(
				geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
			).rejects.toBeInstanceOf(AddressIndexSchemaError);
		}
	});

	it('a shard file whose shard/shards fields disagree with the stub fails closed', async () => {
		const routes = splitRoutes();
		routes[`US/addresses/94999.${MISSION_SHARD}.json`] = {
			status: 200,
			body: { ...SHARD_FILES[MISSION_SHARD], shards: 999 },
		};
		mockFetchRoutes(routes);
		await expect(
			geocodeAddress({ street: '2000 Mission Street', city: 'SF', state: 'CA', zip: '94999' }),
		).rejects.toBeInstanceOf(AddressIndexSchemaError);
	});

	it('shared hash vectors: stableStreetShard matches the committed cross-repo vector file byte-for-byte', () => {
		expect(sharedVectors.hashAlgorithm).toBe('fnv1a32');
		expect(sharedVectors.vectors.length).toBeGreaterThan(0);
		for (const v of sharedVectors.vectors as Array<{ streetKey: string; shards: number; shard: number }>) {
			expect(stableStreetShard(v.streetKey, v.shards)).toBe(v.shard);
		}
	});
});
