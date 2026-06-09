import { describe, expect, it } from 'vitest';
import {
	applyEmailMergeFields,
	buildEmailTierContext,
	countEmailMergeFields,
	hasEmailMergeFields,
	type EmailMergeContext
} from '$lib/core/email/merge-fields';

const ctx: EmailMergeContext = {
	firstName: 'Ana <Admin>',
	lastName: 'Rivera',
	email: 'ana@example.org',
	postalCode: '94110',
	verificationStatus: 'verified',
	tierLabel: 'Established',
	tierContext: buildEmailTierContext('verified')
};

describe('email merge fields', () => {
	it('detects and counts supported tokens', () => {
		const template = 'Hi {{firstName}}, {{email}}';
		expect(hasEmailMergeFields(template)).toBe(true);
		expect(countEmailMergeFields(template)).toBe(2);
		expect(hasEmailMergeFields('No tokens here')).toBe(false);
	});

	it('escapes recipient values when rendering HTML bodies', () => {
		const out = applyEmailMergeFields('<p>Hello {{firstName}}</p>', ctx);
		expect(out).toContain('Ana &lt;Admin&gt;');
		expect(out).not.toContain('Ana <Admin>');
	});

	it('keeps subject replacements as header text, not HTML entities', () => {
		const out = applyEmailMergeFields('Hello {{firstName}}', ctx, 'header');
		expect(out).toBe('Hello Ana <Admin>');
	});

	it('strips control characters from header replacements', () => {
		const out = applyEmailMergeFields(
			'Hello {{firstName}}',
			{ ...ctx, firstName: 'Ana\r\nBcc: attacker@example.org' },
			'header'
		);
		expect(out).toBe('Hello AnaBcc: attacker@example.org');
	});
});
