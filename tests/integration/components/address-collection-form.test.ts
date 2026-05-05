/**
 * Address Resolution Endpoint Contract Tests
 *
 * Tests POST /api/location/resolve-address — the unified server-side address
 * resolution endpoint backed by Shadow Atlas's resolveAddress().
 *
 * Pipeline under test:
 *   1. Shadow Atlas resolveAddress() — Nominatim geocoding + H3 district + IPFS officials
 *
 * These tests import the POST handler directly and call it with mock
 * SvelteKit RequestEvents, using vi.mock to intercept the Shadow Atlas client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequestEvent } from '../../setup/api-test-setup';
import type { AddressResolutionResult } from '../../../src/lib/core/shadow-atlas/client';

// ---------------------------------------------------------------------------
// Mock the Shadow Atlas client module
// ---------------------------------------------------------------------------

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

// Import POST *after* vi.mock so the mock is active
import { POST } from '../../../src/routes/api/location/resolve-address/+server';

// ---------------------------------------------------------------------------
// Shadow Atlas response factories
// ---------------------------------------------------------------------------

interface ResolveOverrides {
	matchedAddress?: string;
	lat?: number;
	lng?: number;
	confidence?: number;
	country?: 'US' | 'CA';
	districtId?: string;
	districtName?: string;
	districtJurisdiction?: string;
	districtType?: string;
	officials?: AddressResolutionResult['officials'];
	cellId?: string | null;
	vintage?: string;
}

function shadowAtlasResponse(overrides: ResolveOverrides = {}): AddressResolutionResult {
	const {
		matchedAddress = '123 MAIN ST, SPRINGFIELD, IL, 62704',
		lat = 39.7817,
		lng = -89.6501,
		confidence = 0.95,
		country = 'US',
		districtId = 'IL-18',
		districtName = "Illinois's 18th Congressional District",
		districtJurisdiction = 'congressional',
		districtType = 'congressional',
		officials = {
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
				},
				{
					bioguide_id: 'D000622',
					name: 'Tammy Duckworth',
					party: 'Democratic',
					chamber: 'senate' as const,
					state: 'IL',
					district: null,
					office: 'U.S. Senator',
					phone: '202-555-0101',
					contact_form_url: null,
					website_url: null,
					cwc_code: null,
					is_voting: true,
					delegate_type: null
				}
			],
			district_code: districtId,
			state: 'IL',
			special_status: null,
			source: 'congress-legislators' as const,
			cached: true
		},
		cellId = '872a10000ffffff',
		vintage = 'shadow-atlas-nominatim'
	} = overrides;

	return {
		geocode: {
			lat,
			lng,
			matched_address: matchedAddress,
			confidence,
			country
		},
		district: {
			id: districtId,
			name: districtName,
			jurisdiction: districtJurisdiction,
			district_type: districtType
		},
		officials,
		cell_id: cellId,
		vintage
	};
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const testAddress = {
	street: '123 Main Street',
	city: 'Springfield',
	state: 'IL',
	zip: '62704'
};

const authenticatedLocals = {
	user: { id: 'test-user-123', email: 'test@example.com' }
};

/** Create a mock POST request to /api/location/resolve-address */
function createResolveRequest(body: Record<string, unknown>, locals = authenticatedLocals) {
	return createMockRequestEvent({
		url: '/api/location/resolve-address',
		method: 'POST',
		body: JSON.stringify(body),
		locals
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/location/resolve-address', () => {
	beforeEach(() => {
		mockResolveAddress.mockReset();
	});

	// ========================================================================
	// Authentication
	// ========================================================================

	describe('authentication', () => {
		it('returns 401 when user is not authenticated', async () => {
			const event = createResolveRequest(testAddress, { user: null } as any);
			const response = await POST(event as any);
			const data = await response.json();

			expect(response.status).toBe(401);
			expect(data.resolved).toBe(false);
			expect(data.error).toContain('Authentication');
		});
	});

	// ========================================================================
	// Input validation
	// ========================================================================

	describe('validation', () => {
		it('returns 400 for missing street', async () => {
			const event = createResolveRequest({ city: 'Springfield', state: 'IL', zip: '62704' });
			const response = await POST(event as any);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.resolved).toBe(false);
		});

		it('returns 400 for invalid state code (must be 2 chars)', async () => {
			const event = createResolveRequest({
				street: '123 Main',
				city: 'Springfield',
				state: 'Illinois',
				zip: '62704'
			});
			const response = await POST(event as any);

			expect(response.status).toBe(400);
		});

		it('returns 400 for invalid zip format', async () => {
			const event = createResolveRequest({
				street: '123 Main',
				city: 'Springfield',
				state: 'IL',
				zip: 'ABCDE'
			});
			const response = await POST(event as any);

			expect(response.status).toBe(400);
		});

		it('accepts 9-digit zip codes (ZIP+4)', async () => {
			mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

			const event = createResolveRequest({
				...testAddress,
				zip: '62704-1234'
			});
			const response = await POST(event as any);
			const data = await response.json();

			// Should not be a 400 validation error
			expect(response.status).not.toBe(400);
			expect(data).toBeDefined();
		});
	});

	// ========================================================================
	// Happy path: Shadow Atlas geocode + district + officials
	// ========================================================================

	describe('happy path', () => {
		it('returns geocoder-standardized address with district and coordinates', async () => {
			mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.resolved).toBe(true);

			// Geocoder-standardized address
			expect(data.address.matched).toBe('123 MAIN ST, SPRINGFIELD, IL, 62704');
			expect(data.address.street).toBe('123 MAIN ST');
			expect(data.address.city).toBe('SPRINGFIELD');
			expect(data.address.state).toBe('IL');
			expect(data.address.zip).toBe('62704');

			// Coordinates
			expect(data.coordinates.lat).toBe(39.7817);
			expect(data.coordinates.lng).toBe(-89.6501);

			// District
			expect(data.district.code).toBe('IL-18');
			expect(data.district.state).toBe('IL');
		});

		it('returns cell_id from Shadow Atlas H3 cell', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({ cellId: '872a10000ffffff' })
			);

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.cell_id).toBe('872a10000ffffff');
			expect(data.zk_eligible).toBe(true);
		});

		it('returns zk_eligible=false when cell_id is null', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({ cellId: null })
			);

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.cell_id).toBeNull();
			expect(data.zk_eligible).toBe(false);
		});

		it('returns officials array with house and senate members', async () => {
			mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.officials).toBeDefined();
			expect(Array.isArray(data.officials)).toBe(true);

			// Should have at least 1 official
			expect(data.officials.length).toBeGreaterThanOrEqual(1);

			const official = data.officials[0];
			expect(official).toHaveProperty('name');
			expect(official).toHaveProperty('chamber');
			expect(official).toHaveProperty('party');
			expect(official).toHaveProperty('bioguide_id');
			expect(official).toHaveProperty('is_voting_member');
		});

		it('passes address fields to resolveAddress', async () => {
			mockResolveAddress.mockResolvedValueOnce(shadowAtlasResponse());

			const event = createResolveRequest(testAddress);
			await POST(event as any);

			expect(mockResolveAddress).toHaveBeenCalledWith({
				street: '123 Main Street',
				city: 'Springfield',
				state: 'IL',
				zip: '62704',
				country: undefined
			});
		});
	});

	// ========================================================================
	// Shadow Atlas error scenarios
	// ========================================================================

	describe('Shadow Atlas errors', () => {
		it('returns 500 when resolveAddress throws an error', async () => {
			mockResolveAddress.mockRejectedValueOnce(
				new Error('Address not found. Please check your address and try again.')
			);

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.resolved).toBe(false);
			expect(data.error).toContain('temporarily unavailable');
		});

		it('returns 500 when resolveAddress throws a network error', async () => {
			mockResolveAddress.mockRejectedValueOnce(
				new Error('Nominatim geocoding returned 503')
			);

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.resolved).toBe(false);
		});
	});

	// ========================================================================
	// At-large districts
	// ========================================================================

	describe('at-large districts', () => {
		it('returns at-large district code from Shadow Atlas', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({
					matchedAddress: '100 STATE ST, MONTPELIER, VT, 05602',
					districtId: 'VT-AL',
					districtName: 'Vermont At-Large Congressional District'
				})
			);

			const event = createResolveRequest({
				street: '100 State St',
				city: 'Montpelier',
				state: 'VT',
				zip: '05602'
			});
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.resolved).toBe(true);
			expect(data.district.code).toBe('VT-AL');
		});
	});

	// ========================================================================
	// DC and territory handling
	// ========================================================================

	describe('DC and territories', () => {
		it('returns special_status for DC addresses', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({
					matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
					districtId: 'DC-00',
					districtName: 'District of Columbia At-Large',
					officials: {
						officials: [
							{
								bioguide_id: 'N000147',
								name: 'Eleanor Holmes Norton',
								party: 'Democratic',
								chamber: 'house',
								state: 'DC',
								district: '00',
								office: 'Delegate',
								phone: '202-555-0200',
								contact_form_url: null,
								website_url: null,
								cwc_code: null,
								is_voting: false,
								delegate_type: 'delegate'
							}
						],
						district_code: 'DC-00',
						state: 'DC',
						special_status: {
							type: 'dc',
							message: 'DC residents have no voting representation in Congress.',
							has_senators: false,
							has_voting_representative: false
						},
						source: 'congress-legislators',
						cached: true
					}
				})
			);

			const event = createResolveRequest({
				street: '1600 Pennsylvania Ave NW',
				city: 'Washington',
				state: 'DC',
				zip: '20500'
			});
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.resolved).toBe(true);
			expect(data.special_status).toBeDefined();
			expect(data.special_status.type).toBe('dc');
			expect(data.special_status.has_senators).toBe(false);
			expect(data.special_status.has_voting_representative).toBe(false);
		});

		it('returns delegate for territory addresses', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({
					matchedAddress: '100 SAN JUAN ST, SAN JUAN, PR, 00901',
					districtId: 'PR-00',
					districtName: 'Puerto Rico At-Large',
					officials: {
						officials: [
							{
								bioguide_id: 'G000582',
								name: 'Jenniffer Gonzalez-Colon',
								party: 'Republican',
								chamber: 'house',
								state: 'PR',
								district: '00',
								office: 'Resident Commissioner',
								phone: '202-555-0300',
								contact_form_url: null,
								website_url: null,
								cwc_code: null,
								is_voting: false,
								delegate_type: 'resident-commissioner'
							}
						],
						district_code: 'PR-00',
						state: 'PR',
						special_status: {
							type: 'territory',
							message: 'Puerto Rico residents have non-voting representation in Congress.',
							has_senators: false,
							has_voting_representative: false
						},
						source: 'congress-legislators',
						cached: true
					}
				})
			);

			const event = createResolveRequest({
				street: '100 San Juan St',
				city: 'San Juan',
				state: 'PR',
				zip: '00901'
			});
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.resolved).toBe(true);
			expect(data.special_status).toBeDefined();
			expect(data.special_status.type).toBe('territory');

			// Should have a delegate in officials
			expect(data.officials.length).toBeGreaterThanOrEqual(1);
			const delegate = data.officials.find(
				(o: { chamber: string }) => o.chamber === 'house'
			);
			expect(delegate).toBeDefined();
			expect(delegate.is_voting_member).toBe(false);
		});
	});

	// ========================================================================
	// Officials unavailable (graceful degradation)
	// ========================================================================

	describe('officials unavailable', () => {
		it('still returns resolved=true with address when officials are null', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({ officials: null })
			);

			const event = createResolveRequest(testAddress);
			const response = await POST(event as any);
			const data = await response.json();

			// Should still resolve with address data
			expect(data.resolved).toBe(true);
			expect(data.address.matched).toBeTruthy();
			// District is null when officials is null (endpoint derives district_code from officials)
			expect(data.district).toBeNull();
			// Officials empty when Shadow Atlas returns null
			expect(Array.isArray(data.officials)).toBe(true);
			expect(data.officials).toHaveLength(0);
		});
	});

	// ========================================================================
	// Address parsing
	// ========================================================================

	describe('matched address parsing', () => {
		it('parses geocoder 4-part standardized address correctly', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({
					matchedAddress: '12 MINT PLZ, SAN FRANCISCO, CA, 94103',
					districtId: 'CA-11'
				})
			);

			const event = createResolveRequest({
				street: '12 Mint Plz',
				city: 'San Francisco',
				state: 'CA',
				zip: '94103'
			});
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.address.street).toBe('12 MINT PLZ');
			expect(data.address.city).toBe('SAN FRANCISCO');
			expect(data.address.state).toBe('CA');
			expect(data.address.zip).toBe('94103');
		});

		it('parses Nominatim display names without moving neighborhood fields into address slots', async () => {
			mockResolveAddress.mockResolvedValueOnce(
				shadowAtlasResponse({
					matchedAddress:
						'12, Mint Plaza, Tenderloin, San Francisco, California, 94103, United States',
					districtId: 'CA-11'
				})
			);

			const event = createResolveRequest({
				street: '12 Mint Plaza',
				city: 'San Francisco',
				state: 'CA',
				zip: '94103'
			});
			const response = await POST(event as any);
			const data = await response.json();

			expect(data.address.street).toBe('12 Mint Plaza');
			expect(data.address.city).toBe('San Francisco');
			expect(data.address.state).toBe('CA');
			expect(data.address.zip).toBe('94103');
		});
	});
});
