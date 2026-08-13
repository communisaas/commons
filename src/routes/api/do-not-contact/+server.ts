/**
 * POST /api/do-not-contact — mailbox-addressed, machine-readable suppression.
 *
 * POST ONLY. There is no GET here and there must never be one: mail-security
 * appliances and inbox previewers fetch links before a human sees them, and a
 * GET-side write would let a scanner silently and permanently delete an office
 * address from every public projection on the platform.
 *
 * Accepts `{ contactHash, token }` as JSON or as form data, so an RFC 8058
 * `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * header pair can be pointed at this URL later without changing the contract.
 *
 * Always answers 200 with the same body. A valid write, an invalid token, a
 * malformed hash and an address nobody has ever heard of are indistinguishable
 * from the outside — anything else is an address-enumeration oracle.
 */

import { json, error } from '@sveltejs/kit';
import { serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { verifyRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

const PARAM_MAX_LENGTH = 128;
const ACCEPTED = { ok: true } as const;

function readParam(value: unknown): string {
	return typeof value === 'string' && value.length <= PARAM_MAX_LENGTH ? value : '';
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const rateLimit = await getRateLimiter().check(
		`ratelimit:do-not-contact:ip:${getClientAddress()}`,
		{ maxRequests: 10, windowMs: 60_000 }
	);
	if (!rateLimit.allowed) throw error(429, 'Too many requests');

	const contentType = request.headers.get('content-type') ?? '';
	let contactHash = '';
	let token = '';
	if (contentType.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		contactHash = readParam(body?.contactHash);
		token = readParam(body?.token);
	} else {
		const form = await request.formData().catch(() => null);
		contactHash = readParam(form?.get('contactHash'));
		token = readParam(form?.get('token'));
	}

	if (!verifyRecipientSuppressionToken(contactHash, token)) return json(ACCEPTED);

	await serverMutation(api.email.suppressRecipientByRequest, {
		_secret: getInternalSecret(),
		contactHash,
		// Random and non-identifying: an operator can see a burst of requests
		// without learning anything about a person.
		requestId: crypto.randomUUID()
	});

	return json(ACCEPTED);
};
