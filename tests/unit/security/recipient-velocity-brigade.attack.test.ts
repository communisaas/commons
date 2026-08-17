/**
 * The pile-on, executed.
 *
 * These are attacks, not unit tests: each one drives the REAL exported `POST`
 * of `/api/do-not-contact/links` with real `Request` objects, against the REAL
 * `ConvexWorkBudget` Durable Object class reached through the existing
 * `FakeSql` harness. The only stub is the published artifact
 * (`$lib/server/public-template-queries`) — the classifier, the hashing, the
 * reservation transport, the SQL statements and the admission arithmetic are all
 * the shipped code.
 *
 * What is proved here, and what deliberately is not:
 *   A  one source hammering one private mailbox is REFUSED after three mints;
 *   B  a 200-source brigade is COUNTED and NOT refused — the global ceiling is
 *      an unmade founder decision, and the test asserts it is still `null`;
 *   C  seats, government-registry namespaces and the congressional relay are
 *      never bounded, and A's refusal does not spill onto another target or
 *      another source;
 *   D  with the binding absent every send proceeds and every verdict reads
 *      `unmeasured` — never "within budget";
 *   E  a duplicate inside the idempotency window consumes one slot;
 *   F  `RECIPIENT_VELOCITY_GLOBAL_CEILING === null`.
 *
 * The cadence is load-bearing. A forgiving 61-second sequence proves the daily
 * counter, but an attacker sends faster than the retry window. The hostile
 * cases below keep the same source while rotating IPs and repeat from one IP
 * below the route limiter, so the recipient governor itself has to stop them.
 *
 * Fixtures self-check against `classifySeatRoute` / `classifyGovernmentalAddress`,
 * so a lexicon change breaks the fixture instead of silently voiding the attack.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { artifactMock } = vi.hoisted(() => ({ artifactMock: vi.fn() }));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: artifactMock
}));

// Runtime environment, not a stubbed dependency: the mint HMACs under this
// secret, and without it every link would fail to build and the attack would
// "pass" for the wrong reason. Same shape as
// `tests/unit/email/recipient-suppression.test.ts`.
vi.mock('$env/dynamic/private', () => ({
	env: {
		PUBLIC_BASE_URL: 'https://commons.email',
		RECIPIENT_SUPPRESSION_SECRET: `test-recipient-velocity-${'a'.repeat(48)}`
	}
}));

import { classifyGovernmentalAddress } from '$lib/core/agents/governmental-class';
import { classifySeatRoute } from '$lib/core/agents/seat-route';
import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { reserveRecipientVelocity } from '$lib/server/recipient-velocity-client';
import {
	RECIPIENT_VELOCITY_GLOBAL_CEILING,
	RECIPIENT_VELOCITY_REPLAY_MAX,
	RECIPIENT_VELOCITY_SOURCE_MAX,
	RECIPIENT_VELOCITY_TARGET_MAX
} from '$lib/server/recipient-velocity-policy';
import {
	describeDoNotContactFailure,
	fetchDoNotContactUrls
} from '$lib/utils/do-not-contact-links';
import { POST } from '../../../src/routes/api/do-not-contact/links/+server';
import {
	recipientReservationRequest,
	recipientStatusRequest,
	request as workBudgetRequest,
	setup
} from '../server/convex-work-budget-harness';

const ENDPOINT = 'https://commons.email/api/do-not-contact/links';
const CONVEX_URL = 'https://quirky-chinchilla-352.convex.cloud';
const SLUG = 'clinic-closure-hearing';
const OTHER_SLUG = 'second-published-template';
const RELAY_SLUG = 'congressional-relay-template';

/** A named natural person. `classifySeatRoute` must agree, or the fixture is void. */
const VICTIM = { email: 'dana.reyes@gmail.com', name: 'Dana Reyes' };
const SECOND_PERSON = { email: 'sam.okafor@gmail.com', name: 'Sam Okafor' };
/** An office seat: closed-lexicon local part, no name token in it. */
const SEAT = { email: 'cityclerk@example.org', name: 'Office of the City Clerk' };
/** A government-registry namespace with no published name beside it. */
const GOVERNMENTAL = 'casework@ny.gov';
/** Named officials: both classifiers match, so the governmental exemption wins. */
const NAMED_GOVERNMENTAL = [
	{ email: 'jane.smith@agency.gov', name: 'Jane Smith' },
	{ email: 'alex.chen@defense.mil', name: 'Alex Chen' },
	{ email: 'riley.jones@senate.state.tx.us', name: 'Riley Jones' }
] as const;
/** The pre-existing incomplete-map copy. A held recipient must NOT get this. */
const LINKS_INCOMPLETE_COPY =
	'A do-not-contact link could not be prepared for every recipient. Please try sending again.';

type Verdicts = { held: string[]; links: Record<string, string>; retryAfter?: number };

function artifactFor(slug: string) {
	if (slug === RELAY_SLUG) {
		return {
			slug,
			detail: {
				deliveryMethod: 'cwc',
				recipient_config: { decisionMakers: [VICTIM] }
			}
		};
	}
	return {
		slug,
		detail: {
			deliveryMethod: 'email',
			recipient_config: {
				decisionMakers: [VICTIM, SECOND_PERSON, SEAT, ...NAMED_GOVERNMENTAL],
				emails: [GOVERNMENTAL]
			}
		}
	};
}

function budgetHarness() {
	const bodies: string[] = [];
	const objectNames: string[] = [];
	const store = setup();
	const namespace = {
		idFromName: (name: string) => {
			objectNames.push(name);
			return { name };
		},
		get: () => ({
			fetch: async (request: Request) => {
				bodies.push(await request.clone().text());
				return store.budget.fetch(request);
			}
		})
	};
	return { bodies, namespace, objectNames, store };
}

function platformFor(namespace: unknown) {
	return {
		env: {
			...(namespace === undefined ? {} : { CONVEX_WORK_BUDGET: namespace }),
			PUBLIC_CONVEX_URL: CONVEX_URL
		}
	};
}

async function post(input: {
	emails: string[];
	ip: string;
	platform: unknown;
	slug?: string;
	userId?: string;
}): Promise<Verdicts> {
	const request = new Request(ENDPOINT, {
		body: JSON.stringify({ slug: input.slug ?? SLUG, emails: input.emails }),
		headers: { 'content-type': 'application/json' },
		method: 'POST'
	});
	const response = await POST({
		getClientAddress: () => input.ip,
		locals: { user: input.userId ? { id: input.userId } : null },
		platform: input.platform,
		request,
		url: new URL(ENDPOINT)
	} as never);
	expect(response.status).toBe(200);
	return (await response.json()) as Verdicts;
}

/**
 * The attacker's clock. Steps past the 60s idempotency window (and past the
 * endpoint's own per-IP sliding window) so each POST is a genuinely new attempt
 * rather than a retry — the hostile case, not the forgiving one.
 */
function step(seconds = 61) {
	vi.setSystemTime(new Date(Date.now() + seconds * 1000));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	// Mid-UTC-day so a 40-attempt run cannot cross a day boundary and reset.
	vi.setSystemTime(new Date(Date.UTC(2026, 7, 13, 6, 0, 0)));
	artifactMock.mockReset();
	artifactMock.mockImplementation(async (_context: unknown, slug: string) => artifactFor(slug));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('fixtures are what the classifiers say they are', () => {
	it('the victim is a person-form route and the seat is a seat', () => {
		expect(classifySeatRoute(VICTIM.email, { candidateName: VICTIM.name })?.form).toBe(
			'person-form'
		);
		expect(classifySeatRoute(SECOND_PERSON.email, { candidateName: SECOND_PERSON.name })?.form).toBe(
			'person-form'
		);
		expect(classifySeatRoute(SEAT.email, { candidateName: SEAT.name })?.form).toBe('seat');
		expect(classifyGovernmentalAddress(GOVERNMENTAL).governmental).toBe(true);
		expect(classifySeatRoute(GOVERNMENTAL, { candidateName: undefined })?.form).toBe(
			'indeterminate'
		);
		for (const official of NAMED_GOVERNMENTAL) {
			expect(
				classifySeatRoute(official.email, { candidateName: official.name })?.form
			).toBe('person-form');
			expect(classifyGovernmentalAddress(official.email).governmental).toBe(true);
		}
	});
});

describe('A — one source, one private mailbox: the pile-on is refused', () => {
	it('mints three and holds the remaining thirty-seven', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		const results: Verdicts[] = [];
		for (let attempt = 0; attempt < 40; attempt += 1) {
			results.push(await post({ emails: [VICTIM.email], ip: '203.0.113.7', platform }));
			step();
		}

		const minted = results.filter((result) => typeof result.links[VICTIM.email] === 'string');
		const heldResults = results.filter((result) => result.held.includes(VICTIM.email));
		expect(minted).toHaveLength(RECIPIENT_VELOCITY_SOURCE_MAX);
		expect(heldResults).toHaveLength(40 - RECIPIENT_VELOCITY_SOURCE_MAX);
		// The refusal is a refusal: no link rides along with it.
		for (const result of heldResults) {
			expect(result.links[VICTIM.email]).toBeUndefined();
			expect(result.links).toEqual({});
			expect(result.retryAfter).toBeGreaterThan(0);
		}
		// The first three are the ones that minted — the bound is a prefix, not a
		// sample.
		expect(results.slice(0, RECIPIENT_VELOCITY_SOURCE_MAX).every((r) => r.links[VICTIM.email])).toBe(
			true
		);
	});

	it('caps a fast signed-in hammer even while its client address rotates', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		const results: Verdicts[] = [];
		for (let attempt = 0; attempt < 40; attempt += 1) {
			results.push(
				await post({
					emails: [VICTIM.email],
					ip: `198.18.0.${attempt}`,
					platform,
					userId: 'same-signed-in-source'
				})
			);
			step(1);
		}

		const minted = results.filter((result) => typeof result.links[VICTIM.email] === 'string');
		const maximumResponses =
			RECIPIENT_VELOCITY_SOURCE_MAX * (RECIPIENT_VELOCITY_REPLAY_MAX + 1);
		expect(minted).toHaveLength(maximumResponses);
		expect(results.slice(maximumResponses).every((result) => result.held.includes(VICTIM.email))).toBe(
			true
		);
	});

	it('caps an anonymous hammer below the route limiter cadence', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		const results: Verdicts[] = [];
		for (let attempt = 0; attempt < 20; attempt += 1) {
			results.push(await post({ emails: [VICTIM.email], ip: '203.0.113.8', platform }));
			// Fewer than ten requests in every rolling minute: the route's per-IP
			// limiter is not the control under test.
			step(7);
		}

		const minted = results.filter((result) => typeof result.links[VICTIM.email] === 'string');
		expect(minted).toHaveLength(
			RECIPIENT_VELOCITY_SOURCE_MAX * (RECIPIENT_VELOCITY_REPLAY_MAX + 1)
		);
	});
});

describe('B — the brigade is counted, not blocked', () => {
	it('two hundred distinct sources all mint, and the observed row reads 200/200', async () => {
		const { namespace, store } = budgetHarness();
		const platform = platformFor(namespace);
		for (let source = 0; source < 200; source += 1) {
			const result = await post({
				emails: [VICTIM.email],
				ip: `198.51.100.${source}`,
				platform
			});
			expect(result.links[VICTIM.email]).toBeTruthy();
			expect(result.held).toEqual([]);
		}

		// Read back through the real internal protocol path, not through fake SQL.
		const status = await store.budget.fetch(
			recipientStatusRequest(await computeGlobalEmailHash(VICTIM.email))
		);
		expect(status.status).toBe(200);
		const observed = (await status.json()) as {
			observed: { distinctSources: number; reservations: number };
		};
		expect(observed.observed).toEqual({ distinctSources: 200, reservations: 200 });
	});
});

describe('C — institutions, other targets and other sources are untouched', () => {
	it('a seat and a government-registry address are never held', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const result = await post({
				emails: [SEAT.email, GOVERNMENTAL],
				ip: '203.0.113.21',
				platform
			});
			expect(result.held).toEqual([]);
			expect(result.links[SEAT.email]).toBeTruthy();
			expect(result.links[GOVERNMENTAL]).toBeTruthy();
			step();
		}
	});

	it('named officials in government registries remain unbounded', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const result = await post({
				emails: NAMED_GOVERNMENTAL.map(({ email }) => email),
				ip: '203.0.113.22',
				platform
			});
			expect(result.held).toEqual([]);
			for (const official of NAMED_GOVERNMENTAL) {
				expect(result.links[official.email]).toBeTruthy();
			}
			step();
		}
	});

	it('exhausting one target leaves a second target and a second source alone', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			await post({ emails: [VICTIM.email], ip: '203.0.113.31', platform });
			step();
		}
		const exhausted = await post({ emails: [VICTIM.email], ip: '203.0.113.31', platform });
		expect(exhausted.held).toEqual([VICTIM.email]);

		const secondTarget = await post({
			emails: [SECOND_PERSON.email],
			ip: '203.0.113.31',
			platform
		});
		expect(secondTarget.links[SECOND_PERSON.email]).toBeTruthy();
		expect(secondTarget.held).toEqual([]);

		const secondSource = await post({ emails: [VICTIM.email], ip: '203.0.113.32', platform });
		expect(secondSource.links[VICTIM.email]).toBeTruthy();
		expect(secondSource.held).toEqual([]);
	});

	it('a congressional relay answers the uniform shape and reserves nothing', async () => {
		const { bodies, namespace } = budgetHarness();
		const platform = platformFor(namespace);
		const relay = await post({
			emails: [VICTIM.email],
			ip: '203.0.113.41',
			platform,
			slug: RELAY_SLUG
		});
		expect(relay).toEqual({ held: [], links: {} });
		expect(bodies).toHaveLength(0);
	});

	it('an unknown slug, a malformed body and a roster miss are indistinguishable', async () => {
		const { bodies, namespace } = budgetHarness();
		const platform = platformFor(namespace);
		artifactMock.mockImplementation(async (_context: unknown, slug: string) =>
			slug === SLUG ? artifactFor(slug) : null
		);

		const unknownSlug = await post({
			emails: [VICTIM.email],
			ip: '203.0.113.42',
			platform,
			slug: OTHER_SLUG
		});
		const rosterMiss = await post({
			emails: ['stranger@example.com'],
			ip: '203.0.113.43',
			platform
		});
		const malformed = await POST({
			getClientAddress: () => '203.0.113.44',
			locals: { user: null },
			platform,
			request: new Request(ENDPOINT, {
				body: JSON.stringify(['not', 'a', 'record']),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			}),
			url: new URL(ENDPOINT)
		} as never);

		expect(unknownSlug).toEqual({ held: [], links: {} });
		expect(rosterMiss).toEqual({ held: [], links: {} });
		expect(await malformed.json()).toEqual({ held: [], links: {} });
		expect(bodies).toHaveLength(0);
	});
});

describe('D — with no binding the governor degrades OPEN and says so', () => {
	it('every send proceeds and every verdict is unmeasured, never within budget', async () => {
		const platform = platformFor(undefined);
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const result = await post({ emails: [VICTIM.email], ip: '192.0.2.9', platform });
			expect(result.links[VICTIM.email]).toBeTruthy();
			expect(result.held).toEqual([]);
			step();
		}

		// The verdict the seam actually received, read from the transport itself.
		const verdicts = await reserveRecipientVelocity({
			event: { platform } as never,
			scopeKey: SLUG,
			sourceKey: 'ip:192.0.2.9',
			targets: [{ address: VICTIM.email, hash: await computeGlobalEmailHash(VICTIM.email) }]
		});
		const verdict = verdicts.get(VICTIM.email);
		expect(verdict).toEqual({ state: 'unmeasured', why: 'recipient-velocity-binding-absent' });
		// `unmeasured` is its own state. It is neither `granted` nor any allowed /
		// remaining / within-budget shape.
		expect(verdict?.state).not.toBe('granted');
		expect(Object.keys(verdict ?? {})).toEqual(['state', 'why']);
	});
});

describe('E — a retry inside the idempotency window costs one slot', () => {
	it('two posts within sixty seconds consume a single mint', async () => {
		const { namespace, store } = budgetHarness();
		const platform = platformFor(namespace);
		const first = await post({ emails: [VICTIM.email], ip: '203.0.113.51', platform });
		vi.setSystemTime(new Date(Date.now() + 5_000));
		const retry = await post({ emails: [VICTIM.email], ip: '203.0.113.51', platform });
		expect(first.links[VICTIM.email]).toBeTruthy();
		expect(retry.links[VICTIM.email]).toBe(first.links[VICTIM.email]);
		expect([...store.sql.recipientVelocity.values()].map((row) => row.used)).toEqual([1]);

		// Two more genuine attempts still mint, and only the fourth is refused.
		step();
		expect((await post({ emails: [VICTIM.email], ip: '203.0.113.51', platform })).held).toEqual([]);
		step();
		expect((await post({ emails: [VICTIM.email], ip: '203.0.113.51', platform })).held).toEqual([]);
		step();
		expect((await post({ emails: [VICTIM.email], ip: '203.0.113.51', platform })).held).toEqual([
			VICTIM.email
		]);
	});

	it('binds a replay to the exact template scope and caps free responses', async () => {
		const { namespace, store } = budgetHarness();
		const platform = platformFor(namespace);

		expect((await post({ emails: [VICTIM.email], ip: '203.0.113.52', platform })).held).toEqual(
			[]
		);
		step(5);
		// A different template is a new send, not a retry of the first reservation.
		expect(
			(
				await post({
					emails: [VICTIM.email],
					ip: '203.0.113.52',
					platform,
					slug: OTHER_SLUG
				})
			).held
		).toEqual([]);
		expect([...store.sql.recipientVelocity.values()].map((row) => row.used)).toEqual([2]);

		// One exact retry is free; the next identical request is a fresh reservation.
		step(5);
		expect(
			(
				await post({
					emails: [VICTIM.email],
					ip: '203.0.113.52',
					platform,
					slug: OTHER_SLUG
				})
			).held
		).toEqual([]);
		expect([...store.sql.recipientVelocity.values()].map((row) => row.used)).toEqual([2]);
		step(5);
		expect(
			(
				await post({
					emails: [VICTIM.email],
					ip: '203.0.113.52',
					platform,
					slug: OTHER_SLUG
				})
			).held
		).toEqual([]);
		expect([...store.sql.recipientVelocity.values()].map((row) => row.used)).toEqual([3]);

		step(5);
		const finalRecovery = await post({
			emails: [VICTIM.email],
			ip: '203.0.113.52',
			platform,
			slug: OTHER_SLUG
		});
		expect(finalRecovery.held).toEqual([]);
		step(5);
		const held = await post({
			emails: [VICTIM.email],
			ip: '203.0.113.52',
			platform,
			slug: OTHER_SLUG
		});
		expect(held.held).toEqual([VICTIM.email]);
		expect(held.links).toEqual({});
	});
});

describe('F — the global ceiling stays an unmade founder decision', () => {
	it('is null', () => {
		expect(RECIPIENT_VELOCITY_GLOBAL_CEILING).toBeNull();
	});
});

describe('the store never sees a mailbox, an IP, or an oversized body', () => {
	it('every captured request body carries hashes only', async () => {
		const { bodies, namespace, objectNames } = budgetHarness();
		const platform = platformFor(namespace);
		for (let attempt = 0; attempt < 6; attempt += 1) {
			await post({
				emails: [VICTIM.email, SECOND_PERSON.email, SEAT.email, GOVERNMENTAL],
				ip: '203.0.113.61',
				platform
			});
			step();
		}
		expect(bodies.length).toBeGreaterThan(0);
		for (const body of bodies) {
			expect(body).not.toContain('@');
			expect(body).not.toContain('203.0.113.61');
			expect(body).not.toContain('gmail');
			expect(body).not.toContain(SLUG);
			const parsed = JSON.parse(body) as { sourceHash: string; targets: string[] };
			expect(parsed.sourceHash).toMatch(/^[a-f0-9]{64}$/);
			for (const target of parsed.targets) expect(target).toMatch(/^[a-f0-9]{64}$/);
		}
		// A dedicated object id: recipient admissions never serialize behind the
		// paid-provider budget.
		expect(new Set(objectNames)).toEqual(new Set(['recipient-velocity-v1']));
	});

	it('a full twenty-hash roster is admitted, and /reserve keeps its 512-byte ceiling', async () => {
		const { store } = budgetHarness();
		const targets = Array.from({ length: RECIPIENT_VELOCITY_TARGET_MAX }, (_value, index) =>
			index.toString(16).padStart(64, '0')
		);
		const batched = await store.budget.fetch(
			recipientReservationRequest('f'.repeat(64), targets)
		);
		expect(batched.status).toBe(200);
		const body = (await batched.json()) as { verdicts: { state: string }[] };
		expect(body.verdicts).toHaveLength(RECIPIENT_VELOCITY_TARGET_MAX);
		expect(body.verdicts.every((verdict) => verdict.state === 'granted')).toBe(true);

		// The provider path did NOT get a looser ceiling out of this.
		const oversizedBody = JSON.stringify({
			kind: 'query',
			operation: `organizations:${'s'.repeat(460)}`,
			realm: 'production'
		});
		expect(new TextEncoder().encode(oversizedBody).byteLength).toBeGreaterThan(512);
		const oversized = await store.budget.fetch(
			workBudgetRequest('organizations:slugExists', 'query', { body: oversizedBody })
		);
		expect(oversized.status).toBe(400);
	});
});

describe('the cross-template disclosure is closed', () => {
	it('a hold on a second template names nothing the caller did not already know', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await post({ emails: [VICTIM.email], ip: '203.0.113.71', platform });
			step();
		}
		// On the template this source has minted on, the refusal is honest.
		const sameTemplate = await post({ emails: [VICTIM.email], ip: '203.0.113.71', platform });
		expect(sameTemplate.held).toEqual([VICTIM.email]);

		// On a template it has never minted on, the refusal names nothing — so
		// `held` cannot be read as proof that this template publishes the address.
		const otherTemplate = await post({
			emails: [VICTIM.email],
			ip: '203.0.113.71',
			platform,
			slug: OTHER_SLUG
		});
		const nonRosterAddress = await post({
			emails: ['stranger@example.com'],
			ip: '203.0.113.71',
			platform,
			slug: OTHER_SLUG
		});
		expect(otherTemplate).toEqual({ held: [], links: {} });
		expect(otherTemplate).toEqual(nonRosterAddress);
	});
});

describe('a held address blocks assembly and renders honest copy', () => {
	it('the send seam sees a withheld fact, not an incomplete map', async () => {
		const { namespace } = budgetHarness();
		const platform = platformFor(namespace);
		const ip = '203.0.113.81';
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await post({ emails: [VICTIM.email], ip, platform });
			step();
		}

		// The real client util against the real endpoint response.
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: unknown, init: RequestInit) =>
			POST({
				getClientAddress: () => ip,
				locals: { user: null },
				platform,
				request: new Request(ENDPOINT, {
					body: init.body as string,
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				}),
				url: new URL(ENDPOINT)
			} as never)) as typeof globalThis.fetch;
		let fact;
		try {
			fact = await fetchDoNotContactUrls(SLUG, [VICTIM.email, SEAT.email]);
		} finally {
			globalThis.fetch = originalFetch;
		}

		expect(fact.state).toBe('withheld');
		const copy = describeDoNotContactFailure(fact);
		expect(copy).not.toBe(LINKS_INCOMPLETE_COPY);
		expect(copy.toLowerCase()).not.toContain('try again');
		expect(copy.toLowerCase()).not.toContain('try sending');
		// Names the real window — a UTC calendar day, not a rolling 24 hours.
		expect(copy).toContain('next UTC day');
			expect(copy).not.toContain('24 hours');
			expect(copy).toContain(VICTIM.email);
			expect(copy).toContain('whole message');
			// Never claims the recipient has been protected from mail sent elsewhere.
		expect(copy).toContain('does not stop mail you send from your own email client');
	});
});
