import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { api } from '$lib/convex';
import { serverMutation } from '$lib/server/convex-work-budget';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
import { parseRecipientConfig } from '$lib/types/template';
import { sendEmail } from '$lib/server/email/ses';
import {
	verifyRecipientSuppressionInitiationToken,
	verifyRecipientSuppressionToken
} from '$lib/server/email/recipient-suppression';
import {
	buildChallengeConfirmUrl,
	buildChallengeEmailBody,
	CHALLENGE_FROM_EMAIL,
	CHALLENGE_FROM_NAME,
	CHALLENGE_SUBJECT,
	CHALLENGE_TTL_MS,
	hashChallengeNonce,
	mintChallengeNonce
} from '$lib/server/email/suppression-challenge';
import type { PageServerLoad, Actions } from './$types';

/**
 * The mailbox's route out, opened by a link that only ASKS.
 *
 * The link in a sent message is held by the sender before the recipient ever
 * sees it, so neither loading this page nor submitting its form can suppress
 * anything. Both do the same thing at most: cause Commons to mail the address a
 * one-use confirmation nonce. The nonce is the authority, it exists only in the
 * target mailbox, and the terminal write consumes it.
 *
 * GET PERFORMS NO WRITE, and not merely by convention. Mail-security appliances
 * and inbox previewers fetch every link in a message before a human sees it, so
 * a GET-side effect here would let a corporate scanner make decisions no person
 * made.
 *
 * ONE PAGE SHAPE FOR EVERY OUTCOME of the form action: issued, over the per-
 * mailbox daily cap, address no longer published by this template, artifact
 * unavailable, mailer down. Any difference between those is an address-
 * enumeration oracle, since the caller supplies the hash and would learn from
 * the answer whether the address is still on a published roster.
 */

// Fixed-width by construction — a 64-hex hash and a 64-hex token — so 128 is
// generous slack that still keeps the HMAC update off adversarial megabyte URLs.
function paramsInBounds(contactHash: string, token: string): boolean {
	return contactHash.length <= 128 && token.length <= 128;
}

/**
 * v2 binds the slug; v1 does not and is accepted only so links already sitting in
 * mailboxes keep opening a live page. Neither grants anything.
 */
function acceptsInitiation(slug: string, contactHash: string, token: string): boolean {
	if (!paramsInBounds(contactHash, token)) return false;
	if (verifyRecipientSuppressionInitiationToken(slug, contactHash, token)) return true;
	return verifyRecipientSuppressionToken(contactHash, token);
}

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
	const { slug, contactHash, token } = params;
	return acceptsInitiation(slug, contactHash, token)
		? { status: 'confirm' as const }
		: { status: 'invalid' as const };
};

/**
 * Re-derive the plaintext address from the same published artifact the mint read.
 * The artifact NARROWS and never GRANTS: the caller names a hash, and an address
 * comes back only if this template still publishes one that hashes to it.
 */
async function resolvePublishedAddress(
	context: { url: URL; platform: App.Platform | undefined },
	slug: string,
	contactHash: string
): Promise<string | null> {
	const artifact = await getCachedPublicTemplatePageArtifact(context, slug).catch(() => null);
	if (!artifact) return null;
	// The congressional lane routes to the certified-delivery relay and puts no
	// mailbox in front of a sender, so it owes none a route out.
	if (isCongressionalDelivery(artifact.detail.deliveryMethod)) return null;

	const config = parseRecipientConfig(artifact.detail.recipient_config);
	const published = new Set<string>();
	for (const email of config.emails ?? []) {
		if (typeof email === 'string' && email.includes('@')) published.add(email.trim().toLowerCase());
	}
	for (const decisionMaker of config.decisionMakers ?? []) {
		const email = decisionMaker?.email;
		if (typeof email === 'string' && email.includes('@')) published.add(email.trim().toLowerCase());
	}
	for (const address of published) {
		if ((await computeGlobalEmailHash(address)) === contactHash) return address;
	}
	return null;
}

export const actions: Actions = {
	default: async ({ params, url, platform, getClientAddress }) => {
		const { slug, contactHash, token } = params;

		// Defence in depth only. This limiter is per-isolate memory, so it is not
		// the mailbomb bound; that bound is a row in Convex, keyed on the target.
		const rateLimit = await getRateLimiter().check(
			`ratelimit:do-not-contact:ip:${getClientAddress()}`,
			{ maxRequests: 10, windowMs: 60_000 }
		);
		if (!rateLimit.allowed) {
			return { sent: false, error: 'Too many requests. Try again in a minute.' };
		}

		if (!acceptsInitiation(slug, contactHash, token)) {
			return { sent: false, error: 'This link is not valid.' };
		}

		// Everything past this point answers identically. A caller learns only that
		// the request was accepted, never whether a message went anywhere.
		try {
			const address = await resolvePublishedAddress({ url, platform }, slug, contactHash);
			if (address) {
				const nonce = mintChallengeNonce();
				const issuedAt = Date.now();
				const issuance = await serverMutation(api.email.issueRecipientSuppressionChallenge, {
					_secret: getInternalSecret(),
					contactHash,
					slug,
					tokenHash: hashChallengeNonce(nonce),
					issuedAt,
					expiresAt: issuedAt + CHALLENGE_TTL_MS,
					// Random and non-identifying: an operator can see a burst of requests
					// without learning anything about a person.
					requestId: crypto.randomUUID()
				});
				if (issuance.issued) {
					const confirmUrl = buildChallengeConfirmUrl(nonce);
					await sendEmail(
						address,
						CHALLENGE_FROM_EMAIL,
						CHALLENGE_FROM_NAME,
						CHALLENGE_SUBJECT,
						buildChallengeEmailBody(confirmUrl)
					);
				}
			}
		} catch (cause) {
			// Never widen on missing evidence. A missing mailer, an unresolvable
			// artifact or a Convex failure leaves the global write unperformed and
			// the page shape unchanged; the operator-mediated route stays on the page.
			console.warn('[do-not-contact] suppression challenge not issued', cause);
		}

		return { sent: true };
	}
};
