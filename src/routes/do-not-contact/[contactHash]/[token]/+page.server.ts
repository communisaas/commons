import { serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { verifyRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { PageServerLoad, Actions } from './$types';

// Param-length caps keep the HMAC update off adversarial megabyte URLs. Both
// values are fixed-width by construction — a 64-hex hash and a 64-hex token —
// so 128 is generous slack.
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
export const load: PageServerLoad = async ({ params }) => {
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

		await serverMutation(api.email.suppressRecipientByRequest, {
			_secret: getInternalSecret(),
			contactHash,
			// Random and non-identifying: it lets an operator see a burst of
			// requests without learning anything about a person.
			requestId: crypto.randomUUID()
		});

		return { done: true };
	}
};
