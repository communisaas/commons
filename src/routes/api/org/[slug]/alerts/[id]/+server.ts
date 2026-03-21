import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import type { RequestHandler } from './$types';

/**
 * PATCH /api/org/[slug]/alerts/[id]
 *
 * Update alert status (seen, dismissed, acted).
 * Auth: org membership required (any role).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const body = await request.json();
	const { status, actionTaken } = body;

	const validStatuses = ['seen', 'dismissed', 'acted'];
	if (!status || !validStatuses.includes(status)) {
		throw error(400, `Status must be one of: ${validStatuses.join(', ')}`);
	}

	if (status === 'acted' && actionTaken && !['created_campaign', 'sent_email'].includes(actionTaken)) {
		throw error(400, 'Invalid actionTaken value');
	}

	// Verify alert belongs to this org
	const alert = await db.legislativeAlert.findFirst({
		where: { id: params.id, orgId: org.id },
		select: { id: true }
	});

	if (!alert) {
		throw error(404, 'Alert not found');
	}

	const data: Record<string, unknown> = { status };
	if (status === 'seen') {
		data.seenAt = new Date();
	}
	if (status === 'acted' && actionTaken) {
		data.actionTaken = actionTaken;
	}

	const updated = await db.legislativeAlert.update({
		where: { id: params.id },
		data,
		select: { id: true, status: true, actionTaken: true, seenAt: true }
	});

	return json({
		id: updated.id,
		status: updated.status,
		actionTaken: updated.actionTaken,
		seenAt: updated.seenAt?.toISOString() ?? null
	});
};
