/**
 * SMS blast sending engine.
 *
 * Called fire-and-forget from the API endpoint after blast creation.
 * Sends in batches of 10 with 1s delay between batches to respect Twilio rate limits.
 */
import { db } from '$lib/core/db';
import { sendSms } from './twilio';

/**
 * Send an SMS blast to all matching supporters with phone numbers.
 */
export async function sendSmsBlast(blastId: string): Promise<void> {
	// Atomic status transition — prevents double-send race
	const { count } = await db.smsBlast.updateMany({
		where: { id: blastId, status: 'draft' },
		data: { status: 'sending', sentAt: new Date() }
	});
	if (count === 0) return; // blast doesn't exist, not draft, or another process won

	// Now fetch blast data for sending
	const blast = await db.smsBlast.findUnique({
		where: { id: blastId },
		include: { org: { select: { id: true } } }
	});
	if (!blast) return;

	try {
		// Find supporters with phone numbers in this org
		// TODO: Apply recipientFilter when segment query builder supports phone filtering
		const supporters = await db.supporter.findMany({
			where: {
				orgId: blast.orgId,
				phone: { not: null },
				smsStatus: 'subscribed' // TCPA: only send to explicitly consented supporters
			},
			select: { id: true, phone: true, name: true }
		});

		await db.smsBlast.update({
			where: { id: blastId },
			data: { totalRecipients: supporters.length }
		});

		let sentCount = 0;
		let failedCount = 0;

		// Send in batches of 10 with small delay between batches
		const BATCH_SIZE = 10;
		for (let i = 0; i < supporters.length; i += BATCH_SIZE) {
			const batch = supporters.slice(i, i + BATCH_SIZE);
			const results = await Promise.allSettled(
				batch.map(async (sup) => {
					const result = await sendSms(sup.phone!, blast.body, blast.fromNumber);
					await db.smsMessage.create({
						data: {
							blastId,
							supporterId: sup.id,
							to: sup.phone!,
							body: blast.body,
							twilioSid: result.sid || null,
							status: result.success ? 'sent' : 'failed',
							errorCode: result.error || null
						}
					});
					return result;
				})
			);

			for (const r of results) {
				if (r.status === 'fulfilled' && r.value.success) sentCount++;
				else failedCount++;
			}

			// Small delay between batches to respect Twilio rate limits
			if (i + BATCH_SIZE < supporters.length) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		await db.smsBlast.update({
			where: { id: blastId },
			data: { status: 'sent', sentCount, failedCount }
		});
	} catch (err) {
		console.error(`[SMS] Blast ${blastId} failed:`, err);
		await db.smsBlast.update({
			where: { id: blastId },
			data: { status: 'failed' }
		});
	}
}
