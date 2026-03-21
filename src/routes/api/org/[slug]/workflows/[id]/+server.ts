/**
 * PATCH /api/org/[slug]/workflows/[id] — Update workflow
 * DELETE /api/org/[slug]/workflows/[id] — Delete workflow
 */

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

const TriggerSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('supporter_created') }),
	z.object({ type: z.literal('campaign_action'), campaignId: z.string().optional() }),
	z.object({ type: z.literal('event_rsvp') }),
	z.object({ type: z.literal('event_checkin') }),
	z.object({ type: z.literal('donation_completed') }),
	z.object({ type: z.literal('tag_added'), tagId: z.string().min(1) }),
]);

const StepSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('send_email'), emailSubject: z.string().min(1).max(200), emailBody: z.string().min(1).max(10000) }),
	z.object({ type: z.literal('add_tag'), tagId: z.string().min(1) }),
	z.object({ type: z.literal('remove_tag'), tagId: z.string().min(1) }),
	z.object({ type: z.literal('delay'), delayMinutes: z.number().int().min(1).max(43200) }),
	z.object({ type: z.literal('condition'), field: z.enum(['engagementTier', 'verified', 'hasTag']), operator: z.enum(['eq', 'gte', 'lte', 'exists']), value: z.union([z.string(), z.number(), z.boolean()]), thenStepIndex: z.number().int().min(0), elseStepIndex: z.number().int().min(0) }),
]);

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'starter');
	if (!meetsPlan) throw error(403, 'Automation requires a Starter plan or higher');

	// Verify workflow belongs to this org
	const existing = await db.workflow.findFirst({
		where: { id: params.id, orgId: org.id }
	});
	if (!existing) throw error(404, 'Workflow not found');

	const body = await request.json();
	const data: Record<string, unknown> = {};

	if (body.name !== undefined) {
		if (typeof body.name !== 'string' || body.name.trim().length < 3) {
			throw error(400, 'Name must be at least 3 characters');
		}
		data.name = body.name.trim();
	}

	if (body.description !== undefined) {
		data.description = body.description?.trim() || null;
	}

	if (body.trigger !== undefined) {
		try {
			data.trigger = TriggerSchema.parse(body.trigger);
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid trigger: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
	}

	if (body.steps !== undefined) {
		try {
			data.steps = z.array(StepSchema).min(1).max(20).parse(body.steps);
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid steps: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw e;
		}
	}

	if (body.enabled !== undefined) {
		data.enabled = Boolean(body.enabled);
	}

	if (Object.keys(data).length === 0) {
		throw error(400, 'No valid fields to update');
	}

	const updated = await db.workflow.update({
		where: { id: params.id },
		data
	});

	return json({
		id: updated.id,
		name: updated.name,
		enabled: updated.enabled,
		updatedAt: updated.updatedAt.toISOString()
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify workflow belongs to this org
	const existing = await db.workflow.findFirst({
		where: { id: params.id, orgId: org.id }
	});
	if (!existing) throw error(404, 'Workflow not found');

	// Hard delete — cascades to executions + logs via Prisma onDelete
	await db.workflow.delete({ where: { id: params.id } });

	return json({ success: true });
};
