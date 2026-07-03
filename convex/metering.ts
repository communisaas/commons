/**
 * Usage metering ledger — the billing-internal source of truth for metered
 * resolver usage (address / district / officials lookups).
 *
 * Two functions:
 *   - `recordUsage`   (mutation) appends one durable, idempotent ledger row AND
 *     upserts an O(1) per-(org, meter, period) running counter in the same
 *     transaction (`usagePeriodTotals`), so the two can never diverge.
 *   - `getUsageForPeriod` (query) returns the per-meter period total via a single
 *     counter read per meter — O(1), never a ledger scan. (The resolve
 *     allowances reach 500,000/period, far above Convex's 32,000-doc scan limit,
 *     so counting by `take(allowance+1)` is impossible; the counter is the gate.)
 *
 * The own ledger is authoritative; reporting rows to an external usage/billing
 * provider is a swappable downstream concern keyed off `reportedToProvider`.
 *
 * Secret gate: `recordUsage` is a public mutation reachable from trusted
 * SvelteKit server code only — it reuses `requireInternalSecret` (the same
 * SvelteKit→Convex boundary guard the rest of the public surface uses), so the
 * constant-time / dual-secret-rotation logic is never duplicated here.
 */

import { mutation, query, internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireInternalSecret } from './_internalAuth';

declare const process: { env: Record<string, string | undefined> };

// The set of metered resolver operations. Mirrors the `meter` union defined on
// the `usageRecords` table in schema.ts (the schema owns it; this is the
// read-side mirror used for arg validation and the meterless period scan).
const meterValidator = v.union(
	v.literal('resolve_address'),
	// LATENT (2026-07-03): zero writers today — meter slots for future district/officials endpoints
	v.literal('resolve_district'),
	v.literal('resolve_officials')
);

const METERS = ['resolve_address', 'resolve_district', 'resolve_officials'] as const;
type Meter = (typeof METERS)[number];

/**
 * Append one usage ledger row AND maintain the O(1) period counter.
 *
 * Idempotent on `requestId`: a retry or double-fire with the same `requestId`
 * is a no-op that returns the id of the already-recorded row, so a delivery
 * never double-bills. The insert is awaited (durable) — this is deliberately
 * NOT fire-and-forget like `trackApiKeyUsage`; the ledger is the billing source
 * of truth, so the function reports success only after the write resolves.
 *
 * The `usagePeriodTotals` counter is upserted ONLY in the new-insert branch
 * (after the `by_requestId` dedup early-return), in the SAME mutation
 * transaction as the ledger insert — so a duplicate `requestId` never
 * double-counts, and the counter can never diverge from the ledger.
 */
export const recordUsage = mutation({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		keyId: v.optional(v.id('apiKeys')),
		meter: meterValidator,
		quantity: v.number(),
		occurredAt: v.number(),
		requestId: v.string(),
		billingPeriodStart: v.number()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);

		const existing = await ctx.db
			.query('usageRecords')
			.withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
			.first();
		if (existing) {
			// Already recorded under this idempotency key — no second insert, and
			// (critically) no counter increment: the dedup path must not touch the
			// counter, or a retry would inflate the period total.
			return existing._id;
		}

		const id = await ctx.db.insert('usageRecords', {
			orgId: args.orgId,
			// LATENT (2026-07-03): keyId is written but never read — reserved per-API-key usage attribution; no reader exists yet
			keyId: args.keyId,
			meter: args.meter,
			quantity: args.quantity,
			occurredAt: args.occurredAt,
			requestId: args.requestId,
			billingPeriodStart: args.billingPeriodStart
		});

		// Upsert the O(1) period counter in THIS transaction (ledger + counter
		// commit atomically — they cannot diverge). A fresh (org, meter, period)
		// starts at `quantity`; an existing one is patched by `+quantity`.
		const counter = await ctx.db
			.query('usagePeriodTotals')
			.withIndex('by_orgId_meter_period', (q) =>
				q
					.eq('orgId', args.orgId)
					.eq('meter', args.meter)
					.eq('billingPeriodStart', args.billingPeriodStart)
			)
			.first();
		if (counter) {
			await ctx.db.patch(counter._id, { count: counter.count + args.quantity });
		} else {
			await ctx.db.insert('usagePeriodTotals', {
				orgId: args.orgId,
				meter: args.meter,
				billingPeriodStart: args.billingPeriodStart,
				count: args.quantity
			});
		}

		return id;
	}
});

/**
 * Return the recorded quantity total per meter for an org within a single
 * billing period — the read the substrate-sale quota gate calls.
 *
 * Each meter's total is a SINGLE counter read from `usagePeriodTotals` (kept in
 * lockstep with the ledger by `recordUsage`), so the gate is O(1) regardless of
 * how many ledger rows the period holds. This is what lets the gate enforce the
 * full per-plan allowance (Starter 25k / Org 150k / Coalition 500k) without ever
 * approaching Convex's 32,000-doc scan limit — a `take(allowance+1)` ledger
 * count would throw at those allowances.
 *
 * When `meter` is supplied, reads just that counter; when omitted, reads one
 * counter per known meter literal. Returns a `Record<meter, total>` covering
 * only meters with a recorded counter (absent ⇒ the gate reads it as 0).
 *
 * Secret-gated like `recordUsage`: this is a public query reachable from
 * trusted SvelteKit server code only — per-org usage totals are billing
 * internals, not a browser surface.
 */
export const getUsageForPeriod = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		billingPeriodStart: v.number(),
		meter: v.optional(meterValidator)
	},
	handler: async (ctx, args): Promise<Record<string, number>> => {
		requireInternalSecret(args._secret);

		const targets: readonly Meter[] = args.meter ? [args.meter] : METERS;
		const totals: Record<string, number> = {};

		for (const meter of targets) {
			const counter = await ctx.db
				.query('usagePeriodTotals')
				.withIndex('by_orgId_meter_period', (q) =>
					q
						.eq('orgId', args.orgId)
						.eq('meter', meter)
						.eq('billingPeriodStart', args.billingPeriodStart)
				)
				.first();
			if (counter) totals[meter] = counter.count;
		}

		return totals;
	}
});

// ---------------------------------------------------------------------------
// Provider drain — the ONLY provider touchpoint, decoupled from the request
// path. The ledger above is authoritative; this stamps already-recorded rows
// with the provider's event id once reported. Swapping BILLING_PROVIDER changes
// nothing about the ledger write — only what this drain does downstream.
// ---------------------------------------------------------------------------

// Per-tick bound on the unreported scan. Keeps each drain action bounded; the
// 15-min cadence drains the backlog over successive ticks. Never `.collect()`.
const DRAIN_BATCH = 500;

/**
 * Select unreported ledger rows: those whose `reportedToProvider` is still
 * unset (never `false` — the field is set to `true` exactly once, on report).
 * Scans the `by_reportedToProvider` index at `undefined`, bounded by
 * `DRAIN_BATCH`. Internal: reachable only from the drain action, not the
 * public HTTP surface.
 *
 * Each row is enriched with its org's `stripeCustomerId` (the Stripe drain
 * meters against the customer, not the raw orgId). Repeated orgIds are deduped
 * through a Map so a batch of rows sharing one org costs at most one extra
 * `ctx.db.get` per distinct org — the row set is already bounded to
 * `DRAIN_BATCH`, so the org reads are too.
 *
 * `requireStripeCustomer` (set by the drain only when the provider is Stripe)
 * drops rows whose org has no `stripeCustomerId`: they are unbillable, so by
 * design they stay unreported — honest, never a fabricated customer — and off
 * the batch, letting billable rows report instead of poisoning the pass.
 * Residual: unbillable rows keep occupying the head of the
 * `by_reportedToProvider` index; if 500+ consecutive unbillable rows ever fill
 * a batch, billable rows behind them wait until those orgs gain a customer id.
 * Acceptable pre-launch — no schema change.
 */
export const getUnreportedUsage = internalQuery({
	args: {
		requireStripeCustomer: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query('usageRecords')
			.withIndex('by_reportedToProvider', (q) => q.eq('reportedToProvider', undefined))
			.take(DRAIN_BATCH);

		const stripeCustomerByOrg = new Map<string, string | undefined>();
		for (const r of rows) {
			if (!stripeCustomerByOrg.has(r.orgId)) {
				const org = await ctx.db.get(r.orgId);
				stripeCustomerByOrg.set(r.orgId, org?.stripeCustomerId);
			}
		}

		const enriched = rows.map((r) => ({
			...r,
			stripeCustomerId: stripeCustomerByOrg.get(r.orgId)
		}));

		if (args.requireStripeCustomer) {
			return enriched.filter((r) => !!r.stripeCustomerId);
		}
		return enriched;
	}
});

/**
 * Stamp a single ledger row as reported with its provider event id. Idempotent:
 * re-stamping an already-reported row writes the same terminal state, so a
 * re-run (or a retried action) is a no-op — never a double report. Internal.
 */
export const markReported = internalMutation({
	args: {
		id: v.id('usageRecords'),
		providerEventId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.id, {
			reportedToProvider: true,
			providerEventId: args.providerEventId
		});
	}
});

/**
 * Drain unreported usage rows to the configured billing provider.
 *
 * Provider is selected INLINE from `process.env.BILLING_PROVIDER` — Convex code
 * must not import `src/lib/server/billing/providers` (the runtime/tsconfig
 * boundary forbids cross-importing app code). Under the default Noop provider
 * the report is a truthful no-op: each row gets a deterministic
 * `noop:<requestId>` event id and is marked reported, so a second pass selects
 * zero rows.
 *
 * Under `BILLING_PROVIDER='stripe'` the action delegates to the SvelteKit
 * internal endpoint (`/api/internal/billing/report-usage`), which owns the
 * Stripe SDK behind the `INTERNAL_API_SECRET` boundary. Only rows the endpoint
 * confirms (correlated by requestId) are stamped reported; a non-2xx or network
 * failure marks ZERO rows, leaving them unreported for the next tick. Stripe's
 * meter-event identifier (the requestId) makes that retry safe — no double-bill.
 *
 * Secret-gated like the rest of the SvelteKit→Convex internal surface.
 */
export const drainUsageToProvider = internalAction({
	args: {
		_secret: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);

		// Stripe drains skip rows with no stripeCustomerId (unbillable — they stay
		// unreported by design); the Noop path takes every row, unchanged.
		const rows = await ctx.runQuery(internal.metering.getUnreportedUsage, {
			requireStripeCustomer: providerName() === 'stripe'
		});
		if (rows.length === 0) {
			return { provider: providerName(), reported: 0 };
		}

		// Stripe: delegate reporting to the SvelteKit internal endpoint (Convex
		// can't import $lib or run the Stripe SDK here). Failure stamps nothing.
		if (providerName() === 'stripe') {
			const baseUrl = process.env.PUBLIC_BASE_URL || 'https://commons.email';
			const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
			const records = rows.map((r) => ({
				orgId: r.orgId,
				meter: r.meter,
				quantity: r.quantity,
				occurredAt: r.occurredAt,
				requestId: r.requestId,
				stripeCustomerId: r.stripeCustomerId
			}));

			let reportedResults: { requestId: string; providerEventId: string }[];
			try {
				const res = await fetch(`${baseUrl}/api/internal/billing/report-usage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-internal-secret': internalSecret
					},
					body: JSON.stringify(records),
					signal: AbortSignal.timeout(30_000)
				});
				if (!res.ok) {
					// Non-2xx: leave every row unreported — the next tick retries.
					console.error(`[metering] stripe report-usage failed: HTTP ${res.status}`);
					return { provider: 'stripe', reported: 0 };
				}
				reportedResults = (await res.json()) as {
					requestId: string;
					providerEventId: string;
				}[];
			} catch (err) {
				// Network/throw: leave every row unreported — the next tick retries.
				console.error(
					'[metering] stripe report-usage fetch failed:',
					err instanceof Error ? err.message : String(err)
				);
				return { provider: 'stripe', reported: 0 };
			}

			// Stamp only rows the endpoint confirmed, correlated by requestId.
			const idByRequestIdStripe = new Map(rows.map((r) => [r.requestId, r._id]));
			let reported = 0;
			for (const { requestId, providerEventId } of reportedResults) {
				const id = idByRequestIdStripe.get(requestId);
				if (!id) continue;
				// Fail-closed under-bill guard: a `noop:`-prefixed event id means the
				// SvelteKit endpoint's getBillingProvider() fell back to Noop (desynced
				// config — provider here is 'stripe' but the endpoint isn't). Nothing
				// reached Stripe, so DON'T stamp the row reported — leave it
				// re-drainable for a correctly configured tick.
				if (providerEventId.startsWith('noop:')) {
					console.warn(
						`[metering] stripe drain received noop-prefixed event id for ${requestId}; ` +
							'leaving row unreported (report-usage endpoint provider is desynced)'
					);
					continue;
				}
				await ctx.runMutation(internal.metering.markReported, { id, providerEventId });
				reported++;
			}
			return { provider: 'stripe', reported };
		}

		const results = reportUsageInline(
			rows.map((r) => ({
				orgId: r.orgId,
				meter: r.meter,
				quantity: r.quantity,
				occurredAt: r.occurredAt,
				requestId: r.requestId
			}))
		);

		// Correlate each provider event id back to its ledger row by requestId.
		const idByRequestId = new Map(rows.map((r) => [r.requestId, r._id]));
		for (const { requestId, providerEventId } of results) {
			const id = idByRequestId.get(requestId);
			if (!id) continue;
			await ctx.runMutation(internal.metering.markReported, { id, providerEventId });
		}

		return { provider: providerName(), reported: results.length };
	}
});

// --- Inline provider selection (no src/lib import) --------------------------

function providerName(): string {
	return process.env.BILLING_PROVIDER === 'stripe' ? 'stripe' : 'noop';
}

/**
 * Inline mirror of `BillingProvider.reportUsage` for the only provider Convex
 * can serve without importing app code or reaching the network: Noop, the
 * vendor-neutral default. It returns a deterministic `noop:<requestId>` event
 * id (matching `NoopBillingAdapter`). Stripe is NOT handled here — that branch
 * of `drainUsageToProvider` POSTs to the SvelteKit internal endpoint, which
 * owns the Stripe SDK. The ledger above remains the source of truth either way.
 */
function reportUsageInline(
	records: { orgId: string; meter: string; quantity: number; occurredAt: number; requestId: string }[]
): { requestId: string; providerEventId: string }[] {
	// Default (and P0): truthful Noop — externalizes nothing.
	return records.map((r) => ({
		requestId: r.requestId,
		providerEventId: `noop:${r.requestId}`
	}));
}
