/**
 * Constituent resolver service — /resolve v2.
 *
 * The Convex congressional-delivery action (`convex/submissions.ts`
 * `deliverToCongress`) POSTs here at `${TEE_RESOLVER_URL}/resolve` BEFORE any CWC
 * send. Without this endpoint `TEE_RESOLVER_URL` has no in-repo target and the
 * action throws "Service configuration error" — so this is the load-bearing gap
 * that makes the congressional send path executable (B1).
 *
 * The resolver runs the three atomic gates (decrypt witness → verify ZK proof →
 * reconcile decrypted address-cell against the witness cell). Only an all-pass
 * returns ConstituentData. PII is scoped to this request: it is never persisted
 * or logged here — it flows straight back to the caller, which builds the CWC XML
 * and forwards it, never writing plaintext.
 *
 * Auth: shared INTERNAL_API_SECRET. This endpoint decrypts witness data into PII,
 * so it must NOT be a public oracle — even though the three gates bound what an
 * attacker can extract, an authenticated, network-isolated boundary is the right
 * posture for a PII resolver. (TEE_RESOLVER_URL should also point at an internal
 * origin; the secret is defense-in-depth atop that.)
 *
 * Today `getConstituentResolver()` returns `LocalConstituentResolver` (in-process,
 * "operator-resolved" trust model); when `TEE_PUBLIC_KEY_URL` is set it returns
 * the Nitro client (which returns NITRO_ENCLAVE_NOT_DEPLOYED until the enclave
 * ships — no silent fallback to Local).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { matchInternalSecret } from '$lib/server/internal/secret-auth';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';
import { getConstituentResolver } from '$lib/server/tee';
import { readBoundedJson } from '$lib/server/bounded-json';
import type { ResolveRequest } from '$lib/server/tee/constituent-resolver';

// The legit payload is ciphertext + nonce + two pubkeys + proof hex + publicInputs
// + 3 short strings — comfortably under 64KB. Cap before parsing so a leaked secret
// can't burn memory/CPU with oversized bodies despite the request-count limiter.
const MAX_RESOLVE_BODY_BYTES = 64 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const auth = matchInternalSecret(request.headers.get('x-internal-secret'));
	if (!auth.ok) {
		throw error(
			auth.reason === 'not_configured' ? 503 : 403,
			auth.reason === 'not_configured'
				? 'INTERNAL_API_SECRET not configured'
				: 'Invalid internal secret'
		);
	}

	// Crypto-heavy + PII endpoint: cap request volume to blunt a leaked-secret flood.
	await enforceInternalRateLimit({ endpoint: 'tee-resolve', maxRequests: 120, windowMs: 60_000 });

	// Bounded read (content-length + streaming abort) before JSON.parse. A
	// too-large or unparseable body maps to the same clean MISSING_FIELDS result
	// below — fail-closed, no retry storm, no unbounded buffering.
	let body: Partial<ResolveRequest> | null;
	try {
		body = (await readBoundedJson(request, MAX_RESOLVE_BODY_BYTES)) as Partial<ResolveRequest>;
	} catch {
		return json({ success: false, errorCode: 'MISSING_FIELDS' });
	}

	// A malformed body is a RESOLVER result (200 + typed errorCode), not a transport
	// error — so the caller records a clean delivery failure instead of retrying a
	// body that will never parse. No PII is involved on this path.
	if (
		!body ||
		typeof body.ciphertext !== 'string' ||
		typeof body.nonce !== 'string' ||
		typeof body.ephemeralPublicKey !== 'string' ||
		typeof body.proof !== 'string' ||
		body.publicInputs === undefined ||
		!body.expected ||
		typeof body.expected.actionDomain !== 'string' ||
		typeof body.expected.templateId !== 'string' ||
		typeof body.expected.districtCommitment !== 'string'
	) {
		return json({ success: false, errorCode: 'MISSING_FIELDS' });
	}

	const result = await getConstituentResolver().resolve({
		ciphertext: body.ciphertext,
		nonce: body.nonce,
		ephemeralPublicKey: body.ephemeralPublicKey,
		proof: body.proof,
		publicInputs: body.publicInputs,
		expected: {
			actionDomain: body.expected.actionDomain,
			templateId: body.expected.templateId,
			districtCommitment: body.expected.districtCommitment
		}
	});

	return json(result);
};
