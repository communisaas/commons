/**
 * POST /api/org/[slug]/workflows — Create workflow
 * GET  /api/org/[slug]/workflows — List workflows
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { FEATURES } from '$lib/config/features';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
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

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { name, description, trigger, steps } = body;

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const workflowId = await serverMutation(api.workflows.create, {
				slug: params.slug,
				name: name?.trim(),
				description: description?.trim() || undefined,
				trigger,
				steps
			});
			return json({ id: workflowId }, { status: 201 });
		} catch (err) {
			console.error('[WorkflowCreate] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'starter');
	if (!meetsPlan) throw error(403, 'Automation requires a Starter plan or higher');

	// Validate name
	if (!name || typeof name !== 'string' || name.trim().length < 3) {
		throw error(400, 'Name is required (minimum 3 characters)');
	}

	// Validate trigger
	let parsedTrigger;
	try {
		parsedTrigger = TriggerSchema.parse(trigger);
	} catch (e) {
		if (e instanceof z.ZodError) throw error(400, `Invalid trigger: ${e.errors[0]?.message ?? 'validation failed'}`);
		throw e;
	}

	// Validate steps
	let parsedSteps;
	try {
		parsedSteps = z.array(StepSchema).min(1).max(20).parse(steps);
	} catch (e) {
		if (e instanceof z.ZodError) throw error(400, `Invalid steps: ${e.errors[0]?.message ?? 'validation failed'}`);
		throw e;
	}

	const workflow = await db.workflow.create({
		data: {
			orgId: org.id,
			name: name.trim(),
			description: description?.trim() || null,
			trigger: parsedTrigger,
			steps: parsedSteps,
			enabled: false
		}
	});

	return json({ id: workflow.id }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.workflows.list, { slug: params.slug });
			return json({
				data: result,
				meta: { cursor: null, hasMore: false }
			});
		} catch (err) {
			console.error('[WorkflowList] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;
	const enabledFilter = url.searchParams.get('enabled');

	const where: Record<string, unknown> = { orgId: org.id };
	if (enabledFilter === 'true') where.enabled = true;
	if (enabledFilter === 'false') where.enabled = false;

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		select: {
			id: true,
			name: true,
			description: true,
			trigger: true,
			steps: true,
			enabled: true,
			createdAt: true,
			updatedAt: true
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const workflows = await db.workflow.findMany(findArgs as Parameters<typeof db.workflow.findMany>[0]);

	const hasMore = workflows.length > limit;
	const items = workflows.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((w) => ({
			...w,
			createdAt: w.createdAt.toISOString(),
			updatedAt: w.updatedAt.toISOString()
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
