/**
 * POST /api/do-not-contact — machine-readable acknowledgement, and nothing more.
 *
 * This endpoint used to perform the terminal, global, permanent suppression on
 * possession of an HMAC token alone. It no longer performs any write. A
 * suppression link rides a message the SENDER composed, so possession of one
 * proves nothing about control of the mailbox it names; the authority now lives
 * in a one-use nonce mailed TO the address, spent at
 * `/do-not-contact/confirm/[nonce]`, which is the only entrance that reaches
 * `api.email.suppressRecipientByRequest`.
 *
 * POST ONLY. There is no GET here and there must never be one: mail-security
 * appliances and inbox previewers fetch links before a human sees them.
 *
 * It still accepts `{ contactHash, token }` as JSON or as form data, and it
 * still answers a single `200 {ok:true}` for a valid token, an invalid token, a
 * malformed hash and an address nobody has ever heard of — anything else is an
 * address-enumeration oracle. What it does NOT do is act on any of them.
 *
 * RFC 8058 one-click stays unwired on purpose. A `List-Unsubscribe-Post` header
 * pointed here would promise a removal this route cannot make, and the header
 * belongs on the challenge message — where the recipient's mailbox really is the
 * caller — not on a message the sender composed. Wiring it here requires the
 * slug-bound issuance the page action performs, not a reinstated write.
 */

import { json, error } from '@sveltejs/kit';
import { verifyRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
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

	// Verified and then deliberately dropped. Keeping the check costs nothing and
	// keeps the shape of the contract honest for a future slug-bound issuance;
	// acting on it is what made this route a global takedown for any holder.
	verifyRecipientSuppressionToken(contactHash, token);

	return json(ACCEPTED);
};
