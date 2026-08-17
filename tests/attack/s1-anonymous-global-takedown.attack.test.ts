/**
 * EXECUTED ATTACK — anonymous, permanent, platform-wide takedown of a published
 * recipient.
 *
 * The exploit this file drives was real: one unauthenticated POST to
 * `/api/do-not-contact/links` returned a takedown credential for every address a
 * published template names, and a second unauthenticated POST spent it. Nothing
 * in between required an account, a session, or any proof of controlling the
 * mailbox being deleted.
 *
 * The gate is this sequence REFUSING, not a green unit test elsewhere. Every
 * step runs the real route handlers. Only the seams are mocked: the environment,
 * the published-artifact reader, the per-isolate rate limiter, the Convex client
 * (replaced with an in-memory model of the challenge table, whose real behaviour
 * is proven against the actual database in
 * `convex/s1-suppression-challenge.convex.test.ts`), and the mailer.
 *
 * The positive control matters as much as the refusal: the recipient's route out
 * must still work with no account and no session. A refusal that also closes the
 * mailbox's own door is not a fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const INTERNAL_SECRET = 'internal-api-secret-for-attack-' + 'z'.repeat(32);

vi.mock('$env/dynamic/private', () => ({
	env: {
		RECIPIENT_SUPPRESSION_SECRET: 'test-suppression-' + 'a'.repeat(48),
		PUBLIC_BASE_URL: 'https://commons.email',
		INTERNAL_API_SECRET: 'internal-api-secret-for-attack-' + 'z'.repeat(32)
	}
}));

const { mockGetCachedPublicTemplatePageArtifact, mockRateLimitCheck, mockServerMutation, mockSendEmail } =
	vi.hoisted(() => ({
		mockGetCachedPublicTemplatePageArtifact: vi.fn(),
		mockRateLimitCheck: vi.fn(),
		mockServerMutation: vi.fn(),
		mockSendEmail: vi.fn()
	}));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: mockGetCachedPublicTemplatePageArtifact
}));
vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimitCheck })
}));
vi.mock('$lib/server/convex-work-budget', () => ({ serverMutation: mockServerMutation }));
vi.mock('$lib/server/email/ses', () => ({ sendEmail: mockSendEmail }));
vi.mock('$lib/convex', () => ({
	api: {
		email: {
			issueRecipientSuppressionChallenge: { fn: 'email:issueRecipientSuppressionChallenge' },
			suppressRecipientByRequest: { fn: 'email:suppressRecipientByRequest' }
		}
	}
}));

import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { generateRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
import { hashChallengeNonce } from '$lib/server/email/suppression-challenge';
import { POST as mintLinks } from '../../src/routes/api/do-not-contact/links/+server';
import { POST as machineEntrance } from '../../src/routes/api/do-not-contact/+server';
import {
	actions as slugBoundActions,
	load as slugBoundLoad
} from '../../src/routes/do-not-contact/[slug]/[contactHash]/[token]/+page.server';
import { actions as legacyActions } from '../../src/routes/do-not-contact/[contactHash]/[token]/+page.server';
import { actions as confirmActions } from '../../src/routes/do-not-contact/confirm/[nonce]/+page.server';

const SLUG = 'clean-water';
const ROSTER_A = 'director@agency.test';
const ROSTER_B = 'deputy@agency.test';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The published artifact both the mint and the confirm-side address re-derivation
 * read. It NARROWS: an address it does not carry can never produce a link or a
 * challenge, no matter what a caller names.
 */
function artifact() {
	return {
		slug: SLUG,
		detail: {
			slug: SLUG,
			deliveryMethod: 'email',
			recipient_config: {
				emails: [ROSTER_A],
				decisionMakers: [{ name: 'Deputy Director', email: ROSTER_B }]
			}
		}
	};
}

// ---------------------------------------------------------------------------
// In-memory model of the challenge table and the contact-authority rows. The
// real semantics are proven against the actual database in the convex suite;
// here they exist so an attempted terminal write is OBSERVABLE.
// ---------------------------------------------------------------------------
type ChallengeRow = {
	contactHash: string;
	slug: string;
	tokenHash: string;
	issuedAt: number;
	expiresAt: number;
	consumedAt?: number;
};

let challenges: ChallengeRow[] = [];
let contactAuthorities: string[] = [];

function suppressCalls() {
	return mockServerMutation.mock.calls.filter(
		([ref]) => ref?.fn === 'email:suppressRecipientByRequest'
	);
}

/** An anonymous visitor: no session, no account, an arbitrary source address. */
function anonymous(ip = '203.0.113.7') {
	return { locals: { user: null }, getClientAddress: () => ip, setHeaders: () => {} };
}

function mintEvent(body: unknown, ip = '203.0.113.7') {
	return {
		...anonymous(ip),
		request: new Request('https://commons.email/api/do-not-contact/links', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url: new URL(`https://commons.email/s/${SLUG}`),
		platform: undefined
	} as never;
}

function pageEvent(params: Record<string, string>, ip = '203.0.113.7') {
	return {
		...anonymous(ip),
		params,
		url: new URL(`https://commons.email/s/${SLUG}`),
		platform: undefined
	} as never;
}

async function mintedUrlFor(address: string): Promise<string> {
	const response = await mintLinks(mintEvent({ slug: SLUG, emails: [address] }));
	const { links } = (await response.json()) as { links: Record<string, string> };
	const url = links[address];
	if (!url) throw new Error('ATTACK_SETUP_FAILED: the legitimate mint produced no link');
	return url;
}

/** `/do-not-contact/{slug}/{contactHash}/{token}` → the three path parameters. */
function paramsFromUrl(url: string): { slug: string; contactHash: string; token: string } {
	const [slug, contactHash, token] = new URL(url).pathname.split('/').slice(2);
	return { slug, contactHash, token };
}

beforeEach(() => {
	vi.clearAllMocks();
	challenges = [];
	contactAuthorities = [];
	mockRateLimitCheck.mockResolvedValue({ allowed: true });
	mockGetCachedPublicTemplatePageArtifact.mockResolvedValue(artifact());
	mockSendEmail.mockResolvedValue({ success: true, messageId: 'test-message' });
	mockServerMutation.mockImplementation(async (ref: { fn: string }, args: Record<string, never>) => {
		const call = args as unknown as Record<string, string & number>;
		if (ref.fn === 'email:issueRecipientSuppressionChallenge') {
			if (call._secret !== INTERNAL_SECRET) throw new Error('INTERNAL_SECRET_INVALID');
			const issuedAt = Number(call.issuedAt);
			const recent = challenges.filter(
				(row) => row.contactHash === call.contactHash && row.issuedAt > issuedAt - DAY_MS
			);
			if (recent.length >= 3) return { issued: false };
			challenges.push({
				contactHash: String(call.contactHash),
				slug: String(call.slug),
				tokenHash: String(call.tokenHash),
				issuedAt,
				expiresAt: Number(call.expiresAt)
			});
			return { issued: true };
		}
		if (ref.fn === 'email:suppressRecipientByRequest') {
			if (call._secret !== INTERNAL_SECRET) throw new Error('INTERNAL_SECRET_INVALID');
			const row = challenges.find((entry) => entry.tokenHash === call.challengeNonceHash);
			if (!row) throw new Error('RECIPIENT_SUPPRESSION_CHALLENGE_NOT_FOUND');
			if (row.expiresAt <= Date.now()) throw new Error('RECIPIENT_SUPPRESSION_CHALLENGE_EXPIRED');
			if (row.consumedAt !== undefined) throw new Error('RECIPIENT_SUPPRESSION_CHALLENGE_CONSUMED');
			row.consumedAt = Date.now();
			contactAuthorities.push(row.contactHash);
			return { suppressed: true };
		}
		throw new Error(`UNEXPECTED_MUTATION:${ref.fn}`);
	});
});

describe('attacker sequence', () => {
	it('step 1 — the anonymous mass mint returns nothing', async () => {
		// The original exploit: one body, no addresses, the whole published roster
		// of takedown credentials comes back.
		const response = await mintLinks(mintEvent({ slug: SLUG }));

		expect(response.status).toBe(200);
		const { links } = (await response.json()) as { links: Record<string, string> };
		expect(links).toEqual({});
		// And the shape is the same one every other outcome answers with, so the
		// refusal is not itself an oracle.
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		console.log('S1-ATTACK-MINT-REFUSED');
	});

	it('step 2 — possession of a legitimately minted URL writes nothing, on ANY entrance', async () => {
		const url = await mintedUrlFor(ROSTER_A);
		const { slug, contactHash, token } = paramsFromUrl(url);
		expect(url).toContain(`/do-not-contact/${SLUG}/`);

		// Entrance 1: the slug-bound page. GET is inert, and the form action only
		// asks Commons to mail the mailbox — it does not decide anything.
		expect(await slugBoundLoad(pageEvent({ slug, contactHash, token }))).toEqual({
			status: 'confirm'
		});
		expect(await slugBoundActions.default(pageEvent({ slug, contactHash, token }))).toEqual({
			sent: true
		});

		// Entrance 2: the legacy two-segment page, whose action used to write. A
		// harvested link of that vintage carries a v1 token, so use a genuine one —
		// the point is that a VALID legacy credential no longer buys a write.
		const legacyToken = generateRecipientSuppressionToken(contactHash);
		const legacy = await legacyActions.default(pageEvent({ contactHash, token: legacyToken }));
		expect(legacy).toEqual({ operator: true });

		// Entrance 3: the machine-readable POST endpoint, which used to write.
		const machine = await machineEntrance({
			...anonymous(),
			request: new Request('https://commons.email/api/do-not-contact', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ contactHash, token: legacyToken })
			})
		} as never);
		expect(machine.status).toBe(200);
		expect(await machine.json()).toEqual({ ok: true });

		// Not one terminal write across all three, and no contact-authority row.
		expect(suppressCalls()).toHaveLength(0);
		expect(contactAuthorities).toEqual([]);
		console.log('S1-ATTACK-WRITE-REFUSED');
	});

	it('step 3 — 50 mints from 50 distinct addresses still yield zero authority', async () => {
		// The IP throttle is per-isolate memory and trivially distributed around;
		// that is exactly why it was never the thing standing in the way.
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const ip = `198.51.100.${attempt}`;
			const response = await mintLinks(mintEvent({ slug: SLUG }, ip));
			const { links } = (await response.json()) as { links: Record<string, string> };
			expect(links).toEqual({});
		}

		expect(suppressCalls()).toHaveLength(0);
		expect(contactAuthorities).toEqual([]);
		expect(mockSendEmail).not.toHaveBeenCalled();
	});

	it('cannot mint or challenge an address the template does not publish', async () => {
		const offRoster = 'someone-else@example.test';
		const response = await mintLinks(mintEvent({ slug: SLUG, emails: [offRoster] }));
		const { links } = (await response.json()) as { links: Record<string, string> };
		expect(links).toEqual({});

		// Even holding a forged-shaped URL for an unpublished hash, the confirm side
		// re-derives from the published artifact and finds nothing to mail.
		const url = await mintedUrlFor(ROSTER_A);
		const { slug, token } = paramsFromUrl(url);
		const strangerHash = await computeGlobalEmailHash(offRoster);
		expect(
			await slugBoundActions.default(pageEvent({ slug, contactHash: strangerHash, token }))
		).toEqual({ sent: false, error: 'This link is not valid.' });
		expect(mockSendEmail).not.toHaveBeenCalled();
		expect(challenges).toEqual([]);
	});

	it('treats an institutional mailbox and a natural person identically', async () => {
		// Nothing keys on how a mailbox is spelled. Both published addresses take
		// the same path, and neither is easier to suppress than the other.
		for (const address of [ROSTER_A, ROSTER_B]) {
			const { slug, contactHash, token } = paramsFromUrl(await mintedUrlFor(address));
			expect(await slugBoundActions.default(pageEvent({ slug, contactHash, token }))).toEqual({
				sent: true
			});
		}
		expect(suppressCalls()).toHaveLength(0);
		expect(challenges).toHaveLength(2);
		expect(mockSendEmail).toHaveBeenCalledTimes(2);
	});
});

describe('the recipient path, with no account and no session', () => {
	it('issues, confirms exactly once, and refuses the replay', async () => {
		const { slug, contactHash, token } = paramsFromUrl(await mintedUrlFor(ROSTER_A));

		const asked = await slugBoundActions.default(pageEvent({ slug, contactHash, token }));
		expect(asked).toEqual({ sent: true });

		// The nonce exists only in the message that went TO the mailbox.
		expect(mockSendEmail).toHaveBeenCalledTimes(1);
		const [to, , , , htmlBody] = mockSendEmail.mock.calls[0] as string[];
		expect(to).toBe(ROSTER_A);
		const nonce = htmlBody.match(/\/do-not-contact\/confirm\/([A-Za-z0-9_-]{43})/)?.[1];
		expect(nonce).toBeTruthy();
		// Only its hash was ever handed to the backend.
		expect(challenges[0].tokenHash).toBe(hashChallengeNonce(nonce as string));

		// A mail appliance prefetching the emailed link consumes nothing.
		expect(await confirmActions.default(pageEvent({ nonce: nonce as string }))).toEqual({
			done: true
		});
		expect(suppressCalls()).toHaveLength(1);
		expect(contactAuthorities).toEqual([await computeGlobalEmailHash(ROSTER_A)]);

		// Replay of the same nonce is refused, and the address is suppressed once.
		expect(await confirmActions.default(pageEvent({ nonce: nonce as string }))).toEqual({
			done: false,
			error: 'This confirmation link has expired or has already been used.'
		});
		expect(contactAuthorities).toHaveLength(1);
		console.log('S1-RECIPIENT-PATH-INTACT');
	});

	it('is bounded per mailbox at three challenges a day, with identical copy over the cap', async () => {
		const { slug, contactHash, token } = paramsFromUrl(await mintedUrlFor(ROSTER_A));

		for (let attempt = 0; attempt < 4; attempt += 1) {
			expect(await slugBoundActions.default(pageEvent({ slug, contactHash, token }))).toEqual({
				sent: true
			});
		}
		expect(challenges).toHaveLength(3);
		expect(mockSendEmail).toHaveBeenCalledTimes(3);
	});

	it('renders the same page when the mailer is down — the global write never widens', async () => {
		mockSendEmail.mockRejectedValue(new Error('SES_UNAVAILABLE'));
		const { slug, contactHash, token } = paramsFromUrl(await mintedUrlFor(ROSTER_A));

		expect(await slugBoundActions.default(pageEvent({ slug, contactHash, token }))).toEqual({
			sent: true
		});
		expect(suppressCalls()).toHaveLength(0);
		expect(contactAuthorities).toEqual([]);
	});

	it('renders the same page when the published artifact is unavailable', async () => {
		const { slug, contactHash, token } = paramsFromUrl(await mintedUrlFor(ROSTER_A));
		mockGetCachedPublicTemplatePageArtifact.mockRejectedValue(new Error('ARTIFACT_UNAVAILABLE'));

		expect(await slugBoundActions.default(pageEvent({ slug, contactHash, token }))).toEqual({
			sent: true
		});
		expect(mockSendEmail).not.toHaveBeenCalled();
		expect(contactAuthorities).toEqual([]);
	});
});
