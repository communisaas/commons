/**
 * SMS blast sending engine.
 *
 * Called fire-and-forget from the API endpoint after blast creation.
 * Sends in batches of 10 with 1s delay between batches to respect Twilio rate limits.
 */
import { db } from '$lib/core/db';
import { sendSms } from './twilio';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';

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
		// Check SMS billing quota before sending
		const usage = await getOrgUsage(blast.orgId);
		const limits = isOverLimit(usage);
		if (limits.sms) {
			await db.smsBlast.update({
				where: { id: blastId },
				data: { status: 'failed' }
			});
			console.warn(`[SMS] Blast ${blastId} failed: org ${blast.orgId} over SMS quota (${usage.smsSent}/${usage.limits.maxSms})`);
			return;
		}

		// Count recipients to check if this blast would exceed the quota
		const recipientFilter = {
			orgId: blast.orgId,
			phone: { not: null },
			smsStatus: 'subscribed' as const // TCPA: only send to explicitly consented supporters
		};

		const estimatedRecipients = await db.supporter.count({
			where: recipientFilter
		});

		if (usage.smsSent + estimatedRecipients > usage.limits.maxSms) {
			await db.smsBlast.update({
				where: { id: blastId },
				data: { status: 'failed' }
			});
			const remaining = Math.max(0, usage.limits.maxSms - usage.smsSent);
			console.warn(`[SMS] Blast ${blastId} failed: would send ~${estimatedRecipients} messages but org ${blast.orgId} only has ${remaining} SMS remaining (${usage.smsSent}/${usage.limits.maxSms})`);
			return;
		}

		// Find supporters with phone numbers in this org
		// TODO: Apply recipientFilter when segment query builder supports phone filtering
		const supporters = await db.supporter.findMany({
			where: recipientFilter,
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
