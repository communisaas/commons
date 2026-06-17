import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CONSENT_SCOPE_SENTENCE,
	NO_CONSENT_RECORDS_SENTENCE,
	describeEmailConsent,
	describeTextConsent
} from '$lib/components/org/os/people-reach';

const platformProfiles = readFileSync('src/lib/data/platform-export-profiles.ts', 'utf8');
const importPage = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.svelte',
	'utf8'
);
const importServer = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.server.ts',
	'utf8'
);
const schema = readFileSync('convex/schema.ts', 'utf8');
const supporters = readFileSync('convex/supporters.ts', 'utf8');
const spaces = readFileSync('src/lib/components/org/os/spaces.ts', 'utf8');
const layoutServer = readFileSync('src/routes/org/[slug]/+layout.server.ts', 'utf8');

describe('People import consent evidence custody', () => {
	it('recognizes consent source/date/text fields as platform-neutral import targets', () => {
		expect(platformProfiles).toContain("| 'email_consent_source'");
		expect(platformProfiles).toContain("| 'sms_consent_text'");
		expect(platformProfiles).toContain("'email consent source': 'email_consent_source'");
		expect(platformProfiles).toContain("'sms consent date': 'sms_consented_at'");
		expect(importPage).toContain("{ value: 'email_consent_source', label: 'Email consent source' }");
		expect(importPage).toContain("{ value: 'sms_consent_text', label: 'SMS consent text' }");
		expect(importPage).toContain('Consent evidence columns');
		expect(importPage).toContain('consentEvidenceColumnCount');
	});

	it('maps bounded consent metadata without treating it as dispatch permission', () => {
		expect(importServer).toContain("'email_consent_source'");
		expect(importServer).toContain("'sms_consented_at'");
		expect(importServer).toContain('parseConsentTimestamp');
		expect(importServer).toContain('importedConsentSource');
		expect(importServer).toContain('emailConsentSource: mapped.emailConsentSource || undefined');
		expect(importServer).toContain('smsConsentText: mapped.smsConsentText || undefined');
		expect(importServer).toContain('consent_evidence: consentEvidence');
		expect(importPage).toContain('not legal clearance or');
		expect(importPage).toContain('carrier dispatch proof');
	});

	it('persists consent evidence and tightens duplicate-row suppression status', () => {
		expect(schema).toContain('emailConsentSource: v.optional(v.string())');
		expect(schema).toContain('smsConsentedAt: v.optional(v.number())');
		expect(supporters).toContain('const EMAIL_STATUS_RANK');
		expect(supporters).toContain('const SMS_STATUS_RANK');
		expect(supporters).toContain('const nextEmailStatus = stricterStatus(');
		expect(supporters).toContain('existing.emailStatus,');
		expect(supporters).toContain('patch.emailStatus = nextEmailStatus');
		expect(supporters).toContain('const nextSmsStatus = stricterStatus(');
		expect(supporters).toContain('patch.smsStatus = nextSmsStatus');
		expect(supporters).toContain('patch.emailConsentSource = s.emailConsentSource');
		expect(supporters).toContain('patch.smsConsentText = s.smsConsentText');
		expect(supporters).toContain('emailConsentSource: s.emailConsentSource');
		expect(supporters).toContain('smsConsentText: s.smsConsentText');
		expect(supporters).toContain('consentEvidence: {');
		// getSummaryStats now reads the denormalized breakdown counters instead
		// of scanning every supporter row; the consent-evidence block is sourced
		// from org.supporterStats rather than per-row locals.
		expect(supporters).toContain('emailSubscribed: stats.emailSubscribedConsentEvidence');
		expect(supporters).toContain('smsSubscribed: stats.smsSubscribedConsentEvidence');
	});

	it('threads aggregate consent evidence into space load data', () => {
		expect(spaces).toContain('consentEvidence: {');
		expect(layoutServer).toContain('consentEvidence: {');
		expect(layoutServer).toContain('emailSubscribed: asNumber');
	});
});

describe('People space consent sentences', () => {
	const consentEvidence = { email: 940, emailSubscribed: 812, sms: 120, smsSubscribed: 98 };

	it('reads email consent records as one plain sentence traced to the summary fields', () => {
		expect(describeEmailConsent(consentEvidence)).toBe(
			'Consent records on file for 940 people · 812 currently subscribed'
		);
	});

	it('reads text consent records as one plain sentence traced to the summary fields', () => {
		expect(describeTextConsent(consentEvidence)).toBe(
			'Text consent records for 120 people · 98 currently opted in'
		);
	});

	it('omits the text consent line when no text consent records exist', () => {
		expect(describeTextConsent({ ...consentEvidence, sms: 0 })).toBeNull();
	});

	it('phrases zero consent records as a quiet sentence, not a zero', () => {
		expect(describeEmailConsent({ ...consentEvidence, email: 0 })).toBe(
			NO_CONSENT_RECORDS_SENTENCE
		);
		expect(NO_CONSENT_RECORDS_SENTENCE).toMatch(/^No consent records on file yet/);
	});

	it('keeps the honesty that consent records are origin, not permission to send', () => {
		expect(CONSENT_SCOPE_SENTENCE).toMatch(/where permission came from/);
		expect(CONSENT_SCOPE_SENTENCE).toMatch(/not permission to send/);
		const peopleSurface = readFileSync('src/lib/components/org/os/BaseSpace.svelte', 'utf8');
		expect(peopleSurface).toContain('CONSENT_SCOPE_SENTENCE');
	});
});
