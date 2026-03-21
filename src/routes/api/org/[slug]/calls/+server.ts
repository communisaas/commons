/**
 * POST /api/org/[slug]/calls — Initiate patch-through call
 * GET  /api/org/[slug]/calls — List calls
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { FEATURES } from '$lib/config/features';
import { isValidE164, initiatePatchThroughCall } from '$lib/server/sms/twilio';
import { VALID_CALL_STATUSES } from '$lib/server/sms/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'starter');
	if (!meetsPlan) throw error(403, 'Patch-through calling requires a Starter plan or higher');

	const body = await request.json();
	const { supporterId, targetPhone, targetName, campaignId, districtHash } = body;

	// Validate required fields
	if (!supporterId || typeof supporterId !== 'string') {
		throw error(400, 'supporterId is required');
	}
	if (!targetPhone || typeof targetPhone !== 'string') {
		throw error(400, 'targetPhone is required');
	}
	if (!/^\+\d{10,15}$/.test(targetPhone)) throw error(400, 'Invalid phone number format');
	if (targetName && (typeof targetName !== 'string' || targetName.length > 200)) {
		throw error(400, 'Invalid target name');
	}

	// Validate campaignId belongs to this org
	if (campaignId) {
		const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId: org.id } });
		if (!campaign) {
			return json({ error: 'Campaign not found in this organization' }, { status: 400 });
		}
	}

	// Look up supporter and verify they belong to this org
	const supporter = await db.supporter.findFirst({
		where: { id: supporterId, orgId: org.id },
		select: { id: true, phone: true, name: true }
	});
	if (!supporter) throw error(404, 'Supporter not found');
	if (!supporter.phone) throw error(400, 'Supporter does not have a phone number on file');

	// Create call record
	const call = await db.patchThroughCall.create({
		data: {
			orgId: org.id,
			supporterId: supporter.id,
			callerPhone: supporter.phone,
			targetPhone,
			targetName: targetName || null,
			campaignId: campaignId || null,
			districtHash: districtHash || null,
			status: 'initiated'
		}
	});

	// Initiate the call via Twilio
	const callbackUrl = `${url.origin}/api/sms/call-status`;
	const result = await initiatePatchThroughCall(
		supporter.phone,
		targetPhone,
		callbackUrl,
		targetName
	);

	if (result.success) {
		const updated = await db.patchThroughCall.update({
			where: { id: call.id },
			data: { twilioCallSid: result.callSid }
		});

		return json(
			{
				id: updated.id,
				supporterId: updated.supporterId,
				targetPhone: updated.targetPhone,
				targetName: updated.targetName,
				status: updated.status,
				twilioCallSid: updated.twilioCallSid,
				createdAt: updated.createdAt.toISOString()
			},
			{ status: 201 }
		);
	} else {
		await db.patchThroughCall.update({
			where: { id: call.id },
			data: { status: 'failed' }
		});

		throw error(502, `Failed to initiate call: ${result.error}`);
	}
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;
	const statusFilter = url.searchParams.get('status');
	const campaignIdFilter = url.searchParams.get('campaignId');

	const where: Record<string, unknown> = { orgId: org.id };
	if (statusFilter && VALID_CALL_STATUSES.includes(statusFilter as any)) {
		where.status = statusFilter;
	}
	if (campaignIdFilter) {
		where.campaignId = campaignIdFilter;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		select: {
			id: true,
			targetPhone: true,
			targetName: true,
			status: true,
			duration: true,
			twilioCallSid: true,
			campaignId: true,
			createdAt: true,
			updatedAt: true,
			supporter: {
				select: { id: true, name: true, phone: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const calls = await db.patchThroughCall.findMany(
		findArgs as Parameters<typeof db.patchThroughCall.findMany>[0]
	);

	const hasMore = calls.length > limit;
	const items = calls.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((c) => ({
			id: c.id,
			targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
			targetName: c.targetName,
			status: c.status,
			duration: c.duration,
			campaignId: c.campaignId,
			supporter: c.supporter
				? { id: c.supporter.id, name: c.supporter.name }
				: null,
			createdAt: c.createdAt.toISOString(),
			updatedAt: c.updatedAt.toISOString()
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
