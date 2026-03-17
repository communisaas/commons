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
	mockEnv,
	mockDbSmsBlastFindUnique,
	mockDbSmsBlastUpdate,
	mockDbSupporterFindMany,
	mockDbSmsMessageCreate,
	mockDbSmsMessageFindFirst,
	mockDbSmsMessageUpdate,
	mockDbPatchThroughCallUpdateMany,
	mockFeatures
} = vi.hoisted(() => ({
	mockValidateTwilioSignature: vi.fn(),
	mockEnv: {
		TWILIO_ACCOUNT_SID: 'AC_test_sid',
		TWILIO_AUTH_TOKEN: 'test_auth_token',
		TWILIO_PHONE_NUMBER: '+15559876543',
		PUBLIC_BASE_URL: 'https://example.com'
	},
	mockDbSmsBlastFindUnique: vi.fn(),
	mockDbSmsBlastUpdate: vi.fn(),
	mockDbSupporterFindMany: vi.fn(),
	mockDbSmsMessageCreate: vi.fn(),
	mockDbSmsMessageFindFirst: vi.fn(),
	mockDbSmsMessageUpdate: vi.fn(),
	mockDbPatchThroughCallUpdateMany: vi.fn(),
	mockFeatures: {
		SMS: true as boolean,
		DEBATE: true,
		CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true,
		WALLET: true,
		ANALYTICS_EXPANDED: true,
		AB_TESTING: true,
		PUBLIC_API: true,
		EVENTS: true,
		FUNDRAISING: true,
		AUTOMATION: true
	}
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/core/db', () => ({
	db: {
		smsBlast: {
			findUnique: (...args: any[]) => mockDbSmsBlastFindUnique(...args),
			update: (...args: any[]) => mockDbSmsBlastUpdate(...args)
		},
		supporter: {
			findMany: (...args: any[]) => mockDbSupporterFindMany(...args)
		},
		smsMessage: {
			create: (...args: any[]) => mockDbSmsMessageCreate(...args),
			findFirst: (...args: any[]) => mockDbSmsMessageFindFirst(...args),
			update: (...args: any[]) => mockDbSmsMessageUpdate(...args)
		},
		patchThroughCall: {
			updateMany: (...args: any[]) => mockDbPatchThroughCallUpdateMany(...args)
		}
	}
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
			'../../../src/lib/server/sms/twilio.ts'
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
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('sends SMS successfully (returns sid)', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test_123' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
		);
		const result = await sendSms('+15551234567', 'Hello!');

		expect(result.success).toBe(false);
		expect(result.error).toContain('Invalid number');
	});

	it('passes correct from number', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio.ts'
		);
		await sendSms('+15551234567', 'Hello!');

		const body = parseFetchBody(mockFetch);
		expect(body.get('From')).toBe('+15559876543');
	});

	it('uses custom from number when provided', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio.ts'
		);
		await sendSms('+15551234567', 'Hello!', '+15559999999');

		const body = parseFetchBody(mockFetch);
		expect(body.get('From')).toBe('+15559999999');
	});

	it('sets StatusCallback when PUBLIC_BASE_URL is configured', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'SM_test' }));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio.ts'
		);
		await sendSms('+15551234567', 'Hello!');

		const body = parseFetchBody(mockFetch);
		expect(body.get('StatusCallback')).toBe('https://example.com/api/sms/webhook');
	});

	it('handles network error gracefully', async () => {
		mockFetch.mockRejectedValue(new Error('Network unreachable'));

		const { sendSms } = await import(
			'../../../src/lib/server/sms/twilio.ts'
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
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('initiates call successfully (returns callSid)', async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ sid: 'CA_test_123' }));

		const { initiatePatchThroughCall } = await import(
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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
			'../../../src/lib/server/sms/twilio.ts'
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

describe('sendSmsBlast', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch;
		mockDbSmsBlastFindUnique.mockResolvedValue({
			id: 'blast-1',
			orgId: 'org-1',
			body: 'Campaign update!',
			fromNumber: null,
			status: 'draft',
			org: { id: 'org-1' }
		});
		mockDbSmsBlastUpdate.mockResolvedValue({});
		mockDbSmsMessageCreate.mockResolvedValue({});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('sends to all supporters with phones and updates counters', async () => {
		mockDbSupporterFindMany.mockResolvedValue([
			{ id: 'sup-1', phone: '+15551111111', name: 'Alice' },
			{ id: 'sup-2', phone: '+15552222222', name: 'Bob' }
		]);

		mockFetch
			.mockResolvedValueOnce(mockJsonResponse({ sid: 'SM_1' }))
			.mockResolvedValueOnce(mockJsonResponse({ sid: 'SM_2' }));

		const { sendSmsBlast } = await import(
			'../../../src/lib/server/sms/send-blast.ts'
		);
		await sendSmsBlast('blast-1');

		// Should update status to 'sending' first
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'blast-1' },
				data: expect.objectContaining({ status: 'sending' })
			})
		);

		// Should update totalRecipients
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'blast-1' },
				data: { totalRecipients: 2 }
			})
		);

		// Should create message records for each supporter
		expect(mockDbSmsMessageCreate).toHaveBeenCalledTimes(2);

		// Should mark as sent with final counts
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'blast-1' },
				data: expect.objectContaining({ status: 'sent' })
			})
		);
	});

	it('returns early if blast is not draft', async () => {
		mockDbSmsBlastFindUnique.mockResolvedValue({
			id: 'blast-1',
			orgId: 'org-1',
			status: 'sent'
		});

		const { sendSmsBlast } = await import(
			'../../../src/lib/server/sms/send-blast.ts'
		);
		await sendSmsBlast('blast-1');

		expect(mockDbSmsBlastUpdate).not.toHaveBeenCalled();
		expect(mockDbSupporterFindMany).not.toHaveBeenCalled();
	});

	it('returns early if blast not found', async () => {
		mockDbSmsBlastFindUnique.mockResolvedValue(null);

		const { sendSmsBlast } = await import(
			'../../../src/lib/server/sms/send-blast.ts'
		);
		await sendSmsBlast('blast-nonexistent');

		expect(mockDbSmsBlastUpdate).not.toHaveBeenCalled();
	});

	it('handles empty recipient list', async () => {
		mockDbSupporterFindMany.mockResolvedValue([]);

		const { sendSmsBlast } = await import(
			'../../../src/lib/server/sms/send-blast.ts'
		);
		await sendSmsBlast('blast-1');

		// Should still update totalRecipients to 0
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { totalRecipients: 0 }
			})
		);

		// Should mark as sent with 0 counts
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: 'sent', sentCount: 0, failedCount: 0 })
			})
		);
	});

	it('marks blast as failed on error', async () => {
		mockDbSupporterFindMany.mockRejectedValue(new Error('DB error'));

		const { sendSmsBlast } = await import(
			'../../../src/lib/server/sms/send-blast.ts'
		);
		await sendSmsBlast('blast-1');

		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'blast-1' },
				data: { status: 'failed' }
			})
		);
	});
});

// =============================================================================
// SMS status webhook
// =============================================================================

describe('SMS Status Webhook - POST /api/sms/webhook', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateTwilioSignature.mockReturnValue(true);
	});

	function makeWebhookRequest(params: Record<string, string>) {
		const formData = new FormData();
		for (const [key, value] of Object.entries(params)) {
			formData.append(key, value);
		}
		return {
			formData: () => Promise.resolve(formData),
			headers: new Headers({
				'X-Twilio-Signature': 'valid-sig'
			})
		} as unknown as Request;
	}

	it('updates message status on delivery', async () => {
		mockDbSmsMessageFindFirst.mockResolvedValue({
			id: 'msg-1',
			blastId: 'blast-1'
		});
		mockDbSmsMessageUpdate.mockResolvedValue({});
		mockDbSmsBlastUpdate.mockResolvedValue({});

		const { POST } = await import(
			'../../../src/routes/api/sms/webhook/+server.ts'
		);
		const res = await POST({
			request: makeWebhookRequest({
				MessageSid: 'SM_123',
				MessageStatus: 'delivered'
			}),
			url: new URL('http://localhost/api/sms/webhook')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbSmsMessageUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'msg-1' },
				data: { status: 'delivered', errorCode: null }
			})
		);

		// Should increment delivered counter
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'blast-1' },
				data: { deliveredCount: { increment: 1 } }
			})
		);
	});

	it('updates message with error code on failure', async () => {
		mockDbSmsMessageFindFirst.mockResolvedValue({
			id: 'msg-1',
			blastId: 'blast-1'
		});
		mockDbSmsMessageUpdate.mockResolvedValue({});

		const { POST } = await import(
			'../../../src/routes/api/sms/webhook/+server.ts'
		);
		const res = await POST({
			request: makeWebhookRequest({
				MessageSid: 'SM_123',
				MessageStatus: 'failed',
				ErrorCode: '30003'
			}),
			url: new URL('http://localhost/api/sms/webhook')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbSmsMessageUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { status: 'failed', errorCode: '30003' }
			})
		);
	});

	it('ignores unknown SID (no message found)', async () => {
		mockDbSmsMessageFindFirst.mockResolvedValue(null);

		const { POST } = await import(
			'../../../src/routes/api/sms/webhook/+server.ts'
		);
		const res = await POST({
			request: makeWebhookRequest({
				MessageSid: 'SM_unknown',
				MessageStatus: 'delivered'
			}),
			url: new URL('http://localhost/api/sms/webhook')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbSmsMessageUpdate).not.toHaveBeenCalled();
	});

	it('returns 403 for invalid Twilio signature', async () => {
		mockValidateTwilioSignature.mockReturnValue(false);

		const { POST } = await import(
			'../../../src/routes/api/sms/webhook/+server.ts'
		);
		const res = await POST({
			request: makeWebhookRequest({
				MessageSid: 'SM_123',
				MessageStatus: 'delivered'
			}),
			url: new URL('http://localhost/api/sms/webhook')
		} as any);

		expect(res.status).toBe(403);
	});

	it('returns 400 for missing required fields', async () => {
		const { POST } = await import(
			'../../../src/routes/api/sms/webhook/+server.ts'
		);
		const res = await POST({
			request: makeWebhookRequest({}),
			url: new URL('http://localhost/api/sms/webhook')
		} as any);

		expect(res.status).toBe(400);
	});
});

// =============================================================================
// Call status webhook
// =============================================================================

describe('Call Status Webhook - POST /api/sms/call-status', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateTwilioSignature.mockReturnValue(true);
	});

	function makeCallWebhookRequest(params: Record<string, string>) {
		const formData = new FormData();
		for (const [key, value] of Object.entries(params)) {
			formData.append(key, value);
		}
		return {
			formData: () => Promise.resolve(formData),
			headers: new Headers({
				'X-Twilio-Signature': 'valid-sig'
			})
		} as unknown as Request;
	}

	it('updates call status to completed with duration', async () => {
		mockDbPatchThroughCallUpdateMany.mockResolvedValue({ count: 1 });

		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		const res = await POST({
			request: makeCallWebhookRequest({
				CallSid: 'CA_123',
				CallStatus: 'completed',
				CallDuration: '120'
			}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbPatchThroughCallUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { twilioCallSid: 'CA_123' },
				data: expect.objectContaining({
					status: 'completed',
					duration: 120,
					completedAt: expect.any(Date)
				})
			})
		);
	});

	it('updates call status to failed', async () => {
		mockDbPatchThroughCallUpdateMany.mockResolvedValue({ count: 1 });

		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		const res = await POST({
			request: makeCallWebhookRequest({
				CallSid: 'CA_123',
				CallStatus: 'failed'
			}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbPatchThroughCallUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: 'failed',
					completedAt: expect.any(Date)
				})
			})
		);
	});

	it('updates call status to no-answer', async () => {
		mockDbPatchThroughCallUpdateMany.mockResolvedValue({ count: 1 });

		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		const res = await POST({
			request: makeCallWebhookRequest({
				CallSid: 'CA_123',
				CallStatus: 'no-answer'
			}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbPatchThroughCallUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: 'no-answer',
					completedAt: expect.any(Date)
				})
			})
		);
	});

	it('does not set completedAt for non-terminal status', async () => {
		mockDbPatchThroughCallUpdateMany.mockResolvedValue({ count: 1 });

		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		await POST({
			request: makeCallWebhookRequest({
				CallSid: 'CA_123',
				CallStatus: 'ringing'
			}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		const callArgs = mockDbPatchThroughCallUpdateMany.mock.calls[0][0];
		expect(callArgs.data.completedAt).toBeUndefined();
	});

	it('returns 403 for invalid Twilio signature', async () => {
		mockValidateTwilioSignature.mockReturnValue(false);

		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		const res = await POST({
			request: makeCallWebhookRequest({
				CallSid: 'CA_123',
				CallStatus: 'completed'
			}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		expect(res.status).toBe(403);
	});

	it('returns 400 for missing required fields', async () => {
		const { POST } = await import(
			'../../../src/routes/api/sms/call-status/+server.ts'
		);
		const res = await POST({
			request: makeCallWebhookRequest({}),
			url: new URL('http://localhost/api/sms/call-status')
		} as any);

		expect(res.status).toBe(400);
	});
});
