/**
 * Person-lane / paid-lane parity for POST /api/location/resolve-address.
 *
 * The keyed substrate (src/routes/api/v1/resolve-address) has long emitted the
 * full boundary ladder (`districts`) plus the machine-readable coverage
 * disclosure (`coverage`). The free person lane resolved the same cell from the
 * same single chunk fetch but threw everything except the congressional hit
 * away. These tests pin the widened person response:
 *
 *   - the ladder is echoed VERBATIM (same entries, same canonical slot order);
 *   - the disclosure is the real frozen DISTRICT_COVERAGE, never a clone or a
 *     filtered copy, and never ships without the ladder it explains;
 *   - no boundary type reaches the wire that the disclosure does not describe;
 *   - an officials-fetch failure (BLOCKED) is never laundered into "you have no
 *     district" (ABSENT);
 *   - nothing in the body claims verification — this is a boundary lookup over a
 *     public map, not civic proof.
 *
 * Harness mirrors tests/unit/shadow-atlas/provenance-capture.test.ts: mocked I/O
 * only (no network, no real atlas fetch), poseidon stubbed so no crypto WASM loads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequestEvent } from '../../setup/api-test-setup';
import type { AddressResolutionResult } from '../../../src/lib/core/shadow-atlas/client';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the route import below.
// ---------------------------------------------------------------------------

vi.mock('$env/dynamic/private', () => ({
	env: {
		ADDRESS_RESOLUTION_TOKEN_SECRET: 'a'.repeat(64)
	}
}));

vi.mock('$app/environment', () => ({
	dev: false,
	browser: false,
	building: false,
	version: 'test'
}));

type ResolveAddressFn = (address: {
	street: string;
	city: string;
	state: string;
	zip: string;
	country?: 'US' | 'CA';
}) => Promise<AddressResolutionResult>;

const mockResolveAddress = vi.fn<ResolveAddressFn>();

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: Parameters<typeof mockResolveAddress>) => mockResolveAddress(...args)
}));

// Poseidon is stubbed only to keep crypto WASM out of this suite. The coverage
// module is deliberately NOT mocked — the disclosure under test is the real one.
vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: async () => '0x' + '1'.padStart(64, '0'),
	poseidonHash: async () => '0x' + '2'.padStart(64, '0')
}));

import { DISTRICT_COVERAGE } from '$lib/core/shadow-atlas/coverage';
import { POST } from '../../../src/routes/api/location/resolve-address/+server';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ResolvedEntry = AddressResolutionResult['districts'][number];

/** A realistic multi-slot ladder in canonical slot order — congressional first. */
const LADDER: ResolvedEntry[] = [
	{
		id: 'IL-18',
		geoid: '1718',
		name: "Illinois's 18th Congressional District",
		jurisdiction: 'congressional',
		district_type: 'congressional'
	},
	{
		id: 'sldu-17050',
		geoid: '17050',
		name: 'State Senate 17050',
		jurisdiction: 'state-senate',
		district_type: 'state-senate'
	},
	{
		id: 'county-17167',
		geoid: '17167',
		name: 'Sangamon County',
		jurisdiction: 'county',
		district_type: 'county'
	},
	{
		id: 'place-1772000',
		geoid: '1772000',
		name: 'Springfield',
		jurisdiction: 'city',
		district_type: 'city'
	},
	{
		id: 'unsd-1735940',
		geoid: '1735940',
		name: 'Springfield School District 186',
		jurisdiction: 'unified-school',
		district_type: 'unified-school'
	}
];

interface ResolveOverrides {
	districtId?: string | null;
	districts?: ResolvedEntry[];
	officials?: AddressResolutionResult['officials'];
}

function shadowAtlasResponse(overrides: ResolveOverrides = {}): AddressResolutionResult {
	const { districtId = 'IL-18', districts = LADDER } = overrides;
	const officials: AddressResolutionResult['officials'] =
		overrides.officials !== undefined
			? overrides.officials
			: ({
					officials: [
						{
							bioguide_id: 'L000585',
							name: 'Darin LaHood',
							party: 'Republican',
							chamber: 'house' as const,
							state: 'IL',
							district: '18',
							office: 'U.S. Representative',
							phone: '202-555-0100',
							contact_form_url: null,
							website_url: null,
							cwc_code: 'IL18',
							is_voting: true,
							delegate_type: null
						}
					],
					district_code: districtId ?? '',
					state: 'IL',
					special_status: null,
					source: 'congress-legislators' as const,
					cached: true
				} as AddressResolutionResult['officials']);

	return {
		geocode: {
			lat: 39.7817,
			lng: -89.6501,
			matched_address: '123 MAIN ST, SPRINGFIELD, IL, 62704',
			confidence: 0.95,
			country: 'US'
		},
		district: districtId
			? {
					id: districtId,
					name: `District ${districtId}`,
					jurisdiction: 'congressional',
					district_type: 'congressional'
				}
			: null,
		districts,
		officials,
		cell_id: '872a10000ffffff',
		provenance: { source: 'nominatim', tigerVintage: '2024' },
		confidence: 1.0,
		boundaryAsOf: '2025-12-06T00:00:00.000Z',
		officialsAsOf: '2026-03-14T00:00:00.000Z',
		warning: null
	};
}

const testAddress = {
	street: '123 Main Street',
	city: 'Springfield',
	state: 'IL',
	zip: '62704'
};

function createResolveRequest(body: Record<string, unknown>) {
	return createMockRequestEvent({
		url: '/api/location/resolve-address',
		method: 'POST',
		body: JSON.stringify(body),
		locals: { user: { id: 'test-user-123', email: 'test@example.com' } }
	});
}

async function post(body: Record<string, unknown> = testAddress) {
	const response = await POST(createResolveRequest(body) as never);
	return { response, body: await response.json() };
}

// ---------------------------------------------------------------------------

describe('POST /api/location/resolve-address — ladder + disclosure parity', () => {
	beforeEach(() => {
		mockResolveAddress.mockReset();
	});

	it('(a) echoes the resolver ladder verbatim, in the same canonical slot order', async () => {
		mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

		const { response, body } = await post();

		expect(response.status).toBe(200);
		expect(body.resolved).toBe(true);
		expect(body.districts).toEqual(LADDER);
		// Order is the resolver's, not re-sorted: congressional stays first.
		expect(body.districts.map((d: ResolvedEntry) => d.district_type)).toEqual(
			LADDER.map((d) => d.district_type)
		);
		expect(body.districts[0].district_type).toBe('congressional');
	});

	it('(b) ships the real DISTRICT_COVERAGE disclosure, officialsTypes included', async () => {
		mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

		const { body } = await post();

		expect(body.coverage).toEqual(DISTRICT_COVERAGE);
		expect(body.coverage.officialsTypes).toEqual(['congressional']);
		expect(body.coverage.boundaryTypes).toEqual(DISTRICT_COVERAGE.boundaryTypes);
	});

	it('(c) never emits a boundary type the disclosure does not describe', async () => {
		mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

		const { body } = await post();

		expect(body.districts.length).toBeGreaterThan(0);
		for (const entry of body.districts as ResolvedEntry[]) {
			expect(Object.keys(body.coverage.boundaryTypes)).toContain(entry.district_type);
		}
	});

	it('(d) outside coverage is an honest empty ladder that still carries the disclosure', async () => {
		mockResolveAddress.mockResolvedValueOnce(
			shadowAtlasResponse({ districtId: null, districts: [], officials: null })
		);

		const { response, body } = await post();

		expect(response.status).toBe(200);
		expect(body.resolved).toBe(true);
		expect(body.districts).toEqual([]);
		// Disclosure ships even with zero rows — an absent 'partial' type is a
		// possible ingest gap, and the reader cannot tell without the coverage table.
		expect(body.coverage).toEqual(DISTRICT_COVERAGE);
		expect(body.district).toBeNull();
	});

	it('(e) an officials-fetch failure degrades the roster, never the district', async () => {
		const result = shadowAtlasResponse({ officials: null });
		mockResolveAddress.mockResolvedValueOnce(result);

		// Deliberately mismatched request state: the district payload must come from
		// the resolver's district id, not from what the person typed.
		const { body } = await post({ ...testAddress, state: 'IA' });

		expect(body.district).not.toBeNull();
		expect(body.district.code).toBe(result.district!.id);
		expect(body.district.code).not.toBeNull();
		expect(body.district.state).toBe(result.district!.id.split('-')[0]);
		expect(body.district.state).not.toBe('IA');
		// BLOCKED, not ABSENT: the roster is empty because the fetch failed.
		expect(body.officials).toEqual([]);
		expect(body.districts).toEqual(LADDER);
	});

	it('(f) every resolved response carries both districts and coverage', async () => {
		mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

		const { body } = await post();

		expect(body.resolved).toBe(true);
		expect(Object.keys(body)).toContain('districts');
		expect(Object.keys(body)).toContain('coverage');
	});

	it('(g) claims no verification and exposes no empirical weight', async () => {
		mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

		const { body } = await post();

		const serialized = JSON.stringify(body);
		expect(serialized).not.toMatch(/verified/i);
		expect(serialized).not.toMatch(/weight/i);
	});
});
