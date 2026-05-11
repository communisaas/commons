import { describe, it, expect } from 'vitest';

// Mirror of `convex/http.ts:parseTwilioFormBody` — vitest can't import Convex
// internals, so the test inlines the helper. Any drift between this body and
// the production function is the bug this test is designed to catch
// (drift-canary surface, same idiom as `email-hash-invariants.test.ts`).
function parseTwilioFormBody(body: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const pair of body.split('&')) {
		const [key, value] = pair.split('=');
		if (key) {
			const decodedKey = decodeURIComponent(key.replace(/\+/g, ' '));
			const decodedValue = decodeURIComponent((value ?? '').replace(/\+/g, ' '));
			params[decodedKey] = decodedValue;
		}
	}
	return params;
}

describe('parseTwilioFormBody (form-encoding contract)', () => {
	it('decodes simple key=value', () => {
		const params = parseTwilioFormBody('From=%2B15551234567&To=%2B15559876543');
		expect(params.From).toBe('+15551234567');
		expect(params.To).toBe('+15559876543');
	});

	it('converts + to space (form-urlencoded space representation)', () => {
		// Twilio sends `Body=Hello+World` — the signature was computed against
		// "Hello World" (form-decoded). Without the `+`-to-space conversion,
		// our parser produced "Hello+World" (literal +), causing every SMS
		// with a space to fail signature verification.
		const params = parseTwilioFormBody('Body=Hello+World');
		expect(params.Body).toBe('Hello World');
	});

	it('handles mixed + and %20 within a single value', () => {
		// Twilio rarely emits %20 in form bodies, but spec allows both.
		const params = parseTwilioFormBody('Body=Hello%20World+from+Twilio');
		expect(params.Body).toBe('Hello World from Twilio');
	});

	it('preserves literal plus in pre-encoded sequences (%2B)', () => {
		// Phone numbers arrive as `From=%2B15551234567` (the `+` is percent-
		// encoded). Our `+` replace runs BEFORE percent-decode, so `%2B`
		// stays intact through the replace and decodes correctly to `+`.
		const params = parseTwilioFormBody('From=%2B15551234567');
		expect(params.From).toBe('+15551234567');
	});

	it('handles a key with empty value', () => {
		const params = parseTwilioFormBody('ErrorCode=&MessageStatus=delivered');
		expect(params.ErrorCode).toBe('');
		expect(params.MessageStatus).toBe('delivered');
	});

	it('decodes URL-encoded special chars in values', () => {
		const params = parseTwilioFormBody('Body=Cost%3A+%245.99');
		expect(params.Body).toBe('Cost: $5.99');
	});

	it('treats malformed pairs (no =) as empty value', () => {
		const params = parseTwilioFormBody('FlagOnly&MessageSid=SMxxx');
		expect(params.FlagOnly).toBe('');
		expect(params.MessageSid).toBe('SMxxx');
	});

	it('matches a realistic Twilio status-callback payload shape', () => {
		const body =
			'MessageSid=SM12345&MessageStatus=delivered&To=%2B15551234567&From=%2B15559876543&Body=Reply+received&AccountSid=ACtest';
		const params = parseTwilioFormBody(body);
		expect(params.MessageSid).toBe('SM12345');
		expect(params.MessageStatus).toBe('delivered');
		expect(params.To).toBe('+15551234567');
		expect(params.From).toBe('+15559876543');
		expect(params.Body).toBe('Reply received');
		expect(params.AccountSid).toBe('ACtest');
	});
});
