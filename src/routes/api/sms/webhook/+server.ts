/**
// CONVEX: Keep SvelteKit
 * Twilio SMS delivery status webhook.
 *
 * Receives status updates (delivered, failed, undelivered) and updates
 * SmsMessage records + SmsBlast counters accordingly.
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

	const messageSid = params.MessageSid;
	const messageStatus = params.MessageStatus;
	const errorCode = params.ErrorCode;

	if (!messageSid || !messageStatus) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Update message status
	const message = await db.smsMessage.findFirst({
		where: { twilioSid: messageSid }
	});

	if (message) {
		await db.smsMessage.update({
			where: { id: message.id },
			data: {
				status: messageStatus,
				errorCode: errorCode || null
			}
		});

		// Update blast counters
		if (messageStatus === 'delivered') {
			await db.smsBlast.update({
				where: { id: message.blastId },
				data: { deliveredCount: { increment: 1 } }
			});
		}
	}

	return json({ ok: true });
};
