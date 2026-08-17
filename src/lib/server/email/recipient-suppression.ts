import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * HMAC-bound suppression tokens for the mailbox-addressed do-not-contact route.
 *
 * A person or office whose address the platform resolved is not a supporter and
 * owns no row anyone could key an opt-out on. The only thing shared between the
 * platform and that mailbox is the address itself, so the key is its global
 * email hash and the proof is an HMAC over that hash. The plaintext address
 * never enters the URL, so a referer header or an access log leaks nothing.
 *
 * Pattern matches `unsubscribe.ts` (which stays supporter-scoped by contract —
 * this is a separate key space, not an extension of it):
 *   - Mint always uses `RECIPIENT_SUPPRESSION_SECRET` (active).
 *   - Verify tries the active secret first, then
 *     `RECIPIENT_SUPPRESSION_SECRET_PREVIOUS` if set, so a link that has been
 *     sitting in an inbox keeps working through a rotation.
 *
 * Rotation procedure (operator):
 *   1. Set _PREVIOUS = current value.
 *   2. Set RECIPIENT_SUPPRESSION_SECRET = new value. Deploy.
 *   3. Wait long enough for outstanding links to be opened OR be deemed stale
 *      (operator judgment — these ride sent mail, so months, not days).
 *   4. Unset _PREVIOUS. Deploy.
 *
 * Token = hex(HMAC-SHA256(secret, "recipient-suppression:v1:" + contactHash)).
 * The domain prefix is load-bearing: without it a token minted for one key
 * space could verify in the other. Deterministic for the same (hash, secret)
 * pair, so the same address always gets the same link and the write is
 * idempotent.
 *
 * RETIRED ASYMMETRY — what these tokens are now, and what retired the residual.
 * RFC 8058 one-click assumes the link travelled TO the mailbox, so possession of
 * it implies control of it. That assumption never held here: the link rides a
 * message the SENDER composes and sends from their own mail client, so the
 * sender holds it before the recipient does. A token in this file therefore no
 * longer authorizes anything. It is an INITIATION proof: it opens a page that
 * ASKS, and the terminal write consumes a one-use nonce that was mailed to the
 * address itself (`suppression-challenge.ts`). Possession of a link now buys the
 * ability to make Commons send that mailbox one message, bounded per target in
 * Convex — not the ability to blank it.
 *
 * The recorded rejection that survives unchanged, because it is still right:
 * there is deliberately no re-subscribe, appeal, or un-suppress path. Recovery
 * is an operator repair of the `contactAuthorities` row; it is out of product
 * scope on purpose, because a self-serve un-suppress is a strictly worse failure
 * than an over-suppression.
 *
 * Two spaces live here. `recipient-suppression:v1:` binds a contact hash alone;
 * it is kept only so links already sitting in mailboxes still open a live page —
 * demoted, not broken. `recipient-suppression-initiate:v2:` binds the public
 * template slug as well, so the confirm handler can re-derive the address from
 * the same published artifact the mint read instead of accepting one.
 */

const MIN_SECRET_BYTES = 32;

/** Global email hash: 64 lowercase hex characters, and nothing else. */
const CONTACT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Mandatory domain separation from every other HMAC key space in the tree. */
const TOKEN_DOMAIN = 'recipient-suppression:v1:';

/** The slug-bound initiation space. Separate domain, so a v1 token cannot open a v2 page. */
const TOKEN_DOMAIN_INITIATE = 'recipient-suppression-initiate:v2:';

/**
 * Public template slugs, the same shape the public route accepts. Validated
 * before the HMAC so an adversarial path segment never reaches a secret, and so
 * a slug carrying `/` cannot forge a different URL shape.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

function activeSecret(): string {
	const secret = env.RECIPIENT_SUPPRESSION_SECRET;
	if (!secret) throw new Error('RECIPIENT_SUPPRESSION_SECRET env var is required');
	if (secret.length < MIN_SECRET_BYTES) {
		throw new Error(`RECIPIENT_SUPPRESSION_SECRET must be >= ${MIN_SECRET_BYTES} bytes`);
	}
	return secret;
}

function previousSecret(): string | null {
	const secret = env.RECIPIENT_SUPPRESSION_SECRET_PREVIOUS;
	if (!secret) return null;
	if (secret.length < MIN_SECRET_BYTES) {
		// A bad _PREVIOUS must NOT brick active-secret verification of links that
		// are already sitting in mailboxes. Log loud and treat as unset; the
		// operator sees the warning and outstanding links keep working.
		console.warn(
			`[recipient-suppression] RECIPIENT_SUPPRESSION_SECRET_PREVIOUS is set but < ${MIN_SECRET_BYTES} bytes; ignoring (active-secret verification continues)`
		);
		return null;
	}
	return secret;
}

function computeToken(secret: string, contactHash: string): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${TOKEN_DOMAIN}${contactHash}`);
	return hmac.digest('hex');
}

function computeInitiationToken(secret: string, slug: string, contactHash: string): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${TOKEN_DOMAIN_INITIATE}${slug}:${contactHash}`);
	return hmac.digest('hex');
}

/**
 * Compare a caller-supplied token against the active secret, then the optional
 * rotation-window previous secret. One loop for both key spaces so a future
 * space cannot accidentally ship without the rotation window or without the
 * length guard.
 */
function matchesAnySecret(expected: (secret: string) => string, token: string): boolean {
	const tokenBuf = Buffer.from(token, 'utf8');
	const candidates: string[] = [activeSecret()];
	const previous = previousSecret();
	if (previous) candidates.push(previous);
	for (const secret of candidates) {
		const expectedBuf = Buffer.from(expected(secret), 'utf8');
		// Length compared on the BUFFERS, not the strings: `timingSafeEqual`
		// throws on a length mismatch and a non-ASCII token's byte length is not
		// its character length.
		if (expectedBuf.length !== tokenBuf.length) continue;
		if (timingSafeEqual(tokenBuf, expectedBuf)) return true;
	}
	return false;
}

/** Whether a value is a well-formed public template slug for the initiation space. */
export function isRecipientSuppressionSlug(value: unknown): value is string {
	return typeof value === 'string' && SLUG_PATTERN.test(value);
}

/**
 * Whether a value is a well-formed global email hash. Every entrance checks
 * this before touching a secret, so an adversarial parameter never reaches the
 * HMAC.
 */
export function isRecipientContactHash(value: string): boolean {
	return CONTACT_HASH_PATTERN.test(value);
}

/**
 * Generate a suppression token for a global email hash under the active secret.
 * Throws on a malformed hash — a caller minting a link for a non-hash has a bug,
 * not a bad request.
 */
export function generateRecipientSuppressionToken(contactHash: string): string {
	if (!isRecipientContactHash(contactHash)) {
		throw new Error('RECIPIENT_SUPPRESSION_CONTACT_HASH_INVALID');
	}
	return computeToken(activeSecret(), contactHash);
}

/**
 * Generate a slug-bound initiation token under the active secret. Throws on a
 * malformed slug or hash — a caller minting a link for a non-slug has a bug.
 */
export function generateRecipientSuppressionInitiationToken(
	slug: string,
	contactHash: string
): string {
	if (!isRecipientSuppressionSlug(slug)) {
		throw new Error('RECIPIENT_SUPPRESSION_SLUG_INVALID');
	}
	if (!isRecipientContactHash(contactHash)) {
		throw new Error('RECIPIENT_SUPPRESSION_CONTACT_HASH_INVALID');
	}
	return computeInitiationToken(activeSecret(), slug, contactHash);
}

/**
 * Verify a slug-bound initiation token. Never throws on caller input, for the
 * same reason the v1 verifier does not: both arrive straight off a URL an
 * appliance may have mangled.
 */
export function verifyRecipientSuppressionInitiationToken(
	slug: string,
	contactHash: string,
	token: string
): boolean {
	if (!isRecipientSuppressionSlug(slug)) return false;
	if (!isRecipientContactHash(contactHash)) return false;
	return matchesAnySecret((secret) => computeInitiationToken(secret, slug, contactHash), token);
}

/**
 * Build the full do-not-contact URL for one published template and one global
 * email hash. Carries no plaintext address by construction; the slug is the
 * public page's own identifier, so it discloses nothing the page does not.
 */
export function buildRecipientSuppressionUrl(slug: string, contactHash: string): string {
	const token = generateRecipientSuppressionInitiationToken(slug, contactHash);
	const baseUrl = env.PUBLIC_BASE_URL || 'https://commons.email';
	return `${baseUrl}/do-not-contact/${slug}/${contactHash}/${token}`;
}

/**
 * Verify a v1 suppression token. Tries the active secret first, then the
 * optional rotation-window previous secret. Never throws on caller input: a
 * malformed hash or a wrong-length token is a `false`, because both arrive
 * straight off a URL an appliance may have mangled.
 *
 * This is a legacy INITIATION acceptor, not an authority. Links minted under the
 * v1 scheme are already in mailboxes; they still open a page, and that page —
 * like every other entrance — can do nothing but ask.
 */
export function verifyRecipientSuppressionToken(contactHash: string, token: string): boolean {
	if (!isRecipientContactHash(contactHash)) return false;
	return matchesAnySecret((secret) => computeToken(secret, contactHash), token);
}
