import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

/**
 * POST /api/org/[slug]/decision-makers/[dmId]/follow — Follow a decision-maker.
 * PATCH /api/org/[slug]/decision-makers/[dmId]/follow — Update follow settings.
 * DELETE /api/org/[slug]/decision-makers/[dmId]/follow — Unfollow a decision-maker.
 */

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify decision-maker exists
	const dm = await db.decisionMaker.findUnique({
		where: { id: params.dmId },
		select: { id: true }
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	const body = await request.json().catch(() => ({}));
	const VALID_REASONS = ['manual', 'research', 'constituent', 'coalition'];
	const rawReason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'manual';
	const reason = VALID_REASONS.includes(rawReason) ? rawReason : 'manual';
	const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;
	const alertsEnabled = typeof body.alertsEnabled === 'boolean' ? body.alertsEnabled : true;

	// Check if already following — return 200 if so, create and return 201 if not
	const existing = await db.orgDMFollow.findUnique({
		where: {
			orgId_decisionMakerId: {
				orgId: org.id,
				decisionMakerId: params.dmId
			}
		}
	});

	if (existing) {
		return json({
			id: existing.id,
			orgId: existing.orgId,
			decisionMakerId: existing.decisionMakerId,
			reason: existing.reason,
			note: existing.note,
			alertsEnabled: existing.alertsEnabled,
			followedBy: existing.followedBy,
			followedAt: existing.followedAt.toISOString(),
			created: false
		});
	}

	const follow = await db.orgDMFollow.create({
		data: {
			orgId: org.id,
			decisionMakerId: params.dmId,
			reason,
			note,
			alertsEnabled,
			followedBy: locals.user.id
		}
	});

	return json({
		id: follow.id,
		orgId: follow.orgId,
		decisionMakerId: follow.decisionMakerId,
		reason: follow.reason,
		note: follow.note,
		alertsEnabled: follow.alertsEnabled,
		followedBy: follow.followedBy,
		followedAt: follow.followedAt.toISOString(),
		created: true
	}, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const existing = await db.orgDMFollow.findUnique({
		where: {
			orgId_decisionMakerId: {
				orgId: org.id,
				decisionMakerId: params.dmId
			}
		}
	});

	if (!existing) {
		throw error(404, 'Not following this decision-maker');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const data: Record<string, unknown> = {};
	if (typeof body.alertsEnabled === 'boolean') data.alertsEnabled = body.alertsEnabled;
	if (typeof body.note === 'string') data.note = body.note.slice(0, 1000);

	const updated = await db.orgDMFollow.update({
		where: { id: existing.id },
		data
	});

	return json({
		id: updated.id,
		orgId: updated.orgId,
		decisionMakerId: updated.decisionMakerId,
		reason: updated.reason,
		note: updated.note,
		alertsEnabled: updated.alertsEnabled,
		followedBy: updated.followedBy,
		followedAt: updated.followedAt.toISOString()
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	await db.orgDMFollow.deleteMany({
		where: {
			orgId: org.id,
			decisionMakerId: params.dmId
		}
	});

	return json({ success: true });
};
