/**
 * Unit tests for the Twilio inbound SMS webhook.
 *
 * Tests STOP/START keyword handling and Twilio signature validation.
 *
 * Mocks:
 * - $lib/core/db (Prisma)
 * - $lib/server/sms/twilio (validateTwilioSignature)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock('$lib/core/db', () => ({
	db: {
		supporter: {
			updateMany: (...args: unknown[]) => mockUpdateMany(...args)
		}
	}
}));

// ---------------------------------------------------------------------------
// Mock Twilio signature validation
// ---------------------------------------------------------------------------

let signatureValid = true;

vi.mock('$lib/server/sms/twilio', () => ({
	validateTwilioSignature: () => signatureValid
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { POST } from '$lib/../routes/api/sms/inbound/+server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, string>, signature = 'valid-sig'): Request {
	const formData = new URLSearchParams(body);
	return new Request('https://commons.email/api/sms/inbound', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'X-Twilio-Signature': signature
		},
		body: formData.toString()
	});
}

function callPost(body: Record<string, string>, signature?: string) {
	const request = makeRequest(body, signature);
	return (POST as any)({
		request,
		url: new URL('https://commons.email/api/sms/inbound')
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Inbound SMS Webhook', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		signatureValid = true;
	});

	describe('signature validation', () => {
		it('should reject requests with invalid Twilio signature', async () => {
			signatureValid = false;
			const res = await callPost({ From: '+15551234567', Body: 'STOP' });
			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.error).toBe('Invalid signature');
			expect(mockUpdateMany).not.toHaveBeenCalled();
		});
	});

	describe('missing fields', () => {
		it('should return 400 when From is missing', async () => {
			const res = await callPost({ Body: 'STOP' });
			expect(res.status).toBe(400);
			expect(mockUpdateMany).not.toHaveBeenCalled();
		});
	});

	describe('STOP keywords', () => {
		const stopKeywords = ['STOP', 'stop', 'UNSUBSCRIBE', 'Cancel', 'END', 'quit', 'STOPALL'];

		for (const keyword of stopKeywords) {
			it(`should set smsStatus to "stopped" for keyword "${keyword}"`, async () => {
				const res = await callPost({ From: '+15551234567', Body: keyword });
				expect(res.status).toBe(200);
				expect(res.headers.get('Content-Type')).toBe('text/xml');
				const text = await res.text();
				expect(text).toBe('<Response></Response>');

				expect(mockUpdateMany).toHaveBeenCalledWith({
					where: { phone: '+15551234567' },
					data: { smsStatus: 'stopped' }
				});
			});
		}

		it('should handle STOP with extra whitespace', async () => {
			const res = await callPost({ From: '+15551234567', Body: '  STOP  ' });
			expect(res.status).toBe(200);
			expect(mockUpdateMany).toHaveBeenCalledWith({
				where: { phone: '+15551234567' },
				data: { smsStatus: 'stopped' }
			});
		});
	});

	describe('START keywords', () => {
		const startKeywords = ['START', 'start', 'YES', 'UNSTOP'];

		for (const keyword of startKeywords) {
			it(`should re-subscribe for keyword "${keyword}"`, async () => {
				const res = await callPost({ From: '+15551234567', Body: keyword });
				expect(res.status).toBe(200);
				expect(res.headers.get('Content-Type')).toBe('text/xml');

				expect(mockUpdateMany).toHaveBeenCalledWith({
					where: { phone: '+15551234567', smsStatus: 'stopped' },
					data: { smsStatus: 'subscribed' }
				});
			});
		}
	});

	describe('non-keyword messages', () => {
		it('should not update any supporter for arbitrary text', async () => {
			const res = await callPost({ From: '+15551234567', Body: 'Hello there' });
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('text/xml');
			expect(mockUpdateMany).not.toHaveBeenCalled();
		});

		it('should not update for empty body', async () => {
			const res = await callPost({ From: '+15551234567', Body: '' });
			expect(res.status).toBe(200);
			expect(mockUpdateMany).not.toHaveBeenCalled();
		});
	});

	describe('TwiML response', () => {
		it('should always return empty TwiML Response for valid requests', async () => {
			const res = await callPost({ From: '+15551234567', Body: 'random' });
			expect(res.headers.get('Content-Type')).toBe('text/xml');
			const text = await res.text();
			expect(text).toBe('<Response></Response>');
		});
	});
});
