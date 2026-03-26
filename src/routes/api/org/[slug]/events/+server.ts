/**
 * POST /api/org/[slug]/events — Create event
 * GET  /api/org/[slug]/events — List org events
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { FEATURES } from '$lib/config/features';
import crypto from 'node:crypto';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

const VALID_EVENT_TYPES = ['IN_PERSON', 'VIRTUAL', 'HYBRID'];
const VALID_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'];

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { title, description, eventType, startAt, endAt, timezone, venue, address, city, state, postalCode, latitude, longitude, virtualUrl, capacity, waitlistEnabled, requireVerification, campaignId } = body;

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const eventId = await serverMutation(api.events.create, {
				slug: params.slug,
				title,
				description: description?.trim() || undefined,
				eventType: eventType || 'IN_PERSON',
				startAt: new Date(startAt).getTime(),
				endAt: endAt ? new Date(endAt).getTime() : undefined,
				timezone: timezone || 'America/New_York',
				venue: venue?.trim() || undefined,
				address: address?.trim() || undefined,
				city: city?.trim() || undefined,
				state: state?.trim() || undefined,
				postalCode: postalCode?.trim() || undefined,
				latitude: typeof latitude === 'number' ? latitude : undefined,
				longitude: typeof longitude === 'number' ? longitude : undefined,
				virtualUrl: virtualUrl?.trim() || undefined,
				capacity: typeof capacity === 'number' && capacity > 0 ? capacity : undefined,
				waitlistEnabled: Boolean(waitlistEnabled),
				requireVerification: Boolean(requireVerification),
				campaignId: campaignId || undefined
			});
			return json({ id: eventId }, { status: 201 });
		} catch (err) {
			console.error('[EventCreate] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'starter');
	if (!meetsPlan) throw error(403, 'Events require a Starter plan or higher');

	if (!title || typeof title !== 'string' || title.trim().length < 3) {
		throw error(400, 'Title is required (minimum 3 characters)');
	}

	if (!startAt) {
		throw error(400, 'Start date/time is required');
	}

	const startDate = new Date(startAt);
	if (isNaN(startDate.getTime())) {
		throw error(400, 'Invalid start date format');
	}
	if (startDate <= new Date()) {
		throw error(400, 'Start date must be in the future');
	}
	const maxDate = new Date();
	maxDate.setFullYear(maxDate.getFullYear() + 2);
	if (startDate > maxDate) {
		throw error(400, 'Event start date cannot be more than 2 years in the future');
	}

	if (eventType && !VALID_EVENT_TYPES.includes(eventType)) {
		throw error(400, 'Event type must be one of: IN_PERSON, VIRTUAL, HYBRID');
	}

	let endDate: Date | null = null;
	if (endAt) {
		endDate = new Date(endAt);
		if (isNaN(endDate.getTime())) {
			throw error(400, 'Invalid end date format');
		}
		if (endDate <= startDate) {
			throw error(400, 'End date must be after start date');
		}
		const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
		if (endDate.getTime() - startDate.getTime() > MAX_DURATION_MS) {
			throw error(400, 'Event duration cannot exceed 30 days');
		}
	}

	if (campaignId) {
		const campaign = await db.campaign.findFirst({
			where: { id: campaignId, orgId: org.id }
		});
		if (!campaign) throw error(400, 'Invalid campaign selection');
	}

	if (timezone) {
		try {
			const validTimezones = Intl.supportedValuesOf('timeZone');
			if (!validTimezones.includes(timezone)) {
				throw error(400, 'Invalid timezone. Must be a valid IANA timezone identifier');
			}
		} catch (e: unknown) {
			// Re-throw our HTTP errors
			if (e && typeof e === 'object' && 'status' in e) throw e;
			// Runtime doesn't support supportedValuesOf — skip validation
		}
	}

	const checkinCode = crypto.randomUUID().slice(0, 8);

	const event = await db.event.create({
		data: {
			orgId: org.id,
			campaignId: campaignId || null,
			title: title.trim(),
			description: description?.trim() || null,
			eventType: eventType || 'IN_PERSON',
			startAt: startDate,
			endAt: endDate,
			timezone: timezone || 'America/New_York',
			venue: venue?.trim() || null,
			address: address?.trim() || null,
			city: city?.trim() || null,
			state: state?.trim() || null,
			postalCode: postalCode?.trim() || null,
			latitude: typeof latitude === 'number' ? latitude : null,
			longitude: typeof longitude === 'number' ? longitude : null,
			virtualUrl: virtualUrl?.trim() || null,
			capacity: typeof capacity === 'number' && capacity > 0 ? capacity : null,
			waitlistEnabled: Boolean(waitlistEnabled),
			requireVerification: Boolean(requireVerification),
			checkinCode,
			status: 'DRAFT'
		}
	});

	return json({ id: event.id, checkinCode }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.events.list, { slug: params.slug });
			return json({
				data: result,
				meta: { cursor: null, hasMore: false }
			});
		} catch (err) {
			console.error('[EventList] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const status = url.searchParams.get('status');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;

	const where: Record<string, unknown> = { orgId: org.id };
	if (status && VALID_STATUSES.includes(status)) {
		where.status = status;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { startAt: 'desc' as const },
		select: {
			id: true,
			title: true,
			description: true,
			eventType: true,
			startAt: true,
			endAt: true,
			timezone: true,
			venue: true,
			city: true,
			state: true,
			virtualUrl: true,
			capacity: true,
			waitlistEnabled: true,
			requireVerification: true,
			checkinCode: true,
			status: true,
			rsvpCount: true,
			attendeeCount: true,
			verifiedAttendees: true,
			campaignId: true,
			createdAt: true,
			updatedAt: true
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const events = await db.event.findMany(findArgs as Parameters<typeof db.event.findMany>[0]);

	const hasMore = events.length > limit;
	const items = events.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((e) => ({
			...e,
			startAt: e.startAt.toISOString(),
			endAt: e.endAt?.toISOString() ?? null,
			createdAt: e.createdAt.toISOString(),
			updatedAt: e.updatedAt.toISOString()
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
