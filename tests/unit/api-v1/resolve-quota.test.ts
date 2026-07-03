/**
 * Unit Tests: POST /api/v1/resolve-address — plan-quota gate.
 *
 * Exercises the SUBSTRATE-SALE allowance gate layered in front of the resolver:
 * the handler reads the metering ledger for the current billing period via
 * `getUsageForPeriod` and compares the recorded `resolve_address` count to the
 * resolving plan's finite `maxResolvesMonth` allowance BEFORE invoking
 * resolveAddress. Over-quota is an honest typed 402 RESOLVE_QUOTA_EXCEEDED — no
 * resolve, no meter. The allowance is PER-PLAN (read from the slug), not a flat
 * number, so a paid plan at the inactive count still resolves.
 *
 * Also covers the additive `warning` field: the staleness/redraw guard degrades
 * (lowers confidence + sets a warning) rather than throwing, so a degraded
 * result stays a 200 with `body.data.warning` surfaced.
 *
 * The response envelope helpers (apiOk/apiError) are NOT mocked — assertions run
 * against the real parsed JSON envelope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLANS } from '../../../src/lib/server/billing/plans';

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

// Re-export the REAL AtlasInfraError alongside the mocked resolver — the
// handler imports the class for its `instanceof` catch branch.
vi.mock('$lib/core/shadow-atlas/client', async () => {
	const actual = await vi.importActual<typeof import('../../../src/lib/core/shadow-atlas/client')>(
		'$lib/core/shadow-atlas/client'
	);
	return {
		AtlasInfraError: actual.AtlasInfraError,
		resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
	};
});

// Both the metering write (serverMutation) AND the pre-resolve quota read
// (serverQuery) flow through the Convex bridge. Mock both so the test asserts
// the call shapes without standing up a backend.
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

// =============================================================================
// HELPERS
// =============================================================================

const INACTIVE_ALLOWANCE = PLANS.inactive.maxResolvesMonth;
const ORGANIZATION_ALLOWANCE = PLANS.organization.maxResolvesMonth;

function authContext(planSlug: string) {
	return {
		orgId: 'org-api-123',
		keyId: 'key-test-456',
		scopes: ['read', 'write'],
		planSlug
	};
}

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
	officialsAsOf: '2026-03-20T00:00:00.000Z',
	warning: null as string | null
};

/** Default the gate read to a count under the inactive allowance. */
function setupDefaults(planSlug = 'inactive') {
	mockAuthenticateApiKey.mockResolvedValue(authContext(planSlug));
	mockCheckApiPlanRateLimit.mockResolvedValue(null);
	mockRequireScope.mockReturnValue(null);
	mockGetInternalSecret.mockReturnValue('internal-secret');
	mockServerMutation.mockResolvedValue('usage_row_1');
	mockServerQuery.mockResolvedValue({ resolve_address: 0 });
	mockResolveAddress.mockResolvedValue(ENRICHED_RESULT);
}

function makeRequest(body: unknown = VALID_BODY, headers?: Record<string, string>) {
	return new Request('http://localhost/api/v1/resolve-address', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer ck_live_test123',
			'Content-Type': 'application/json',
			...headers
		},
		body: JSON.stringify(body)
	});
}

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/v1/resolve-address — plan-quota gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it('(a) inactive key UNDER the allowance → resolves and meters exactly one row', async () => {
		mockServerQuery.mockResolvedValue({ resolve_address: INACTIVE_ALLOWANCE - 1 });

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.district).toEqual(ENRICHED_RESULT.district);
		// The substrate ran...
		expect(mockResolveAddress).toHaveBeenCalledTimes(1);
		// ...and the meter fired exactly once.
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [, meterArgs] = mockServerMutation.mock.calls[0];
		expect(meterArgs.meter).toBe('resolve_address');

		// The gate read and the meter write use the SAME billing period.
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		const [, queryArgs] = mockServerQuery.mock.calls[0];
		expect(queryArgs.meter).toBe('resolve_address');
		expect(queryArgs.orgId).toBe('org-api-123');
		expect(queryArgs.billingPeriodStart).toBe(meterArgs.billingPeriodStart);
		// The gate read is secret-gated like the meter write (requireInternalSecret).
		expect(queryArgs._secret).toBe('internal-secret');
	});

	it('(b) inactive key AT the allowance → 402 RESOLVE_QUOTA_EXCEEDED, no resolve, no meter', async () => {
		mockServerQuery.mockResolvedValue({ resolve_address: INACTIVE_ALLOWANCE });

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(402);
		expect(body.error.code).toBe('RESOLVE_QUOTA_EXCEEDED');
		expect(body.data).toBeNull();
		// Gate fired BEFORE the resolver → neither resolve nor meter ran.
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(c) paid (organization) key at the INACTIVE count still resolves — allowance is per-plan, not flat', async () => {
		mockAuthenticateApiKey.mockResolvedValue(authContext('organization'));
		// A count that would exhaust the inactive floor but is well under the
		// organization allowance — proves the allowance is read from the slug.
		mockServerQuery.mockResolvedValue({ resolve_address: INACTIVE_ALLOWANCE });
		expect(INACTIVE_ALLOWANCE).toBeLessThan(ORGANIZATION_ALLOWANCE);

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.district).toEqual(ENRICHED_RESULT.district);
		expect(mockResolveAddress).toHaveBeenCalledTimes(1);
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
	});

	it('(d) a stale ENRICHED_RESULT with a warning surfaces body.data.warning non-null in a 200', async () => {
		mockServerQuery.mockResolvedValue({ resolve_address: 0 });
		mockResolveAddress.mockResolvedValue({
			...ENRICHED_RESULT,
			confidence: 0,
			warning: 'district boundaries redrawn after atlas vintage'
		});

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		// Degrade-not-throw: the warning does NOT convert a resolved result to an error.
		expect(res.status).toBe(200);
		expect(body.data.warning).toBe('district boundaries redrawn after atlas vintage');
		expect(body.data.confidence).toBe(0);
		// The two clocks remain distinct keys, untouched by the warning.
		expect(body.data.asOf.boundaryAsOf).toBe('2026-01-15T00:00:00.000Z');
		expect(body.data.asOf.officialsAsOf).toBe('2026-03-20T00:00:00.000Z');
	});

	it('(e) a metering-ledger outage on the gate read → 502 METERING_UNAVAILABLE, no resolve, no meter', async () => {
		mockServerQuery.mockRejectedValue(new Error('convex down'));

		// The allowance gate reads the ledger first. If that read throws we can't
		// enforce the quota, so the handler fails closed with a typed 502 before
		// the resolver runs — no resolve, no metered row.
		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(502);
		expect(body.error.code).toBe('METERING_UNAVAILABLE');
		expect(body.data).toBeNull();
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(g) over-quota 402 still short-circuits BEFORE the resolver even when an Idempotency-Key is supplied', async () => {
		mockServerQuery.mockResolvedValue({ resolve_address: INACTIVE_ALLOWANCE });

		// An idempotency key must never buy a way past the allowance gate — the
		// 402 fires before the resolver and before any ledger write.
		const res = await resolveAddressHandler({
			request: makeRequest(VALID_BODY, { 'Idempotency-Key': 'retry-key-001' })
		} as any);
		const body = await res.json();

		expect(res.status).toBe(402);
		expect(body.error.code).toBe('RESOLVE_QUOTA_EXCEEDED');
		expect(mockResolveAddress).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('(h) a header-less request still meters under a UUID-shaped requestId (no idempotency implied)', async () => {
		mockServerQuery.mockResolvedValue({ resolve_address: 0 });

		const res = await resolveAddressHandler({ request: makeRequest() } as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [, meterArgs] = mockServerMutation.mock.calls[0];
		// UUID-shaped, NOT org-prefixed: without a client key each retry is a
		// fresh billable row.
		expect(meterArgs.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
		expect(body.meta.requestId).toBe(meterArgs.requestId);
	});

	// D1 per-plan regression: the gate honors EACH plan's maxResolvesMonth at the
	// boundary, including allowances (org 150k / coalition 500k) far above the old
	// 16k ledger-scan cap. The count is mocked (counter-backed in production), so
	// this asserts the gate arithmetic — not 150k real rows — across every plan.
	for (const slug of ['starter', 'organization', 'coalition'] as const) {
		const allowance = PLANS[slug].maxResolvesMonth;

		it(`(f-${slug}) at allowance-1 (${allowance - 1}) → 200 + meters; at allowance (${allowance}) → 402, no resolve, no meter`, async () => {
			// Just under the per-plan allowance → resolves and meters exactly once.
			vi.clearAllMocks();
			setupDefaults(slug);
			mockServerQuery.mockResolvedValue({ resolve_address: allowance - 1 });

			let res = await resolveAddressHandler({ request: makeRequest() } as any);
			expect(res.status).toBe(200);
			expect(mockResolveAddress).toHaveBeenCalledTimes(1);
			expect(mockServerMutation).toHaveBeenCalledTimes(1);

			// Exactly at the per-plan allowance → 402, gate fires before the resolver.
			vi.clearAllMocks();
			setupDefaults(slug);
			mockServerQuery.mockResolvedValue({ resolve_address: allowance });

			res = await resolveAddressHandler({ request: makeRequest() } as any);
			const body = await res.json();
			expect(res.status).toBe(402);
			expect(body.error.code).toBe('RESOLVE_QUOTA_EXCEEDED');
			expect(body.data).toBeNull();
			expect(mockResolveAddress).not.toHaveBeenCalled();
			expect(mockServerMutation).not.toHaveBeenCalled();
		});
	}
});
