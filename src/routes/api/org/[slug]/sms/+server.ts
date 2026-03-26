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
import { SMS_MAX_LENGTH, VALID_BLAST_STATUSES } from '$lib/server/sms/types';
import type { RequestHandler } from './$types';

const RecipientFilterSchema = z.object({
	tags: z.array(z.string()).max(20).optional(),
	segments: z.array(z.string()).max(10).optional(),
	excludeTags: z.array(z.string()).max(20).optional()
}).strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'starter');
	if (!meetsPlan) throw error(403, 'SMS campaigns require a Starter plan or higher');

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
		const campaign = await db.campaign.findFirst({
			where: { id: campaignId, orgId: org.id }
		});
		if (!campaign) throw error(400, 'Campaign not found in this organization');
	}

	const blast = await db.smsBlast.create({
		data: {
			orgId: org.id,
			body: smsBody.trim(),
			fromNumber: fromNumber || null,
			recipientFilter: parsedFilter,
			campaignId: campaignId || null,
			status: 'draft'
		}
	});

	return json(
		{
			id: blast.id,
			body: blast.body,
			fromNumber: blast.fromNumber,
			status: blast.status,
			createdAt: blast.createdAt.toISOString()
		},
		{ status: 201 }
	);
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;
	const statusFilter = url.searchParams.get('status');

	const where: Record<string, unknown> = { orgId: org.id };
	if (statusFilter && VALID_BLAST_STATUSES.includes(statusFilter as any)) {
		where.status = statusFilter;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		select: {
			id: true,
			body: true,
			fromNumber: true,
			status: true,
			totalRecipients: true,
			sentCount: true,
			failedCount: true,
			sentAt: true,
			createdAt: true,
			updatedAt: true,
			campaignId: true,
			_count: { select: { messages: true } }
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const blasts = await db.smsBlast.findMany(findArgs as Parameters<typeof db.smsBlast.findMany>[0]);

	const hasMore = blasts.length > limit;
	const items = blasts.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((b) => ({
			...b,
			createdAt: b.createdAt.toISOString(),
			updatedAt: b.updatedAt.toISOString(),
			sentAt: b.sentAt?.toISOString() ?? null
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
