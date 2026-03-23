import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { verifySNSSignature } from '$lib/core/security/sns-verify';
import { computeEmailHash } from '$lib/core/crypto/user-pii-encryption';

interface SNSMessage {
	Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
	MessageId: string;
	TopicArn: string;
	Subject?: string;
	Message: string;
	Timestamp: string;
	SignatureVersion: string;
	Signature: string;
	SigningCertURL: string;
	SubscribeURL?: string;
	Token?: string;
}

interface SESBounceMessage {
	notificationType: 'Bounce';
	bounce: {
		bounceType: 'Permanent' | 'Transient';
		bouncedRecipients: Array<{ emailAddress: string }>;
	};
}

interface SESComplaintMessage {
	notificationType: 'Complaint';
	complaint: {
		complainedRecipients: Array<{ emailAddress: string }>;
	};
}

interface SESOpenMessage {
	notificationType: 'Open';
	mail: { messageId: string; destination: string[] };
}

interface SESClickMessage {
	notificationType: 'Click';
	click: { link: string };
	mail: { messageId: string; destination: string[] };
}

interface SESDeliveryMessage {
	notificationType: 'Delivery';
	mail: { messageId: string; destination: string[] };
}

type SESMessage =
	| SESBounceMessage
	| SESComplaintMessage
	| SESOpenMessage
	| SESClickMessage
	| SESDeliveryMessage
	| { notificationType: string };

export const POST: RequestHandler = async ({ request }) => {
	let body: SNSMessage;

	try {
		// SNS sends Content-Type: text/plain, so we parse the raw text as JSON
		const raw = await request.text();
		body = JSON.parse(raw);
	} catch {
		return json({ ok: false, error: 'invalid JSON' }, { status: 400 });
	}

	// F1: Reject messages from unexpected SNS topics before signature verification.
	// SES_SNS_TOPIC_ARN must be configured — without it, any valid SNS topic could
	// subscribe and inject fake bounce/complaint data.
	const allowedTopic = env.SES_SNS_TOPIC_ARN;
	if (!allowedTopic) {
		console.error('[ses-webhook] SES_SNS_TOPIC_ARN not configured — rejecting all SNS messages');
		return json({ ok: false, error: 'webhook not configured' }, { status: 403 });
	}
	if (body.TopicArn !== allowedTopic) {
		console.error('[ses-webhook] Unexpected TopicArn:', body.TopicArn);
		return json({ ok: false, error: 'topic not allowed' }, { status: 403 });
	}

	// Verify SNS message signature to prevent spoofed notifications
	const verifyResult = await verifySNSSignature(body);
	if (!verifyResult.valid) {
		console.error('[ses-webhook] SNS signature verification failed:', verifyResult.error);
		return json({ ok: false, error: 'signature verification failed' }, { status: 403 });
	}

	// Handle SNS subscription confirmation
	if (body.Type === 'SubscriptionConfirmation') {
		if (body.SubscribeURL) {
			console.log('[ses-webhook] Confirming SNS subscription:', body.TopicArn);
			try {
				await fetch(body.SubscribeURL);
			} catch (err) {
				console.error('[ses-webhook] Failed to confirm subscription:', err);
			}
		}
		return json({ ok: true });
	}

	// Only process Notification type from here on
	if (body.Type !== 'Notification') {
		return json({ ok: true });
	}

	let message: SESMessage;
	try {
		message = JSON.parse(body.Message);
	} catch {
		return json({ ok: false, error: 'invalid Message JSON' }, { status: 400 });
	}

	// Extract SES mail.messageId for CampaignDelivery correlation.
	// SES events (Delivery, Bounce, Open, Click) all carry mail.messageId.
	const mailMessageId = ('mail' in message && (message as { mail?: { messageId?: string } }).mail?.messageId) || null;

	// Try to route to CampaignDelivery first (report delivery tracking)
	if (mailMessageId) {
		const delivery = await db.campaignDelivery.findFirst({
			where: { sesMessageId: mailMessageId }
		});

		if (delivery) {
			await handleReportDeliveryEvent(delivery.id, message);
			return json({ ok: true });
		}
	}

	// Fall through to existing EmailBlast logic
	if (message.notificationType === 'Bounce') {
		const bounce = (message as SESBounceMessage).bounce;

		// Only process permanent bounces — transient bounces are retried by SES
		if (bounce.bounceType !== 'Permanent') {
			return json({ ok: true });
		}

		const emails = bounce.bouncedRecipients.map((r) => r.emailAddress.toLowerCase());
		console.log('[ses-webhook] Bounce:', emails.length, 'emails', emails);

		if (emails.length > 0) {
			// Cross-org update is intentional: a bounced address is bounced everywhere,
			// and complaints are the strongest suppression signal regardless of org.
			const hashes = (await Promise.all(emails.map((e) => computeEmailHash(e)))).filter(
				(h): h is string => h !== null
			);
			if (hashes.length > 0) {
				await db.supporter.updateMany({
					where: {
						email_hash: { in: hashes },
						emailStatus: { not: 'complained' }
					},
					data: { emailStatus: 'bounced' }
				});
			}
		}
	} else if (message.notificationType === 'Complaint') {
		const complaint = (message as SESComplaintMessage).complaint;
		const emails = complaint.complainedRecipients.map((r) => r.emailAddress.toLowerCase());
		console.log('[ses-webhook] Complaint:', emails.length, 'emails', emails);

		if (emails.length > 0) {
			// Cross-org update is intentional: a bounced address is bounced everywhere,
			// and complaints are the strongest suppression signal regardless of org.
			// Complaints always win — once complained, never re-emailed
			const hashes = (await Promise.all(emails.map((e) => computeEmailHash(e)))).filter(
				(h): h is string => h !== null
			);
			if (hashes.length > 0) {
				await db.supporter.updateMany({
					where: { email_hash: { in: hashes } },
					data: { emailStatus: 'complained' }
				});
			}
		}
	} else if (message.notificationType === 'Open') {
		const openMsg = message as SESOpenMessage;
		const email = openMsg.mail.destination[0]?.toLowerCase();
		if (email) {
			// Scope blast lookup via supporter's org to prevent cross-org misattribution
			const emailHash = await computeEmailHash(email);
			const supporter = emailHash
				? await db.supporter.findFirst({
						where: { email_hash: emailHash },
						orderBy: { updatedAt: 'desc' },
						select: { orgId: true }
					})
				: null;
			const blast = await db.emailBlast.findFirst({
				where: {
					status: 'sent',
					...(supporter ? { orgId: supporter.orgId } : {}),
					batches: { some: {} },
					events: { none: { recipientEmail: email, eventType: 'open' } }
				},
				orderBy: { sentAt: 'desc' }
			});
			if (blast) {
				await Promise.all([
					db.emailEvent.create({
						data: { blastId: blast.id, recipientEmail: email, eventType: 'open' }
					}),
					db.emailBlast.update({
						where: { id: blast.id },
						data: { totalOpened: { increment: 1 } }
					})
				]);
			}
		}
	} else if (message.notificationType === 'Click') {
		const clickMsg = message as SESClickMessage;
		const email = clickMsg.mail.destination[0]?.toLowerCase();
		if (email) {
			// Scope blast lookup via supporter's org to prevent cross-org misattribution
			const emailHash = await computeEmailHash(email);
			const supporter = emailHash
				? await db.supporter.findFirst({
						where: { email_hash: emailHash },
						orderBy: { updatedAt: 'desc' },
						select: { orgId: true }
					})
				: null;
			let blast = await db.emailBlast.findFirst({
				where: {
					status: 'sent',
					...(supporter ? { orgId: supporter.orgId } : {}),
					events: { some: { recipientEmail: email, eventType: 'open' } }
				},
				orderBy: { sentAt: 'desc' }
			});
			if (!blast) {
				blast = await db.emailBlast.findFirst({
					where: {
						status: 'sent',
						...(supporter ? { orgId: supporter.orgId } : {}),
						batches: { some: {} }
					},
					orderBy: { sentAt: 'desc' }
				});
			}
			if (blast) {
				await Promise.all([
					db.emailEvent.create({
						data: {
							blastId: blast.id,
							recipientEmail: email,
							eventType: 'click',
							linkUrl: clickMsg.click.link
						}
					}),
					db.emailBlast.update({
						where: { id: blast.id },
						data: { totalClicked: { increment: 1 } }
					})
				]);
			}
		}
	}

	return json({ ok: true });
};

/**
 * Handle SES events for CampaignDelivery (proof report tracking).
 * Maps SES notification types to ReportResponse rows and delivery status updates.
 */
async function handleReportDeliveryEvent(deliveryId: string, message: SESMessage): Promise<void> {
	const now = new Date();

	switch (message.notificationType) {
		case 'Delivery':
			await db.campaignDelivery.update({
				where: { id: deliveryId },
				data: { status: 'delivered' }
			});
			break;

		case 'Bounce':
			await db.campaignDelivery.update({
				where: { id: deliveryId },
				data: { status: 'bounced' }
			});
			break;

		case 'Open':
			// Dedup: only create one "opened" response per delivery
			{
				const existing = await db.reportResponse.findFirst({
					where: { deliveryId, type: 'opened' }
				});
				if (!existing) {
					await Promise.all([
						db.reportResponse.create({
							data: {
								deliveryId,
								type: 'opened',
								confidence: 'observed',
								occurredAt: now
							}
						}),
						db.campaignDelivery.update({
							where: { id: deliveryId },
							data: { status: 'opened' }
						})
					]);
				}
			}
			break;

		case 'Click': {
			const clickMsg = message as SESClickMessage;
			const isVerifyClick = clickMsg.click.link.includes('/verify/');
			await db.reportResponse.create({
				data: {
					deliveryId,
					type: isVerifyClick ? 'clicked_verify' : 'opened',
					detail: isVerifyClick ? clickMsg.click.link : undefined,
					confidence: 'observed',
					occurredAt: now
				}
			});
			break;
		}
	}
}
