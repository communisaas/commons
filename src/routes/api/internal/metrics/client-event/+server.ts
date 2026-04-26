/**
 * Wave 6 / FU-1.3 — client-side metric ingestion endpoint.
 *
 * Receives best-effort `navigator.sendBeacon` posts from the browser when
 * commitment generation fails (IPFS gateway slow, Poseidon WASM init bug,
 * etc.). Logs to stderr in a structured format that ops dashboards parse.
 * No DB writes — metrics infrastructure (Datadog, etc.) is downstream of
 * the log stream.
 *
 * Auth: NONE. Anyone can post here. The metric body is structured-log-only;
 * the worst case from spam is log noise. If volume becomes an issue, gate
 * with a per-IP rate limit using the existing `enforceInternalRateLimit`
 * pattern — but for canary metrics on a low-traffic event class, that's
 * premature.
 *
 * Privacy: caller-supplied error strings are truncated to 200 chars at the
 * source (`AddressCollectionForm.svelte`). The endpoint additionally trims
 * to defend against tampered clients.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';

const ALLOWED_METRICS = new Set([
	'verify_commitment_generation_failure',
	'v2_witness_fetch_failure'
]);

export const POST: RequestHandler = async ({ request }) => {
	// SELF-REVIEW F: cap log spam from misbehaving / malicious clients.
	// Per-IP-keyed rate limit; legitimate clients should hit this < 1/minute.
	// 60/min/IP is generous; sustained spam is a misconfiguration to investigate.
	await enforceInternalRateLimit({
		endpoint: 'metrics-client-event',
		maxRequests: 60,
		windowMs: 60_000
	});
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		// sendBeacon may post text/plain — try that.
		try {
			const text = await request.text();
			body = JSON.parse(text);
		} catch {
			return json({ ok: false, error: 'invalid_body' }, { status: 400 });
		}
	}

	if (!body || typeof body !== 'object') {
		return json({ ok: false, error: 'invalid_body' }, { status: 400 });
	}

	const b = body as Record<string, unknown>;
	const metric = typeof b.metric === 'string' ? b.metric : null;
	if (!metric || !ALLOWED_METRICS.has(metric)) {
		return json({ ok: false, error: 'unknown_metric' }, { status: 400 });
	}

	// Structured log line for downstream parsing. Keep PII out — the field
	// shape is fixed and bounded.
	console.warn('[client-metric]', {
		metric,
		error: typeof b.error === 'string' ? b.error.slice(0, 200) : undefined,
		timestamp: typeof b.timestamp === 'number' ? b.timestamp : Date.now(),
		userAgent: request.headers.get('user-agent')?.slice(0, 100)
	});

	return json({ ok: true });
};
