/**
 * Twilio REST API client — SMS sending + patch-through calling.
 *
 * Direct REST calls via fetch() — zero SDK dependency.
 * The Twilio Node SDK is 15 MB; these three operations are simple
 * HTTP calls with Basic Auth + form encoding.
 */
import { env } from '$env/dynamic/private';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SmsSendResult, CallInitResult } from './types';

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

function getCredentials(): { accountSid: string; authToken: string } {
	const accountSid = env.TWILIO_ACCOUNT_SID;
	const authToken = env.TWILIO_AUTH_TOKEN;
	if (!accountSid || !authToken) {
		throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars are required');
	}
	return { accountSid, authToken };
}

function getFromNumber(): string {
	const num = env.TWILIO_PHONE_NUMBER;
	if (!num) throw new Error('TWILIO_PHONE_NUMBER env var is required');
	return num;
}

function authHeader(accountSid: string, authToken: string): string {
	return 'Basic ' + btoa(`${accountSid}:${authToken}`);
}

/**
 * Validate E.164 phone number format
 */
export function isValidE164(phone: string): boolean {
	return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * Send a single SMS via Twilio REST API.
 *
 * POST /2010-04-01/Accounts/{SID}/Messages.json
 * Body: application/x-www-form-urlencoded
 */
export async function sendSms(to: string, body: string, fromNumber?: string): Promise<SmsSendResult> {
	if (!isValidE164(to)) {
		return { success: false, error: 'Invalid phone number format (E.164 required)' };
	}
	try {
		const { accountSid, authToken } = getCredentials();
		const params = new URLSearchParams();
		params.set('To', to);
		params.set('From', fromNumber || getFromNumber());
		params.set('Body', body);
		const callbackBase = env.PUBLIC_BASE_URL || '';
		if (callbackBase) {
			params.set('StatusCallback', `${callbackBase}/api/sms/webhook`);
		}

		const res = await fetch(`${TWILIO_API_BASE}/${accountSid}/Messages.json`, {
			method: 'POST',
			headers: {
				'Authorization': authHeader(accountSid, authToken),
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params.toString()
		});

		const data = await res.json();
		if (!res.ok) {
			return { success: false, error: data.message || `Twilio API error (${res.status})` };
		}
		return { success: true, sid: data.sid };
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown Twilio error';
		return { success: false, error };
	}
}

/**
 * Initiate a patch-through call connecting a supporter to a decision-maker.
 * Flow: Twilio calls the supporter -> plays message -> dials the target.
 *
 * POST /2010-04-01/Accounts/{SID}/Calls.json
 * Body: application/x-www-form-urlencoded
 */
export async function initiatePatchThroughCall(
	callerPhone: string,
	targetPhone: string,
	callbackUrl: string,
	targetName?: string,
	districtInfo?: string
): Promise<CallInitResult> {
	if (!isValidE164(callerPhone) || !isValidE164(targetPhone)) {
		return { success: false, error: 'Invalid phone number format (E.164 required)' };
	}
	try {
		const { accountSid, authToken } = getCredentials();
		const greeting = targetName
			? `Connecting you with ${targetName}.`
			: 'Connecting you with your representative.';
		const districtMsg = districtInfo
			? ` You are a verified constituent from ${districtInfo}.`
			: '';

		const twiml = `<Response><Say>${escapeXml(greeting)}${escapeXml(districtMsg)} Please hold.</Say><Dial callerId="${getFromNumber()}">${targetPhone}</Dial></Response>`;

		const params = new URLSearchParams();
		params.set('To', callerPhone);
		params.set('From', getFromNumber());
		params.set('Twiml', twiml);
		params.set('StatusCallback', callbackUrl);
		// Repeated params for array values
		for (const event of ['initiated', 'ringing', 'answered', 'completed']) {
			params.append('StatusCallbackEvent', event);
		}

		const res = await fetch(`${TWILIO_API_BASE}/${accountSid}/Calls.json`, {
			method: 'POST',
			headers: {
				'Authorization': authHeader(accountSid, authToken),
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params.toString()
		});

		const data = await res.json();
		if (!res.ok) {
			return { success: false, error: data.message || `Twilio API error (${res.status})` };
		}
		return { success: true, callSid: data.sid };
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown Twilio error';
		return { success: false, error };
	}
}

/**
 * Validate Twilio webhook signature (HMAC-SHA1).
 *
 * Pure crypto — no SDK dependency.
 * Algorithm: HMAC-SHA1(authToken, url + sortedParams) → base64
 */
export function validateTwilioSignature(
	signature: string,
	url: string,
	params: Record<string, string>
): boolean {
	try {
		const authToken = env.TWILIO_AUTH_TOKEN;
		if (!authToken) return false;

		const sortedKeys = Object.keys(params).sort();
		let data = url;
		for (const key of sortedKeys) {
			data += key + params[key];
		}

		const computed = createHmac('sha1', authToken)
			.update(data)
			.digest('base64');

		if (computed.length !== signature.length) return false;
		return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
	} catch {
		return false;
	}
}
