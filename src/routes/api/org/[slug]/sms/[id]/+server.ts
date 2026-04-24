// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * PATCH /api/org/[slug]/sms/[id] — Update blast or trigger send
 * DELETE /api/org/[slug]/sms/[id] — Delete blast
 */

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { SMS_MAX_LENGTH } from '$lib/server/sms/types';
import type { RequestHandler } from './$types';

const RecipientFilterSchema = z.object({
	tags: z.array(z.string()).max(20).optional(),
	segments: z.array(z.string()).max(10).optional(),
	excludeTags: z.array(z.string()).max(20).optional()
}).strict();

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// Verify blast belongs to this org
	const existing = await serverQuery(api.sms.getBlast, {
		slug: params.slug,
		blastId: params.id as any
	});
	if (!existing) throw error(404, 'SMS blast not found');

	const body = await request.json();

	// Trigger send action
	if (body.action === 'send') {
		if (existing.blast.status !== 'draft') {
			throw error(400, 'Only draft blasts can be sent');
		}

		// Check SMS quota before sending
		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits && limits.current.smsSent >= limits.limits.maxSms) {
			throw error(403, 'SMS send limit reached for the current billing period. Upgrade your plan to send more.');
		}

		// Dispatch path is not yet wired. Org-PII encryption means the server can't
		// decrypt supporter phones; the blast runner must be a client-side operation
		// (analogous to `client-blast-sender.ts` for email) or go via a Lambda proxy
		// with decrypted phones passed in. Both are pending.
		//
		// Previous revisions of this route called an undefined `sendSmsBlast()` and
		// returned `{ status: 'sending' }` — which silently lied to the caller. We
		// now fail-loud so ops dashboards + UI can surface the real state.
		throw error(
			501,
			'SMS blast dispatch is not yet wired. Blast drafts are preserved; please contact support to enable sending.'
		);
	}

	// Update fields (only if draft)
	if (existing.blast.status !== 'draft') {
		throw error(400, 'Only draft blasts can be updated');
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
				if (e instanceof z.ZodError) throw error(400, `Invalid recipient filter: ${e.errors[0]?.message ?? 'validation failed'}`);
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
		blastId: params.id as any,
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
		blastId: params.id as any
	});
	if (!existing) throw error(404, 'SMS blast not found');

	if (existing.blast.status === 'sending') {
		throw error(400, 'Cannot delete a blast that is currently sending');
	}

	await serverMutation(api.sms.deleteBlast, {
		slug: params.slug,
		blastId: params.id as any
	});

	return new Response(null, { status: 204 });
};
