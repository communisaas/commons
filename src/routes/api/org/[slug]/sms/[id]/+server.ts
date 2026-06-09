// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * PATCH /api/org/[slug]/sms/[id] — Update blast or trigger send
 * DELETE /api/org/[slug]/sms/[id] — Delete blast
 */

import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { z } from 'zod';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { getTextDispatchReadiness } from '$lib/server/sms/text-dispatch-readiness';
import { isValidE164, sendSms } from '$lib/server/sms/twilio';
import { SMS_MAX_LENGTH } from '$lib/server/sms/types';
import type { RequestHandler } from './$types';

// Per-entry caps on tag/segment ids (Convex doc ids are 32 chars).
const RecipientFilterSchema = z
	.object({
		tags: z.array(z.string().max(64)).max(20).optional(),
		segments: z.array(z.string().max(64)).max(10).optional(),
		excludeTags: z.array(z.string().max(64)).max(20).optional()
	})
	.strict();

const MAX_DECRYPTED_SMS_DISPATCH = 100;

const DecryptedRecipientSchema = z
	.object({
		supporterId: z.string().min(1).max(64),
		phone: z.string().refine((value) => isValidE164(value), {
			message: 'phone must be E.164'
		}),
		encryptedTo: z.string().max(512).optional(),
		toHash: z.string().max(128).optional()
	})
	.strict();

const SendBodySchema = z
	.object({
		action: z.literal('send'),
		expectedTotalRecipients: z.number().int().min(1).max(1_000_000).optional(),
		finalBatch: z.boolean().optional(),
		decryptedRecipients: z
			.array(DecryptedRecipientSchema)
			.min(1)
			.max(MAX_DECRYPTED_SMS_DISPATCH)
	})
	.strict();

function textDispatchEnv() {
	return {
		TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
		TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
		TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
	};
}

function textDispatchBoundary(readiness = getTextDispatchReadiness(textDispatchEnv())) {
	return json(
		{
			error: 'text_dispatch_not_armed',
			message: readiness.message,
			blockedVerb: 'carrier_delivery',
			preservedArtifact: 'sms_draft',
			gate: 'CP-sms-dispatch',
			taskIds: ['T2-1'],
			dependency: readiness.dependency,
			missing: readiness.missing,
			runtimeFlag: readiness.runtimeFlag,
			runnerImplemented: readiness.runnerImplemented,
			clientDecryptorMounted: readiness.clientDecryptorMounted,
			clientBatchRouteMounted: readiness.clientBatchRouteMounted
		},
		{ status: 424 }
	);
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// Verify blast belongs to this org
	const existing = await serverQuery(api.sms.getBlast, {
		slug: params.slug,
		blastId: params.id as Id<'smsBlasts'>
	});
	if (!existing) throw error(404, 'SMS draft not found');

	const body = await request.json();

	// Trigger send action
	if (body.action === 'send') {
		const hasDecryptedRecipientBatch = Array.isArray(body.decryptedRecipients);
		const readiness = getTextDispatchReadiness(textDispatchEnv(), {
			featureEnabled: FEATURES.SMS_DISPATCH,
			clientDecryptorMounted: hasDecryptedRecipientBatch
		});
		if (!readiness.ready) return textDispatchBoundary(readiness);

		const parsed = SendBodySchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{
					error: 'text_dispatch_decrypted_recipients_required',
					message:
						'Carrier delivery requires a client-decrypted recipient batch with E.164 phone numbers.',
					blockedVerb: 'carrier_delivery',
					preservedArtifact: 'sms_draft',
					gate: 'CP-sms-dispatch',
					taskIds: ['T2-1'],
					issues: parsed.error.issues.map((issue) => ({
						path: issue.path.join('.'),
						message: issue.message
					}))
				},
				{ status: 422 }
			);
		}

		if (existing.blast.status !== 'draft' && existing.blast.status !== 'sending') {
			throw error(400, 'Only draft or sending text delivery records can be dispatched');
		}
		const recipients = parsed.data.decryptedRecipients;
		const seenSupporters = new Set<string>();
		const seenPhones = new Set<string>();
		for (const recipient of recipients) {
			if (seenSupporters.has(recipient.supporterId)) {
				throw error(400, 'Duplicate supporter in decrypted recipient batch');
			}
			if (seenPhones.has(recipient.phone)) {
				throw error(400, 'Duplicate phone in decrypted recipient batch');
			}
			seenSupporters.add(recipient.supporterId);
			seenPhones.add(recipient.phone);
		}

		const dispatchCohort = await serverQuery(api.sms.getEncryptedRecipientsForBlast, {
			slug: params.slug,
			blastId: params.id as Id<'smsBlasts'>
		});
		const allowedSupporterIds = new Set(
			dispatchCohort.recipients.map((recipient) => String(recipient._id))
		);
		for (const recipient of recipients) {
			if (!allowedSupporterIds.has(recipient.supporterId)) {
				return json(
					{
						error: 'text_dispatch_recipient_scope_mismatch',
						message:
							'Carrier delivery can only use the next encrypted-phone batch from the saved text audience.',
						blockedVerb: 'carrier_delivery',
						preservedArtifact: 'sms_draft',
						gate: 'CP-sms-dispatch',
						taskIds: ['T2-1']
					},
					{ status: 409 }
				);
			}
		}
		if (
			parsed.data.finalBatch === true &&
			(dispatchCohort.hasMore || recipients.length !== dispatchCohort.remainingCount)
		) {
			return json(
				{
					error: 'text_dispatch_final_batch_not_current',
					message:
						'Final text dispatch can only be recorded after the current remaining eligible cohort is included.',
					blockedVerb: 'carrier_delivery',
					preservedArtifact: 'sms_draft',
					gate: 'CP-sms-dispatch',
					taskIds: ['T2-1']
				},
				{ status: 409 }
			);
		}
		if (
			parsed.data.expectedTotalRecipients !== undefined &&
			parsed.data.expectedTotalRecipients < dispatchCohort.dispatchedCount + recipients.length
		) {
			return json(
				{
					error: 'text_dispatch_expected_total_too_small',
					message:
						'Text dispatch expected total cannot be lower than the already recorded and current eligible batch.',
					blockedVerb: 'carrier_delivery',
					preservedArtifact: 'sms_draft',
					gate: 'CP-sms-dispatch',
					taskIds: ['T2-1']
				},
				{ status: 409 }
			);
		}

		// Check SMS quota before sending
		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits && limits.current.smsSent + recipients.length > limits.limits.maxSms) {
			throw error(
				403,
				'SMS delivery limit reached for the current billing period. Upgrade your plan to dispatch more.'
			);
		}

		const results = [];
		for (const recipient of recipients) {
			const result = await sendSms(recipient.phone, existing.blast.body, existing.blast.fromNumber);
			results.push({
				supporterId: recipient.supporterId as Id<'supporters'>,
				encryptedTo: recipient.encryptedTo,
				toHash: recipient.toHash,
				twilioSid: result.success ? result.sid : undefined,
				status: result.success ? ('sent' as const) : ('failed' as const),
				errorCode: result.success ? undefined : result.error
			});
		}

		const recorded = await serverMutation(api.sms.recordDispatchBatch, {
			slug: params.slug,
			blastId: params.id as Id<'smsBlasts'>,
			expectedTotalRecipients: parsed.data.expectedTotalRecipients,
			finalBatch: parsed.data.finalBatch,
			results
		});

		return json({
			id: params.id,
			status: recorded.status,
			totalRecipients: recorded.totalRecipients,
			sentCount: recorded.sentCount,
			failedCount: recorded.failedCount,
			deliveredCount: recorded.deliveredCount,
			batchSentCount: recorded.batchSentCount,
			batchFailedCount: recorded.batchFailedCount,
			recordedCount: recorded.recordedCount,
			message:
				'Carrier dispatch used a client-decrypted recipient batch; plaintext phones were not persisted.'
		});
	}

	// Update fields (only if draft)
	if (existing.blast.status !== 'draft') {
		throw error(400, 'Only draft text delivery records can be updated');
	}

	const updateArgs: Record<string, unknown> = {};

	if (body.body !== undefined) {
		if (typeof body.body !== 'string' || body.body.trim().length === 0) {
			throw error(400, 'SMS body is required');
		}
		if (body.body.length > SMS_MAX_LENGTH) {
			throw error(400, `SMS body must not exceed ${SMS_MAX_LENGTH} characters`);
		}
		updateArgs.body = body.body.trim();
	}

	if (body.recipientFilter !== undefined) {
		if (body.recipientFilter) {
			try {
				updateArgs.recipientFilter = RecipientFilterSchema.parse(body.recipientFilter);
			} catch (e) {
				if (e instanceof z.ZodError)
					throw error(
						400,
						`Invalid recipient filter: ${e.errors[0]?.message ?? 'validation failed'}`
					);
				throw e;
			}
		} else {
			updateArgs.recipientFilter = null;
		}
	}

	if (Object.keys(updateArgs).length === 0) {
		throw error(400, 'No valid fields to update');
	}

	await serverMutation(api.sms.updateBlast, {
		slug: params.slug,
		blastId: params.id as Id<'smsBlasts'>,
		...updateArgs
	});

	return json({
		id: params.id,
		status: 'draft',
		updatedAt: new Date().toISOString()
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// Verify blast belongs to this org
	const existing = await serverQuery(api.sms.getBlast, {
		slug: params.slug,
		blastId: params.id as Id<'smsBlasts'>
	});
	if (!existing) throw error(404, 'SMS draft not found');

	if (existing.blast.status === 'sending') {
		throw error(400, 'Cannot delete a blast that is currently sending');
	}

	await serverMutation(api.sms.deleteBlast, {
		slug: params.slug,
		blastId: params.id as Id<'smsBlasts'>
	});

	return new Response(null, { status: 204 });
};
