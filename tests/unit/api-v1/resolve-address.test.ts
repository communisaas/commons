/**
 * Unit Tests: POST /api/v1/resolve-address
 *
 * Keyed, plan-gated address resolution endpoint. Exercises the auth chain
 * (auth → rate-limit → scope), body validation, the two-clock freshness
 * surfacing, and honest typed errors (geocode-miss 404, resolve-failed 502,
 * outside-coverage 200 with district:null).
 *
 * The response envelope helpers (apiOk/apiError) are NOT mocked — assertions
 * run against the real parsed JSON envelope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// HOISTED MOCKS
// =============================================================================

const {
	mockAuthenticateApiKey,
	mockRequireScope,
	mockCheckApiPlanRateLimit,
	mockResolveAddress,
	mockServerMutation,
	mockServerQuery,
	mockGetInternalSecret
} = vi.hoisted(() => ({
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockResolveAddress: vi.fn(),
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn(),
	mockGetInternalSecret: vi.fn()
}));

// =============================================================================
// MODULE MOCKS
// =============================================================================

vi.mock('$lib/server/api-v1/gate', () => ({
	requirePublicApi: vi.fn()
}));

vi.mock('$lib/server/api-v1/auth', () => ({
	authenticateApiKey: (...args: unknown[]) => mockAuthenticateApiKey(...args),
	requireScope: (...args: unknown[]) => mockRequireScope(...args)
}));

vi.mock('$lib/server/api-v1/rate-limit', () => ({
	checkApiPlanRateLimit: (...args: unknown[]) => mockCheckApiPlanRateLimit(...args)
}));

// Re-export the REAL AtlasInfraError class alongside the mocked resolver: the
// handler's `instanceof AtlasInfraError` check can only ever match instances of
// the actual class, so a plain-object stand-in would make case (h) untestable.
vi.mock('$lib/core/shadow-atlas/client', async () => {
	const actual = await vi.importActual<typeof import('../../../src/lib/core/shadow-atlas/client')>(
		'$lib/core/shadow-atlas/client'
	);
	return {
		AtlasInfraError: actual.AtlasInfraError,
		resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
	};
});

// The metering write is awaited on the success path. Mock the Convex bridge so
// the test asserts the call shape without standing up a backend.
vi.mock('convex-sveltekit', () => ({
	serverMutation: (...args: unknown[]) => mockServerMutation(...args),
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		metering: {
			recordUsage: 'metering:recordUsage',
			getUsageForPeriod: 'metering:getUsageForPeriod'
		}
	}
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: (...args: unknown[]) => mockGetInternalSecret(...args)
}));

// $types stub
vi.mock('../../../src/routes/api/v1/resolve-address/$types', () => ({}));

// =============================================================================
// IMPORTS (after mocks)
// =============================================================================

const { POST: resolveAddressHandler } = await import(
	'../../../src/routes/api/v1/resolve-address/+server'
);
// Routed through the mock above, which re-exports the actual class — so
// instances constructed here are the SAME class the handler checks against.
const { AtlasInfraError } = await import('$lib/core/shadow-atlas/client');
// The REAL coverage module (only the client module is mocked): the handler embeds
// this exact static disclosure object in every response.
const { DISTRICT_COVERAGE } = await import('$lib/core/shadow-atlas/coverage');

// =============================================================================
// HELPERS
// =============================================================================

const VALID_AUTH_CONTEXT = {
	orgId: 'org-api-123',
	keyId: 'key-test-456',
	scopes: ['read', 'write'],
	planSlug: 'inactive'
};

const VALID_BODY = {
	street: '12 Mint Plz',
	city: 'San Francisco',
	state: 'CA',
	zip: '94103',
	country: 'US' as const
};

const ENRICHED_RESULT = {
	geocode: {
		lat: 37.78,
		lng: -122.41,
		matched_address: '12 Mint Plz, San Francisco, CA, 94103',
		confidence: 0.9,
		country: 'US'
	},
	district: { id: 'CA-12', name: 'California 12th', jurisdiction: 'US', district_type: 'congressional' },
	districts: [
		{ id: 'CA-12', geoid: '0612', name: 'California 12th', jurisdiction: 'congressional', district_type: 'congressional' },
		{ id: 'sldu-06011', geoid: '06011', name: 'State Senate 06011', jurisdiction: 'state-senate', district_type: 'state-senate' },
		{ id: 'county-06075', geoid: '06075', name: 'County 06075', jurisdiction: 'county', district_type: 'county' }
	],
	officials: {
		officials: [
			{ name: 'Rep. Example', party: 'D', chamber: 'house', state: 'CA', district: '12', office: 'Representative, CA' }
		],
		district_code: 'CA-12',
		state: 'CA',
		special_status: null,
		source: 'congress-legislators',
		cached: false
	},
	cell_id: 'cell-abc',
	provenance: { source: 'nominatim', tigerVintage: '2023' },
	confidence: 1.0,
	boundaryAsOf: '2026-01-15T00:00:00.000Z',
	officialsAsOf: '2026-03-20T00:00:00.000Z'
};

function setupDefaults() {
	mockAuthenticateApiKey.mockResolvedValue(VALID_AUTH_CONTEXT);
	mockCheckApiPlanRateLimit.mockResolvedValue(null);
	mockRequireScope.mockReturnValue(null);
	mockGetInternalSecret.mockReturnValue('internal-secret');
	mockServerMutation.mockResolvedValue('usage_row_1');
	// Pre-resolve plan-quota gate reads the ledger via getUsageForPeriod; return
	// zero recorded usage so every existing case stays under-allowance and the
	// gate is a no-op for these assertions (the gate is exercised in its own
	// resolve-quota.test.ts).
	mockServerQuery.mockResolvedValue({ resolve_address: 0 });
}

function makeRequest(
	body: unknown = VALID_BODY,
	opts?: { rawBody?: string; headers?: Record<string, string> }
) {
	return new Request('http://localhost/api/v1/resolve-address', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer ck_live_test123',
			'Content-Type': 'application/json',
			...opts?.headers
		},
		body: opts?.rawBody ?? JSON.stringify(body)
	});
}

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/v1/resolve-address', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it('(a) returns 401 when authenticateApiKey returns a 401 Response', async () => {
		mockAuthenticateApiKey.mockResolvedValue(
			new Response(
				JSON.stringify({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } }
			)
		);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		expect(res.status).toBe(401);
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('(b) returns 403 when requireScope returns a 403 Response', async () => {
		mockRequireScope.mockReturnValue(
			new Response(
				JSON.stringify({ data: null, error: { code: 'FORBIDDEN', message: 'no scope' } }),
				{ status: 403, headers: { 'Content-Type': 'application/json' } }
			)
		);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(403);
		expect(body.error.code).toBe('FORBIDDEN');
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('(c) returns 429 when checkApiPlanRateLimit returns a 429 Response', async () => {
		mockCheckApiPlanRateLimit.mockResolvedValue(
			new Response(
				JSON.stringify({ data: null, error: { code: 'RATE_LIMITED', message: 'slow down' } }),
				{ status: 429, headers: { 'Content-Type': 'application/json' } }
			)
		);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		expect(res.status).toBe(429);
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('(d) happy path: surfaces district, provenance, confidence, officials + two DISTINCT clocks', async () => {
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.district).toEqual(ENRICHED_RESULT.district);
		// The multi-type view passes through verbatim (congressional entry included).
		expect(body.data.districts).toEqual(ENRICHED_RESULT.districts);
		// The static coverage disclosure is embedded in every response, and it is the
		// REAL module object — which boundary types are served, at what honesty class,
		// and that officials rosters are congressional-only.
		expect(body.data.coverage).toEqual(JSON.parse(JSON.stringify(DISTRICT_COVERAGE)));
		expect(body.data.coverage.officialsTypes).toEqual(['congressional']);
		expect(body.data.provenance).toEqual({ source: 'nominatim', tigerVintage: '2023' });
		expect(body.data.confidence).toBe(1.0);
		expect(body.data.officials).toHaveLength(1);
		// Two clocks are distinct, non-null, never collapsed.
		expect(body.data.asOf.boundaryAsOf).toBe('2026-01-15T00:00:00.000Z');
		expect(body.data.asOf.officialsAsOf).toBe('2026-03-20T00:00:00.000Z');
		expect(body.data.asOf.boundaryAsOf).not.toBe(body.data.asOf.officialsAsOf);

		// The pre-resolve quota read is secret-gated like the write below.
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		const [, queryArgs] = mockServerQuery.mock.calls[0];
		expect(queryArgs._secret).toBe('internal-secret');

		// Exactly ONE awaited metering write for the resolution.
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [, meterArgs] = mockServerMutation.mock.calls[0];
		expect(meterArgs.meter).toBe('resolve_address');
		expect(meterArgs.quantity).toBe(1);
		expect(meterArgs.orgId).toBe(VALID_AUTH_CONTEXT.orgId);
		expect(meterArgs.keyId).toBe(VALID_AUTH_CONTEXT.keyId);
		expect(meterArgs._secret).toBe('internal-secret');
		// billingPeriodStart is the UTC calendar-month floor (a real number).
		expect(typeof meterArgs.billingPeriodStart).toBe('number');
		// The response meta echoes the SAME requestId the ledger row was keyed on.
		expect(typeof meterArgs.requestId).toBe('string');
		expect(body.meta.requestId).toBe(meterArgs.requestId);
	});

	it('(d2) outside-coverage (district:null) is a billable resolution — meters exactly one row', async () => {
		mockResolveAddress.mockResolvedValue({
			...ENRICHED_RESULT,
			district: null,
			districts: [],
			officials: null,
			confidence: 0,
			boundaryAsOf: null,
			officialsAsOf: null
		});

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.district).toBeNull();
		// The multi-type view round-trips the honest empty array.
		expect(body.data.districts).toEqual([]);
		// The substrate ran → exactly one metered row, requestId echoed.
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		expect(body.meta.requestId).toBe(mockServerMutation.mock.calls[0][1].requestId);
	});

	it('(d5) billing is invariant in the number of district types returned — a 6-type result still meters quantity 1', async () => {
		mockResolveAddress.mockResolvedValue({
			...ENRICHED_RESULT,
			districts: [
				{ id: 'MN-08', geoid: '2708', name: "Minnesota's 8th Congressional District", jurisdiction: 'congressional', district_type: 'congressional' },
				{ id: 'sldu-27011', geoid: '27011', name: 'State Senate 27011', jurisdiction: 'state-senate', district_type: 'state-senate' },
				{ id: 'sldl-2711B', geoid: '2711B', name: 'State House/Assembly 2711B', jurisdiction: 'state-house', district_type: 'state-house' },
				{ id: 'county-27115', geoid: '27115', name: 'County 27115', jurisdiction: 'county', district_type: 'county' },
				{ id: 'unsd-2742750', geoid: '2742750', name: 'Unified School District 2742750', jurisdiction: 'unified-school', district_type: 'unified-school' },
				{ id: 'cousub-2711532984', geoid: '2711532984', name: 'Township/MCD 2711532984', jurisdiction: 'township', district_type: 'township' }
			]
		});

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.districts).toHaveLength(6);
		// One resolution = one meter event, regardless of how many types returned.
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [, meterArgs] = mockServerMutation.mock.calls[0];
		expect(meterArgs.meter).toBe('resolve_address');
		expect(meterArgs.quantity).toBe(1);
	});

	it('(d6) a resolver result WITHOUT a districts field still yields data.districts === [] (never undefined)', async () => {
		const { districts: _omit, ...legacyShape } = ENRICHED_RESULT;
		mockResolveAddress.mockResolvedValue(legacyShape);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.districts).toEqual([]);
	});

	it('(d3) the metering write is AWAITED + fail-closed — a rejected ledger write yields a non-200, never a billed-but-unrecorded 200', async () => {
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);
		mockServerMutation.mockRejectedValue(new Error('ledger write failed'));

		// If the write were fire-and-forget, the handler would resolve 200 with
		// unbilled usage. Because it is AWAITED inside its own try, the rejection
		// is caught and the request fails closed (502 METERING_WRITE_FAILED) —
		// distinct from a resolver failure — rather than returning a success the
		// ledger never recorded. Revenue is never silently dropped, and a retry
		// re-resolves under a fresh requestId.
		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).not.toBe(200);
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('METERING_WRITE_FAILED');
		expect(body.data).toBeNull();
		// The write was attempted exactly once (awaited, not skipped).
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
	});

	it('(d4) a metering-ledger outage on the quota read fails closed — 502 METERING_UNAVAILABLE, no resolve, no meter', async () => {
		mockServerQuery.mockRejectedValue(new Error('convex down'));

		// The gate read is the first thing past validation. If it throws we can't
		// honestly enforce the allowance, so the handler returns a typed 502
		// BEFORE resolveAddress runs — never a bare 500/throw, never a billed row.
		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('METERING_UNAVAILABLE');
		expect(body.data).toBeNull();
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(e) returns 400 INVALID_REQUEST on a bad body (state length !== 2)', async () => {
		const res = await resolveAddressHandler({
			request: makeRequest({ ...VALID_BODY, state: 'CALIFORNIA' })
		} as any);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error.code).toBe('INVALID_REQUEST');
		expect(mockResolveAddress).not.toHaveBeenCalled();
		// A 400 before resolveAddress writes ZERO ledger rows.
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(e2) returns 400 INVALID_REQUEST when street is missing', async () => {
		const { street: _omit, ...noStreet } = VALID_BODY;
		const res = await resolveAddressHandler({ request: makeRequest(noStreet) } as any);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error.code).toBe('INVALID_REQUEST');
	});

	it('(e3) returns 400 INVALID_REQUEST on a non-JSON body (never a 500)', async () => {
		const res = await resolveAddressHandler({
			request: makeRequest(undefined, { rawBody: 'not-json{' })
		} as any);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error.code).toBe('INVALID_REQUEST');
	});

	it('(f) geocode-miss: an "Address not found" throw yields GEOCODE_MISS 404 (NOT 500)', async () => {
		mockResolveAddress.mockRejectedValue(
			new Error('Address not found. Please check your address and try again.')
		);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(404);
		expect(body.error.code).toBe('GEOCODE_MISS');
		// resolveAddress threw → the metering hook is unreachable → ZERO rows.
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(f2) any other throw yields RESOLVE_FAILED 502', async () => {
		mockResolveAddress.mockRejectedValue(new Error('Nominatim geocoding returned 503'));

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('RESOLVE_FAILED');
		// A 502 path writes ZERO ledger rows.
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(g) outside-coverage: district:null resolves to 200 apiOk with data.district === null', async () => {
		mockResolveAddress.mockResolvedValue({
			...ENRICHED_RESULT,
			district: null,
			districts: [],
			officials: null,
			confidence: 0,
			boundaryAsOf: null,
			officialsAsOf: null
		});

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.data.district).toBeNull();
		expect(body.data.districts).toEqual([]);
		expect(body.data.officials).toEqual([]);
		expect(body.error).toBeUndefined();
	});

	it('(h) an AtlasInfraError throw yields 502 ATLAS_UNAVAILABLE and the meter is structurally unreachable', async () => {
		mockResolveAddress.mockRejectedValue(new AtlasInfraError('chunk store returned 503'));

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('ATLAS_UNAVAILABLE');
		expect(body.data).toBeNull();
		// The throw skipped the meter hook — an infra outage is NEVER billed.
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(i) a valid Idempotency-Key becomes the org-namespaced, PAYLOAD-BOUND ledger requestId AND is echoed in meta', async () => {
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);

		const res = await resolveAddressHandler({
			request: makeRequest(VALID_BODY, { headers: { 'Idempotency-Key': 'retry-key-001' } })
		} as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [, meterArgs] = mockServerMutation.mock.calls[0];
		// Org-namespaced + payload-bound composite: orgId:ik:<32-hex sha256 of
		// key|payload>. One org can never dedup/collide with another org's rows,
		// and the hash binds the key to THIS address payload.
		expect(meterArgs.requestId).toMatch(
			new RegExp(`^${VALID_AUTH_CONTEXT.orgId}:ik:[0-9a-f]{32}$`)
		);
		// meta.requestId correlates to the ACTUAL ledger row, not a fresh UUID.
		expect(body.meta.requestId).toBe(meterArgs.requestId);

		// A TRUE REPLAY (same key, same payload) is deterministic — same requestId,
		// so recordUsage's by_requestId dedup bills once.
		vi.clearAllMocks();
		setupDefaults();
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);
		await resolveAddressHandler({
			request: makeRequest(VALID_BODY, { headers: { 'Idempotency-Key': 'retry-key-001' } })
		} as any);
		expect(mockServerMutation.mock.calls[0][1].requestId).toBe(meterArgs.requestId);
	});

	it('(i3) the SAME Idempotency-Key with a DIFFERENT address yields a DIFFERENT requestId — a pinned key cannot mint unmetered resolves', async () => {
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);

		await resolveAddressHandler({
			request: makeRequest(VALID_BODY, { headers: { 'Idempotency-Key': 'pinned-key-001' } })
		} as any);
		const firstRequestId = mockServerMutation.mock.calls[0][1].requestId;

		vi.clearAllMocks();
		setupDefaults();
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);
		await resolveAddressHandler({
			request: makeRequest(
				{ ...VALID_BODY, street: '742 Evergreen Terrace' },
				{ headers: { 'Idempotency-Key': 'pinned-key-001' } }
			)
		} as any);
		const secondRequestId = mockServerMutation.mock.calls[0][1].requestId;

		// Different payload -> different ledger row -> BOTH resolutions bill.
		// Without payload binding, a pinned key would dedup every subsequent
		// address to the first row: unbounded unmetered volume.
		expect(secondRequestId).not.toBe(firstRequestId);
		expect(secondRequestId).toMatch(new RegExp(`^${VALID_AUTH_CONTEXT.orgId}:ik:[0-9a-f]{32}$`));
	});

	it('(i4) delimiter-crafted payloads do NOT collide — the serialization is injective', async () => {
		// With a '|'-joined hash these two payloads serialize identically
		// ('...|123 Main St||X|...' both ways) and Nominatim tokenizes them the
		// same, so the second resolve would dedup into an unmetered 200. The
		// JSON tuple serialization keeps them distinct.
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);

		await resolveAddressHandler({
			request: makeRequest(
				{ ...VALID_BODY, street: '123 Main St|', city: 'X' },
				{ headers: { 'Idempotency-Key': 'crafted-key-01' } }
			)
		} as any);
		const firstRequestId = mockServerMutation.mock.calls[0][1].requestId;

		vi.clearAllMocks();
		setupDefaults();
		mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);
		await resolveAddressHandler({
			request: makeRequest(
				{ ...VALID_BODY, street: '123 Main St', city: '|X' },
				{ headers: { 'Idempotency-Key': 'crafted-key-01' } }
			)
		} as any);
		const secondRequestId = mockServerMutation.mock.calls[0][1].requestId;

		expect(secondRequestId).not.toBe(firstRequestId);
	});

	it('(i2) an invalid Idempotency-Key is a 400 INVALID_REQUEST BEFORE the resolver runs', async () => {
		for (const badKey of [
			'short7c', // 7 chars — under the 8 minimum
			'a'.repeat(65), // 65 chars — over the 64 maximum
			'bad key!@#$%' // illegal characters (space, !, @, #, $, %)
		]) {
			vi.clearAllMocks();
			setupDefaults();

			const res = await resolveAddressHandler({
				request: makeRequest(VALID_BODY, { headers: { 'Idempotency-Key': badKey } })
			} as any);
			const body = await res.json();
			expect(res.status, `key ${JSON.stringify(badKey)}`).toBe(400);
			expect(body.error.code).toBe('INVALID_REQUEST');
			expect(mockResolveAddress).not.toHaveBeenCalled();
			expect(mockServerMutation).not.toHaveBeenCalled();
		}
	});

	it("(j) country 'CA' is a typed 400 UNSUPPORTED_COUNTRY — no resolve, no meter", async () => {
		const res = await resolveAddressHandler({
			request: makeRequest({ ...VALID_BODY, country: 'CA' })
		} as any);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error.code).toBe('UNSUPPORTED_COUNTRY');
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(j2) a Canadian-format postal code fails the US-only zip schema with a 400', async () => {
		const res = await resolveAddressHandler({
			request: makeRequest({ ...VALID_BODY, zip: 'K1A 0B1' })
		} as any);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error.code).toBe('INVALID_REQUEST');
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('(k) an authenticateApiKey THROW (backend outage) yields a typed 502 AUTH_UNAVAILABLE, never a raw 500', async () => {
		mockAuthenticateApiKey.mockRejectedValue(new Error('convex auth backend down'));

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('AUTH_UNAVAILABLE');
		expect(body.data).toBeNull();
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(k2) a checkApiPlanRateLimit THROW (limiter outage) yields a typed 502 RATE_LIMITER_UNAVAILABLE, never a raw 500', async () => {
		mockCheckApiPlanRateLimit.mockRejectedValue(new Error('rate limiter backend down'));

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();
		expect(res.status).toBe(502);
		expect(body.error.code).toBe('RATE_LIMITER_UNAVAILABLE');
		expect(body.data).toBeNull();
		// Returned before body parse, quota read, and resolve — no resolve, no meter.
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});
