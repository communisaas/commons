// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * GET /api/org/[slug]/sms/[id]/messages — List messages for a blast
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { VALID_SMS_STATUSES } from '$lib/server/sms/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify blast belongs to this org
	const blast = await db.smsBlast.findFirst({
		where: { id: params.id, orgId: org.id },
		select: { id: true }
	});
	if (!blast) throw error(404, 'SMS blast not found');

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;
	const statusFilter = url.searchParams.get('status');

	const where: Record<string, unknown> = { blastId: params.id };
	if (statusFilter && VALID_SMS_STATUSES.includes(statusFilter as any)) {
		where.status = statusFilter;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		select: {
			id: true,
			to: true,
			status: true,
			twilioSid: true,
			errorCode: true,
			createdAt: true,
			updatedAt: true,
			supporter: {
				select: { id: true, name: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const messages = await db.smsMessage.findMany(
		findArgs as Parameters<typeof db.smsMessage.findMany>[0]
	);

	const hasMore = messages.length > limit;
	const items = messages.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((m) => ({
			id: m.id,
			to: m.to ? '***' + m.to.slice(-4) : null,
			status: m.status,
			errorCode: m.errorCode,
			supporter: m.supporter
				? { id: m.supporter.id, name: m.supporter.name }
				: null,
			createdAt: m.createdAt.toISOString(),
			updatedAt: m.updatedAt.toISOString()
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
