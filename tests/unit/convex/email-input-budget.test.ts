import { describe, expect, it } from 'vitest';

import {
	MAX_EMAIL_AB_CONFIG_BYTES,
	MAX_EMAIL_BODY_HTML_BYTES,
	MAX_EMAIL_SUBJECT_BYTES,
	assertAbMetadataInput,
	assertEmailDraftInput,
	assertEmailDraftPatch
} from '../../../convex/lib/emailInputBudget';

const valid = {
	subject: 'A bounded subject',
	bodyHtml: '<p>Hello</p>',
	fromName: 'Commons',
	fromEmail: 'hello@commons.email'
};

describe('email Convex input budgets', () => {
	it('accepts a normal draft and partial patch', () => {
		expect(() => assertEmailDraftInput(valid)).not.toThrow();
		expect(() => assertEmailDraftPatch({ subject: 'Updated' })).not.toThrow();
	});

	it('measures multi-byte input by UTF-8 bytes', () => {
		expect(() =>
			assertEmailDraftInput({
				...valid,
				subject: '🪓'.repeat(Math.floor(MAX_EMAIL_SUBJECT_BYTES / 2))
			})
		).toThrow(/EMAIL_SUBJECT_INVALID/);
		expect(() =>
			assertEmailDraftPatch({ bodyHtml: '界'.repeat(Math.floor(MAX_EMAIL_BODY_HTML_BYTES / 2)) })
		).toThrow(/EMAIL_BODY_HTML_INVALID/);
	});

	it('rejects header injection and malformed sender addresses', () => {
		expect(() => assertEmailDraftInput({ ...valid, fromEmail: 'a@example.com\r\nBcc:x@y.z' })).toThrow(
			/EMAIL_FROM_ADDRESS_INVALID/
		);
		expect(() => assertEmailDraftPatch({ fromEmail: 'not-an-email' })).toThrow(
			/EMAIL_FROM_ADDRESS_INVALID/
		);
	});

	it('bounds and validates A/B metadata', () => {
		expect(() => assertAbMetadataInput('run_20260719', { winnerMetric: 'open' })).not.toThrow();
		expect(() => assertAbMetadataInput('../foreign', {})).toThrow(/EMAIL_AB_PARENT_ID_INVALID/);
		expect(() =>
			assertAbMetadataInput('run', { value: 'x'.repeat(MAX_EMAIL_AB_CONFIG_BYTES) })
		).toThrow(/EMAIL_AB_CONFIG_INVALID/);
	});
});
