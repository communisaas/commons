/**
 * The certified-delivery lane must not buy the permissive hazard set.
 *
 * A lane fact is not evidence about a recipient. An artifact can declare the
 * certified lane AND publish a personal mailbox on the same page, so a verdict
 * minted from the lane alone would strip a named human's S5/S7/S10 protection on
 * evidence nobody read. These cases drive the real endpoint and assert the
 * refusal, resolving the hazard set through the real resolver rather than
 * restating the mapping.
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
import {
	blockingHazardsForAudience,
	deriveAudience,
	type AudienceVerdict
} from '$lib/core/server/moderation/audience';
import { recipientEmailsFromConfig } from '$lib/types/template';
import { SEED_TEMPLATES } from '../../../convex/seedData';

const SLUG = 'clean-water';
const TEXT = 'The director ignored three years of complaints from my block.';

function artifact(recipient_config: unknown, deliveryMethod = 'email', slug = SLUG) {
	return { slug, detail: { slug, deliveryMethod, recipient_config } };
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

/** The verdict that actually reached the moderator, not one rebuilt for the test. */
function deliveredAudience(): AudienceVerdict {
	expect(mockModerate).toHaveBeenCalledTimes(1);
	return mockModerate.mock.calls[0][1].audience as AudienceVerdict;
}

describe('the certified-delivery lane cannot unlock the permissive hazard set', () => {
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
	});

	it('refuses a named human published on a certified-lane artifact', async () => {
		const recipient = 'jane.smith@hospital.org';
		mockArtifact.mockResolvedValue(
			artifact(
				{ decisionMakers: [{ name: 'Jane Smith', email: recipient }] },
				'cwc'
			)
		);

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [recipient] });

		expect(body.policy).toBe('person-form');
		expect(mockArtifact).toHaveBeenCalledWith(expect.anything(), SLUG);
		expect(blockingHazardsForAudience(deliveredAudience())).toEqual([
			'S1',
			'S4',
			'S5',
			'S7',
			'S10'
		]);
	});

	it('refuses an indeterminate mailbox published on a certified-lane artifact', async () => {
		const recipient = 'jsmith@acme.com';
		mockArtifact.mockResolvedValue(artifact({ emails: [recipient] }, 'cwc'));

		const { body } = await policyOf({ text: TEXT, slug: SLUG, recipients: [recipient] });

		expect(body).toMatchObject({ policy: 'unevaluable', reason: 'indeterminate-route' });
		expect(mockArtifact).toHaveBeenCalledWith(expect.anything(), SLUG);
		expect(blockingHazardsForAudience(deliveredAudience())).toEqual(
			expect.arrayContaining(['S5', 'S7', 'S10'])
		);
	});

	it.each(
		SEED_TEMPLATES.filter((template) => template.deliveryMethod === 'cwc').map((template) => [
			template.slug,
			template.recipientConfig,
			recipientEmailsFromConfig(template.recipientConfig)
		] as const)
	)(
		'keeps the shipped certified-lane roster institutional: %s',
		async (slug, recipientConfig, recipients) => {
			// Producer shapes, not hand-written fixtures: the reach this narrowing must
			// not cost is measured on the rosters and addresses the product actually ships.
			expect(recipients.length).toBeGreaterThan(0);
			mockArtifact.mockResolvedValue(artifact(recipientConfig, 'cwc', slug));

			const { body } = await policyOf({ text: TEXT, slug, recipients });

			expect(body).toMatchObject({ policy: 'institutional', basis: 'government-registry' });
			expect(mockArtifact).toHaveBeenCalledWith(expect.anything(), slug);
			expect(deliveredAudience()).toMatchObject({
				form: 'institutional',
				basis: 'government-registry',
				routes: recipients.length
			});
		}
	);

	it('refuses the empty roster in the fold and the unaddressed send at the endpoint — the same answer reached twice', async () => {
		expect(deriveAudience([], { certifiedRelay: true })).toEqual({
			form: 'unevaluable',
			reason: 'no-roster',
			routes: 0
		});

		mockArtifact.mockResolvedValue(artifact({}, 'cwc'));

		const { body } = await policyOf({ text: TEXT, slug: SLUG });

		expect(body).toMatchObject({
			policy: 'unevaluable',
			reason: 'no-addressed-recipients'
		});
		expect(mockArtifact).not.toHaveBeenCalled();
		expect(deliveredAudience()).toEqual({
			form: 'unevaluable',
			reason: 'no-addressed-recipients',
			routes: 0
		});
	});

	it('cannot override a person or rescue an indeterminate route when set directly', () => {
		// The rule attacked at its own weakest shape: the flag is not a verdict and
		// classifies nothing — it only corroborates a registry grant against the
		// name veto, so it cannot reach a person or an indeterminate route at all.
		expect(
			deriveAudience([{ email: 'jane.smith@hospital.org', name: 'Jane Smith' }], {
				certifiedRelay: true
			})
		).toEqual({ form: 'person-form', basis: 'name-token-match', routes: 1 });
		expect(
			deriveAudience([{ email: 'jsmith@acme.com', name: null }], { certifiedRelay: true })
		).toEqual({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 1
		});
	});
});
