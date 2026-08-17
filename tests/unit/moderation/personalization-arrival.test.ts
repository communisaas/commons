/**
 * POST /api/moderation/personalization — how the audience ARRIVES at the policy.
 *
 * Two caller fields, and neither is an assertion. `slug` is a pointer: the
 * server dereferences it into the published artifact it already holds and
 * re-classifies the roster itself. `recipients` is a binding input: every address
 * must be published by that artifact, while the full published roster supplies a
 * strict policy floor. A caller can neither add a route nor omit a natural person
 * to unlock the permissive set. Nothing a caller writes asserts a class, a form,
 * a title, or a recipient.
 *
 * The second property is degradation. No addressed set, no slug, an invalid
 * slug, an unavailable artifact and an addressee the slug does not publish are
 * not errors: they are `unevaluable`, which selects the strict hazard set.
 * Resolution never produces a status code of its own.
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

const SLUG = 'clean-water';
const TEXT = 'The director ignored three years of complaints from my block.';

function artifact(recipient_config: unknown, deliveryMethod = 'email') {
	return { slug: SLUG, detail: { slug: SLUG, deliveryMethod, recipient_config } };
}

// A stranger, not the author: the send-time gate is reached by anyone who can
// load the public page, so that is the session the arrival path is measured on.
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

describe('POST /api/moderation/personalization audience arrival', () => {
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
		// Two distinct seat local parts on ONE domain: the switchboard
		// `deriveAudience` requires before a lexicon hit may promote.
		mockArtifact.mockResolvedValue(
			artifact({ emails: ['board@hospital.org', 'press@hospital.org'] })
		);
	});

	it('derives institutional from an office roster on the published artifact', async () => {
		const { status, body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: ['board@hospital.org', 'press@hospital.org']
		});

		expect(status).toBe(200);
		expect(mockArtifact).toHaveBeenCalledWith(expect.anything(), SLUG);
		expect(mockModerate).toHaveBeenCalledWith(
			TEXT,
			expect.objectContaining({
				audience: { form: 'institutional', basis: 'seat-lexicon', routes: 2 }
			})
		);
		expect(body).toMatchObject({ policy: 'institutional', basis: 'seat-lexicon' });
	});

	it('derives person-form from a named decision maker, not from anything the caller sent', async () => {
		mockArtifact.mockResolvedValue(
			artifact({ decisionMakers: [{ name: 'Jane Smith', email: 'jane.smith@hospital.org' }] })
		);

		const { status, body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: ['jane.smith@hospital.org']
		});

		expect(status).toBe(200);
		expect(mockModerate).toHaveBeenCalledWith(
			TEXT,
			expect.objectContaining({ audience: expect.objectContaining({ form: 'person-form' }) })
		);
		expect(body).toMatchObject({ policy: 'person-form', basis: 'name-token-match' });
	});

	it('carries the policy on the not-approved branch too', async () => {
		mockModerate.mockResolvedValue({
			approved: false,
			summary: 'Blocked: Defamation',
			latency_ms: 2
		});

		const { status, body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: ['board@hospital.org', 'press@hospital.org']
		});

		expect(status).toBe(400);
		expect(body).toMatchObject({
			approved: false,
			policy: 'institutional',
			basis: 'seat-lexicon'
		});
	});

	it('degrades to unevaluable — still moderating — when the artifact is unavailable', async () => {
		mockArtifact.mockRejectedValue(new Error('artifact origin unavailable'));

		const { status, body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: ['board@hospital.org', 'press@hospital.org']
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'artifact-unavailable' });
		expect(mockModerate).toHaveBeenCalledTimes(1);
		expect(mockModerate).toHaveBeenCalledWith(
			TEXT,
			expect.objectContaining({ audience: expect.objectContaining({ form: 'unevaluable' }) })
		);
	});

	// The addressed set is read before the slug is, so these cases now name the
	// gate that actually fired. A request carrying no mailbox has not described a
	// send anyone can measure, and it spends no artifact read finding that out.
	it.each([
		['omitted', { text: TEXT }],
		['omitted beside an invalid slug', { text: TEXT, slug: 'Not A Slug' }],
		['empty', { text: TEXT, slug: SLUG, recipients: [] }],
		['not an array', { text: TEXT, slug: SLUG, recipients: 'board@hospital.org' }]
	])(
		'answers 200 with the strict policy when the addressed set is %s',
		async (_label, body) => {
			const result = await policyOf(body);

			expect(result.status).toBe(200);
			expect(result.body).toMatchObject({
				policy: 'unevaluable',
				reason: 'no-addressed-recipients'
			});
			expect(mockArtifact).not.toHaveBeenCalled();
			expect(mockModerate).toHaveBeenCalledTimes(1);
		}
	);

	it('keeps the strict policy for an invalid slug once an addressed set is supplied', async () => {
		const result = await policyOf({
			text: TEXT,
			slug: 'Not A Slug',
			recipients: ['board@hospital.org', 'press@hospital.org']
		});

		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({ policy: 'unevaluable', reason: 'no-slug' });
		expect(mockArtifact).not.toHaveBeenCalled();
		expect(mockModerate).toHaveBeenCalledTimes(1);
	});

	// The relay-only artifact publishes no mailbox at all, and the lane fact alone
	// grants nothing: `deriveAudience` folds that empty roster to `unevaluable`.
	// The endpoint refuses one step earlier — no addressed set is carried, so the
	// request is refused before the artifact is even read. A certified artifact
	// with published mailboxes must earn its verdict from those routes instead.
	it('refuses a certified artifact that carries no addressed set', async () => {
		mockArtifact.mockResolvedValue(artifact({}, 'cwc'));

		const { body } = await policyOf({ text: TEXT, slug: SLUG });

		expect(body.policy).not.toBe('institutional');
		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'no-addressed-recipients' });
		expect(mockArtifact).not.toHaveBeenCalled();
	});

	it('does not let the certified-delivery lane promote a roster the artifact published', async () => {
		mockArtifact.mockResolvedValue(artifact({ emails: ['jsmith@acme.com'] }, 'cwc'));

		const { body } = await policyOf({
			text: TEXT,
			slug: SLUG,
			recipients: ['jsmith@acme.com']
		});

		expect(body.policy).not.toBe('institutional');
	});
});
