/**
 * POST /api/do-not-contact/links — the only way a suppression credential exists.
 *
 * Two properties carry the endpoint. The roster is SERVER-derived, so naming an
 * address the template does not publish mints nothing — otherwise this route is a
 * takedown-link generator for any mailbox on earth. And every outcome is one
 * status, one body shape: a hit, a miss, an unknown slug and a congressional
 * template must be indistinguishable, or the route is an address-enumeration
 * oracle. The explicit exception is a roster above the reviewed ceiling, which
 * fails atomically instead of masquerading as a complete partial map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		RECIPIENT_SUPPRESSION_SECRET: 'test-suppression-' + 'a'.repeat(48),
		PUBLIC_BASE_URL: 'https://commons.email'
	}
}));

const { mockGetCachedPublicTemplatePageArtifact, mockRateLimitCheck } = vi.hoisted(() => ({
	mockGetCachedPublicTemplatePageArtifact: vi.fn(),
	mockRateLimitCheck: vi.fn()
}));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: mockGetCachedPublicTemplatePageArtifact
}));
vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimitCheck })
}));

import { env } from '$env/dynamic/private';
import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { verifyRecipientSuppressionToken } from '$lib/server/email/recipient-suppression';
import { POST } from '../../../src/routes/api/do-not-contact/links/+server';
import {
	DO_NOT_CONTACT_LINK_TIMEOUT_MS,
	buildDoNotContactZone,
	fetchDoNotContactUrls
} from '$lib/utils/do-not-contact-links';

const SLUG = 'clean-water';
const ROSTER_A = 'director@agency.test';
const ROSTER_B = 'Deputy@Agency.test';
const OFF_ROSTER = 'someone-else@example.test';

function artifact(overrides: Record<string, unknown> = {}) {
	return {
		slug: SLUG,
		detail: {
			slug: SLUG,
			deliveryMethod: 'email',
			recipient_config: {
				emails: [ROSTER_A],
				decisionMakers: [{ name: 'Deputy Director', email: ROSTER_B }]
			},
			...overrides
		}
	};
}

function event(body: unknown, { slug = SLUG }: { slug?: string } = {}) {
	return {
		request: new Request('https://commons.email/api/do-not-contact/links', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url: new URL(`https://commons.email/s/${slug}`),
		platform: undefined,
		getClientAddress: () => '203.0.113.7'
	} as never;
}

async function links(response: Response): Promise<Record<string, string>> {
	const parsed = (await response.json()) as { links: Record<string, string> };
	return parsed.links;
}

describe('POST /api/do-not-contact/links', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(env as Record<string, string | undefined>).RECIPIENT_SUPPRESSION_SECRET =
			'test-suppression-' + 'a'.repeat(48);
		mockRateLimitCheck.mockResolvedValue({ allowed: true });
		mockGetCachedPublicTemplatePageArtifact.mockResolvedValue(artifact());
	});

	it('mints only for the intersection of the published roster and the named addresses', async () => {
		const response = await POST(event({ slug: SLUG, emails: [ROSTER_A, OFF_ROSTER] }));

		expect(response.status).toBe(200);
		const minted = await links(response);
		// Keyed by the normalized address — the same trim+lowercase the hash uses.
		expect(Object.keys(minted)).toEqual([ROSTER_A]);
		expect(minted[OFF_ROSTER]).toBeUndefined();
	});

	it('never mints for an address the template does not publish', async () => {
		const minted = await links(await POST(event({ slug: SLUG, emails: [OFF_ROSTER] })));
		expect(minted).toEqual({});
	});

	it('returns the whole published roster when no addresses are named', async () => {
		const minted = await links(await POST(event({ slug: SLUG })));
		expect(Object.keys(minted).sort()).toEqual([ROSTER_B.toLowerCase(), ROSTER_A].sort());
	});

	it('rejects an oversized derived roster instead of returning a trimmed map', async () => {
		mockGetCachedPublicTemplatePageArtifact.mockResolvedValueOnce(
			artifact({
				recipient_config: {
					emails: Array.from({ length: 21 }, (_, index) => `recipient-${index}@agency.test`)
				}
			})
		);

		await expect(POST(event({ slug: SLUG }))).rejects.toMatchObject({
			status: 413,
			body: { message: 'Recipient roster exceeds the 20-address suppression-link limit' }
		});
	});

	it('answers one body shape for a hit, a miss, an unknown slug and a congressional template', async () => {
		const hit = await POST(event({ slug: SLUG, emails: [ROSTER_A] }));
		const miss = await POST(event({ slug: SLUG, emails: [OFF_ROSTER] }));

		mockGetCachedPublicTemplatePageArtifact.mockResolvedValueOnce(null);
		const unknown = await POST(event({ slug: 'no-such-template' }, { slug: 'no-such-template' }));

		mockGetCachedPublicTemplatePageArtifact.mockResolvedValueOnce(
			artifact({ deliveryMethod: 'cwc' })
		);
		const congressional = await POST(event({ slug: SLUG, emails: [ROSTER_A] }));

		for (const response of [hit, miss, unknown, congressional]) {
			expect(response.status).toBe(200);
			const parsed = (await response.clone().json()) as Record<string, unknown>;
			expect(Object.keys(parsed)).toEqual(['links']);
		}
		expect(await links(miss)).toEqual({});
		expect(await links(unknown)).toEqual({});
		expect(await links(congressional)).toEqual({});
		expect(Object.keys(await links(hit))).toEqual([ROSTER_A]);
	});

	it('mints a URL that verifies under the address global email hash', async () => {
		const minted = await links(await POST(event({ slug: SLUG, emails: [ROSTER_A] })));
		const contactHash = await computeGlobalEmailHash(ROSTER_A);
		const url = minted[ROSTER_A];

		expect(url).toBe(
			`https://commons.email/do-not-contact/${contactHash}/${url.split('/').pop()}`
		);
		expect(verifyRecipientSuppressionToken(contactHash, url.split('/').pop() as string)).toBe(true);
		// The plaintext address is not in the credential.
		expect(url).not.toContain('@');
	});

	it('rate limits per IP', async () => {
		mockRateLimitCheck.mockResolvedValueOnce({ allowed: false });
		await expect(POST(event({ slug: SLUG }))).rejects.toMatchObject({ status: 429 });
		expect(mockRateLimitCheck).toHaveBeenCalledWith(
			'ratelimit:do-not-contact-links:ip:203.0.113.7',
			{ maxRequests: 10, windowMs: 60_000 }
		);
	});

	it('answers private, no-store', async () => {
		const response = await POST(event({ slug: SLUG }));
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('degrades a mint failure to a missing entry rather than a 500', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		delete (env as Record<string, string | undefined>).RECIPIENT_SUPPRESSION_SECRET;

		const response = await POST(event({ slug: SLUG, emails: [ROSTER_A] }));
		expect(response.status).toBe(200);
		expect(await links(response)).toEqual({});
		warn.mockRestore();
	});
});

describe('send-time do-not-contact facts', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('does no network work when there are no recipients', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchDoNotContactUrls(SLUG, [])).resolves.toEqual({ state: 'absent' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('represents a timeout as BLOCKED and supplies a bounded signal', async () => {
		const controller = new AbortController();
		controller.abort(new DOMException('timed out', 'TimeoutError'));
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
		const fetchMock = vi.fn().mockRejectedValue(controller.signal.reason);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchDoNotContactUrls(SLUG, [ROSTER_A]);

		expect(result).toEqual({
			state: 'blocked',
			why: 'Do-not-contact links timed out. Please try sending again in a moment.'
		});
		expect(timeout).toHaveBeenCalledWith(DO_NOT_CONTACT_LINK_TIMEOUT_MS);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/do-not-contact/links',
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it('represents a completed response missing a required link as ABSENT', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ links: {} }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);

		await expect(fetchDoNotContactUrls(SLUG, [ROSTER_A])).resolves.toEqual({ state: 'absent' });
	});

	it('keeps an over-cap response BLOCKED with a sender-visible roster reason', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('too many recipients', { status: 413 }))
		);

		await expect(fetchDoNotContactUrls(SLUG, [ROSTER_A])).resolves.toEqual({
			state: 'blocked',
			why: 'This message has too many recipients to prepare do-not-contact links safely.'
		});
	});

	it('builds a suppression zone only from a complete PRESENT link map', async () => {
		const url = 'https://commons.email/do-not-contact/hash/token';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ links: { [ROSTER_A]: url } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);

		const result = await buildDoNotContactZone(SLUG, [ROSTER_A]);
		expect(result).toEqual(
			expect.objectContaining({
				state: 'present',
				value: expect.stringContaining(`${ROSTER_A} — ${url}`)
			})
		);
	});
});
