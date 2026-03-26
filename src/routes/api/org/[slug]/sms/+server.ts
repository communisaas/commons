// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * POST /api/org/[slug]/sms — Create SMS blast
 * GET  /api/org/[slug]/sms — List SMS blasts
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

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { body: smsBody, fromNumber, recipientFilter, campaignId } = body;

	// Validate SMS body
	if (!smsBody || typeof smsBody !== 'string' || smsBody.trim().length === 0) {
		throw error(400, 'SMS body is required');
	}
	if (smsBody.length > SMS_MAX_LENGTH) {
		throw error(400, `SMS body must not exceed ${SMS_MAX_LENGTH} characters`);
	}

	let parsedFilter = null;
	if (recipientFilter) {
		try {
			parsedFilter = RecipientFilterSchema.parse(recipientFilter);
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid recipient filter: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
	}

	// Validate fromNumber if provided (E.164 format)
	if (fromNumber && typeof fromNumber === 'string') {
		if (!/^\+[1-9]\d{1,14}$/.test(fromNumber)) {
			throw error(400, 'fromNumber must be in E.164 format (e.g., +15551234567)');
		}
	}

	// Validate campaignId belongs to this org (prevent IDOR)
	if (campaignId) {
		const campaign = await serverQuery(api.calls.validateCampaign, {
			slug: params.slug,
			campaignId: campaignId as any
		});
		if (!campaign) throw error(400, 'Campaign not found in this organization');
	}

	const blast = await serverMutation(api.sms.createBlast, {
		slug: params.slug,
		body: smsBody.trim(),
		fromNumber: fromNumber || '',
		campaignId: campaignId ? (campaignId as any) : undefined,
		recipientFilter: parsedFilter,
		totalRecipients: 0
	});

	return json(
		{
			id: blast._id,
			body: smsBody.trim(),
			fromNumber: fromNumber || null,
			status: 'draft',
			createdAt: new Date().toISOString()
		},
		{ status: 201 }
	);
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);

	const blasts = await serverQuery(api.sms.listBlasts, {
		slug: params.slug,
		limit
	});

	return json({
		data: blasts.map((b) => ({
			id: b._id,
			body: b.body,
			status: b.status,
			totalRecipients: b.totalRecipients,
			sentCount: b.sentCount,
			failedCount: b.failedCount,
			messageCount: b.messageCount,
			sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null,
			createdAt: new Date(b._creationTime).toISOString()
		})),
		meta: { hasMore: false }
	});
};
