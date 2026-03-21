/**
 * PATCH  /api/org/[slug]/events/[id] — Update event
 * DELETE /api/org/[slug]/events/[id] — Cancel event (soft delete)
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

const VALID_EVENT_TYPES = ['IN_PERSON', 'VIRTUAL', 'HYBRID'];

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const event = await db.event.findFirst({
		where: { id: params.id, orgId: org.id }
	});

	if (!event) throw error(404, 'Event not found');
	if (event.status === 'COMPLETED') throw error(400, 'Cannot update a completed event');

	const body = await request.json();
	const data: Record<string, unknown> = {};

	if (body.title !== undefined) {
		if (typeof body.title !== 'string' || body.title.trim().length < 3) {
			throw error(400, 'Title must be at least 3 characters');
		}
		data.title = body.title.trim();
	}
	if (body.description !== undefined) data.description = body.description?.trim() || null;
	if (body.eventType !== undefined) {
		if (!VALID_EVENT_TYPES.includes(body.eventType)) {
			throw error(400, 'Event type must be one of: IN_PERSON, VIRTUAL, HYBRID');
		}
		data.eventType = body.eventType;
	}
	if (body.startAt !== undefined) {
		const d = new Date(body.startAt);
		if (isNaN(d.getTime())) throw error(400, 'Invalid start date format');
		data.startAt = d;
	}
	if (body.endAt !== undefined) data.endAt = body.endAt ? new Date(body.endAt) : null;
	if (body.timezone !== undefined) {
		if (typeof body.timezone !== 'string') throw error(400, 'Timezone must be a string');
		const validTimezones = Intl.supportedValuesOf('timeZone');
		if (!validTimezones.includes(body.timezone)) {
			throw error(400, 'Invalid timezone. Must be a valid IANA timezone identifier');
		}
		data.timezone = body.timezone;
	}
	if (body.venue !== undefined) data.venue = body.venue?.trim() || null;
	if (body.address !== undefined) data.address = body.address?.trim() || null;
	if (body.city !== undefined) data.city = body.city?.trim() || null;
	if (body.state !== undefined) data.state = body.state?.trim() || null;
	if (body.postalCode !== undefined) data.postalCode = body.postalCode?.trim() || null;
	if (body.latitude !== undefined) data.latitude = typeof body.latitude === 'number' ? body.latitude : null;
	if (body.longitude !== undefined) data.longitude = typeof body.longitude === 'number' ? body.longitude : null;
	if (body.virtualUrl !== undefined) data.virtualUrl = body.virtualUrl?.trim() || null;
	if (body.capacity !== undefined) data.capacity = typeof body.capacity === 'number' && body.capacity > 0 ? body.capacity : null;
	if (body.waitlistEnabled !== undefined) data.waitlistEnabled = Boolean(body.waitlistEnabled);
	if (body.requireVerification !== undefined) data.requireVerification = Boolean(body.requireVerification);
	if (body.status !== undefined) {
		if (!['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(body.status)) {
			throw error(400, 'Invalid status');
		}
		data.status = body.status;
	}
	if (body.campaignId !== undefined) {
		if (body.campaignId) {
			const campaign = await db.campaign.findFirst({
				where: { id: body.campaignId, orgId: org.id }
			});
			if (!campaign) throw error(400, 'Invalid campaign selection');
		}
		data.campaignId = body.campaignId || null;
	}

	const updated = await db.event.update({
		where: { id: params.id },
		data
	});

	return json({
		id: updated.id,
		title: updated.title,
		status: updated.status,
		startAt: updated.startAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString()
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const event = await db.event.findFirst({
		where: { id: params.id, orgId: org.id }
	});

	if (!event) throw error(404, 'Event not found');

	await db.event.update({
		where: { id: params.id },
		data: { status: 'CANCELLED' }
	});

	return json({ success: true });
};
