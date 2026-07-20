/**
 * POST /api/v1/resolve-address — Keyed, plan-gated address resolution.
 *
 * Sells the Shadow Atlas resolution substrate: geocode → district → officials,
 * with two independent freshness clocks (boundary geometry vs. officials sync).
 *
 * This is the org/data plane. It NEVER mints or returns a person-layer HMAC
 * verify token — coordinate-binding tokens belong to the authenticated person
 * flow, not the keyed substrate sale.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { resolveAddress, AtlasInfraError } from '$lib/core/shadow-atlas/client';
import { DISTRICT_COVERAGE } from '$lib/core/shadow-atlas/coverage';
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { resolveAllowanceForPlan } from '$lib/server/billing/plans';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RequestHandler } from './$types';

/**
 * Calendar-month (UTC) floor of the current instant — the billing period a
 * metered row lands in for an org with no active subscription. Mirrors the
 * inactive/default branch of `subscriptions.checkPlanLimits` (no subscription
 * lookup here: keep the meter a single awaited write, not a query+write).
 */
function currentCalendarMonthStart(): number {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

const addressSchema = z.object({
	street: z.string().min(1).max(200),
	city: z.string().min(1).max(100),
	state: z.string().length(2),
	// US ZIP only (5 or 5+4). Deliberate divergence from the person layer
	// (src/routes/api/location/resolve-address/+server.ts keeps the Canadian
	// postal branch): the free plane fails soft on an unresolvable address, but
	// this paid plane meters every completed resolution, so it must reject
	// addresses the atlas can never cover BEFORE the billable substrate runs.
	zip: z.string().regex(/^\d{5}(-\d{4})?$/),
	// Enum keeps 'CA' for schema-shape parity with the person layer; a CA value
	// is rejected with a typed 400 UNSUPPORTED_COUNTRY below, never resolved.
	country: z.enum(['US', 'CA']).optional()
});

/**
 * Client-supplied Idempotency-Key charset/length. The effective ledger
 * requestId is `${orgId}:ik:${sha256(key|payload).slice(0,32)}` — org-namespaced
 * (one org can never dedup, un-bill, or collide with another org's rows via the
 * global by_requestId index) AND payload-bound: the same key with a DIFFERENT
 * address is a distinct billable request, so a pinned key can never convert the
 * finite quota into unbounded free resolves. Only a true replay (same key, same
 * payload) deduplicates. The fixed-width composite (~68 chars) stays under
 * Stripe's 100-char meter-event identifier limit (the drain passes requestId
 * verbatim as the identifier).
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,64}$/;

export const POST: RequestHandler = async ({ request }) => {
	requirePublicApi();
	// Fail-closed on an auth-backend outage: a throw here is an infrastructure
	// fault, not a bad key — surface a typed 502, never a raw 500.
	let auth;
	try {
		auth = await authenticateApiKey(request);
	} catch {
		return apiError('AUTH_UNAVAILABLE', 'Authentication backend temporarily unavailable', 502);
	}
	if (auth instanceof Response) return auth;
	// Fail-closed on a rate-limiter outage: a throw here is an infrastructure
	// fault, not an over-limit caller — surface a typed 502, never a raw 500.
	let rateLimit;
	try {
		rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	} catch {
		return apiError('RATE_LIMITER_UNAVAILABLE', 'Rate limiter temporarily unavailable', 502);
	}
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	// Guard body parse + validation together so a malformed body is a 400, not a 500.
	let parsed;
	try {
		parsed = addressSchema.safeParse(await request.json());
	} catch {
		return apiError('INVALID_REQUEST', 'Request body must be valid JSON', 400);
	}
	if (!parsed.success) {
		return apiError('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request', 400);
	}
	// Deliberate divergence from the person layer (src/routes/api/location/
	// resolve-address/+server.ts, which accepts CA): the free plane fails soft
	// on out-of-coverage addresses, but this paid plane must not bill
	// unresolvables — CA is not covered by the atlas, so it is an honest typed
	// 400 BEFORE the billable substrate runs.
	if (parsed.data.country === 'CA') {
		return apiError(
			'UNSUPPORTED_COUNTRY',
			'Only US addresses are resolvable; CA is not covered by the atlas',
			400
		);
	}

	// Optional client idempotency: an org-namespaced Idempotency-Key becomes the
	// ledger requestId, so a same-key retry deduplicates in recordUsage
	// (by_requestId) and bills once. Validated BEFORE any billable work.
	const idempotencyKey = request.headers.get('Idempotency-Key');
	if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
		return apiError(
			'INVALID_REQUEST',
			'Idempotency-Key must be 8-64 characters of [A-Za-z0-9_.:-]',
			400
		);
	}

	// Plan-quota gate — substrate-sale allowance, distinct from the 100/min abuse
	// cap (checkApiPlanRateLimit above, untouched). Read the metering ledger for
	// THIS period and compare against the resolving plan's finite allowance. The
	// SAME `period` is reused for the post-success recordUsage write below, so the
	// read window and the write window are identical (no off-by-one across a
	// month boundary). Over-quota is an honest typed 402 — no resolve, no meter.
	const period = currentCalendarMonthStart();
	// Fail-closed on a metering-ledger outage: if the gate read itself can't run,
	// we can't honestly enforce the allowance, so return a typed 502 rather than
	// silently resolving (and billing) past an unknown count. No resolve, no meter.
	let usage;
	try {
		usage = await serverQuery(api.metering.getUsageForPeriod, {
			_secret: getInternalSecret(),
			orgId: auth.orgId,
			billingPeriodStart: period,
			meter: 'resolve_address'
		});
	} catch {
		return apiError('METERING_UNAVAILABLE', 'Usage metering temporarily unavailable', 502);
	}
	const resolvesUsed = usage['resolve_address'] ?? 0;
	if (resolvesUsed >= resolveAllowanceForPlan(auth.planSlug)) {
		return apiError('RESOLVE_QUOTA_EXCEEDED', 'Resolve quota exhausted for this plan period', 402);
	}

	try {
		const r = await resolveAddress(parsed.data);
		// Outside-coverage (district === null) is an honest empty result, NOT an error.
		// The two freshness clocks are surfaced as DISTINCT keys, never collapsed.
		const data = {
			district: r.district,
			// Additive multi-type view: every populated, served boundary type for the
			// resolved cell (congressional included, same id as `district`). [] on an
			// outside-coverage miss. Billing is UNCHANGED — one resolution is one metered
			// event regardless of how many boundary types return (quantity: 1 below).
			districts: r.districts ?? [],
			// Static machine-readable coverage disclosure: which boundary types this API
			// serves, each with an honest national/partial class, plus which types carry
			// officials rosters (congressional only). Absent type = not served at all.
			coverage: DISTRICT_COVERAGE,
			provenance: r.provenance,
			confidence: r.confidence,
			asOf: {
				boundaryAsOf: r.boundaryAsOf,
				officialsAsOf: r.officialsAsOf
			},
			officials: r.officials?.officials ?? [],
			// Additive: the staleness/redraw guard DEGRADES (lowers confidence +
			// sets a warning) rather than throwing, so a degraded-but-resolved
			// result stays a 200. Surfacing the warning never collapses, fabricates,
			// or borrows either of the two asOf clocks above — it is its own field.
			warning: r.warning ?? null
		};

		// Meter the resolution AFTER it succeeds: this hook is structurally
		// unreachable on every apiError branch below (the throw skips it) and on
		// a malformed-body 400 (returned before the try). An outside-coverage
		// district:null result IS a billable resolution — the substrate ran.
		//
		// AWAITED, not fire-and-forget: a dropped write is unbilled revenue, so
		// the response returns only after the durable ledger row resolves.
		//
		// Idempotency is CLIENT-DRIVEN: a retry WITHOUT an Idempotency-Key gets a
		// fresh requestId and RE-BILLS. The by_requestId dedup in recordUsage
		// applies only to a TRUE REPLAY — same key AND same address payload — which
		// re-executes the resolve (no response caching, bounded by the per-plan
		// rate cap) but bills exactly once. The key is hashed TOGETHER with the
		// normalized payload, so reusing one key across different addresses yields
		// distinct requestIds and each resolution bills: a pinned key cannot mint
		// unmetered volume. The org prefix namespaces the composite in the global
		// by_requestId index.
		// JSON.stringify of the tuple is the INJECTIVE serialization: a '|'-join
		// would collide on fields containing the delimiter (street '123 Main St|'
		// + city 'X' vs street '123 Main St' + city '|X'), letting crafted
		// payloads share a requestId and dedup into unmetered resolves.
		const requestId = idempotencyKey
			? `${auth.orgId}:ik:${createHash('sha256')
					.update(
						JSON.stringify([
							idempotencyKey,
							parsed.data.street,
							parsed.data.city,
							parsed.data.state,
							parsed.data.zip,
							parsed.data.country ?? 'US'
						])
					)
					.digest('hex')
					.slice(0, 32)}`
			: crypto.randomUUID();
		// Attempted exactly ONCE (no retry). A rejected write fails closed to a
		// typed 502 distinct from a resolver failure: the resolution succeeded but
		// the billable row never landed, so we never return a billed-but-unrecorded 200.
		try {
			await serverMutation(api.metering.recordUsage, {
				_secret: getInternalSecret(),
				orgId: auth.orgId,
				keyId: auth.keyId,
				meter: 'resolve_address',
				quantity: 1,
				occurredAt: Date.now(),
				requestId,
				billingPeriodStart: period
			});
		} catch {
			return apiError(
				'METERING_WRITE_FAILED',
				'Resolution succeeded but usage metering failed',
				502
			);
		}

		return apiOk(data, { requestId });
	} catch (error) {
		// Infrastructure fault in the atlas chunk store (5xx/timeout/DNS) — a
		// typed 502 distinct from a geocode miss. The throw already skipped the
		// meter hook above, so an infra outage is never billed.
		if (error instanceof AtlasInfraError) {
			return apiError('ATLAS_UNAVAILABLE', 'Atlas data source unavailable', 502);
		}
		const message = error instanceof Error ? error.message : '';
		if (message.includes('Address not found')) {
			return apiError('GEOCODE_MISS', message, 404);
		}
		return apiError('RESOLVE_FAILED', 'Address resolution failed', 502);
	}
};
