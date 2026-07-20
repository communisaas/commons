import { describe, expect, it } from 'vitest';
import {
	PUBLIC_RECIPIENT_PROVENANCE_TTL_MS,
	issuePublicRecipientProvenance,
	verifyPublicRecipientProvenance
} from '../../../convex/lib/publicRecipientProvenance';
import { publicRecipientIntentCount } from '../../../convex/lib/publicTemplateDiscoverySource';

const ACTIVE_SECRET = 'active-public-recipient-secret-32-bytes-minimum';
const PREVIOUS_SECRET = 'previous-public-recipient-secret-32-bytes-minimum';
const USER_ID = 'users:author-1';
const NOW = 1_800_000_000_000;

function groundedRecipient() {
	return {
		name: '  Ada   Lovelace ',
		title: 'Director',
		organization: 'Agency',
		email: ' Ada@Agency.GOV ',
		emailSource: 'https://agency.gov/contact',
		isAiResolved: true,
		emailGrounded: true,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: 'https://agency.gov/contact'
		},
		roleCategory: 'executes',
		accountabilityOpener: 'Please account for the published decision.',
		relevanceRank: 1,
		personalPrompt: 'private authoring prompt'
	};
}

async function attestedRecipient(secret = ACTIVE_SECRET) {
	const recipient = groundedRecipient();
	const publicRecipientProvenance = await issuePublicRecipientProvenance(
		recipient,
		USER_ID,
		secret,
		NOW
	);
	expect(publicRecipientProvenance).not.toBeNull();
	return { ...recipient, publicRecipientProvenance: publicRecipientProvenance! };
}

describe('public recipient provenance', () => {
	it('counts current and legacy recipient-intent shapes without compatibility double-counting', () => {
		expect(
			publicRecipientIntentCount({
				decisionMakers: [{ email: 'one@example.test' }, { email: 'two@example.test' }],
				customRecipients: [{ email: 'three@example.test' }],
				recipientEmails: [
					'one@example.test',
					'two@example.test',
					'three@example.test'
				],
				emails: ['one@example.test', 'two@example.test', 'three@example.test']
			})
		).toBe(3);
		expect(
			publicRecipientIntentCount({
				recipients: [{ type: 'congressional' }, { email: 'direct@example.test' }]
			})
		).toBe(2);
	});

	it('returns only canonical signed public claims', async () => {
		const verified = await verifyPublicRecipientProvenance(
			await attestedRecipient(),
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);

		expect(verified).toEqual({
			email: 'ada@agency.gov',
			emailSource: 'https://agency.gov/contact',
			name: 'Ada Lovelace',
			title: 'Director',
			organization: 'Agency',
			roleCategory: 'executes',
			accountabilityOpener: 'Please account for the published decision.',
			relevanceRank: 1
		});
		expect(verified).not.toHaveProperty('personalPrompt');
	});

	it('rejects forgeable client flags without a server proof', async () => {
		expect(
			await verifyPublicRecipientProvenance(
				groundedRecipient(),
				USER_ID,
				[ACTIVE_SECRET],
				NOW
			)
		).toBeNull();
	});

	it.each([
		['email', 'other@agency.gov'],
		['emailSource', 'https://agency.gov/other'],
		['name', 'Other Person'],
		['title', 'Deputy Director'],
		['organization', 'Other Agency'],
		['accountabilityOpener', 'Changed public copy'],
		['roleCategory', 'shapes'],
		['relevanceRank', 2]
	] as const)('rejects tampering with signed %s', async (field, value) => {
		const recipient = await attestedRecipient();
		const tampered = { ...recipient, [field]: value };
		expect(
			await verifyPublicRecipientProvenance(tampered, USER_ID, [ACTIVE_SECRET], NOW)
		).toBeNull();
	});

	it('binds the proof to the author and expiry window', async () => {
		const recipient = await attestedRecipient();
		expect(
			await verifyPublicRecipientProvenance(recipient, 'users:other', [ACTIVE_SECRET], NOW)
		).toBeNull();
		expect(
			await verifyPublicRecipientProvenance(
				recipient,
				USER_ID,
				[ACTIVE_SECRET],
				NOW + PUBLIC_RECIPIENT_PROVENANCE_TTL_MS + 60_001
			)
		).toBeNull();
	});

	it('accepts the previous secret during rotation', async () => {
		const recipient = await attestedRecipient(PREVIOUS_SECRET);
		expect(
			await verifyPublicRecipientProvenance(
				recipient,
				USER_ID,
				[ACTIVE_SECRET, PREVIOUS_SECRET],
				NOW
			)
		).not.toBeNull();
	});

	it('refuses non-HTTPS sources, credentials, query strings, or fragments', async () => {
		for (const emailSource of [
			'http://agency.gov/contact',
			'https://user:pass@agency.gov/contact',
			'https://agency.gov/contact?person=ada',
			'https://agency.gov/contact#ada'
		]) {
			expect(
				await issuePublicRecipientProvenance(
					{
						...groundedRecipient(),
						emailSource,
						publicEmailGrounding: {
							version: 1,
							method: 'page-read',
							source: emailSource
						}
					},
					USER_ID,
					ACTIVE_SECRET,
					NOW
				)
			).toBeNull();
		}
	});

	it('refuses stale cache hits and unbound grounding markers', async () => {
		const recipient = groundedRecipient();
		const { publicEmailGrounding: _grounding, ...withoutFreshGrounding } = recipient;

		expect(
			await issuePublicRecipientProvenance(
				{ ...withoutFreshGrounding, cacheHit: true },
				USER_ID,
				ACTIVE_SECRET,
				NOW
			)
		).toBeNull();
		expect(
			await issuePublicRecipientProvenance(
				{
					...recipient,
					publicEmailGrounding: {
						version: 1,
						method: 'page-read',
						source: 'https://agency.gov/other-contact'
					}
				},
				USER_ID,
				ACTIVE_SECRET,
				NOW
			)
		).toBeNull();
	});
});
