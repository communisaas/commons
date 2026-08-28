import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { serverMutation } from '$lib/server/convex-work-budget';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { hashChallengeNonce, isChallengeNonce } from '$lib/server/email/suppression-challenge';
import type { PageServerLoad, Actions } from './$types';

/**
 * The confirmation the mailbox itself holds — the only entrance with authority.
 *
 * GET IS INERT, AND HERE THAT IS LOAD-BEARING RATHER THAN CUSTOMARY. This is the
 * one link in the whole flow that actually travels to a recipient's mailbox, so
 * it is exactly the link a corporate mail appliance will prefetch before any
 * human reads the message. A GET-side consume would let the recipient's own mail
 * scanner spend the challenge — either silently suppressing the address or, if
 * the scan preceded the read, burning the nonce so the person cannot use it.
 * `load` therefore renders a button and nothing else.
 *
 * The nonce is a bearer credential, so the response is `private, no-store` and
 * `no-referrer`: the same reasoning that keeps plaintext addresses out of these
 * URLs keeps this one out of referer chains and shared caches.
 */

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
	return isChallengeNonce(params.nonce)
		? { status: 'confirm' as const }
		: { status: 'invalid' as const };
};

export const actions: Actions = {
	default: async ({ params, getClientAddress, setHeaders }) => {
		setHeaders({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });

		const rateLimit = await getRateLimiter().check(
			`ratelimit:do-not-contact:ip:${getClientAddress()}`,
			{ maxRequests: 10, windowMs: 60_000 }
		);
		if (!rateLimit.allowed) {
			return { done: false, error: 'Too many requests. Try again in a minute.' };
		}

		if (!isChallengeNonce(params.nonce)) {
			return { done: false, error: 'This confirmation link is not valid.' };
		}

		try {
			// The contact hash comes off the stored challenge row, not off the wire.
			// Nothing a caller supplies decides which mailbox is suppressed.
			await serverMutation(api.email.suppressRecipientByRequest, {
				_secret: getInternalSecret(),
				challengeNonceHash: hashChallengeNonce(params.nonce),
				// Random and non-identifying: it lets an operator see a burst of
				// requests without learning anything about a person.
				requestId: crypto.randomUUID()
			});
		} catch {
			// Safe to distinguish: this outcome is keyed to the caller's own nonce,
			// which the caller already holds. It is not keyed to an address, so it
			// tells a stranger nothing they could enumerate with.
			return {
				done: false,
				error: 'This confirmation link has expired or has already been used.'
			};
		}

		return { done: true };
	}
};
