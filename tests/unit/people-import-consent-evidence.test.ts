import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
		expect(importPage).toContain("label: 'Consent evidence custody'");
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
		expect(supporters).toContain('emailSubscribed: emailSubscribedConsentEvidence');
		expect(supporters).toContain('smsSubscribed: smsSubscribedConsentEvidence');
	});

	it('threads aggregate consent evidence into space load data', () => {
		expect(spaces).toContain('consentEvidence: {');
		expect(layoutServer).toContain('consentEvidence: {');
		expect(layoutServer).toContain('emailSubscribed: asNumber');
	});
});
