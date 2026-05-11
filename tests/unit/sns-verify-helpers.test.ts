import { describe, it, expect } from 'vitest';
import {
	validateCertURL,
	buildSigningString
} from '../../convex/_snsVerifyHelpers';

describe('validateCertURL (SSRF guard)', () => {
	it('accepts canonical AWS SNS cert URLs', () => {
		expect(
			validateCertURL('https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem')
		).toBe(true);
		expect(
			validateCertURL('https://sns.eu-west-2.amazonaws.com/cert.pem')
		).toBe(true);
	});

	it('rejects non-HTTPS', () => {
		expect(
			validateCertURL('http://sns.us-east-1.amazonaws.com/cert.pem')
		).toBe(false);
	});

	it('rejects non-AWS hostnames', () => {
		expect(
			validateCertURL('https://attacker.example.com/sns.us-east-1.amazonaws.com.pem')
		).toBe(false);
	});

	it('rejects look-alike subdomain', () => {
		expect(
			validateCertURL('https://sns.us-east-1.amazonaws.com.attacker.com/cert.pem')
		).toBe(false);
		expect(
			validateCertURL('https://snsxus-east-1.amazonaws.com/cert.pem')
		).toBe(false);
	});

	it('rejects when path does not end in .pem', () => {
		expect(
			validateCertURL('https://sns.us-east-1.amazonaws.com/cert.pem/payload')
		).toBe(false);
	});

	it('rejects unparseable URLs', () => {
		expect(validateCertURL('not a url')).toBe(false);
		expect(validateCertURL('')).toBe(false);
	});
});

describe('buildSigningString (canonical preimage)', () => {
	const baseFields = {
		Type: 'Notification',
		MessageId: 'msg-1',
		TopicArn: 'arn:aws:sns:us-east-1:123:Topic',
		Timestamp: '2026-05-07T12:00:00.000Z',
		Message: 'hello'
	};

	it('emits ordered key/value lines for Notification', () => {
		const out = buildSigningString(baseFields);
		expect(out).toBe(
			'Message\nhello\nMessageId\nmsg-1\nTimestamp\n2026-05-07T12:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123:Topic\nType\nNotification\n'
		);
	});

	it('includes Subject between MessageId and Timestamp when present', () => {
		const out = buildSigningString({ ...baseFields, Subject: 'subj' });
		expect(out).toContain('Subject\nsubj\n');
		expect(out.indexOf('Subject\n')).toBeGreaterThan(out.indexOf('MessageId\n'));
		expect(out.indexOf('Subject\n')).toBeLessThan(out.indexOf('Timestamp\n'));
	});

	it('includes SubscribeURL for SubscriptionConfirmation', () => {
		const out = buildSigningString({
			...baseFields,
			Type: 'SubscriptionConfirmation',
			SubscribeURL: 'https://sns.amazonaws.com/confirm?token=xyz'
		});
		expect(out).toContain('SubscribeURL\nhttps://sns.amazonaws.com/confirm?token=xyz\n');
	});

	it('includes SubscribeURL for UnsubscribeConfirmation', () => {
		const out = buildSigningString({
			...baseFields,
			Type: 'UnsubscribeConfirmation',
			SubscribeURL: 'https://sns.amazonaws.com/confirm?token=xyz'
		});
		expect(out).toContain('SubscribeURL\nhttps://sns.amazonaws.com/confirm?token=xyz\n');
	});

	it('does NOT include SubscribeURL for Notification', () => {
		const out = buildSigningString({
			...baseFields,
			SubscribeURL: 'https://sns.amazonaws.com/confirm?token=xyz'
		});
		expect(out).not.toContain('SubscribeURL\n');
	});

	it('terminates with a single newline', () => {
		const out = buildSigningString(baseFields);
		expect(out.endsWith('\n')).toBe(true);
		expect(out.endsWith('\n\n')).toBe(false);
	});

	it('omits Subject section entirely when undefined (not even an empty value)', () => {
		const out = buildSigningString(baseFields);
		expect(out).not.toContain('Subject\n');
	});
});
