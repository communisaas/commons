import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserContext } from '$lib/server/llm-cost-protection';
import {
	readPaidProviderBudgetStatus,
	writePaidProviderPublicPoolOverride
} from '$lib/server/paid-provider-budget-client';

const NO_STORE_HEADERS = {
	'cache-control': 'private, no-store, max-age=0',
	'cdn-cache-control': 'no-store',
	'cloudflare-cdn-cache-control': 'no-store'
} as const;

/** A pool override is one small number. Nothing larger is a pool override. */
const MAX_POOL_BODY_BYTES = 256;

export const GET: RequestHandler = async (event) => {
	const context = getUserContext(event);
	if (!context.isAuthenticated || !context.userId) {
		return json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE_HEADERS });
	}
	if (context.providerTier !== 'operator') {
		return json({ error: 'Operator access required' }, { status: 403, headers: NO_STORE_HEADERS });
	}

	const status = await readPaidProviderBudgetStatus({
		event,
		identifier: context.userId
	});
	if (!status) {
		return json(
			{ error: 'Paid-provider budget status unavailable' },
			{ status: 503, headers: NO_STORE_HEADERS }
		);
	}

	return json(status, { headers: NO_STORE_HEADERS });
};

/**
 * Move the shared free monthly pool inside its declared band — the operator's
 * one runtime capacity input, with no redeploy.
 *
 * The gate is the same server-derived operator authority the read uses:
 * `providerTier === 'operator'` comes from the env allowlist
 * (`isPaidProviderOperator` in `llm-cost-protection.ts`), never from anything a
 * caller can assert. The body carries a single integer; no payment, plan, or
 * subscription signal is accepted, so "payment never increases these limits"
 * stays true by construction rather than by policy.
 */
export const POST: RequestHandler = async (event) => {
	const context = getUserContext(event);
	if (!context.isAuthenticated || !context.userId) {
		return json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE_HEADERS });
	}
	if (context.providerTier !== 'operator') {
		return json({ error: 'Operator access required' }, { status: 403, headers: NO_STORE_HEADERS });
	}

	const declaredLength = event.request.headers.get('content-length');
	if (declaredLength !== null && Number(declaredLength) > MAX_POOL_BODY_BYTES) {
		return json({ error: 'Request body too large' }, { status: 400, headers: NO_STORE_HEADERS });
	}
	let body: unknown;
	try {
		const text = await event.request.text();
		if (new TextEncoder().encode(text).byteLength > MAX_POOL_BODY_BYTES) {
			return json({ error: 'Request body too large' }, { status: 400, headers: NO_STORE_HEADERS });
		}
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Malformed request body' }, { status: 400, headers: NO_STORE_HEADERS });
	}
	const units = (body as { publicMonthlyUnits?: unknown } | null)?.publicMonthlyUnits;
	if (typeof units !== 'number' || !Number.isFinite(units)) {
		return json(
			{ error: 'publicMonthlyUnits must be a number' },
			{ status: 400, headers: NO_STORE_HEADERS }
		);
	}

	const verdict = await writePaidProviderPublicPoolOverride({ event, units });
	if (!verdict) {
		return json(
			{ error: 'Paid-provider budget authority unavailable' },
			{ status: 503, headers: NO_STORE_HEADERS }
		);
	}
	// The authority's verdict is the response. A refusal is a real answer, not an
	// error the caller has to guess at, so the reason travels with it.
	return json(verdict, { status: verdict.accepted ? 200 : 400, headers: NO_STORE_HEADERS });
};
