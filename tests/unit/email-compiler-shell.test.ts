import { describe, it, expect } from 'vitest';
import {
	compileEmailShell,
	compileSubjectMergeFields,
	type MergeContext,
	type VerificationBlock
} from '$lib/server/email/compiler';

const verification: VerificationBlock = {
	totalRecipients: 150,
	verifiedCount: 45,
	verifiedPct: 30,
	districtCount: 8
};

describe('compileEmailShell', () => {
	it('wraps body in DOCTYPE shell', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {
			platformUrl: 'https://example.org'
		});
		expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
		expect(out).toContain('<p>hi</p>');
	});

	it('renders the verification block with the supplied stats', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {});
		expect(out).toContain('Verification Context');
		expect(out).toContain('45 of 150');
		expect(out).toContain('8 districts');
	});

	it('leaves merge fields for the dispatch path to resolve per recipient', () => {
		const out = compileEmailShell('Hi {{firstName}}!', verification, {});
		expect(out).toContain('{{firstName}}');
	});

	it('emits the platform host derived from platformUrl when unsubscribe is set', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {
			platformUrl: 'https://example.org',
			unsubscribeUrl: 'https://example.org/unsubscribe/abc'
		});
		expect(out).toContain('example.org');
		expect(out).toContain('Unsubscribe');
		expect(out).toContain('https://example.org/unsubscribe/abc');
	});

	it('hides the unsubscribe block when unsubscribeUrl is omitted', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {
			platformUrl: 'https://example.org'
		});
		expect(out).not.toContain('Unsubscribe');
	});

	it('falls back to commons.email host on invalid platformUrl', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {
			platformUrl: 'not a url',
			unsubscribeUrl: 'https://example.org/unsubscribe/abc'
		});
		expect(out).toContain('commons.email');
	});

	it('escapes attacker-controlled platformUrl + unsubscribeUrl in attributes', () => {
		const out = compileEmailShell('<p>hi</p>', verification, {
			platformUrl: 'https://example.org/"><script>alert(1)</script>',
			unsubscribeUrl: 'https://example.org/unsubscribe/"><script>alert(1)</script>'
		});
		expect(out).not.toContain('<script>alert(1)</script>');
		expect(out).toContain('&quot;');
	});

	it('omits the verification block entirely when verification is null', () => {
		const out = compileEmailShell('<p>hi</p>', null, {
			platformUrl: 'https://example.org'
		});
		expect(out).not.toContain('Verification Context');
		expect(out).toContain('<p>hi</p>');
	});
});

describe('compileSubjectMergeFields (subject is a header)', () => {
	const ctx: MergeContext = {
		firstName: 'Jane',
		lastName: 'Doe',
		email: 'jane@example.com',
		postalCode: '90210',
		verificationStatus: 'verified',
		tierLabel: 'Established',
		tierContext: 'Your identity is verified.'
	};

	it('resolves merge tokens with the supplied values (compose preview honesty)', () => {
		expect(compileSubjectMergeFields('Hi {{firstName}}, an update', ctx)).toBe(
			'Hi Jane, an update'
		);
	});

	it('strips CR/LF from resolved values — no header injection on the subject', () => {
		const injected: MergeContext = { ...ctx, firstName: 'Jane\r\nBcc: evil@example.com' };
		const out = compileSubjectMergeFields('Hi {{firstName}}', injected);
		expect(out).not.toContain('\r');
		expect(out).not.toContain('\n');
		expect(out).toBe('Hi JaneBcc: evil@example.com');
	});

	it('does not HTML-escape (a subject is not HTML)', () => {
		expect(compileSubjectMergeFields('{{firstName}}', { ...ctx, firstName: 'Tom & Jerry' })).toBe(
			'Tom & Jerry'
		);
	});
});
