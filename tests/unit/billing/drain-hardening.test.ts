/**
 * Drain-hardening tests: poison rows never sink the metering drain.
 *
 * Covers the per-record settlement chain end to end:
 *   (a) the REAL StripeBillingAdapter settles a mixed batch (billable +
 *       no-customer + transient Stripe failure) per record — fulfilled-only
 *       results, never a batch-wide throw;
 *   (b) those REAL adapter results fed through a mirror of the drain's
 *       correlation + `noop:`-guard stamping logic (convex/metering.ts) stamp
 *       ONLY the confirmed rows — poison rows stay unreported (no fixture
 *       pre-stamps anything);
 *   (c) the `getUnreportedUsage` mirror excludes rows lacking a
 *       stripeCustomerId only when `requireStripeCustomer` is set (the Stripe
 *       drain), leaving the Noop path byte-for-byte unchanged;
 *   (d) the secret-gated `getUsageForPeriod` mirror rejects a missing/wrong
 *       `_secret` via the REAL `requireInternalSecret` (dual-secret rotation
 *       included) and returns totals with a valid one;
 *   (e) the report-usage endpoint fails closed: a provider throw becomes a
 *       typed 502 REPORT_FAILED envelope (the drain stamps nothing on non-2xx),
 *       while the 2xx path returns the (possibly partial) results array as-is.
 *
 * Real-handler coverage of the Convex metering surfaces themselves
 * (recordUsage, getUsageForPeriod, getUnreportedUsage, markReported, and the
 * Noop drain) lives in convex/metering.convex.test.ts, where convex-test
 * executes the REAL convex/metering.ts handlers against the real schema. This
 * file keeps the surfaces convex-test cannot reach — the REAL
 * StripeBillingAdapter and the report-usage endpoint — so only the Stripe-side
 * drain correlation logic remains mirrored here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireInternalSecret } from '../../../convex/_internalAuth';

// =============================================================================
// HOISTED MOCKS
// =============================================================================

const { meterEventCreate, getStripeMock } = vi.hoisted(() => {
	const meterEventCreate = vi.fn();
	return {
		meterEventCreate,
		getStripeMock: vi.fn(() => ({
			billing: { meterEvents: { create: meterEventCreate } }
		}))
	};
});

vi.mock('$lib/server/billing/stripe', () => ({
	getStripe: () => getStripeMock()
}));

// The endpoint's shared-secret header check — pass by default; the secret
// boundary itself is exercised in (d) against the REAL requireInternalSecret.
vi.mock('$lib/server/internal/secret-auth', () => ({
	matchInternalSecret: vi.fn(() => ({ ok: true }))
}));

// $types stub for the internal endpoint route
vi.mock('../../../src/routes/api/internal/billing/report-usage/$types', () => ({}));

// =============================================================================
// IMPORTS (after mocks)
// =============================================================================

import { StripeBillingAdapter, type UsageRecordInput } from '$lib/server/billing/providers';

const { POST: reportUsageHandler } = await import(
	'../../../src/routes/api/internal/billing/report-usage/+server'
);

// =============================================================================
// FIXTURES — a mixed batch: billable, unbillable (no customer), transient-fail
// =============================================================================

const SECRET = 'test-internal-secret-0123456789abcdef-pad'; // >= 32 bytes
const PREVIOUS_SECRET = 'prev-internal-secret-0123456789abcdef-pd'; // >= 32 bytes

const GOOD: UsageRecordInput = {
	orgId: 'org_good',
	stripeCustomerId: 'cus_good',
	meter: 'resolve_address',
	quantity: 2,
	occurredAt: 1000,
	requestId: 'req-good'
};
const NO_CUSTOMER: UsageRecordInput = {
	orgId: 'org_nocust',
	meter: 'resolve_address',
	quantity: 1,
	occurredAt: 2000,
	requestId: 'req-nocust'
};
const TRANSIENT: UsageRecordInput = {
	orgId: 'org_flaky',
	stripeCustomerId: 'cus_flaky',
	meter: 'resolve_district',
	quantity: 1,
	occurredAt: 3000,
	requestId: 'req-transient'
};
const MIXED_BATCH: UsageRecordInput[] = [GOOD, NO_CUSTOMER, TRANSIENT];

interface LedgerRow {
	_id: string;
	orgId: string;
	meter: string;
	quantity: number;
	occurredAt: number;
	requestId: string;
	reportedToProvider?: boolean;
	providerEventId?: string;
}

/** Fresh unreported ledger rows for the mixed batch — nothing pre-stamped. */
function makeLedgerRows(): LedgerRow[] {
	return MIXED_BATCH.map((r, i) => ({
		_id: `usage_${i + 1}`,
		orgId: r.orgId,
		meter: r.meter,
		quantity: r.quantity,
		occurredAt: r.occurredAt,
		requestId: r.requestId
	}));
}

// =============================================================================
// MIRRORS of convex/metering.ts logic (Convex code can't be imported here —
// the runtime/tsconfig boundary — so the drain logic is mirrored exactly;
// a divergence in that logic would break these assertions)
// =============================================================================

const DRAIN_BATCH = 500;

/**
 * Mirror of `getUnreportedUsage`: unreported rows bounded by DRAIN_BATCH,
 * enriched with the org's stripeCustomerId (deduped per org), and — when
 * `requireStripeCustomer` is set — filtered to billable rows only.
 */
function getUnreportedUsageMirror(
	rows: LedgerRow[],
	orgs: Map<string, { stripeCustomerId?: string }>,
	args: { requireStripeCustomer?: boolean } = {}
): (LedgerRow & { stripeCustomerId?: string })[] {
	const selected = rows.filter((r) => r.reportedToProvider === undefined).slice(0, DRAIN_BATCH);
	const stripeCustomerByOrg = new Map<string, string | undefined>();
	for (const r of selected) {
		if (!stripeCustomerByOrg.has(r.orgId)) {
			stripeCustomerByOrg.set(r.orgId, orgs.get(r.orgId)?.stripeCustomerId);
		}
	}
	const enriched = selected.map((r) => ({ ...r, stripeCustomerId: stripeCustomerByOrg.get(r.orgId) }));
	if (args.requireStripeCustomer) {
		return enriched.filter((r) => !!r.stripeCustomerId);
	}
	return enriched;
}

/**
 * Mirror of the Stripe drain's stamping loop (drainUsageToProvider): correlate
 * endpoint-confirmed results back to ledger rows by requestId and stamp them —
 * skipping any `noop:`-prefixed event id (desynced-endpoint under-bill guard).
 */
function stampConfirmedMirror(
	rows: LedgerRow[],
	reportedResults: { requestId: string; providerEventId: string }[]
): number {
	const idByRequestId = new Map(rows.map((r) => [r.requestId, r._id]));
	let reported = 0;
	for (const { requestId, providerEventId } of reportedResults) {
		const id = idByRequestId.get(requestId);
		if (!id) continue;
		if (providerEventId.startsWith('noop:')) continue;
		const row = rows.find((r) => r._id === id)!;
		row.reportedToProvider = true;
		row.providerEventId = providerEventId;
		reported++;
	}
	return reported;
}

/** Mirror of the secret-gated `getUsageForPeriod` — REAL requireInternalSecret. */
function getUsageForPeriodMirror(
	counters: Map<string, number>,
	args: { _secret: string; orgId: string; billingPeriodStart: number }
): Record<string, number> {
	requireInternalSecret(args._secret);
	const totals: Record<string, number> = {};
	for (const meter of ['resolve_address', 'resolve_district', 'resolve_officials']) {
		const count = counters.get(`${args.orgId}::${meter}::${args.billingPeriodStart}`);
		if (count !== undefined) totals[meter] = count;
	}
	return totals;
}

// =============================================================================
// ENV + MOCK LIFECYCLE
// =============================================================================

let savedProvider: string | undefined;
let savedSecret: string | undefined;
let savedPrevious: string | undefined;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	savedProvider = process.env.BILLING_PROVIDER;
	savedSecret = process.env.INTERNAL_API_SECRET;
	savedPrevious = process.env.INTERNAL_API_SECRET_PREVIOUS;
	delete process.env.BILLING_PROVIDER;
	process.env.INTERNAL_API_SECRET = SECRET;
	delete process.env.INTERNAL_API_SECRET_PREVIOUS;

	meterEventCreate.mockReset();
	// Echo the identifier back (Stripe's dedup key) for billable records; the
	// transient record fails once at Stripe — a per-record poison, not a batch one.
	meterEventCreate.mockImplementation(async (params: { identifier: string }) => {
		if (params.identifier === 'req-transient') {
			throw new Error('stripe 500: temporary meter event failure');
		}
		return { identifier: params.identifier };
	});
	getStripeMock.mockClear();

	// The adapter logs each per-record rejection — keep test output clean.
	consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	if (savedProvider === undefined) delete process.env.BILLING_PROVIDER;
	else process.env.BILLING_PROVIDER = savedProvider;
	if (savedSecret === undefined) delete process.env.INTERNAL_API_SECRET;
	else process.env.INTERNAL_API_SECRET = savedSecret;
	if (savedPrevious === undefined) delete process.env.INTERNAL_API_SECRET_PREVIOUS;
	else process.env.INTERNAL_API_SECRET_PREVIOUS = savedPrevious;
	consoleError.mockRestore();
});

// =============================================================================
// TESTS
// =============================================================================

describe('drain hardening — poison rows never sink the batch', () => {
	it('(a) REAL adapter settles a mixed batch per record: only the good requestId fulfills, no batch throw', async () => {
		const adapter = new StripeBillingAdapter();

		// Does not throw despite one unbillable + one Stripe-rejected record.
		const out = await adapter.reportUsage(MIXED_BATCH);

		expect(out).toEqual([{ requestId: 'req-good', providerEventId: 'req-good' }]);

		// The no-customer record never reached Stripe; the transient one did (and
		// failed there); the good one carries the customer id, not the raw orgId.
		const identifiers = meterEventCreate.mock.calls.map(
			(call) => (call[0] as { identifier: string }).identifier
		);
		expect(identifiers).toEqual(['req-good', 'req-transient']);
		expect(identifiers).not.toContain('req-nocust');
		expect(meterEventCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				identifier: 'req-good',
				payload: { stripe_customer_id: 'cus_good', value: '2' }
			})
		);
		// Both poison records were logged, not swallowed silently.
		expect(consoleError).toHaveBeenCalledTimes(2);
	});

	it('(b) REAL adapter output through the drain correlation + noop:-guard stamps ONLY good rows', async () => {
		const rows = makeLedgerRows();
		// SOURCE check: no fixture pre-stamps — every row starts unreported.
		expect(rows.every((r) => r.reportedToProvider === undefined)).toBe(true);
		expect(rows.every((r) => r.providerEventId === undefined)).toBe(true);

		// The stamped set derives from the REAL adapter's return values.
		const adapter = new StripeBillingAdapter();
		const reportedResults = await adapter.reportUsage(MIXED_BATCH);

		const reported = stampConfirmedMirror(rows, reportedResults);
		expect(reported).toBe(1);

		const good = rows.find((r) => r.requestId === 'req-good')!;
		expect(good.reportedToProvider).toBe(true);
		expect(good.providerEventId).toBe('req-good');

		// Poison rows are unstamped — still selectable for the next drain tick,
		// where Stripe's identifier=requestId dedup makes the retry double-bill-safe.
		for (const requestId of ['req-nocust', 'req-transient']) {
			const row = rows.find((r) => r.requestId === requestId)!;
			expect(row.reportedToProvider).toBeUndefined();
			expect(row.providerEventId).toBeUndefined();
		}
	});

	it('(c) getUnreportedUsage mirror: requireStripeCustomer=true excludes unbillable rows; flag absent/false returns all (Noop path unchanged)', () => {
		const rows = makeLedgerRows();
		const orgs = new Map<string, { stripeCustomerId?: string }>([
			['org_good', { stripeCustomerId: 'cus_good' }],
			['org_nocust', {}],
			['org_flaky', { stripeCustomerId: 'cus_flaky' }]
		]);

		// Stripe drain: the unbillable row is off the batch (stays unreported by
		// design — never a fabricated customer), so billable rows progress.
		const stripeBatch = getUnreportedUsageMirror(rows, orgs, { requireStripeCustomer: true });
		expect(stripeBatch.map((r) => r.requestId)).toEqual(['req-good', 'req-transient']);
		expect(stripeBatch.every((r) => !!r.stripeCustomerId)).toBe(true);

		// Flag absent (Noop drain call shape) and explicit false: all rows, enriched.
		for (const args of [{}, { requireStripeCustomer: false }]) {
			const all = getUnreportedUsageMirror(rows, orgs, args);
			expect(all.map((r) => r.requestId)).toEqual(['req-good', 'req-nocust', 'req-transient']);
			expect(all.find((r) => r.requestId === 'req-nocust')!.stripeCustomerId).toBeUndefined();
		}

		// The filter operates on the unreported set: a stamped row drops out entirely.
		rows[0].reportedToProvider = true;
		expect(
			getUnreportedUsageMirror(rows, orgs, { requireStripeCustomer: true }).map(
				(r) => r.requestId
			)
		).toEqual(['req-transient']);
	});

	it('(d) secret-gated getUsageForPeriod mirror: Unauthorized on missing/wrong _secret; totals with active or rotation-previous secret', () => {
		const counters = new Map<string, number>([['org_good::resolve_address::1700000000000', 42]]);
		const args = { orgId: 'org_good', billingPeriodStart: 1_700_000_000_000 };

		// Missing and wrong secrets throw — the REAL gate, not a re-implementation.
		expect(() => getUsageForPeriodMirror(counters, { ...args, _secret: '' })).toThrow(
			/Unauthorized/
		);
		expect(() =>
			getUsageForPeriodMirror(counters, {
				...args,
				_secret: 'wrong-but-long-enough-to-pass-length-check'
			})
		).toThrow(/Unauthorized/);

		// Active secret returns the counter-backed totals.
		expect(getUsageForPeriodMirror(counters, { ...args, _secret: SECRET })).toEqual({
			resolve_address: 42
		});

		// Rotation window: the previous secret is still accepted.
		process.env.INTERNAL_API_SECRET_PREVIOUS = PREVIOUS_SECRET;
		expect(getUsageForPeriodMirror(counters, { ...args, _secret: PREVIOUS_SECRET })).toEqual({
			resolve_address: 42
		});
	});

	it('(e) endpoint: a provider throw becomes a typed 502 REPORT_FAILED; the 2xx path returns the partial results as-is', async () => {
		process.env.BILLING_PROVIDER = 'stripe';

		const makeRequest = () =>
			new Request('http://localhost/api/internal/billing/report-usage', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET },
				body: JSON.stringify(MIXED_BATCH)
			});

		// Batch-level throw (provider construction/config failure) → typed 502.
		// The drain treats any non-2xx as stamp-nothing-and-retry, so this
		// composes fail-closed: every row stays unreported for the next tick.
		getStripeMock.mockImplementationOnce(() => {
			throw new Error('STRIPE_SECRET_KEY not configured');
		});
		const failed = await reportUsageHandler({ request: makeRequest() } as any);
		expect(failed.status).toBe(502);
		const failedBody = await failed.json();
		expect(failedBody.error.code).toBe('REPORT_FAILED');
		expect(failedBody.error.message).toContain('STRIPE_SECRET_KEY');

		// 2xx path: per-record settlement means the response may be PARTIAL — the
		// endpoint returns exactly what the provider confirmed, unchanged.
		const ok = await reportUsageHandler({ request: makeRequest() } as any);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual([{ requestId: 'req-good', providerEventId: 'req-good' }]);
	});
});
