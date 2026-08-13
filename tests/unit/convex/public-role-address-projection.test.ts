import { describe, expect, it } from 'vitest';
import { isPublicRoleFormAddress } from '../../../convex/lib/publicRoleAddress';
import {
	buildPublicTemplateDetailProjection,
	projectPublicDetailRecipientConfig,
	readPublicTemplateDetailProjection
} from '../../../convex/lib/publicTemplateDiscoverySource';
import { issuePublicRecipientProvenance } from '../../../convex/lib/publicRecipientProvenance';

const ACTIVE_SECRET = 'active-public-recipient-secret-32-bytes-minimum';
const USER_ID = 'users:role-address-author';
const NOW = 1_800_000_000_000;

function templateFixture(): Parameters<typeof buildPublicTemplateDetailProjection>[0] {
	return {
		_id: 'templates:role-address-fixture',
		_creationTime: NOW,
		slug: 'role-address-fixture',
		title: 'Role address fixture',
		description: 'A public projection fixture.',
		domain: 'civic',
		domainHue: 210,
		type: 'email',
		deliveryMethod: 'email',
		messageBody: 'Please consider this request.',
		sources: [],
		researchLog: [],
		preview: 'Please consider this request.',
		verifiedSends: 0,
		uniqueDistricts: 0,
		topics: []
	} as unknown as Parameters<typeof buildPublicTemplateDetailProjection>[0];
}

async function attestedRecipient({
	email,
	name,
	emailSource = 'https://agency.gov/contact'
}: {
	email: string;
	name: string;
	emailSource?: string;
}) {
	const recipient = {
		name,
		title: 'Director',
		organization: 'Public Agency',
		email,
		emailSource,
		isAiResolved: true,
		emailGrounded: true,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: emailSource
		}
	};
	const publicRecipientProvenance = await issuePublicRecipientProvenance(
		recipient,
		USER_ID,
		ACTIVE_SECRET,
		NOW
	);
	if (!publicRecipientProvenance) throw new Error('TEST_ATTESTATION_FAILED');
	return { ...recipient, publicRecipientProvenance };
}

describe('public role-form address projection', () => {
	it.each([
		'president@osu.edu',
		'chancellor@illinois.edu',
		'superintendent@pgcps.org',
		'planning@city.gov',
		'press@agency.gov',
		'patient.relations@health.org',
		'mayor@sfgov.org'
	])('admits the closed role-form lexicon entry %s', (email) => {
		expect(isPublicRoleFormAddress(email)).toBe(true);
	});

	it.each([
		'pelosi@house.gov',
		'j.smith@university.edu',
		'jane.doe@county.gov',
		'asmith@utility.com',
		'president2@x.gov',
		'info+tag@x.gov',
		'tghnews@health.org',
		'notanemail',
		'a@b@c.gov'
	])('refuses non-membership address %s', (email) => {
		expect(isPublicRoleFormAddress(email)).toBe(false);
	});

	it('withholds a named-individual address even when its signature is valid', async () => {
		const roleRecipient = await attestedRecipient({
			email: 'planning@agency.gov',
			name: 'Planning Office'
		});
		const namedRecipient = await attestedRecipient({
			email: 'ada.lovelace@agency.gov',
			name: 'Ada Lovelace'
		});

		const projected = await projectPublicDetailRecipientConfig(
			{ decisionMakers: [roleRecipient, namedRecipient] },
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);

		expect(projected.emails).toEqual(['planning@agency.gov']);
		expect(projected.decisionMakers).toHaveLength(1);
		expect(JSON.stringify(projected)).not.toContain('Ada Lovelace');
		expect(JSON.stringify(projected)).not.toContain('ada.lovelace@agency.gov');
	});

	it('retires stored named-individual rosters at both reader address sites', () => {
		const namedDecisionMaker = {
			email: 'ada.lovelace@agency.gov',
			emailGrounded: true as const,
			emailSource: 'https://agency.gov/contact',
			name: 'Ada Lovelace',
			title: 'Director',
			organization: 'Public Agency'
		};
		const namedInEmails = buildPublicTemplateDetailProjection(templateFixture(), {
			emails: [namedDecisionMaker.email],
			decisionMakers: [namedDecisionMaker]
		});
		expect(() => readPublicTemplateDetailProjection(namedInEmails)).toThrow(
			/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID/
		);

		const namedInDecisionMakers = buildPublicTemplateDetailProjection(templateFixture(), {
			emails: ['planning@agency.gov'],
			decisionMakers: [namedDecisionMaker]
		});
		expect(() => readPublicTemplateDetailProjection(namedInDecisionMakers)).toThrow(
			/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID/
		);
	});

	it('keeps filtered counts and recipient email derivation consistent', async () => {
		const roleRecipient = await attestedRecipient({
			email: 'press@agency.gov',
			name: 'Press Office'
		});
		const namedRecipient = await attestedRecipient({
			email: 'j.smith@agency.gov',
			name: 'Jordan Smith'
		});
		const projected = await projectPublicDetailRecipientConfig(
			{ decisionMakers: [roleRecipient, namedRecipient] },
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);
		const detail = readPublicTemplateDetailProjection(
			buildPublicTemplateDetailProjection(templateFixture(), projected)
		);

		expect(detail.recipient_count).toBe(detail.recipient_config.decisionMakers?.length);
		expect(detail.recipientEmails).toEqual(detail.recipient_config.emails);
	});

	it('round-trips a query-string channel source unchanged', async () => {
		const emailSource = 'https://agency.gov/contact?dept=planning';
		const roleRecipient = await attestedRecipient({
			email: 'planning@agency.gov',
			name: 'Planning Office',
			emailSource
		});
		const projected = await projectPublicDetailRecipientConfig(
			{ decisionMakers: [roleRecipient] },
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);
		const detail = readPublicTemplateDetailProjection(
			buildPublicTemplateDetailProjection(templateFixture(), projected)
		);

		expect(detail.recipient_config.decisionMakers?.[0]?.emailSource).toBe(emailSource);
	});
});
