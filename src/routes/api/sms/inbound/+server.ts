/**
// CONVEX: Keep SvelteKit
 * Twilio inbound SMS webhook.
 *
 * Handles STOP/START/HELP keywords per TCPA requirements.
 * - STOP  -> set smsStatus = 'stopped'
 * - START -> set smsStatus = 'subscribed'
 *
 * Twilio Advanced Opt-Out handles the auto-reply; this endpoint
 * updates our database to stay in sync.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { validateTwilioSignature } from '$lib/server/sms/twilio';

const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_KEYWORDS = new Set(['start', 'yes', 'unstop']);

export const POST: RequestHandler = async ({ request, url }) => {
	const formData = await request.formData();
	const params: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		params[key] = value.toString();
	}

	// Validate Twilio signature
	const signature = request.headers.get('X-Twilio-Signature') || '';
	const valid = validateTwilioSignature(signature, url.toString(), params);
	if (!valid) {
		return json({ error: 'Invalid signature' }, { status: 403 });
	}

	const from = params.From; // E.164 phone number
	const body = (params.Body || '').trim().toLowerCase();

	if (!from) {
		return json({ error: 'Missing From number' }, { status: 400 });
	}

	if (STOP_KEYWORDS.has(body)) {
		// Mark all supporters with this phone as stopped
		await db.supporter.updateMany({
			where: { phone: from },
			data: { smsStatus: 'stopped' }
		});
	} else if (START_KEYWORDS.has(body)) {
		// Re-subscribe all supporters with this phone that were previously stopped
		await db.supporter.updateMany({
			where: { phone: from, smsStatus: 'stopped' },
			data: { smsStatus: 'subscribed' }
		});
	}

	// Return empty TwiML (no auto-reply — Twilio handles STOP/START responses)
	return new Response('<Response></Response>', {
		headers: { 'Content-Type': 'text/xml' }
	});
};
