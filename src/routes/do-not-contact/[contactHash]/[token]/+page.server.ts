import { verifyRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { PageServerLoad, Actions } from './$types';

/**
 * The legacy two-segment link, kept alive and stripped of authority.
 *
 * Links minted under the original scheme carry no slug, so this route cannot
 * re-derive which published template the address came from — and without that it
 * cannot re-read the artifact to recover the plaintext address, which is what
 * mailing a confirmation challenge requires. It therefore does the only honest
 * thing left: it confirms the link is genuine and hands the person an operator
 * route. It performs NO write on any method.
 *
 * A link of this shape can only exist if it was minted at a real send. Whether
 * any ever reached a production recipient is an operator question; if none did,
 * this route should be deleted outright rather than kept as a courtesy.
 *
 * Param-length caps keep the HMAC update off adversarial megabyte URLs. Both
 * values are fixed-width by construction — a 64-hex hash and a 64-hex token — so
 * 128 is generous slack.
 */
function paramsInBounds(contactHash: string, token: string): boolean {
	return contactHash.length <= 128 && token.length <= 128;
}

/**
 * GET renders a confirmation and PERFORMS NO WRITE.
 *
 * Mail-security appliances and inbox previewers fetch every link in a message
 * before a human ever sees it. A GET-side write would therefore let a corporate
 * scanner silently and permanently delete an office address from every public
 * projection on the platform, with no person having decided anything.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
	const { contactHash, token } = params;

	if (!paramsInBounds(contactHash, token)) {
		return { status: 'invalid' as const };
	}
	if (!verifyRecipientSuppressionToken(contactHash, token)) {
		return { status: 'invalid' as const };
	}
	return { status: 'confirm' as const };
};

export const actions: Actions = {
	default: async ({ params, getClientAddress }) => {
		const { contactHash, token } = params;

		const rateLimit = await getRateLimiter().check(
			`ratelimit:do-not-contact:ip:${getClientAddress()}`,
			{ maxRequests: 10, windowMs: 60_000 }
		);
		if (!rateLimit.allowed) {
			return { done: false, error: 'Too many requests. Try again in a minute.' };
		}

		if (!paramsInBounds(contactHash, token)) {
			return { done: false, error: 'This link is not valid.' };
		}
		if (!verifyRecipientSuppressionToken(contactHash, token)) {
			return { done: false, error: 'This link is not valid.' };
		}

		// No slug, so no artifact, so no address to mail a challenge to. The route
		// out stays open, but through a person rather than a machine.
		return { operator: true as const };
	}
};
