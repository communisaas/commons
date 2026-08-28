/**
 * The addressed set BINDS the verdict to the artifact that publishes it.
 *
 * The hole this closes: a slug alone selected the policy, so a sender could
 * address a private mailbox while naming a clean institutional template, and
 * take the permissive S1/S4-only set on evidence about somebody else entirely.
 *
 * The rule measured here is monotonic. A caller-supplied address may only select
 * a route the published roster contains, and removing a route may never move the
 * verdict from strict to permissive. The full published roster is the policy
 * floor; only an already-institutional artifact may report an addressed subset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddHeaders, mockArtifact, mockEnforce, mockModerate, mockRateLimitResponse } =
	vi.hoisted(() => ({
		mockAddHeaders: vi.fn(),
		mockArtifact: vi.fn(),
		mockEnforce: vi.fn(),
		mockModerate: vi.fn(),
		mockRateLimitResponse: vi.fn(
			() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
		)
	}));

vi.mock('$lib/core/server/moderation', () => ({
	moderatePersonalization: mockModerate
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	addRateLimitHeaders: mockAddHeaders,
	enforceLLMRateLimit: mockEnforce,
	rateLimitResponse: mockRateLimitResponse
}));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: mockArtifact
}));

vi.mock('../../../src/routes/api/moderation/personalization/$types', () => ({}));

import { POST } from '../../../src/routes/api/moderation/personalization/+server';
import type { AudienceVerdict } from '$lib/core/server/moderation/audience';

const SLUG = 'clean-water';
const TEXT = 'The director ignored three years of complaints from my block.';
// Two distinct seat local parts on ONE domain: the switchboard `deriveAudience`
// requires before a lexicon hit may promote. A subset narrower than that is
// `seat-lexicon-unattested`, which is the reach this binding costs and the
// reason these fixtures address a PAIR rather than a single office.
const OFFICE = 'board@hospital.org';
const PRESS = 'press@hospital.org';
const OMBUDS = 'ombuds@hospital.org';
/** A mailbox only some OTHER template publishes. Naming it must buy nothing. */
const OUTSIDER = 'john.smith@smithproperties.com';

function artifact(recipient_config: unknown, deliveryMethod = 'email') {
	return { slug: SLUG, detail: { slug: SLUG, deliveryMethod, recipient_config } };
}

// A stranger, not the author: the send-time gate is reached by anyone who can
// load the public page, so that is the session this binding is measured on.
function event(body: unknown): any {
	return {
		locals: { session: { userId: 'stranger-1' } },
		request: { json: () => Promise.resolve(body) },
		url: new URL('https://commons.email/api/moderation/personalization'),
		platform: {}
	};
}

async function policyOf(body: unknown) {
	const response = await POST(event(body));
	return { status: response.status, body: await response.json() };
}

/** The verdict that actually reached the moderator, not one rebuilt for the test. */
function deliveredAudience(): AudienceVerdict {
	expect(mockModerate).toHaveBeenCalledTimes(1);
	return mockModerate.mock.calls[0][1].audience as AudienceVerdict;
}

describe('the addressed set binds the verdict to the artifact that publishes it', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforce.mockResolvedValue({
			allowed: true,
			limit: 10,
			remaining: 9,
			resetAt: new Date(),
			tier: 'authenticated'
		});
		mockModerate.mockResolvedValue({ approved: true, summary: 'Approved', latency_ms: 1 });
		mockArtifact.mockResolvedValue(artifact({ emails: [OFFICE, PRESS, OMBUDS] }));
	});

	it('refuses the cross-slug grant: an addressee this slug does not publish', async () => {
		const { status, body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OUTSIDER] });

		expect(status).toBe(200);
		expect(body.policy).not.toBe('institutional');
		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'addressee-not-published' });
		// The moderator still ran, and it ran on the strict verdict.
		expect(deliveredAudience()).toMatchObject({ form: 'unevaluable' });
	});

	it('refuses one outsider smuggled in beside genuinely published offices', async () => {
		const { body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: [OFFICE, PRESS, OUTSIDER]
		});

		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'addressee-not-published' });
	});

	it('spends no artifact read when the request names no addressed set', async () => {
		const { body } = await policyOf({ text: TEXT, slug: SLUG });

		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'no-addressed-recipients' });
		expect(mockArtifact).toHaveBeenCalledTimes(0);
	});

	it('lets an addressed SUBSET of a published seat roster stay institutional', async () => {
		const { status, body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: [OFFICE, PRESS]
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ policy: 'institutional', basis: 'seat-lexicon' });
		// Two routes reported — the ones addressed — with policy evidence from the
		// full, already-institutional published roster.
		expect(deliveredAudience()).toMatchObject({ form: 'institutional', routes: 2 });
	});

	it('uses the full published switchboard as evidence for one addressed seat', async () => {
		const { body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: [OFFICE]
		});

		expect(body).toMatchObject({ policy: 'institutional', basis: 'seat-lexicon' });
		expect(deliveredAudience()).toMatchObject({ form: 'institutional', routes: 1 });
	});

	it('keeps a named human protected when they are the addressee in a mixed roster', async () => {
		mockArtifact.mockResolvedValue(
			artifact({
				emails: [OFFICE],
				decisionMakers: [{ name: 'John Smith', email: OUTSIDER }]
			})
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OUTSIDER] });

		expect(body).toMatchObject({ policy: 'person-form', basis: 'name-token-match' });
	});

	it('refuses the drop-the-person unlock when only an office is addressed', async () => {
		mockArtifact.mockResolvedValue(
			artifact({
				emails: [OFFICE, PRESS],
				decisionMakers: [{ name: 'Jane Smith', email: 'jane.smith@hospital.org' }]
			})
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OFFICE] });

		// The caller omitted Jane, but cannot omit the evidence that keeps S5/S7/S10.
		expect(body).toMatchObject({ policy: 'person-form', basis: 'name-token-match' });
		expect(deliveredAudience()).toMatchObject({ form: 'person-form', routes: 3 });
	});

	it('keeps an unevaluable published route as a strict floor when it is omitted', async () => {
		mockArtifact.mockResolvedValue(
			artifact({ emails: [OFFICE, PRESS, 'jsmith@hospital.org'] })
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OFFICE] });

		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'indeterminate-route' });
	});

	it('matches however the published mailbox is capitalized or padded', async () => {
		const { body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: [' Board@Hospital.ORG ', 'PRESS@Hospital.org']
		});

		expect(body).toMatchObject({ policy: 'institutional', basis: 'seat-lexicon' });
		// The caller's padding and casing matched a key; classification still read
		// the bytes the ARTIFACT published, never the string the caller sent.
		expect(deliveredAudience()).toMatchObject({ form: 'institutional', routes: 2 });
	});

	it.each([
		['a non-string', [OFFICE, 42]],
		['an address with no @', [OFFICE, 'board-at-hospital.org']],
		['an address past the 256-char cap', [OFFICE, `${'a'.repeat(250)}@hospital.org`]],
		['an empty string', [OFFICE, '']]
	])(
		'refuses the whole set rather than dropping %s so the survivors buy institutional',
		async (_label, recipients) => {
			const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients });

			expect(body.policy).not.toBe('institutional');
			expect(body).toMatchObject({ policy: 'unevaluable', reason: 'no-addressed-recipients' });
			// The refusal precedes the artifact read, so a malformed entry is not even
			// an enumeration probe against the published roster.
			expect(mockArtifact).toHaveBeenCalledTimes(0);
		}
	);

	it('classifies an address published BOTH bare and as a named human as person-form', async () => {
		// The bare `emails` entry must not erase the name published beside the same
		// mailbox — otherwise listing a person twice would strip their protection.
		mockArtifact.mockResolvedValue(
			artifact({
				emails: [OUTSIDER],
				decisionMakers: [{ name: 'John Smith', email: OUTSIDER }]
			})
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OUTSIDER] });

		expect(body).toMatchObject({ policy: 'person-form', basis: 'name-token-match' });
	});

	it('classifies the same pair as person-form whichever list is written first', async () => {
		mockArtifact.mockResolvedValue(
			artifact({
				decisionMakers: [
					{ name: 'John Smith', email: OUTSIDER },
					{ email: OUTSIDER }
				]
			})
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [OUTSIDER] });

		expect(body).toMatchObject({ policy: 'person-form', basis: 'name-token-match' });
	});

	it('deduplicates a repeated addressee instead of inflating the measured roster', async () => {
		const { body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: [OFFICE, ' BOARD@hospital.org ', OFFICE, PRESS]
		});

		expect(body).toMatchObject({ policy: 'institutional' });
		expect(deliveredAudience()).toMatchObject({ routes: 2 });
	});
});
