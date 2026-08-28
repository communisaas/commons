/**
 * Webhook processing — internal mutations called from HTTP actions.
 *
 * SES bounce/complaint/open/click, Twilio SMS delivery/inbound/call status.
 * Stripe webhook processing is in convex/subscriptions.ts.
 */

import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { smsMessageStatus as smsMessageStatusV } from './_validators';
import type { Doc, Id } from './_generated/dataModel';
/**
 * Unkeyed SHA-256 hash of normalized email — for cross-org bounce/complaint
 * correlation. No server-held secret key needed.
 */
// Global hash helpers are imported from `convex/_orgHash.ts` so the
// webhook lookup uses byte-identical normalization as the producer-
// side `computeOrgScoped*Hash` writers. Divergent normalization would
// silently produce `globalEmailHash`/`globalPhoneHash` values that
// never match the stored row — SES bounce/complaint and TCPA
// STOP/START would fail to find any supporter.
import { computeGlobalEmailHash, computeGlobalPhoneHash } from './_orgHash';
import {
	applySupporterStatsDelta,
	applySupporterStatsDeltaBatch,
	type CountableSupporter
} from './_supporterStats';
import {
	applyCampaignDeliveryTransitionReadModel,
	applyCampaignVerifyClickReadModel
} from './lib/campaignReadModelDb';
import { ACCOUNTABILITY_RESPONSE_MAX } from './lib/accountabilityReadModel';
import { syncAccountabilityReceiptProjection } from './lib/accountabilityReadModelDb';
import {
	applyDonationConfirmationTransition,
	DONATION_CONFIRMATION_SUMMARY_VERSION
} from './lib/donationConfirmationSummary';
import { recordSmsReply, SMS_REPLY_SUMMARY_VERSION } from './lib/smsReplySummary';
import {
	CONTACT_AUTHORITY_MIGRATION_KEY,
	CONTACT_AUTHORITY_MIGRATION_PAGE_MAX_BYTES,
	CONTACT_AUTHORITY_MIGRATION_PAGE_SIZE,
	CONTACT_FANOUT_CURSOR_MAX_BYTES,
	CONTACT_FANOUT_INPUT_MAX,
	CONTACT_FANOUT_MAX_ATTEMPTS,
	CONTACT_FANOUT_OVERDUE_MS,
	CONTACT_FANOUT_PAGE_MAX_BYTES,
	CONTACT_FANOUT_PAGE_SIZE,
	CONTACT_FANOUT_PAYLOAD_MAX_BYTES,
	applyEmailAuthorityEvent,
	applySmsAuthorityEvent,
	contactFanoutPriority,
	enqueueContactFanoutJob,
	filterEmailSendAuthorized,
	readContactAuthority,
	seedContactAuthorityFromSupporter,
	type ContactFanoutKind
} from './lib/contactAuthority';
import { syncEmailAbWinnerCandidate } from './lib/emailAbWinnerCandidate';

type DeliveryResponseEvent = {
	type: 'opened' | 'clicked_verify';
	detail?: string;
	confidence: 'observed';
	occurredAt: number;
};

function hasResponse(
	responses: Array<{ type: string; detail?: string }>,
	event: DeliveryResponseEvent
): boolean {
	if (event.type === 'clicked_verify') {
		return responses.some((r) => r.type === event.type && r.detail === event.detail);
	}
	return responses.some((r) => r.type === 'opened');
}

// Classify a clicked SES link as a constituent verify-click. The shipped report
// email links the public proof page at `/v/<campaignId>`; the per-delivery
// credential route `/verify/<hash>` is also a live verify surface. Match either
// as a leading path *segment* (not a bare substring) so unrelated paths that
// merely contain "/v/" — `/services/v/x`, `/communisaas/voter-protocol/...`,
// or a `?next=/v/...` query — are not misclassified as verify clicks. Must not
// throw: it runs inside the webhook mutation, and a throw would drop the event.
function isVerifyLink(linkUrl: string | undefined): boolean {
	if (!linkUrl) return false;
	let path = linkUrl;
	try {
		path = new URL(linkUrl).pathname;
	} catch {
		// Relative or malformed URL — keep the raw string and still anchor on a
		// leading segment so `/v/<id>` (relative) classifies, `not a url` does not.
	}
	return /^\/(v|verify)\//.test(path);
}

const CONTACT_FANOUT_BACKOFF_MS = [5_000, 30_000, 120_000, 300_000, 900_000, 3_600_000];

function boundedProviderEventId(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (!value || value.length > 256) throw new Error('CONTACT_FANOUT_PROVIDER_EVENT_ID_INVALID');
	return value;
}

function contactFanoutIdempotencyKey(
	source: string,
	providerEventId: string | undefined,
	kind: ContactFanoutKind,
	contactHash: string
): string | undefined {
	return providerEventId ? `${source}:${providerEventId}:${kind}:${contactHash}` : undefined;
}

async function scheduleContactFanoutDrain(ctx: { scheduler: any }): Promise<void> {
	await ctx.scheduler.runAfter(0, (internal as any).webhooks.drainContactFanoutQueue, {});
}

// =============================================================================
// SES WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Update supporter emailStatus by email hash (bounce/complaint).
 * Cross-org update is intentional: a bounced address is bounced everywhere.
 */
export const updateSupporterEmailStatus = internalMutation({
	args: {
		emailHashes: v.array(v.string()),
		status: v.string(), // 'bounced' | 'complained'
		providerEventId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		if (args.status !== 'bounced' && args.status !== 'complained') {
			throw new Error('CONTACT_FANOUT_EMAIL_STATUS_INVALID');
		}
		if (args.emailHashes.length < 1 || args.emailHashes.length > CONTACT_FANOUT_INPUT_MAX) {
			throw new Error('CONTACT_FANOUT_EMAIL_HASH_BATCH_INVALID');
		}
		const providerEventId = boundedProviderEventId(args.providerEventId);
		const hashes = [...new Set(args.emailHashes)];
		let accepted = 0;
		for (const hash of hashes) {
			const kind = args.status === 'complained' ? 'email_set_complained' : 'email_set_bounced';
			const result = await enqueueContactFanoutJob(ctx, {
				kind,
				contactHash: hash,
				providerEventId,
				idempotencyKey: contactFanoutIdempotencyKey('ses', providerEventId, kind, hash),
				now: Date.now()
			});
			if (result.existing) continue;
			const authority = await applyEmailAuthorityEvent(ctx, {
				kind,
				contactHash: hash,
				source: 'ses',
				sourceEventId: providerEventId,
				now: Date.now()
			});
			await ctx.db.patch(result.jobId, {
				targetEmailStatus: authority.state === 'email_complained' ? 'complained' : 'bounced',
				targetSoftBounceCount: authority.softBounceCount,
				authorityUpdatedAt: authority.updatedAt
			});
			accepted++;
		}
		if (accepted > 0) await scheduleContactFanoutDrain(ctx);
		return { accepted, duplicates: hashes.length - accepted };
	}
});

/**
 * Process a batch of soft bounces. For each email hash:
 *   - increment supporter.softBounceCount
 *   - on the 3rd increment, set emailStatus='bounced' and write a
 *     suppressedEmails row with 30-day TTL so blast recipient resolution
 *     stops pulling the address. Complaints still trump bounces.
 *
 * Called by the bounce branch in the SNS webhook handler when bounceType is
 * 'Transient' or 'Undetermined' (i.e. not Permanent).
 */
export const recordSoftBounces = internalMutation({
	args: { emailHashes: v.array(v.string()), providerEventId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.emailHashes.length < 1 || args.emailHashes.length > CONTACT_FANOUT_INPUT_MAX) {
			throw new Error('CONTACT_FANOUT_EMAIL_HASH_BATCH_INVALID');
		}
		const providerEventId = boundedProviderEventId(args.providerEventId);
		const hashes = [...new Set(args.emailHashes)];
		let accepted = 0;
		for (const hash of hashes) {
			const kind = 'email_soft_bounce' as const;
			const result = await enqueueContactFanoutJob(ctx, {
				kind,
				contactHash: hash,
				providerEventId,
				idempotencyKey: contactFanoutIdempotencyKey('ses', providerEventId, kind, hash),
				now: Date.now()
			});
			if (result.existing) continue;
			const authority = await applyEmailAuthorityEvent(ctx, {
				kind,
				contactHash: hash,
				source: 'ses',
				sourceEventId: providerEventId,
				now: Date.now()
			});
			await ctx.db.patch(result.jobId, {
				targetEmailStatus:
					authority.state === 'email_complained'
						? 'complained'
						: authority.state === 'email_bounced'
							? 'bounced'
							: undefined,
				targetSoftBounceCount: authority.softBounceCount ?? 0,
				authorityUpdatedAt: authority.updatedAt
			});
			accepted++;
		}
		if (accepted > 0) await scheduleContactFanoutDrain(ctx);
		return { accepted, duplicates: hashes.length - accepted };
	}
});

/**
 * Reset the soft-bounce counter for one or more supporters when SES reports
 * a successful Delivery. A cleared counter means a future transient blip
 * doesn't carry over from a previous send.
 */
export const resetSoftBounce = internalMutation({
	args: { emailHashes: v.array(v.string()), providerEventId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.emailHashes.length < 1 || args.emailHashes.length > CONTACT_FANOUT_INPUT_MAX) {
			throw new Error('CONTACT_FANOUT_EMAIL_HASH_BATCH_INVALID');
		}
		const providerEventId = boundedProviderEventId(args.providerEventId);
		const hashes = [...new Set(args.emailHashes)];
		let accepted = 0;
		for (const hash of hashes) {
			const kind = 'email_reset_soft_bounce' as const;
			const result = await enqueueContactFanoutJob(ctx, {
				kind,
				contactHash: hash,
				providerEventId,
				idempotencyKey: contactFanoutIdempotencyKey('ses', providerEventId, kind, hash),
				now: Date.now()
			});
			if (result.existing) continue;
			const authority = await applyEmailAuthorityEvent(ctx, {
				kind,
				contactHash: hash,
				source: 'ses',
				sourceEventId: providerEventId,
				now: Date.now()
			});
			await ctx.db.patch(result.jobId, {
				targetSoftBounceCount: 0,
				authorityUpdatedAt: authority.updatedAt
			});
			accepted++;
		}
		if (accepted > 0) await scheduleContactFanoutDrain(ctx);
		return { accepted, duplicates: hashes.length - accepted };
	}
});

/**
 * Record an email open event for an email blast.
 */
export const recordEmailOpen = internalMutation({
	args: {
		email: v.string(),
		emailHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Compute email hash for dedup lookups (HMAC is deterministic — safe in mutations)
		const emailHash = args.emailHash ?? (await computeGlobalEmailHash(args.email));

		// Find the most recent sent blast that hasn't already recorded an open for this email
		const blasts = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status', (q) => q.eq('status', 'sent'))
			.order('desc')
			.take(20);

		for (const blast of blasts) {
			// Dedup: check via recipientEmailHash only — no plaintext fallback
			let existingOpen;
			if (emailHash) {
				existingOpen = await ctx.db
					.query('emailEvents')
					.withIndex('by_blastId_recipientEmailHash_eventType', (q) =>
						q.eq('blastId', blast._id).eq('recipientEmailHash', emailHash).eq('eventType', 'open')
					)
					.first();
			}

			if (!existingOpen && blast.batches && blast.batches.length > 0) {
				const totalOpened = (blast.totalOpened ?? 0) + 1;
				await ctx.db.insert('emailEvents', {
					blastId: blast._id,
					recipientEmailHash: emailHash ?? undefined,
					eventType: 'open',
					timestamp: Date.now()
				});
				await ctx.db.patch(blast._id, {
					totalOpened,
					updatedAt: Date.now()
				});
				await syncEmailAbWinnerCandidate(ctx, {
					blastId: blast._id,
					orgId: blast.orgId,
					status: blast.status,
					isAbTest: blast.isAbTest,
					abParentId: blast.abParentId,
					abVariant: blast.abVariant,
					abWinnerPickedAt: blast.abWinnerPickedAt,
					abTestConfig: blast.abTestConfig,
					totalSent: blast.totalSent,
					totalOpened,
					totalClicked: blast.totalClicked,
					sentAt: blast.sentAt
				});
				return;
			}
		}
	}
});

/**
 * Record an email click event for an email blast.
 */
export const recordEmailClick = internalMutation({
	args: {
		email: v.string(),
		linkUrl: v.string()
	},
	handler: async (ctx, args) => {
		// Compute email hash (HMAC is deterministic — safe in mutations)
		const emailHash = await computeGlobalEmailHash(args.email);

		// Find the most recent sent blast
		const blasts = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status', (q) => q.eq('status', 'sent'))
			.order('desc')
			.take(20);

		for (const blast of blasts) {
			// Check for open event via hash — no plaintext fallback
			let hasOpen;
			if (emailHash) {
				hasOpen = await ctx.db
					.query('emailEvents')
					.withIndex('by_blastId_recipientEmailHash_eventType', (q) =>
						q.eq('blastId', blast._id).eq('recipientEmailHash', emailHash).eq('eventType', 'open')
					)
					.first();
			}

			if (hasOpen || (blast.batches && blast.batches.length > 0)) {
				// Dedup against duplicate SNS click delivery (AWS retries the same
				// MessageId on transient downstream failures). Without this check,
				// a re-delivered click event inflates totalClicked. Per-link dedup
				// (matching linkUrl) so a user legitimately clicking two links in
				// the same email still produces two click rows. (cure shipped).
				if (emailHash) {
					const existingClick = await ctx.db
						.query('emailEvents')
						.withIndex('by_blastId_recipientEmailHash_eventType_linkUrl', (q) =>
							q
								.eq('blastId', blast._id)
								.eq('recipientEmailHash', emailHash)
								.eq('eventType', 'click')
								.eq('linkUrl', args.linkUrl)
						)
						.first();
					if (existingClick) {
						return;
					}
				}
				const totalClicked = (blast.totalClicked ?? 0) + 1;
				await ctx.db.insert('emailEvents', {
					blastId: blast._id,
					recipientEmailHash: emailHash ?? undefined,
					eventType: 'click',
					linkUrl: args.linkUrl,
					timestamp: Date.now()
				});
				await ctx.db.patch(blast._id, {
					totalClicked,
					updatedAt: Date.now()
				});
				await syncEmailAbWinnerCandidate(ctx, {
					blastId: blast._id,
					orgId: blast.orgId,
					status: blast.status,
					isAbTest: blast.isAbTest,
					abParentId: blast.abParentId,
					abVariant: blast.abVariant,
					abWinnerPickedAt: blast.abWinnerPickedAt,
					abTestConfig: blast.abTestConfig,
					totalSent: blast.totalSent,
					totalOpened: blast.totalOpened,
					totalClicked,
					sentAt: blast.sentAt
				});
				return;
			}
		}
	}
});

/**
 * Handle SES event for a CampaignDelivery (proof report tracking).
 */
export const handleDeliveryEvent = internalMutation({
	args: {
		sesMessageId: v.string(),
		notificationType: v.string(),
		linkUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Find campaign delivery by sesMessageId via the `by_sesMessageId`
		// index — `.filter(q.eq(...))` would full-scan every campaign
		// delivery row. `.first()` is sufficient because the field is
		// unique by construction (SES guarantees one MessageId per send);
		// collisions are operator-investigable via the warn log emitted
		// from `updateDeliveryStatus`.
		const delivery = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_sesMessageId', (q) => q.eq('sesMessageId', args.sesMessageId))
			.first();

		if (!delivery) return { found: false };

		const now = Date.now();

		switch (args.notificationType) {
			case 'Delivery':
				await applyCampaignDeliveryTransitionReadModel(
					ctx,
					delivery._id,
					delivery.status,
					'delivered',
					now
				);
				await ctx.db.patch(delivery._id, { status: 'delivered' });
				break;

			case 'Bounce':
				await applyCampaignDeliveryTransitionReadModel(
					ctx,
					delivery._id,
					delivery.status,
					'bounced',
					now
				);
				await ctx.db.patch(delivery._id, { status: 'bounced' });
				break;

			case 'Open': {
				// Find associated accountability receipt to add response
				const receipt = await ctx.db
					.query('accountabilityReceipts')
					.withIndex('by_deliveryId', (q) => q.eq('deliveryId', delivery._id))
					.first();

				const event = { type: 'opened' as const, confidence: 'observed' as const, occurredAt: now };
				if (receipt) {
					const responses = receipt.responses ?? [];
					const alreadyOpened = hasResponse(responses, event);
					if (!alreadyOpened) {
						if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
							throw new Error('ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED');
						} else {
							await ctx.db.patch(receipt._id, {
								responses: [...responses, event],
								updatedAt: now
							});
							await syncAccountabilityReceiptProjection(ctx, receipt._id);
						}
					}
				} else {
					const responses = delivery.responses ?? [];
					if (!hasResponse(responses, event)) {
						if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
							throw new Error('CAMPAIGN_DELIVERY_RESPONSE_LIMIT_EXCEEDED');
						} else {
							await ctx.db.patch(delivery._id, { responses: [...responses, event] });
						}
					}
				}
				await applyCampaignDeliveryTransitionReadModel(
					ctx,
					delivery._id,
					delivery.status,
					'opened',
					now
				);
				await ctx.db.patch(delivery._id, { status: 'opened' });
				break;
			}

			case 'Click': {
				const receipt = await ctx.db
					.query('accountabilityReceipts')
					.withIndex('by_deliveryId', (q) => q.eq('deliveryId', delivery._id))
					.first();

				const isVerifyClick = isVerifyLink(args.linkUrl);
				const event: DeliveryResponseEvent = isVerifyClick
					? {
							type: 'clicked_verify',
							detail: args.linkUrl,
							confidence: 'observed',
							occurredAt: now
						}
					: { type: 'opened', confidence: 'observed', occurredAt: now };

				if (receipt) {
					const responses = receipt.responses ?? [];
					const verifyAlreadyCounted = responses.some(
						(response) => response.type === 'clicked_verify'
					);
					// dedup against duplicate SNS click delivery.
					// Same retry-inflation pattern as elsewhere (SNS click on emailEvents)
					// and (Twilio delivered counter). For verify clicks, dedup
					// on (type, detail) so multiple distinct verify links each register
					// but a retried delivery for the same link doesn't double-count.
					// For non-verify clicks (type="opened"), match the Open case's
					// global dedup ("opened" entry exists at all → skip).
					const alreadyRecorded = hasResponse(responses, event);

					if (!alreadyRecorded) {
						if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
							throw new Error('ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED');
						} else {
							if (isVerifyClick && !verifyAlreadyCounted) {
								await applyCampaignVerifyClickReadModel(ctx, delivery._id, now);
							}
							await ctx.db.patch(receipt._id, {
								responses: [...responses, event],
								updatedAt: now
							});
							await syncAccountabilityReceiptProjection(ctx, receipt._id);
						}
					}
				} else {
					const responses = delivery.responses ?? [];
					const verifyAlreadyCounted = responses.some(
						(response) => response.type === 'clicked_verify'
					);
					if (!hasResponse(responses, event)) {
						if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
							throw new Error('CAMPAIGN_DELIVERY_RESPONSE_LIMIT_EXCEEDED');
						} else {
							if (isVerifyClick && !verifyAlreadyCounted) {
								await applyCampaignVerifyClickReadModel(ctx, delivery._id, now);
							}
							await ctx.db.patch(delivery._id, { responses: [...responses, event] });
						}
					}
				}
				break;
			}
		}

		return { found: true };
	}
});

// =============================================================================
// SES WEBHOOK — ACTION (orchestrates mutations)
// =============================================================================

/**
 * Process an SES/SNS notification. Called from the HTTP router after
 * signature verification + topic ARN validation.
 */
export const processSesWebhook = internalAction({
	args: {
		snsType: v.string(), // 'SubscriptionConfirmation' | 'Notification'
		subscribeURL: v.optional(v.string()),
		message: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		// Handle SNS subscription confirmation
		if (args.snsType === 'SubscriptionConfirmation' && args.subscribeURL) {
			const response = await fetch(args.subscribeURL);
			if (!response.ok) {
				throw new Error(`SES_SUBSCRIPTION_CONFIRMATION_FAILED_${response.status}`);
			}
			return { ok: true };
		}

		if (args.snsType !== 'Notification' || !args.message) {
			return { ok: true };
		}

		const message = args.message;
		const notificationType = message.notificationType;

		// Extract SES mail.messageId for CampaignDelivery correlation
		const mailMessageId = message.mail?.messageId ?? null;

		// Try to route to CampaignDelivery first (report delivery tracking)
		if (mailMessageId) {
			const result = await ctx.runMutation(internal.webhooks.handleDeliveryEvent, {
				sesMessageId: mailMessageId,
				notificationType,
				linkUrl: message.click?.link
			});

			if (result.found) return { ok: true };
		}

		// Fall through to EmailBlast logic
		if (notificationType === 'Bounce') {
			const bounce = message.bounce;
			const emails: string[] = (bounce?.bouncedRecipients ?? []).map(
				(r: { emailAddress: string }) => r.emailAddress.toLowerCase()
			);
			if (emails.length === 0) return { ok: true };

			const hashes = (
				await Promise.all(emails.map((email: string) => computeGlobalEmailHash(email)))
			).filter((h): h is string => h !== null);

			if (hashes.length === 0) return { ok: true };

			if (bounce?.bounceType === 'Permanent') {
				await ctx.runMutation(internal.webhooks.updateSupporterEmailStatus, {
					emailHashes: hashes,
					status: 'bounced',
					providerEventId: mailMessageId ?? undefined
				});
			} else {
				// Transient / Undetermined — increment soft-bounce tally; SES sends
				// these even on successful retries, so we only flip emailStatus once
				// we cross the threshold inside recordSoftBounces.
				await ctx.runMutation(internal.webhooks.recordSoftBounces, {
					emailHashes: hashes,
					providerEventId: mailMessageId ?? undefined
				});
			}
		} else if (notificationType === 'Delivery') {
			// SES confirms the address still accepts mail. Reset any soft-bounce
			// counter so a stale transient blip doesn't tip over the threshold.
			const emails: string[] = (
				message.delivery?.recipients ??
				message.mail?.destination ??
				[]
			).map((e: string) => e.toLowerCase());
			if (emails.length > 0) {
				const hashes = (
					await Promise.all(emails.map((email: string) => computeGlobalEmailHash(email)))
				).filter((h): h is string => h !== null);
				if (hashes.length > 0) {
					await ctx.runMutation(internal.webhooks.resetSoftBounce, {
						emailHashes: hashes,
						providerEventId: mailMessageId ?? undefined
					});
				}
			}
		} else if (notificationType === 'Complaint') {
			const complaint = message.complaint;
			const emails: string[] = (complaint?.complainedRecipients ?? []).map(
				(r: { emailAddress: string }) => r.emailAddress.toLowerCase()
			);

			if (emails.length > 0) {
				const hashes = (
					await Promise.all(emails.map((email: string) => computeGlobalEmailHash(email)))
				).filter((h): h is string => h !== null);

				if (hashes.length > 0) {
					await ctx.runMutation(internal.webhooks.updateSupporterEmailStatus, {
						emailHashes: hashes,
						status: 'complained',
						providerEventId: mailMessageId ?? undefined
					});
				}
			}
		} else if (notificationType === 'Open') {
			const email = message.mail?.destination?.[0]?.toLowerCase();
			if (email) {
				await ctx.runMutation(internal.webhooks.recordEmailOpen, { email });
			}
		} else if (notificationType === 'Click') {
			const email = message.mail?.destination?.[0]?.toLowerCase();
			const linkUrl = message.click?.link;
			if (email && linkUrl) {
				await ctx.runMutation(internal.webhooks.recordEmailClick, { email, linkUrl });
			}
		}

		return { ok: true };
	}
});

// =============================================================================
// TWILIO SMS WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Update SMS message delivery status.
 */
export const updateSmsStatus = internalMutation({
	args: {
		twilioSid: v.string(),
		status: smsMessageStatusV,
		errorCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const message = await ctx.db
			.query('smsMessages')
			.withIndex('by_twilioSid', (q) => q.eq('twilioSid', args.twilioSid))
			.first();

		if (!message) return;

		// Capture the previous status BEFORE patching so we can detect a real
		// status transition vs a duplicate-delivery callback. Twilio retries
		// status callbacks on transient downstream failures (network hiccups
		// between Twilio and our endpoint); without this guard, every retry
		// of a `delivered` callback re-increments the blast's deliveredCount.
		// Same class of bug as elsewhere (SNS click-event retry inflation), now
		// closed for SMS via the previous-status check. (cure shipped).
		const previousStatus = message.status;

		await ctx.db.patch(message._id, {
			status: args.status,
			errorCode: args.errorCode ?? undefined
		});

		// Only increment the blast's deliveredCount when the message TRANSITIONED
		// into 'delivered' — not when an already-delivered message receives a
		// duplicate callback.
		if (args.status === 'delivered' && previousStatus !== 'delivered') {
			const blast = await ctx.db.get(message.blastId);
			if (blast) {
				await ctx.db.patch(blast._id, {
					deliveredCount: (blast.deliveredCount ?? 0) + 1,
					updatedAt: Date.now()
				});
			}
		}
	}
});

/**
 * Handle inbound SMS (STOP/START keywords for TCPA compliance).
 */
export const handleInboundSms = internalMutation({
	args: {
		from: v.string(), // E.164 phone number
		// Twilio destination number the user replied to. When present +
		// registered exactly once in `orgTwilioNumbers`, START is scoped to
		// that org. Missing/unregistered/ambiguous routes become durable failed
		// jobs and never relax the global STOP authority.
		to: v.optional(v.string()),
		messageSid: v.string(),
		body: v.string()
	},
	handler: async (ctx, args) => {
		const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
		const START_KEYWORDS = new Set(['start', 'yes', 'unstop']);
		if (!args.from || args.from.length > 32) throw new Error('CONTACT_FANOUT_FROM_INVALID');
		if (args.to !== undefined && args.to.length > 32) {
			throw new Error('CONTACT_FANOUT_DESTINATION_TOO_LARGE');
		}
		if (!args.messageSid || args.messageSid.length > 128) {
			throw new Error('CONTACT_FANOUT_PROVIDER_EVENT_ID_INVALID');
		}
		const replyBody = args.body.trim();
		if (replyBody.length > 1600) throw new Error('CONTACT_FANOUT_REPLY_TOO_LARGE');
		if (!replyBody) return { accepted: false as const, reason: 'empty' as const };
		const body = replyBody.toLowerCase();
		const kind: ContactFanoutKind = STOP_KEYWORDS.has(body)
			? 'sms_stop'
			: START_KEYWORDS.has(body)
				? 'sms_start'
				: 'sms_reply';
		const fromPhoneHash = await computeGlobalPhoneHash(args.from);
		if (!fromPhoneHash) throw new Error('CONTACT_FANOUT_PHONE_HASH_FAILED');

		let scopedOrgId: Id<'organizations'> | undefined;
		let routingFailure: string | undefined;
		if (kind !== 'sms_stop') {
			const prefix = kind === 'sms_start' ? 'SMS_START' : 'SMS_REPLY';
			if (!args.to) {
				routingFailure = `${prefix}_ROUTE_MISSING`;
			} else {
				const matches = await ctx.db
					.query('orgTwilioNumbers')
					.withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', args.to as string))
					.take(2);
				if (matches.length === 1) scopedOrgId = matches[0].orgId;
				else {
					routingFailure =
						matches.length > 1 ? `${prefix}_ROUTE_AMBIGUOUS` : `${prefix}_ROUTE_UNREGISTERED`;
				}
			}
		}

		const now = Date.now();
		const providerEventId = boundedProviderEventId(args.messageSid);
		const result = await enqueueContactFanoutJob(ctx, {
			kind,
			contactHash: fromPhoneHash,
			scopeOrgId: scopedOrgId,
			providerEventId,
			idempotencyKey: contactFanoutIdempotencyKey('twilio', providerEventId, kind, fromPhoneHash),
			replyBody: kind === 'sms_reply' ? replyBody : undefined,
			replyToNumber: args.to,
			now,
			failureCode: routingFailure
		});
		if (!result.existing && !result.failed && kind !== 'sms_reply') {
			const authority = await applySmsAuthorityEvent(ctx, {
				kind,
				contactHash: fromPhoneHash,
				scopeOrgId: scopedOrgId,
				sourceEventId: providerEventId,
				now
			});
			await ctx.db.patch(result.jobId, {
				targetSmsStatus: kind === 'sms_stop' ? 'stopped' : 'subscribed',
				authorityUpdatedAt: authority.updatedAt
			});
		}
		if (!result.existing && !result.failed) await scheduleContactFanoutDrain(ctx);
		return {
			accepted: true as const,
			jobId: result.jobId,
			duplicate: result.existing,
			status: result.failed ? ('failed' as const) : ('pending' as const),
			failureCode: routingFailure ?? null
		};
	}
});

// =============================================================================
// DURABLE GLOBAL CONTACT AUTHORITY + FANOUT
// =============================================================================

export const getNextContactFanoutJob = internalQuery({
	args: { asOf: v.number() },
	handler: async (ctx, { asOf }) => {
		if (!Number.isSafeInteger(asOf) || asOf < 0) throw new Error('CONTACT_FANOUT_AS_OF_INVALID');
		for (let priority = 0; priority <= contactFanoutPriority('sms_reply'); priority++) {
			const job = await ctx.db
				.query('contactFanoutJobs')
				.withIndex('by_status_priority_nextAttemptAt', (q) =>
					q.eq('status', 'pending').eq('priority', priority).lte('nextAttemptAt', asOf)
				)
				.order('asc')
				.first();
			if (job) return job;
		}
		return null;
	}
});

function addStatsTransition(
	groups: Map<
		string,
		{
			orgId: Id<'organizations'>;
			pairs: Array<{ before: CountableSupporter; after: CountableSupporter }>;
		}
	>,
	before: Doc<'supporters'>,
	after: Doc<'supporters'>
): void {
	const key = String(before.orgId);
	const group = groups.get(key) ?? { orgId: before.orgId, pairs: [] };
	group.pairs.push({ before, after });
	groups.set(key, group);
}

async function completeSmsReplyJob(
	ctx: Parameters<typeof recordSmsReply>[0],
	job: Doc<'contactFanoutJobs'>,
	now: number
): Promise<{ processed: number; changed: number }> {
	if (!job.scopeOrgId || !job.replyBody) throw new Error('SMS_REPLY_ROUTE_NOT_RESOLVED');
	if (job.providerEventId) {
		const existing = await ctx.db
			.query('smsReplies')
			.withIndex('by_twilioSid', (q) => q.eq('twilioSid', job.providerEventId as string))
			.take(2);
		if (existing.length > 1) throw new Error('SMS_REPLY_PROVIDER_ID_MULTIPLICITY');
		if (existing[0]) return { processed: 1, changed: 0 };
	}
	const supporters = await ctx.db
		.query('supporters')
		.withIndex('by_globalPhoneHash_orgId', (q) =>
			q.eq('globalPhoneHash', job.contactHash).eq('orgId', job.scopeOrgId as Id<'organizations'>)
		)
		.take(2);
	if (supporters.length > 1) throw new Error('SMS_REPLY_SUPPORTER_MULTIPLICITY');
	const supporterId = supporters.length === 1 ? supporters[0]._id : undefined;
	let blastId: Id<'smsBlasts'> | undefined;
	if (supporterId) {
		const recentMessages = await ctx.db
			.query('smsMessages')
			.withIndex('by_supporterId', (q) => q.eq('supporterId', supporterId))
			.order('desc')
			.take(25);
		for (const message of recentMessages) {
			const blast = await ctx.db.get(message.blastId);
			if (!blast || blast.orgId !== job.scopeOrgId) continue;
			if (job.replyToNumber && blast.fromNumber && blast.fromNumber !== job.replyToNumber) continue;
			blastId = blast._id;
			break;
		}
	}
	const reply = {
		orgId: job.scopeOrgId,
		supporterId,
		blastId,
		fromHash: job.contactHash,
		toNumber: job.replyToNumber,
		body: job.replyBody,
		twilioSid: job.providerEventId,
		receivedAt: job.createdAt,
		summaryVersion: SMS_REPLY_SUMMARY_VERSION
	};
	await recordSmsReply(ctx, reply, now);
	await ctx.db.insert('smsReplies', reply);
	return { processed: supporters.length, changed: 1 };
}

export const processContactFanoutPage = internalMutation({
	args: {
		jobId: v.id('contactFanoutJobs'),
		expectedCursor: v.optional(v.string()),
		asOf: v.number()
	},
	handler: async (ctx, args) => {
		if (!Number.isSafeInteger(args.asOf) || args.asOf < 0) {
			throw new Error('CONTACT_FANOUT_AS_OF_INVALID');
		}
		const job = await ctx.db.get(args.jobId);
		if (!job || job.status !== 'pending') return { status: 'stale' as const };
		if ((job.cursor ?? undefined) !== args.expectedCursor) return { status: 'stale' as const };
		if (job.nextAttemptAt > args.asOf) return { status: 'not-due' as const };
		if (job.payloadBytes > 4 * 1024) throw new Error('CONTACT_FANOUT_PAYLOAD_TOO_LARGE');
		if (
			job.cursor !== undefined &&
			new TextEncoder().encode(job.cursor).byteLength > CONTACT_FANOUT_CURSOR_MAX_BYTES
		) {
			throw new Error('CONTACT_FANOUT_CURSOR_TOO_LARGE');
		}

		if (job.kind === 'sms_reply') {
			const result = await completeSmsReplyJob(ctx, job, args.asOf);
			await ctx.db.patch(job._id, {
				status: 'complete',
				processedCount: job.processedCount + result.processed,
				changedCount: job.changedCount + result.changed,
				pageCount: job.pageCount + 1,
				completedAt: args.asOf,
				updatedAt: args.asOf
			});
			await scheduleContactFanoutDrain(ctx);
			return { status: 'complete' as const, ...result };
		}

		if (job.authorityUpdatedAt === undefined) {
			throw new Error('CONTACT_FANOUT_AUTHORITY_SNAPSHOT_MISSING');
		}
		const pagination = {
			cursor: job.cursor ?? null,
			numItems: CONTACT_FANOUT_PAGE_SIZE,
			maximumRowsRead: CONTACT_FANOUT_PAGE_SIZE + 1,
			maximumBytesRead: CONTACT_FANOUT_PAGE_MAX_BYTES
		};
		const pageResult = job.kind.startsWith('email_')
			? await ctx.db
					.query('supporters')
					.withIndex('by_globalEmailHash', (q) => q.eq('globalEmailHash', job.contactHash))
					.order('asc')
					.paginate(pagination)
			: job.kind === 'sms_start' && job.scopeOrgId
				? await ctx.db
						.query('supporters')
						.withIndex('by_globalPhoneHash_orgId', (q) =>
							q
								.eq('globalPhoneHash', job.contactHash)
								.eq('orgId', job.scopeOrgId as Id<'organizations'>)
						)
						.order('asc')
						.paginate(pagination)
				: await ctx.db
						.query('supporters')
						.withIndex('by_globalPhoneHash', (q) => q.eq('globalPhoneHash', job.contactHash))
						.order('asc')
						.paginate(pagination);
		if (pageResult.pageStatus === 'SplitRequired') {
			throw new Error('CONTACT_FANOUT_PAGE_SPLIT_REQUIRED');
		}

		const statsGroups = new Map<
			string,
			{
				orgId: Id<'organizations'>;
				pairs: Array<{ before: CountableSupporter; after: CountableSupporter }>;
			}
		>();
		let changed = 0;
		for (const supporter of pageResult.page) {
			if (job.kind.startsWith('email_')) {
				if ((supporter.contactEmailAuthorityUpdatedAt ?? -1) >= job.authorityUpdatedAt) continue;
				const nextEmailStatus =
					job.targetEmailStatus === 'complained'
						? 'complained'
						: supporter.emailStatus === 'complained'
							? 'complained'
							: (job.targetEmailStatus ?? supporter.emailStatus);
				const after = {
					...supporter,
					emailStatus: nextEmailStatus,
					softBounceCount: job.targetSoftBounceCount ?? supporter.softBounceCount,
					contactEmailAuthorityUpdatedAt: job.authorityUpdatedAt,
					updatedAt: args.asOf
				};
				await ctx.db.patch(supporter._id, {
					emailStatus: after.emailStatus,
					softBounceCount: after.softBounceCount,
					contactEmailAuthorityUpdatedAt: job.authorityUpdatedAt,
					updatedAt: args.asOf
				});
				if (after.emailStatus !== supporter.emailStatus) {
					addStatsTransition(statsGroups, supporter, after);
				}
				changed++;
			} else {
				if ((supporter.contactSmsAuthorityUpdatedAt ?? -1) >= job.authorityUpdatedAt) continue;
				if (job.targetSmsStatus !== 'stopped' && job.targetSmsStatus !== 'subscribed') {
					throw new Error('CONTACT_FANOUT_SMS_TARGET_INVALID');
				}
				const after = {
					...supporter,
					smsStatus: job.targetSmsStatus,
					contactSmsAuthorityUpdatedAt: job.authorityUpdatedAt,
					updatedAt: args.asOf
				};
				await ctx.db.patch(supporter._id, {
					smsStatus: after.smsStatus,
					contactSmsAuthorityUpdatedAt: job.authorityUpdatedAt,
					updatedAt: args.asOf
				});
				if (after.smsStatus !== supporter.smsStatus) {
					addStatsTransition(statsGroups, supporter, after);
				}
				changed++;
			}
		}
		for (const group of statsGroups.values()) {
			await applySupporterStatsDeltaBatch(ctx, group.orgId, group.pairs);
		}

		const complete = pageResult.isDone;
		await ctx.db.patch(job._id, {
			status: complete ? 'complete' : 'pending',
			cursor: complete ? undefined : pageResult.continueCursor,
			processedCount: job.processedCount + pageResult.page.length,
			changedCount: job.changedCount + changed,
			pageCount: job.pageCount + 1,
			attempts: 0,
			nextAttemptAt: args.asOf,
			failureCode: undefined,
			lastError: undefined,
			updatedAt: args.asOf,
			...(complete ? { completedAt: args.asOf } : {})
		});
		await scheduleContactFanoutDrain(ctx);
		return {
			status: complete ? ('complete' as const) : ('continued' as const),
			processed: pageResult.page.length,
			changed
		};
	}
});

export const recordContactFanoutFailure = internalMutation({
	args: {
		jobId: v.id('contactFanoutJobs'),
		expectedCursor: v.optional(v.string()),
		asOf: v.number(),
		error: v.string()
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || job.status !== 'pending' || (job.cursor ?? undefined) !== args.expectedCursor) {
			return { status: 'stale' as const };
		}
		const attempts = job.attempts + 1;
		const terminal = attempts >= CONTACT_FANOUT_MAX_ATTEMPTS;
		const error = args.error.slice(0, 256);
		const delay =
			CONTACT_FANOUT_BACKOFF_MS[Math.min(attempts - 1, CONTACT_FANOUT_BACKOFF_MS.length - 1)];
		await ctx.db.patch(job._id, {
			status: terminal ? 'failed' : 'pending',
			attempts,
			nextAttemptAt: terminal ? args.asOf : args.asOf + delay,
			failureCode: terminal ? 'CONTACT_FANOUT_ATTEMPTS_EXHAUSTED' : undefined,
			lastError: error,
			updatedAt: args.asOf,
			...(terminal ? { completedAt: args.asOf } : {})
		});
		if (terminal) {
			await ctx.db.insert('contactFanoutJobEvents', {
				jobId: job._id,
				type: 'worker_failed',
				attempt: attempts,
				failureCode: 'CONTACT_FANOUT_ATTEMPTS_EXHAUSTED',
				error,
				createdAt: args.asOf
			});
		}
		await ctx.scheduler.runAfter(
			terminal ? 0 : delay,
			(internal as any).webhooks.drainContactFanoutQueue,
			{}
		);
		return { status: terminal ? ('failed' as const) : ('retrying' as const), attempts };
	}
});

/**
 * Bounded operator recovery for a terminal job. The same cursor and job id are
 * preserved, attempts reset, and an append-only event records the intervention.
 * Routing failures can resolve from the repaired Twilio registry or an explicit
 * organization supplied by an operator; no new fanout job is created.
 */
export const retryContactFanoutJob = internalMutation({
	args: {
		jobId: v.id('contactFanoutJobs'),
		scopeOrgId: v.optional(v.id('organizations'))
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) throw new Error('CONTACT_FANOUT_JOB_NOT_FOUND');
		if (job.status !== 'failed') return { status: job.status, retried: false as const };
		const now = Date.now();
		let scopeOrgId = job.scopeOrgId;
		if (args.scopeOrgId) {
			const org = await ctx.db.get(args.scopeOrgId);
			if (!org) throw new Error('CONTACT_FANOUT_RETRY_ORG_NOT_FOUND');
			if (scopeOrgId && scopeOrgId !== args.scopeOrgId) {
				throw new Error('CONTACT_FANOUT_RETRY_SCOPE_MISMATCH');
			}
			scopeOrgId = args.scopeOrgId;
		}
		if ((job.kind === 'sms_start' || job.kind === 'sms_reply') && !scopeOrgId) {
			if (!job.replyToNumber) throw new Error('CONTACT_FANOUT_RETRY_ROUTE_MISSING');
			const routes = await ctx.db
				.query('orgTwilioNumbers')
				.withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', job.replyToNumber as string))
				.take(2);
			if (routes.length !== 1) {
				throw new Error(
					routes.length > 1
						? 'CONTACT_FANOUT_RETRY_ROUTE_AMBIGUOUS'
						: 'CONTACT_FANOUT_RETRY_ROUTE_UNREGISTERED'
				);
			}
			scopeOrgId = routes[0].orgId;
		}

		let targetSmsStatus = job.targetSmsStatus;
		let authorityUpdatedAt = job.authorityUpdatedAt;
		if (job.kind === 'sms_start' && authorityUpdatedAt === undefined) {
			if (!scopeOrgId) throw new Error('CONTACT_FANOUT_RETRY_ROUTE_MISSING');
			const authority = await applySmsAuthorityEvent(ctx, {
				kind: 'sms_start',
				contactHash: job.contactHash,
				scopeOrgId,
				sourceEventId: job.providerEventId,
				now
			});
			targetSmsStatus = 'subscribed';
			authorityUpdatedAt = authority.updatedAt;
		}
		if (job.kind !== 'sms_reply' && authorityUpdatedAt === undefined) {
			throw new Error('CONTACT_FANOUT_RETRY_AUTHORITY_SNAPSHOT_MISSING');
		}
		const payloadBytes = new TextEncoder().encode(
			JSON.stringify({
				kind: job.kind,
				contactHash: job.contactHash,
				scopeOrgId,
				idempotencyKey: job.idempotencyKey,
				providerEventId: job.providerEventId,
				replyBody: job.replyBody,
				replyToNumber: job.replyToNumber
			})
		).byteLength;
		if (payloadBytes > CONTACT_FANOUT_PAYLOAD_MAX_BYTES) {
			throw new Error('CONTACT_FANOUT_PAYLOAD_TOO_LARGE');
		}
		await ctx.db.insert('contactFanoutJobEvents', {
			jobId: job._id,
			type: 'operator_retry',
			attempt: job.attempts,
			failureCode: job.failureCode,
			error: job.lastError,
			createdAt: now
		});
		await ctx.db.patch(job._id, {
			...(scopeOrgId ? { scopeOrgId } : {}),
			...(targetSmsStatus ? { targetSmsStatus } : {}),
			...(authorityUpdatedAt !== undefined ? { authorityUpdatedAt } : {}),
			status: 'pending',
			attempts: 0,
			nextAttemptAt: now,
			failureCode: undefined,
			lastError: undefined,
			completedAt: undefined,
			payloadBytes,
			updatedAt: now
		});
		await scheduleContactFanoutDrain(ctx);
		return { status: 'pending' as const, retried: true as const, scopeOrgId: scopeOrgId ?? null };
	}
});

export const listContactFanoutJobEvents = internalQuery({
	args: { jobId: v.id('contactFanoutJobs'), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = args.limit ?? 50;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new Error('CONTACT_FANOUT_EVENT_LIMIT_INVALID');
		}
		return ctx.db
			.query('contactFanoutJobEvents')
			.withIndex('by_jobId_createdAt', (q) => q.eq('jobId', args.jobId))
			.order('desc')
			.take(limit);
	}
});

export const drainContactFanoutQueue: any = internalAction({
	args: {},
	handler: async (ctx): Promise<unknown> => {
		const asOf = Date.now();
		const job = (await ctx.runQuery((internal as any).webhooks.getNextContactFanoutJob, {
			asOf
		})) as Doc<'contactFanoutJobs'> | null;
		if (!job) return { status: 'idle' as const };
		try {
			return await ctx.runMutation((internal as any).webhooks.processContactFanoutPage, {
				jobId: job._id,
				expectedCursor: job.cursor,
				asOf
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return await ctx.runMutation((internal as any).webhooks.recordContactFanoutFailure, {
				jobId: job._id,
				expectedCursor: job.cursor,
				asOf,
				error: message
			});
		}
	}
});

export const assertEmailSendAdmissions = internalQuery({
	args: { supporterIds: v.array(v.id('supporters')) },
	handler: async (ctx, args) => {
		if (args.supporterIds.length < 1 || args.supporterIds.length > 100) {
			throw new Error('EMAIL_CONTACT_AUTHORITY_BATCH_INVALID');
		}
		const supporters: Array<Doc<'supporters'>> = [];
		for (const supporterId of args.supporterIds) {
			const supporter = await ctx.db.get(supporterId);
			if (!supporter || supporter.emailStatus !== 'subscribed') continue;
			supporters.push(supporter);
		}
		const allowed = await filterEmailSendAuthorized(ctx, supporters);
		return { allowedSupporterIds: allowed.map((supporter) => supporter._id) };
	}
});

export const startContactAuthorityMigration = internalMutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db
			.query('contactAuthorityMigrations')
			.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_MIGRATION_KEY))
			.unique();
		if (existing?.status === 'ready') return { status: 'ready' as const };
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				status: 'running',
				cursor: undefined,
				scanned: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				startedAt: now,
				completedAt: undefined,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('contactAuthorityMigrations', {
				key: CONTACT_AUTHORITY_MIGRATION_KEY,
				status: 'running',
				scanned: 0,
				startedAt: now,
				updatedAt: now
			});
		}
		await ctx.scheduler.runAfter(
			0,
			(internal as any).webhooks.runContactAuthorityMigrationPage,
			{}
		);
		return { status: 'running' as const };
	}
});

export const runContactAuthorityMigrationPage = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('contactAuthorityMigrations')
			.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_MIGRATION_KEY))
			.unique();
		if (!migration || migration.status !== 'running') return { status: 'idle' as const };
		const page = await ctx.db
			.query('supporters')
			.order('asc')
			.paginate({
				cursor: migration.cursor ?? null,
				numItems: CONTACT_AUTHORITY_MIGRATION_PAGE_SIZE,
				maximumRowsRead: CONTACT_AUTHORITY_MIGRATION_PAGE_SIZE + 1,
				maximumBytesRead: CONTACT_AUTHORITY_MIGRATION_PAGE_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode: 'CONTACT_AUTHORITY_MIGRATION_PAGE_SPLIT_REQUIRED',
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const };
		}
		const missing = page.page.find((supporter) => {
			const needsEmailAuthority =
				supporter.emailStatus === 'subscribed' ||
				supporter.emailStatus === 'bounced' ||
				supporter.emailStatus === 'complained';
			const needsSmsAuthority =
				supporter.smsStatus === 'stopped' ||
				(supporter.smsStatus === 'subscribed' && !!supporter.encryptedPhone);
			return (
				(needsEmailAuthority && !supporter.globalEmailHash) ||
				(needsSmsAuthority && !supporter.globalPhoneHash)
			);
		});
		if (missing) {
			const missingEmail =
				!missing.globalEmailHash &&
				(missing.emailStatus === 'subscribed' ||
					missing.emailStatus === 'bounced' ||
					missing.emailStatus === 'complained');
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode: missingEmail
					? 'CONTACT_AUTHORITY_EMAIL_HASH_MISSING'
					: 'CONTACT_AUTHORITY_PHONE_HASH_MISSING',
				failureSourceId: missing._id,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, supporterId: missing._id };
		}
		const now = Date.now();
		let authoritiesSeeded = 0;
		for (const supporter of page.page) {
			authoritiesSeeded += await seedContactAuthorityFromSupporter(ctx, supporter, now);
		}
		const scanned = migration.scanned + page.page.length;
		if (page.isDone) {
			await ctx.db.patch(migration._id, {
				status: 'ready',
				cursor: undefined,
				scanned,
				failureCode: undefined,
				failureSourceId: undefined,
				completedAt: now,
				updatedAt: now
			});
			return { status: 'ready' as const, scanned, authoritiesSeeded };
		}
		await ctx.db.patch(migration._id, {
			cursor: page.continueCursor,
			scanned,
			updatedAt: now
		});
		await ctx.scheduler.runAfter(
			0,
			(internal as any).webhooks.runContactAuthorityMigrationPage,
			{}
		);
		return { status: 'running' as const, scanned, authoritiesSeeded };
	}
});

export const contactFanoutReadiness = internalQuery({
	args: { asOf: v.number() },
	handler: async (ctx, { asOf }) => {
		if (!Number.isSafeInteger(asOf) || asOf < 0) throw new Error('CONTACT_FANOUT_AS_OF_INVALID');
		const [migration, failed, oldestPending] = await Promise.all([
			ctx.db
				.query('contactAuthorityMigrations')
				.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_MIGRATION_KEY))
				.unique(),
			ctx.db
				.query('contactFanoutJobs')
				.withIndex('by_status_createdAt', (q) => q.eq('status', 'failed'))
				.order('asc')
				.first(),
			ctx.db
				.query('contactFanoutJobs')
				.withIndex('by_status_createdAt', (q) => q.eq('status', 'pending'))
				.order('asc')
				.first()
		]);
		const overdue =
			oldestPending !== null && asOf - oldestPending.createdAt > CONTACT_FANOUT_OVERDUE_MS;
		const ready =
			migration?.status === 'ready' &&
			migration.cursor === undefined &&
			migration.failureCode === undefined &&
			failed === null &&
			!overdue;
		return {
			ready,
			status: migration?.status ?? 'missing',
			failureCode:
				migration?.failureCode ??
				failed?.failureCode ??
				(overdue ? 'CONTACT_FANOUT_OVERDUE' : null),
			failedJobId: failed?._id ?? null,
			oldestPendingAt: oldestPending?.createdAt ?? null,
			oldestPendingKind: oldestPending?.kind ?? null
		};
	}
});

/**
 * Update patch-through call status.
 */
export const updateCallStatus = internalMutation({
	args: {
		callSid: v.string(),
		status: v.string(),
		duration: v.optional(v.number()),
		isTerminal: v.boolean()
	},
	handler: async (ctx, args) => {
		const call = await ctx.db
			.query('patchThroughCalls')
			.withIndex('by_twilioCallSid', (q) => q.eq('twilioCallSid', args.callSid))
			.first();

		if (!call) return;

		const patch: Record<string, unknown> = { status: args.status };
		if (args.duration !== undefined) patch.duration = args.duration;
		if (args.isTerminal) patch.completedAt = Date.now();

		await ctx.db.patch(call._id, patch);
	}
});

// =============================================================================
// STRIPE DONATION WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Complete a donation from Stripe checkout.
 * Atomic: only transitions pending → completed.
 */
export const completeDonation = internalMutation({
	args: {
		donationId: v.string(),
		campaignId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Stripe session IDs already have an exact index; never scan every
		// pending donation and filter in memory for one webhook identifier.
		const donation = await ctx.db
			.query('donations')
			.withIndex('by_stripeSessionId', (q) => q.eq('stripeSessionId', args.donationId))
			.first();
		if (!donation) return { processed: false };

		// Atomic status transition
		if (donation.status !== 'pending') return { processed: false };

		const now = Date.now();
		const donationPatch = {
			status: 'completed',
			stripePaymentIntentId: args.stripePaymentIntentId,
			stripeSubscriptionId: args.stripeSubscriptionId,
			completedAt: now,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			updatedAt: now
		} as const;
		await applyDonationConfirmationTransition(
			ctx,
			donation,
			{ ...donation, ...donationPatch },
			now
		);
		await ctx.db.patch(donation._id, donationPatch);

		// Increment campaign counters
		if (donation.campaignId) {
			const campaign = await ctx.db.get(donation.campaignId);
			if (campaign) {
				await ctx.db.patch(campaign._id, {
					raisedAmountCents: (campaign.raisedAmountCents ?? 0) + donation.amountCents,
					donorCount: (campaign.donorCount ?? 0) + 1,
					updatedAt: Date.now()
				});
			}
		}

		// Emit donation.completed event (T9-3). Org webhook subscribers receive
		// a signed POST; SSE subscribers see it via orgEvents within their poll
		// window. No PII in the payload — donor identity stays in encryptedEmail
		// on the donation row, not in the webhook.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: donation.orgId,
			event: 'donation.completed',
			payload: JSON.stringify({
				donationId: donation._id,
				campaignId: donation.campaignId ?? null,
				amountCents: donation.amountCents,
				recurring: donation.recurring ?? false,
				timestamp: Date.now()
			})
		});

		await ctx.runMutation(internal.workflows.dispatchTrigger, {
			orgId: donation.orgId,
			triggerType: 'donation_completed',
			supporterId: donation.supporterId,
			triggerEvent: {
				type: 'donation_completed',
				donationId: donation._id,
				campaignId: donation.campaignId,
				amountCents: donation.amountCents,
				recurring: donation.recurring ?? false,
				timestamp: Date.now()
			}
		});

		// Schedule donor receipt (out-of-band so a slow SES doesn't back up the
		// Stripe webhook ack). The action self-checks completed status, so a
		// retry of completeDonation won't double-send.
		await ctx.scheduler.runAfter(0, internal.donations.sendReceiptEmail, {
			donationId: donation._id
		});

		return {
			processed: true,
			amountCents: donation.amountCents,
			supporterId: donation.supporterId
		};
	}
});

/**
 * Refund a donation (from charge.refunded event).
 */
export const refundDonation = internalMutation({
	args: {
		stripePaymentIntentId: v.string()
	},
	handler: async (ctx, args) => {
		const donation = await ctx.db
			.query('donations')
			.withIndex('by_stripePaymentIntentId', (q) =>
				q.eq('stripePaymentIntentId', args.stripePaymentIntentId)
			)
			.first();

		if (!donation || donation.status !== 'completed') return;

		const now = Date.now();
		const donationPatch = {
			status: 'refunded',
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			updatedAt: now
		} as const;
		await applyDonationConfirmationTransition(
			ctx,
			donation,
			{ ...donation, ...donationPatch },
			now
		);
		await ctx.db.patch(donation._id, donationPatch);

		// Emit donation.refunded (A4) — mirror of donation.completed. Sits after
		// the early-return guard so a replayed/non-completed refund never emits a
		// phantom event. No donor PII (identity stays on the encrypted donation row).
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: donation.orgId,
			event: 'donation.refunded',
			payload: JSON.stringify({
				donationId: donation._id,
				campaignId: donation.campaignId ?? null,
				amountCents: donation.amountCents,
				timestamp: Date.now()
			})
		});

		// Decrement campaign counters
		if (donation.campaignId) {
			const campaign = await ctx.db.get(donation.campaignId);
			if (campaign) {
				await ctx.db.patch(campaign._id, {
					raisedAmountCents: Math.max(0, (campaign.raisedAmountCents ?? 0) - donation.amountCents),
					donorCount: Math.max(0, (campaign.donorCount ?? 0) - 1),
					updatedAt: Date.now()
				});
			}
		}
	}
});
