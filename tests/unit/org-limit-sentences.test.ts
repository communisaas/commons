import { describe, it, expect } from 'vitest';
import {
	CLIENT_DIRECT_EMAIL_THRESHOLD,
	MAX_DECRYPTED_SMS_DISPATCH,
	ORG_LIMIT_CODES,
	buildOrgLimitNotice,
	callRoutingLimitNotice,
	congressionalDeliveryLimitNotice,
	emailDeliveryLimitNotice,
	emailServerDispatchLimitSentence,
	orgLimitReassurance,
	orgLimitSentence,
	platformApiSyncLimitNotice,
	textDeliveryLimitNotice,
	textDispatchLimitSentence,
	workflowEmailLimitNotice
} from '$lib/data/org-limit-sentences';

const PLATFORM_API_CODES = [
	'platform_api_sync_not_armed',
	'platform_api_credential_custody_not_configured',
	'platform_api_credential_probe_failed'
] as const;

// Assembled from fragments so the excised internal vocabulary never appears
// verbatim in this file either.
const ED = 'ed';
const INTERNAL_VOCABULARY = new RegExp(
	`\\b(arm${ED}|arm${'ing'}|bound${ED}|depend${'ency'}-bound|draft-on${'ly'}|gat${ED}|not arm${ED})\\b`
);

describe('org limit sentences', () => {
	it('maps every boundary code to a sentence', () => {
		for (const code of ORG_LIMIT_CODES) {
			const sentence = orgLimitSentence(code);
			expect(sentence.length).toBeGreaterThan(0);
			expect(sentence).toMatch(/\.$/);
		}
	});

	it('keeps each limit in plain org words', () => {
		expect(orgLimitSentence('text_dispatch_not_armed')).toContain(
			`batches of ${MAX_DECRYPTED_SMS_DISPATCH}`
		);
		expect(orgLimitSentence('email_server_dispatch_dependency_missing')).toContain(
			`more than ${CLIENT_DIRECT_EMAIL_THRESHOLD} recipients`
		);
		expect(orgLimitSentence('workflow_email_dependency_missing')).toMatch(
			/every other step runs/
		);
		expect(orgLimitSentence('call_initiation_not_armed')).toMatch(/phone service/);
		expect(orgLimitSentence('congressional_delivery')).toMatch(/save as drafts/);
		// Each platform-api code carries its own sentence, true at the moment
		// it renders, and each names the CSV path that works today.
		expect(orgLimitSentence('platform_api_sync_not_armed')).toMatch(
			/isn't available for this platform yet/
		);
		expect(orgLimitSentence('platform_api_credential_custody_not_configured')).toMatch(
			/can't be stored yet/
		);
		expect(orgLimitSentence('platform_api_credential_probe_failed')).toMatch(/reconnect it/);
		const platformSentences = PLATFORM_API_CODES.map((code) => orgLimitSentence(code));
		for (const sentence of platformSentences) {
			expect(sentence).toMatch(/CSV/);
		}
		expect(new Set(platformSentences).size).toBe(PLATFORM_API_CODES.length);
	});

	it('keeps internal vocabulary, identifiers, and paths out of member-facing copy', () => {
		for (const code of ORG_LIMIT_CODES) {
			for (const text of [orgLimitSentence(code), orgLimitReassurance(code) ?? '']) {
				// Internal state-machine vocabulary
				expect(text).not.toMatch(INTERNAL_VOCABULARY);
				// Environment-variable-shaped tokens
				expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
				// Chokepoint-style and planning-task-style identifiers
				expect(text).not.toMatch(/\bCP-/);
				expect(text).not.toMatch(/\bT\d+-\d+\b/);
				expect(text).not.toMatch(/\b[EAC]-\d+\b/);
				// File paths and source extensions
				expect(text).not.toMatch(/[\\/]/);
				expect(text).not.toMatch(/\.(ts|svelte|md|json)\b/);
			}
		}
	});

	it('interpolates the batch size and threshold instead of hard-coding them', () => {
		expect(textDispatchLimitSentence(7)).toContain('batches of 7');
		expect(textDispatchLimitSentence(7)).not.toContain(String(MAX_DECRYPTED_SMS_DISPATCH));
		expect(emailServerDispatchLimitSentence(9999)).toContain('more than 9999 recipients');
		expect(emailServerDispatchLimitSentence(9999)).not.toContain(
			String(CLIENT_DIRECT_EMAIL_THRESHOLD)
		);
		// Defaults come from the exported constants
		expect(textDispatchLimitSentence()).toBe(orgLimitSentence('text_dispatch_not_armed'));
		expect(emailServerDispatchLimitSentence()).toBe(
			orgLimitSentence('email_server_dispatch_dependency_missing')
		);
	});

	it('exports positive integer bounds', () => {
		expect(Number.isInteger(CLIENT_DIRECT_EMAIL_THRESHOLD)).toBe(true);
		expect(CLIENT_DIRECT_EMAIL_THRESHOLD).toBeGreaterThan(0);
		expect(Number.isInteger(MAX_DECRYPTED_SMS_DISPATCH)).toBe(true);
		expect(MAX_DECRYPTED_SMS_DISPATCH).toBeGreaterThan(0);
	});

	it('reassures about preserved artifacts only where the sentence does not already', () => {
		expect(orgLimitReassurance('text_dispatch_not_armed')).toMatch(/draft is saved/);
		expect(orgLimitReassurance('workflow_email_dependency_missing')).toMatch(
			/workflow is saved/
		);
		// These sentences already state what is preserved
		expect(orgLimitReassurance('email_server_dispatch_dependency_missing')).toBeNull();
		expect(orgLimitReassurance('congressional_delivery')).toBeNull();
	});

	it('keeps operator detail off the headline', () => {
		const notice = buildOrgLimitNotice('text_dispatch_not_armed', {
			missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
			dependency: 'transport credentials',
			message: 'runtime status line'
		});
		expect(notice.operatorDetail).not.toBeNull();
		expect(notice.operatorDetail?.missing).toEqual(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
		expect(notice.operatorDetail?.dependency).toBe('transport credentials');
		expect(notice.sentence).not.toContain('TWILIO');
		expect(notice.sentence).not.toContain('transport credentials');
		expect(notice.reassurance ?? '').not.toContain('TWILIO');
	});

	it('returns no operator detail when the readiness slice is absent', () => {
		expect(buildOrgLimitNotice('call_initiation_not_armed').operatorDetail).toBeNull();
		expect(textDeliveryLimitNotice(null).operatorDetail).toBeNull();
		expect(emailDeliveryLimitNotice(undefined).operatorDetail).toBeNull();
	});

	it('adapts each readiness slice shape into the shared notice contract', () => {
		const text = textDeliveryLimitNotice({
			dispatchRuntimeMissing: ['TWILIO_PHONE_NUMBER'],
			dispatchRuntimeDependency: 'carrier transport',
			dispatchRuntimeMessage: 'status'
		});
		expect(text.code).toBe('text_dispatch_not_armed');
		expect(text.operatorDetail?.missing).toEqual(['TWILIO_PHONE_NUMBER']);

		const email = emailDeliveryLimitNotice({
			serverDispatchRuntimeMissing: ['AWS_ACCESS_KEY_ID'],
			serverDispatchRuntimeDependency: 'email infrastructure',
			serverDispatchRuntimeMessage: 'status'
		});
		expect(email.code).toBe('email_server_dispatch_dependency_missing');
		expect(email.operatorDetail?.missing).toEqual(['AWS_ACCESS_KEY_ID']);

		const workflow = workflowEmailLimitNotice({
			missing: ['org key verifier'],
			dependency: 'email infrastructure',
			message: 'status'
		});
		expect(workflow.code).toBe('workflow_email_dependency_missing');
		expect(workflow.operatorDetail?.missing).toEqual(['org key verifier']);

		const calls = callRoutingLimitNotice({
			initiationRuntimeMissing: ['TWILIO_ACCOUNT_SID'],
			initiationRuntimeDependency: 'phone transport',
			initiationRuntimeMessage: 'status'
		});
		expect(calls.code).toBe('call_initiation_not_armed');
		expect(calls.operatorDetail?.missing).toEqual(['TWILIO_ACCOUNT_SID']);

		const platform = platformApiSyncLimitNotice({
			runtimeMissing: ['PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY'],
			runtimeDependency: 'credential custody',
			runtimeMessage: 'status'
		});
		expect(platform.code).toBe('platform_api_sync_not_armed');
		expect(platform.operatorDetail?.missing).toEqual(['PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY']);
		const platformProbe = platformApiSyncLimitNotice(
			{
				runtimeMissing: [],
				runtimeDependency: 'credential custody',
				runtimeMessage: 'status'
			},
			'platform_api_credential_probe_failed'
		);
		expect(platformProbe.code).toBe('platform_api_credential_probe_failed');
		expect(platformProbe.sentence).toBe(orgLimitSentence('platform_api_credential_probe_failed'));
		expect(platformProbe.sentence).not.toBe(platform.sentence);

		const congressional = congressionalDeliveryLimitNotice({
			runtimeMissing: ['CWC_API_KEY'],
			runtimeDependency: 'congressional transport',
			runtimeMessage: 'status'
		});
		expect(congressional.code).toBe('congressional_delivery');
		expect(congressional.operatorDetail?.missing).toEqual(['CWC_API_KEY']);
	});
});
