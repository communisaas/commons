/**
 * Unit Tests: Twilio integration — sendSms, initiatePatchThroughCall,
 * isValidE164, validateTwilioSignature, sendSmsBlast, webhooks.
 *
 * Tests use fetch() mocks (not Twilio SDK) since twilio.ts calls the REST API directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MOCKS — fetch + env
// =============================================================================

const {
	mockValidateTwilioSignature,
	mockEnv
} = vi.hoisted(() => ({
	mockValidateTwilioSignature: vi.fn(),
	mockEnv: {
		TWILIO_ACCOUNT_SID: 'AC_test_sid',
		TWILIO_AUTH_TOKEN: 'test_auth_token',
		TWILIO_PHONE_NUMBER: '+15559876543',
		PUBLIC_BASE_URL: 'https://example.com'
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/server/sms/twilio', async (importOriginal) => {
	const actual: Record<string, unknown> = await importOriginal();
	return {
		...actual,
		// Override signature validation for webhook tests
		validateTwilioSignature: (...args: any[]) => mockValidateTwilioSignature(...args)
	};
});

vi.mock('@sveltejs/kit', () => ({
	json: (data: unknown, init?: { status?: number }) =>
		new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: { 'Content-Type': 'application/json' }
		}),
	error: (status: number, message: string) => {
		const e = new Error(message);
		(e as any).status = status;
		throw e;
	}
}));

// Save original fetch for restoration
const originalFetch = globalThis.fetch;

/** Helper: create a mock fetch Response */
function mockJsonResponse(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Helper: parse form-encoded body from a fetch mock call */
function parseFetchBody(mockFetch: ReturnType<typeof vi.fn>, callIndex = 0): URLSearchParams {
	return new URLSearchParams(mockFetch.mock.calls[callIndex][1].body);
}

// =============================================================================
// isValidE164
// =============================================================================

describe('isValidE164', () => {
	let isValidE164: (phone: string) => boolean;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import(
			'../../../src/lib/server/sms/twilio'
		);
		isValidE164 = mod.isValidE164;
	});

	it('accepts valid E.164 numbers', () => {
		expect(isValidE164('+15551234567')).toBe(true);
		expect(isValidE164('+442071234567')).toBe(true);
		expect(isValidE164('+8613812345678')).toBe(true);
	});

	it('rejects missing + prefix', () => {
		expect(isValidE164('15551234567')).toBe(false);
	});

	it('rejects too short', () => {
		expect(isValidE164('+1')).toBe(false);
	});

	it('rejects too long', () => {
		expect(isValidE164('+1234567890123456')).toBe(false);
	});

	it('rejects non-numeric after +', () => {
		expect(isValidE164('+1abc1234567')).toBe(false);
	});

	it('rejects leading zero after +', () => {
		expect(isValidE164('+015551234567')).toBe(false);
	});
});

// =============================================================================
// sendSms
// =============================================================================

describe('sendSms', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('sends SMS successfully (returns sid)', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test_123' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await sendSms('+15551234567', 'Hello!');

		expect(result.success).toBe(true);
		expect(result.sid).toBe('SM_test_123');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/Messages.json'),
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Content-Type': 'application/x-www-form-urlencoded'
				})
			})
		);
		const body = parseFetchBody(mockFetch);
		expect(body.get('To')).toBe('+15551234567');
		expect(body.get('Body')).toBe('Hello!');
		expect(body.get('From')).toBe('+15559876543');
	});

	it('returns error for invalid E.164 phone', async () => {
		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await sendSms('555-1234', 'Hello!');

		expect(result.success).toBe(false);
		expect(result.error).toContain('E.164');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('handles Twilio API error gracefully', async () => {
		mockFetch.mockResolvedValue(
			mockJsonResponse({ message: 'Invalid number' }, 400)
		);

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await sendSms('+15551234567', 'Hello!');

		expect(result.success).toBe(false);
		expect(result.error).toContain('Invalid number');
	});

	it('passes correct from number', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await sendSms('+15551234567', 'Hello!');

		const body = parseFetchBody(mockFetch);
		expect(body.get('From')).toBe('+15559876543');
	});

	it('uses custom from number when provided', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await sendSms('+15551234567', 'Hello!', '+15559999999');

		const body = parseFetchBody(mockFetch);
		expect(body.get('From')).toBe('+15559999999');
	});

	it('sets StatusCallback when PUBLIC_BASE_URL is configured', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await sendSms('+15551234567', 'Hello!');

		const body = parseFetchBody(mockFetch);
		expect(body.get('StatusCallback')).toBe('https://example.com/api/sms/webhook');
	});

	it('handles network error gracefully', async () => {
		mockFetch.mockRejectedValue(new Error('Network unreachable'));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await sendSms('+15551234567', 'Hello!');

		expect(result.success).toBe(false);
		expect(result.error).toContain('Network unreachable');
	});
});

// =============================================================================
// initiatePatchThroughCall
// =============================================================================

describe('initiatePatchThroughCall', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('initiates call successfully (returns callSid)', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test_123' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback'
		);

		expect(result.success).toBe(true);
		expect(result.callSid).toBe('CA_test_123');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/Calls.json'),
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Content-Type': 'application/x-www-form-urlencoded'
				})
			})
		);
		const body = parseFetchBody(mockFetch);
		expect(body.get('To')).toBe('+15551234567');
		expect(body.get('From')).toBe('+15559876543');
		expect(body.get('StatusCallback')).toBe('https://example.com/callback');
	});

	it('returns error for invalid caller phone', async () => {
		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await initiatePatchThroughCall(
			'invalid',
			'+12025551234',
			'https://example.com/callback'
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('E.164');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns error for invalid target phone', async () => {
		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await initiatePatchThroughCall(
			'+15551234567',
			'bad-number',
			'https://example.com/callback'
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('E.164');
	});

	it('includes target name in TwiML greeting', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback',
			'Rep. Smith'
		);

		const body = parseFetchBody(mockFetch);
		expect(body.get('Twiml')).toContain('Connecting you with Rep. Smith');
	});

	it('includes district info in TwiML', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback',
			'Rep. Smith',
			'CA-12'
		);

		const body = parseFetchBody(mockFetch);
		expect(body.get('Twiml')).toContain('constituent from CA-12');
	});

	it('handles Twilio API error', async () => {
		mockFetch.mockResolvedValue(
			mockJsonResponse({ message: 'Call failed' }, 400)
		);

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		const result = await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback'
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Call failed');
	});

	it('uses default greeting when no target name', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback'
		);

		const body = parseFetchBody(mockFetch);
		expect(body.get('Twiml')).toContain('Connecting you with your representative');
	});

	it('sends StatusCallbackEvent params for call lifecycle', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio'
		);
		await initiatePatchThroughCall(
			'+15551234567',
			'+12025551234',
			'https://example.com/callback'
		);

		const body = parseFetchBody(mockFetch);
		const events = body.getAll('StatusCallbackEvent');
		expect(events).toEqual(['initiated', 'ringing', 'answered', 'completed']);
	});
});

// =============================================================================
// sendSmsBlast
// =============================================================================

describe.skip('sendSmsBlast', () => {
	it('is deferred because the Prisma-era send-blast module was removed', () => {
		expect(true).toBe(true);
	});
});

// =============================================================================
// SMS status webhook
// =============================================================================

describe.skip('SMS Status Webhook - POST /api/sms/webhook', () => {
	it('is deferred because the Prisma-era webhook route was removed', () => {
		expect(true).toBe(true);
	});
});

// =============================================================================
// Call status webhook
// =============================================================================

describe.skip('Call Status Webhook - POST /api/sms/call-status', () => {
	it('is deferred because the Prisma-era call-status route was removed', () => {
		expect(true).toBe(true);
	});
});
