/**
 * G3 — Resolution freshness-provenance capture tests.
 *
 * Covers the two capture hops added by G3-provenance-capture:
 *
 * 1. Route emission: POST /api/location/resolve-address externalizes
 *    boundary_as_of / officials_as_of / tiger_vintage / resolution_confidence
 *    VERBATIM from resolveAddress. Two independent clocks are never conflated;
 *    `null` passes through as JSON null (never a fabricated timestamp); the
 *    'unknown' tigerVintage sentinel externalizes as null, never the literal
 *    string 'unknown'.
 *
 * 2. Credential pass-through: registerThreeTree / recoverThreeTree copy the 4
 *    fields verbatim from the request onto the stored SessionCredential; a
 *    request without them leaves the credential fields undefined.
 *
 * Reuses the vi.mock('$lib/core/shadow-atlas/client') + POST-request-builder
 * pattern of tests/integration/components/address-collection-form.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockRequestEvent } from '../../setup/api-test-setup';
import type { AddressResolutionResult } from '../../../src/lib/core/shadow-atlas/client';
import type { SessionCredential } from '../../../src/lib/core/identity/session-credentials';

// ---------------------------------------------------------------------------
// Mock $env/dynamic/private — the resolve-address endpoint mints an HMAC-bound
// address-resolution token (F-2.4) that requires this secret.
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

// ---------------------------------------------------------------------------
// Mock the Shadow Atlas client module (route dependency)
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

// ---------------------------------------------------------------------------
// Mock session-credentials (handler dependency) — spy on storeSessionCredential
// so we can assert exactly what credential the handler persists.
// ---------------------------------------------------------------------------

const storeSessionCredentialMock = vi.fn<(credential: SessionCredential) => Promise<void>>();

vi.mock('$lib/core/identity/session-credentials', () => ({
	storeSessionCredential: (credential: SessionCredential) =>
		storeSessionCredentialMock(credential),
	calculateExpirationDate: () => new Date('2027-01-01T00:00:00.000Z'),
	isCellAnchorMode: (v: unknown) => typeof v === 'string'
}));

// Mock poseidon so the handler's districtCommitment step doesn't load crypto WASM.
vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: async () => '0x' + '1'.padStart(64, '0'),
	poseidonHash: async () => '0x' + '2'.padStart(64, '0')
}));

// Import route handler + registration handler AFTER vi.mock so mocks are active
import { POST } from '../../../src/routes/api/location/resolve-address/+server';
import {
	registerThreeTree,
	recoverThreeTree,
	type ThreeTreeRegistrationRequest,
	type ThreeTreeRecoveryRequest
} from '../../../src/lib/core/identity/shadow-atlas-handler';

// ---------------------------------------------------------------------------
// Shadow Atlas response factory (address-collection-form.test.ts pattern,
// extended with a resolutionConfidence override for the top-level clock).
// ---------------------------------------------------------------------------

interface ResolveOverrides {
	matchedAddress?: string;
	lat?: number;
	lng?: number;
	confidence?: number;
	country?: 'US' | 'CA';
	districtId?: string;
	officials?: AddressResolutionResult['officials'];
	cellId?: string | null;
	provenance?: AddressResolutionResult['provenance'];
	boundaryAsOf?: string | null;
	officialsAsOf?: string | null;
	resolutionConfidence?: number;
	warning?: string | null;
}

function shadowAtlasResponse(overrides: ResolveOverrides = {}): AddressResolutionResult {
	const {
		matchedAddress = '123 MAIN ST, SPRINGFIELD, IL, 62704',
		lat = 39.7817,
		lng = -89.6501,
		confidence = 0.95,
		country = 'US',
		districtId = 'IL-18',
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
				}
			],
			district_code: districtId,
			state: 'IL',
			special_status: null,
			source: 'congress-legislators' as const,
			cached: true
		},
		cellId = '872a10000ffffff',
		provenance = { source: 'nominatim', tigerVintage: 'unknown' },
		boundaryAsOf = null,
		officialsAsOf = null,
		resolutionConfidence = 1.0,
		warning = null
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
			name: `District ${districtId}`,
			jurisdiction: 'congressional',
			district_type: 'congressional'
		},
		districts: [],
		officials,
		cell_id: cellId,
		provenance,
		confidence: resolutionConfidence,
		boundaryAsOf,
		officialsAsOf,
		warning
	};
}

const testAddress = {
	street: '123 Main Street',
	city: 'Springfield',
	state: 'IL',
	zip: '62704'
};

const authenticatedLocals = {
	user: { id: 'test-user-123', email: 'test@example.com' }
};

function createResolveRequest(body: Record<string, unknown>, locals = authenticatedLocals) {
	return createMockRequestEvent({
		url: '/api/location/resolve-address',
		method: 'POST',
		body: JSON.stringify(body),
		locals
	});
}

// ---------------------------------------------------------------------------
// Route emission: provenance fields externalized verbatim
// ---------------------------------------------------------------------------

describe('POST /api/location/resolve-address — provenance emission', () => {
	beforeEach(() => {
		mockResolveAddress.mockReset();
	});

	it('carries boundary_as_of / officials_as_of / tiger_vintage / resolution_confidence verbatim', async () => {
		mockResolveAddress.mockResolvedValueOnce(
			shadowAtlasResponse({
				boundaryAsOf: '2025-12-06T00:00:00.000Z',
				officialsAsOf: '2026-03-14T00:00:00.000Z',
				provenance: { source: 'nominatim', tigerVintage: '2024' },
				resolutionConfidence: 0.4
			})
		);

		const event = createResolveRequest(testAddress);
		const response = await POST(event as any);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.resolved).toBe(true);
		// Exact mocked values — verbatim, no transformation
		expect(data.boundary_as_of).toBe('2025-12-06T00:00:00.000Z');
		expect(data.officials_as_of).toBe('2026-03-14T00:00:00.000Z');
		expect(data.tiger_vintage).toBe('2024');
		expect(data.resolution_confidence).toBe(0.4);
		// Two independent clocks — never conflated
		expect(data.boundary_as_of).not.toBe(data.officials_as_of);
	});

	it('propagates null clocks as JSON null and maps the "unknown" vintage sentinel to null', async () => {
		mockResolveAddress.mockResolvedValueOnce(
			shadowAtlasResponse({
				boundaryAsOf: null,
				officialsAsOf: null,
				provenance: { source: 'nominatim', tigerVintage: 'unknown' },
				resolutionConfidence: 0
			})
		);

		const event = createResolveRequest(testAddress);
		const response = await POST(event as any);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.boundary_as_of).toBeNull();
		expect(data.officials_as_of).toBeNull();
		// 'unknown' sentinel externalizes as null, never the literal string
		expect(data.tiger_vintage).toBeNull();
		expect(data.tiger_vintage).not.toBe('unknown');
		expect(data.resolution_confidence).toBe(0);

		// No fabricated timestamp: none of the provenance fields carries a fresh date
		const freshDatePrefix = new Date().toISOString().slice(0, 10);
		for (const value of [data.boundary_as_of, data.officials_as_of, data.tiger_vintage]) {
			expect(value).toBeNull();
			expect(String(value)).not.toContain(freshDatePrefix);
		}
	});

	it('forwards one present clock without copying it into the absent one', async () => {
		mockResolveAddress.mockResolvedValueOnce(
			shadowAtlasResponse({
				boundaryAsOf: '2025-12-06T00:00:00.000Z',
				officialsAsOf: null,
				provenance: { source: 'nominatim', tigerVintage: '2024' },
				resolutionConfidence: 1.0
			})
		);

		const event = createResolveRequest(testAddress);
		const response = await POST(event as any);
		const data = await response.json();

		expect(data.boundary_as_of).toBe('2025-12-06T00:00:00.000Z');
		// officials clock stays honestly null — never borrowed from the boundary clock
		expect(data.officials_as_of).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Credential pass-through: registerThreeTree / recoverThreeTree
// ---------------------------------------------------------------------------

const ZERO_HASH = '0x' + '0'.repeat(64);

function stubTreeFetch() {
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/shadow-atlas/register')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					leafIndex: 7,
					userRoot: '0x0a',
					userPath: ['0x0b'],
					pathIndices: [0],
					identityCommitment: '0x0c'
				})
			} as unknown as Response;
		}
		if (url.includes('/api/shadow-atlas/engagement')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					engagementRoot: ZERO_HASH,
					engagementPath: Array(20).fill(ZERO_HASH),
					engagementIndex: 0,
					engagementTier: 0,
					actionCount: '0',
					diversityScore: '0'
				})
			} as unknown as Response;
		}
		throw new Error(`Unexpected fetch in test: ${url}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const baseRegistrationRequest: ThreeTreeRegistrationRequest = {
	userId: 'user-1',
	leaf: '0x01',
	cellId: '0x02',
	h3Cell: '872a10000ffffff',
	tree2: {
		cellMapRoot: '0x03',
		cellMapPath: ['0x04'],
		cellMapPathBits: [0],
		districts: Array(24).fill('0x05')
	},
	userSecret: '0x06',
	registrationSalt: '0x07',
	verificationMethod: 'digital-credentials-api',
	verifiedDistrict: 'IL-18'
};

describe('registerThreeTree — provenance pass-through', () => {
	beforeEach(() => {
		storeSessionCredentialMock.mockReset();
		storeSessionCredentialMock.mockResolvedValue(undefined);
		stubTreeFetch();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('copies the 4 provenance fields verbatim onto the stored credential', async () => {
		const result = await registerThreeTree({
			...baseRegistrationRequest,
			boundaryAsOf: '2025-12-06T00:00:00.000Z',
			officialsAsOf: '2026-03-14T00:00:00.000Z',
			tigerVintage: '2024',
			resolutionConfidence: 0.4
		});

		expect(result.success).toBe(true);
		expect(storeSessionCredentialMock).toHaveBeenCalledTimes(1);
		const credential = storeSessionCredentialMock.mock.calls[0][0];
		expect(credential.boundaryAsOf).toBe('2025-12-06T00:00:00.000Z');
		expect(credential.officialsAsOf).toBe('2026-03-14T00:00:00.000Z');
		expect(credential.tigerVintage).toBe('2024');
		expect(credential.resolutionConfidence).toBe(0.4);
		// Two clocks stay distinct on the credential
		expect(credential.boundaryAsOf).not.toBe(credential.officialsAsOf);
	});

	it('forwards null clocks verbatim (honestly-unknown, never synthesized)', async () => {
		const result = await registerThreeTree({
			...baseRegistrationRequest,
			boundaryAsOf: null,
			officialsAsOf: null,
			tigerVintage: '2024',
			resolutionConfidence: 0
		});

		expect(result.success).toBe(true);
		const credential = storeSessionCredentialMock.mock.calls[0][0];
		expect(credential.boundaryAsOf).toBeNull();
		expect(credential.officialsAsOf).toBeNull();
		expect(credential.tigerVintage).toBe('2024');
		expect(credential.resolutionConfidence).toBe(0);
	});

	it('leaves credential fields undefined when the request omits them', async () => {
		const result = await registerThreeTree({ ...baseRegistrationRequest });

		expect(result.success).toBe(true);
		expect(storeSessionCredentialMock).toHaveBeenCalledTimes(1);
		const credential = storeSessionCredentialMock.mock.calls[0][0];
		expect(credential.boundaryAsOf).toBeUndefined();
		expect(credential.officialsAsOf).toBeUndefined();
		expect(credential.tigerVintage).toBeUndefined();
		expect(credential.resolutionConfidence).toBeUndefined();
	});
});

describe('recoverThreeTree — provenance pass-through parity', () => {
	beforeEach(() => {
		storeSessionCredentialMock.mockReset();
		storeSessionCredentialMock.mockResolvedValue(undefined);
		stubTreeFetch();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const baseRecoveryRequest: ThreeTreeRecoveryRequest = {
		...baseRegistrationRequest
	};

	it('copies the 4 provenance fields verbatim onto the recovered credential', async () => {
		const result = await recoverThreeTree({
			...baseRecoveryRequest,
			boundaryAsOf: '2025-12-06T00:00:00.000Z',
			officialsAsOf: '2026-03-14T00:00:00.000Z',
			tigerVintage: '2024',
			resolutionConfidence: 0.4
		});

		expect(result.success).toBe(true);
		expect(storeSessionCredentialMock).toHaveBeenCalledTimes(1);
		const credential = storeSessionCredentialMock.mock.calls[0][0];
		expect(credential.boundaryAsOf).toBe('2025-12-06T00:00:00.000Z');
		expect(credential.officialsAsOf).toBe('2026-03-14T00:00:00.000Z');
		expect(credential.tigerVintage).toBe('2024');
		expect(credential.resolutionConfidence).toBe(0.4);
	});

	it('leaves recovered credential fields undefined when the request omits them', async () => {
		const result = await recoverThreeTree({ ...baseRecoveryRequest });

		expect(result.success).toBe(true);
		const credential = storeSessionCredentialMock.mock.calls[0][0];
		expect(credential.boundaryAsOf).toBeUndefined();
		expect(credential.officialsAsOf).toBeUndefined();
		expect(credential.tigerVintage).toBeUndefined();
		expect(credential.resolutionConfidence).toBeUndefined();
	});
});
