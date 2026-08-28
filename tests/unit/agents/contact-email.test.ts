import { describe, expect, it } from 'vitest';

import {
	hasRoleFormLocalPart,
	orderContactEmails,
	stripNonContentMarkup
} from '$lib/core/agents/contact-email';
import { extractContactHints } from '$lib/core/agents/agents/decision-maker';
import {
	boundContactHintEmails,
	DECISION_MAKER_PROVIDER_LIMITS,
	GEMINI_STAGE_ENVELOPES
} from '$lib/core/agents/provider-call-envelope';
import {
	buildContactSynthesisPrompt,
	CONTACT_SYNTHESIS_PROMPT,
	generateDomainContext
} from '$lib/core/agents/prompts/decision-maker';

describe('contact email extraction', () => {
	it('removes image-filename false positives from the WSHA-shaped fixture', () => {
		const fixture =
			'![Andrew Busz](https://wsha.org/wp-content/uploads/Andrew-Busz-updated-website-e1675378638437@2x.png) [Andrew](mailto:andrewb@wsha.org) foo@2x.jpeg logo@3x.avif';

		expect(extractContactHints(fixture).emails).toEqual(['andrewb@wsha.org']);
	});

	it('does not let no-reply addresses consume a slot', () => {
		const fixture =
			'noreply@city.gov no-reply@city.gov donotreply-marker@example.com clerk@city.gov';

		expect(extractContactHints(fixture).emails).toEqual(['clerk@city.gov']);
	});

	it('puts a structural role address before body addresses', () => {
		const fixture =
			'Email webmaster@site.org or alumni@site.org.\n\n--- CONTACT EMAILS (from page links) ---\nprovost@site.org';

		expect(extractContactHints(fixture).emails).toEqual([
			'provost@site.org',
			'webmaster@site.org',
			'alumni@site.org'
		]);
	});

	it('puts a non-role structural address before a body address', () => {
		const fixture =
			'Email jdoe@site.org.\n\n--- CONTACT EMAILS (from page links) ---\nasmith@site.org';

		expect(extractContactHints(fixture).emails).toEqual(['asmith@site.org', 'jdoe@site.org']);
	});

	it('keeps structural provenance when the same mailto address already appeared in the body', () => {
		const fixture =
			'Mailing list pressoffice-vendor@mailchimp-lists.net. Staff: jdoe@wsha.org, rsmith@wsha.org, and andrewb@wsha.org.\n\n--- CONTACT EMAILS (from page links) ---\nandrewb@wsha.org';

		expect(extractContactHints(fixture).emails).toEqual([
			'andrewb@wsha.org',
			'pressoffice-vendor@mailchimp-lists.net',
			'jdoe@wsha.org',
			'rsmith@wsha.org'
		]);
	});

	it('deduplicates case-insensitively while keeping the first casing', () => {
		const fixture = 'Clerk@city.gov clerk@city.gov';

		expect(extractContactHints(fixture).emails).toEqual(['Clerk@city.gov']);
	});

	it('keeps source order within the role-form tier', () => {
		const fixture =
			'--- CONTACT EMAILS (from page HTML) ---\nplanning@city.gov clerk@city.gov';

		expect(extractContactHints(fixture).emails).toEqual([
			'planning@city.gov',
			'clerk@city.gov'
		]);
	});

	it('uses the decorated input index when tier and source offset tie', () => {
		const fixture = 'This literal fixture intentionally has no email occurrence.';
		const sameTierEmails = ['planning@city.gov', 'clerk@city.gov'];

		expect(orderContactEmails(fixture, sameTierEmails)).toEqual(sameTierEmails);
	});

	it('keeps document order among same-tier addresses without a structural block', () => {
		const fixture = 'Email zelda@site.org before alpha@site.org.';

		expect(extractContactHints(fixture).emails).toEqual(['zelda@site.org', 'alpha@site.org']);
	});

	it('matches only closed role tokens in whole or segmented local parts', () => {
		expect(hasRoleFormLocalPart('mayor.office@city.gov')).toBe(true);
		expect(hasRoleFormLocalPart('office_mayor@city.gov')).toBe(true);
		expect(hasRoleFormLocalPart('mayorish@city.gov')).toBe(false);
	});
});

describe('non-content markup stripping', () => {
	it('removes ineligible source-only addresses and preserves real content', () => {
		const fixture = `<html><body>
			<script>var s="tracker@vendor.io";</script>
			<script type="application/ld+json">{"email":"schema@site.org"}</script>
			<style>/* ui@site.org */</style>
			<!-- hidden@site.org -->
			<a href="mailto:planning@city.gov">planning@city.gov</a>
		</body></html>`;

		const stripped = stripNonContentMarkup(fixture);

		expect(stripped).not.toContain('tracker@');
		expect(stripped).not.toContain('schema@');
		expect(stripped).not.toContain('ui@');
		expect(stripped).not.toContain('hidden@');
		expect(stripped).toContain('planning@city.gov');
	});
});

describe('contact hint prompt bounds', () => {
	it('stops at the count bound', () => {
		const fixture = Array.from({ length: 20 }, (_, index) => `person${index}@city.gov`);

		expect(boundContactHintEmails(fixture)).toHaveLength(12);
	});

	it('stops at the cumulative UTF-8 byte bound', () => {
		const fixture = Array.from(
			{ length: 12 },
			(_, index) => `person${index}@${'é'.repeat(119)}.org`
		);

		const bounded = boundContactHintEmails(fixture);
		const totalBytes = bounded.reduce(
			(sum, email) => sum + new TextEncoder().encode(email).byteLength,
			0
		);

		expect(totalBytes).toBeLessThanOrEqual(
			DECISION_MAKER_PROVIDER_LIMITS.maxContactHintBytesPerPage
		);
		expect(bounded.length).toBeLessThan(12);
		expect(bounded.every((email) => !email.includes('\uFFFD'))).toBe(true);
	});

	it('keeps the producer-emitted worst-case synthesis request below the hard envelope', () => {
		// gemini-client.ts:114-116 counts user prompt + system instruction + the
		// serialized response schema; line 136 throws if their sum exceeds 64 KiB.
		const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
		const limits = DECISION_MAKER_PROVIDER_LIMITS;
		const fill = (bytes: number) => 'x'.repeat(bytes);

		// provider-call-envelope.ts:128-134: maximize both the cumulative email
		// bytes and the 12-address delimiter count without crossing maxEmailBytes.
		const emailLengths = Array(limits.maxContactHintEmailsPerPage).fill(5) as number[];
		let emailBytesLeft = limits.maxContactHintBytesPerPage - 5 * emailLengths.length;
		for (let index = 0; index < emailLengths.length && emailBytesLeft > 0; index++) {
			const added = Math.min(limits.maxEmailBytes - emailLengths[index], emailBytesLeft);
			emailLengths[index] += added;
			emailBytesLeft -= added;
		}
		const worstEmails = emailLengths.map((length) => `${'a'.repeat(length - 5)}@x.co`);

		// gemini-provider.ts:1190-1225 emits at most synthesisChunkSize identities,
		// each with these truncateUtf8 bounds, plus six pages. seat-hop.ts can
		// merge all three identities onto one shared hop, so that is the widest
		// real attribution line; the other five pages each carry one identity.
		const identities = Array.from({ length: limits.synthesisChunkSize }, () => ({
			identity: {
				position: '',
				name: fill(256),
				title: fill(512),
				organization: fill(512),
				search_evidence: fill(1_024)
			},
			reasoning: fill(1_024)
		}));
		const pagesPerIdentity = Math.ceil(
			limits.maxPagesPerSynthesisChunk / limits.synthesisChunkSize
		);
		const pages = Array.from({ length: limits.maxPagesPerSynthesisChunk }, (_, index) => ({
			url: fill(512),
			title: fill(240),
			text: fill(limits.maxPageBytesPerSynthesisChunk),
			recordBlocks: { state: 'blocked' as const, why: 'test_fixture_has_no_raw_html' },
			contactHints: {
				emails: worstEmails,
				phones: Array.from({ length: limits.maxContactHintPhonesPerPage }, () =>
					fill(limits.maxPhoneBytes)
				),
				socialUrls: Array.from({ length: limits.maxContactHintSocialUrlsPerPage }, () =>
					fill(limits.maxSocialUrlBytes)
				)
			},
			attributedTo:
				index === 0
					? identities.map((_, identityIndex) => identityIndex)
					: [Math.min(identities.length - 1, Math.floor(index / pagesPerIdentity))]
		}));
		const issueContext = {
			subjectLine: fill(800),
			coreMessage: fill(limits.maxIssueCoreMessageBytes),
			topics: Array.from({ length: limits.maxIssueTopics }, () => fill(256))
		};

		// prompts/decision-maker.ts supplies both serialized strings. Three identities
		// can yield at most three domain types; these are the three longest contexts.
		const synthesisUserBytes = byteLength(
			buildContactSynthesisPrompt(identities, pages, issueContext)
		);
		const synthesisSystemBytes = byteLength(
			CONTACT_SYNTHESIS_PROMPT.replace(/{CURRENT_DATE}/g, 'September 30, 2026').replace(
				/{DOMAIN_CONTEXT}/g,
				generateDomainContext(new Set(['government', 'union', 'corporate']))
			)
		);
		// gemini-provider.ts PERSON_LOOKUP_RESPONSE_SCHEMA. The provider integration
		// test serializes the actual object and pins this operand, so it cannot drift.
		const synthesisResponseSchemaBytes = 640;
		const worstCasePromptBytes =
			synthesisUserBytes + synthesisSystemBytes + synthesisResponseSchemaBytes;

		expect(DECISION_MAKER_PROVIDER_LIMITS.maxContactHintEmailsPerPage).toBe(12);
		expect(DECISION_MAKER_PROVIDER_LIMITS.maxEmailBytes).toBe(254);
		expect(DECISION_MAKER_PROVIDER_LIMITS.maxContactHintBytesPerPage).toBe(896);
		expect(worstEmails.reduce((sum, email) => sum + byteLength(email), 0)).toBe(
			limits.maxContactHintBytesPerPage
		);
		expect({ synthesisUserBytes, synthesisSystemBytes, synthesisResponseSchemaBytes }).toEqual({
			synthesisUserBytes: 57_576,
			synthesisSystemBytes: 7_314,
			synthesisResponseSchemaBytes: 640
		});
		expect(worstCasePromptBytes).toBe(65_530);
		expect(worstCasePromptBytes).toBeLessThan(
			GEMINI_STAGE_ENVELOPES['decision-contact-synthesis'].maxPromptBytes
		);
	});
});
