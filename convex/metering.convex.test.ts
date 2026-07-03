/// <reference types="vite/client" />
/**
 * Usage metering ledger tests — the REAL `convex/metering.ts` handlers
 * executing under `convex-test` (no mock-ledger mirror).
 *
 * Covers all five surfaces against the real schema-backed tables:
 *   (a) `recordUsage` (public mutation): requestId idempotency asserted on
 *       BOTH real tables — one `usageRecords` row AND an un-inflated
 *       `usagePeriodTotals` counter (the same-transaction invariant);
 *   (b) `getUsageForPeriod` (public query): secret gate via the REAL
 *       `requireInternalSecret`, per-meter counter-backed totals, period
 *       scoping, single-meter scoping;
 *   (c) `getUnreportedUsage` (internalQuery): unreported-only selection,
 *       DRAIN_BATCH bound, org `stripeCustomerId` enrichment and the
 *       `requireStripeCustomer` billable-only filter;
 *   (d) `markReported` (internalMutation): terminal stamp + idempotent
 *       re-stamp;
 *   (e) `drainUsageToProvider` (internalAction) on the Noop branch:
 *       deterministic `noop:<requestId>` event ids, second drain is a no-op.
 *
 * The drain stays on the Noop provider (BILLING_PROVIDER stubbed non-stripe)
 * so no fetch ever leaves the process — MSW's onUnhandledRequest:'error'
 * stays quiet. The Stripe-side correlation (real StripeBillingAdapter +
 * report-usage endpoint) lives in tests/unit/billing/drain-hardening.test.ts,
 * out of convex-test's reach.
 *
 * Basename has >1 dot so the convex CLI push-exclusion applies (same rule as
 * the other convex/*.test.ts files); vitest picks it up via the convex/**
 * include glob.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

// Keep test files out of the function-module map; the _generated .d.ts paths
// remain so convex-test can locate the functions root.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

const SECRET = 'test-internal-secret-0123456789abcdef-pad'; // >= 32 bytes
const PERIOD = 1_700_000_000_000;
const OTHER_PERIOD = 1_702_000_000_000;
// Mirrors DRAIN_BATCH in convex/metering.ts (not exported — a module-private
// constant); the bound assertion below fails if the two ever diverge.
const DRAIN_BATCH = 500;

type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function seedOrg(
	t: Harness,
	over: { slug?: string; stripeCustomerId?: string } = {}
): Promise<Id<'organizations'>> {
	return await t.run(async (ctx) =>
		ctx.db.insert('organizations', {
			name: 'Test Org',
			slug: over.slug ?? 'test-org',
			stripeCustomerId: over.stripeCustomerId,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: PERIOD
		})
	);
}

type RecordArgs = {
	_secret: string;
	orgId: Id<'organizations'>;
	meter: 'resolve_address' | 'resolve_district' | 'resolve_officials';
	quantity: number;
	occurredAt: number;
	requestId: string;
	billingPeriodStart: number;
};

function base(orgId: Id<'organizations'>, over: Partial<RecordArgs> = {}): RecordArgs {
	return {
		_secret: SECRET,
		orgId,
		meter: 'resolve_address',
		quantity: 1,
		occurredAt: PERIOD + 1,
		requestId: 'req-1',
		billingPeriodStart: PERIOD,
		...over
	};
}

describe('metering ledger (real handlers under convex-test)', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		// Too short to satisfy MIN_SECRET_BYTES — the rotation fallback stays off.
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
		// Force the Noop provider: the drain must never fetch out of process.
		vi.stubEnv('BILLING_PROVIDER', 'noop');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	// ── (a) recordUsage ────────────────────────────────────────────────────────

	it('(a) recordUsage is idempotent on requestId — same id, one ledger row, un-inflated counter', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		const args = base(orgId, { requestId: 'dup-req', quantity: 3 });
		const first = await t.mutation(api.metering.recordUsage, args);
		const second = await t.mutation(api.metering.recordUsage, args);
		expect(second).toBe(first);

		// Exactly one ledger row under the idempotency key.
		const rows = await t.run(async (ctx) => ctx.db.query('usageRecords').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].requestId).toBe('dup-req');
		expect(rows[0].quantity).toBe(3);

		// The same-transaction counter was upserted ONCE — the retry did not
		// inflate the period total (the dedup path must never touch the counter).
		const counters = await t.run(async (ctx) => ctx.db.query('usagePeriodTotals').collect());
		expect(counters).toHaveLength(1);
		expect(counters[0]).toMatchObject({
			orgId,
			meter: 'resolve_address',
			billingPeriodStart: PERIOD,
			count: 3
		});
	});

	it('(a) recordUsage rejects a missing/wrong _secret and writes nothing', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		await expect(
			t.mutation(api.metering.recordUsage, base(orgId, { _secret: '' }))
		).rejects.toThrow(/Unauthorized/);
		await expect(
			t.mutation(
				api.metering.recordUsage,
				base(orgId, { _secret: 'wrong-but-long-enough-to-pass-length-check' })
			)
		).rejects.toThrow(/Unauthorized/);

		// Neither table gained a row on the rejected calls.
		expect(await t.run(async (ctx) => ctx.db.query('usageRecords').collect())).toHaveLength(0);
		expect(await t.run(async (ctx) => ctx.db.query('usagePeriodTotals').collect())).toHaveLength(0);
	});

	// ── (b) getUsageForPeriod ──────────────────────────────────────────────────

	it('(b) getUsageForPeriod rejects a missing/wrong _secret', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		await expect(
			t.query(api.metering.getUsageForPeriod, {
				_secret: '',
				orgId,
				billingPeriodStart: PERIOD
			})
		).rejects.toThrow(/Unauthorized/);
		await expect(
			t.query(api.metering.getUsageForPeriod, {
				_secret: 'wrong-but-long-enough-to-pass-length-check',
				orgId,
				billingPeriodStart: PERIOD
			})
		).rejects.toThrow(/Unauthorized/);
	});

	it('(b) getUsageForPeriod returns counter-backed per-meter totals, period-scoped', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'r1', quantity: 2 }));
		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'r2', quantity: 5 }));
		await t.mutation(
			api.metering.recordUsage,
			base(orgId, { requestId: 'r3', meter: 'resolve_district', quantity: 4 })
		);
		await t.mutation(
			api.metering.recordUsage,
			base(orgId, { requestId: 'r4', meter: 'resolve_officials', quantity: 1 })
		);
		// A different billing period must not bleed into PERIOD's totals.
		await t.mutation(
			api.metering.recordUsage,
			base(orgId, {
				requestId: 'r5-old',
				quantity: 999,
				billingPeriodStart: OTHER_PERIOD,
				occurredAt: OTHER_PERIOD + 1
			})
		);

		const all = await t.query(api.metering.getUsageForPeriod, {
			_secret: SECRET,
			orgId,
			billingPeriodStart: PERIOD
		});
		expect(all).toEqual({
			resolve_address: 7,
			resolve_district: 4,
			resolve_officials: 1
		});

		const other = await t.query(api.metering.getUsageForPeriod, {
			_secret: SECRET,
			orgId,
			billingPeriodStart: OTHER_PERIOD
		});
		expect(other).toEqual({ resolve_address: 999 });

		// Single-meter scope returns just that meter's counter.
		const justDistrict = await t.query(api.metering.getUsageForPeriod, {
			_secret: SECRET,
			orgId,
			billingPeriodStart: PERIOD,
			meter: 'resolve_district'
		});
		expect(justDistrict).toEqual({ resolve_district: 4 });
	});

	// ── (c) getUnreportedUsage ─────────────────────────────────────────────────

	it('(c) getUnreportedUsage selects only reportedToProvider-unset rows', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		const id1 = await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'u1' }));
		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'u2' }));

		expect((await t.query(internal.metering.getUnreportedUsage, {})).map((r) => r.requestId)).toEqual(
			['u1', 'u2']
		);

		// Stamp one — it must drop out of the unreported selection.
		await t.mutation(internal.metering.markReported, { id: id1, providerEventId: 'evt_u1' });
		expect((await t.query(internal.metering.getUnreportedUsage, {})).map((r) => r.requestId)).toEqual(
			['u2']
		);
	});

	it('(c) getUnreportedUsage is bounded by DRAIN_BATCH', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		// Seed DRAIN_BATCH+1 unreported rows directly (bypassing recordUsage for
		// speed — the bound under test lives in the internalQuery's take()).
		await t.run(async (ctx) => {
			for (let i = 0; i < DRAIN_BATCH + 1; i++) {
				await ctx.db.insert('usageRecords', {
					orgId,
					meter: 'resolve_address',
					quantity: 1,
					occurredAt: PERIOD + i,
					requestId: `bulk-${i}`,
					billingPeriodStart: PERIOD
				});
			}
		});

		const batch = await t.query(internal.metering.getUnreportedUsage, {});
		expect(batch).toHaveLength(DRAIN_BATCH);
	});

	it('(c) getUnreportedUsage enriches stripeCustomerId per org; requireStripeCustomer drops unbillable rows', async () => {
		const t = newHarness();
		const billable = await seedOrg(t, { slug: 'org-billable', stripeCustomerId: 'cus_main' });
		const unbillable = await seedOrg(t, { slug: 'org-no-cust' });

		await t.mutation(api.metering.recordUsage, base(billable, { requestId: 's1' }));
		await t.mutation(api.metering.recordUsage, base(billable, { requestId: 's2' })); // same org → shared customer
		await t.mutation(api.metering.recordUsage, base(unbillable, { requestId: 's3' }));

		// Flag absent: every row returned, enriched (unbillable → undefined).
		const all = await t.query(internal.metering.getUnreportedUsage, {});
		expect(all.map((r) => [r.requestId, r.stripeCustomerId])).toEqual([
			['s1', 'cus_main'],
			['s2', 'cus_main'],
			['s3', undefined]
		]);

		// requireStripeCustomer (the Stripe drain): unbillable rows are off the
		// batch — they stay unreported by design, never a fabricated customer.
		const billableOnly = await t.query(internal.metering.getUnreportedUsage, {
			requireStripeCustomer: true
		});
		expect(billableOnly.map((r) => r.requestId)).toEqual(['s1', 's2']);
		expect(billableOnly.every((r) => r.stripeCustomerId === 'cus_main')).toBe(true);
	});

	// ── (d) markReported ───────────────────────────────────────────────────────

	it('(d) markReported stamps the terminal state and is idempotent on re-stamp', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);
		const id = await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'm1' }));

		await t.mutation(internal.metering.markReported, { id, providerEventId: 'evt_m1' });
		const stamped = await t.run(async (ctx) => ctx.db.get(id));
		expect(stamped?.reportedToProvider).toBe(true);
		expect(stamped?.providerEventId).toBe('evt_m1');

		// Re-stamp (retried action) writes the same terminal state — a no-op.
		await t.mutation(internal.metering.markReported, { id, providerEventId: 'evt_m1' });
		const restamped = await t.run(async (ctx) => ctx.db.get(id));
		expect(restamped?.reportedToProvider).toBe(true);
		expect(restamped?.providerEventId).toBe('evt_m1');
	});

	// ── (e) drainUsageToProvider (Noop branch) ─────────────────────────────────

	it('(e) drain under Noop stamps every row noop:<requestId>; a second drain reports 0', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'd1' }));
		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'd2' }));

		const first = await t.action(internal.metering.drainUsageToProvider, { _secret: SECRET });
		expect(first).toEqual({ provider: 'noop', reported: 2 });

		// Every row carries the deterministic Noop event id and the terminal flag.
		const rows = await t.run(async (ctx) => ctx.db.query('usageRecords').collect());
		for (const requestId of ['d1', 'd2']) {
			const row = rows.find((r) => r.requestId === requestId);
			expect(row?.reportedToProvider).toBe(true);
			expect(row?.providerEventId).toBe(`noop:${requestId}`);
		}

		// Second drain selects zero rows — the stamps are terminal.
		const second = await t.action(internal.metering.drainUsageToProvider, { _secret: SECRET });
		expect(second).toEqual({ provider: 'noop', reported: 0 });
	});

	it('(e) drain rejects a missing/wrong _secret and stamps nothing', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);
		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'g1' }));

		await expect(
			t.action(internal.metering.drainUsageToProvider, { _secret: '' })
		).rejects.toThrow(/Unauthorized/);

		const rows = await t.run(async (ctx) => ctx.db.query('usageRecords').collect());
		expect(rows.every((r) => r.reportedToProvider === undefined)).toBe(true);
	});

	it('(e) a row recorded after a drain is picked up by the next drain only', async () => {
		const t = newHarness();
		const orgId = await seedOrg(t);

		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'before' }));
		expect(
			await t.action(internal.metering.drainUsageToProvider, { _secret: SECRET })
		).toEqual({ provider: 'noop', reported: 1 });

		await t.mutation(api.metering.recordUsage, base(orgId, { requestId: 'after' }));
		expect(
			(await t.query(internal.metering.getUnreportedUsage, {})).map((r) => r.requestId)
		).toEqual(['after']);

		expect(
			await t.action(internal.metering.drainUsageToProvider, { _secret: SECRET })
		).toEqual({ provider: 'noop', reported: 1 });
		const after = await t.run(async (ctx) =>
			ctx.db
				.query('usageRecords')
				.withIndex('by_requestId', (q) => q.eq('requestId', 'after'))
				.first()
		);
		expect(after?.providerEventId).toBe('noop:after');
	});
});
