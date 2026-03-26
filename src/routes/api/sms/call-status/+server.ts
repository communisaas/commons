/**
// CONVEX: Keep SvelteKit
 * Twilio call status webhook.
 *
 * Receives status updates for patch-through calls and updates
 * PatchThroughCall records with status, duration, and completedAt.
 *
 * Twilio sends form-encoded POST requests with X-Twilio-Signature.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { validateTwilioSignature } from '$lib/server/sms/twilio';

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

	const callSid = params.CallSid;
	const callStatus = params.CallStatus;
	const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;

	if (!callSid || !callStatus) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Map Twilio status to our status names
	const statusMap: Record<string, string> = {
		'initiated': 'initiated',
		'ringing': 'ringing',
		'in-progress': 'in-progress',
		'completed': 'completed',
		'failed': 'failed',
		'busy': 'busy',
		'no-answer': 'no-answer'
	};

	const mappedStatus = statusMap[callStatus];
	if (!mappedStatus) {
		console.warn(`[call-status] Unknown Twilio status: ${callStatus}`);
		return json({ ok: true }); // Acknowledge but don't persist unknown status
	}
	const isTerminal = ['completed', 'failed', 'busy', 'no-answer'].includes(mappedStatus);

	await db.patchThroughCall.updateMany({
		where: { twilioCallSid: callSid },
		data: {
			status: mappedStatus,
			...(duration !== null ? { duration } : {}),
			...(isTerminal ? { completedAt: new Date() } : {})
		}
	});

	return json({ ok: true });
};
