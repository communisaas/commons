import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexWorkflows = await serverQuery(api.workflows.list, { slug: params.slug });

			console.log(`[Workflows] Convex: loaded ${convexWorkflows.length} workflows for ${params.slug}`);

			return {
				org: { name: params.slug, slug: params.slug },
				workflows: convexWorkflows.map((w: Record<string, unknown>) => ({
					id: w._id,
					name: w.name,
					description: w.description ?? null,
					trigger: w.trigger as { type: string; tagId?: string; campaignId?: string },
					stepCount: Array.isArray(w.steps) ? (w.steps as unknown[]).length : 0,
					enabled: w.enabled,
					executionCount: 0, // Convex list doesn't include execution count
					createdAt: typeof w._creationTime === 'number'
						? new Date(w._creationTime as number).toISOString()
						: String(w._creationTime),
					updatedAt: typeof w.updatedAt === 'number'
						? new Date(w.updatedAt as number).toISOString()
						: String(w.updatedAt)
				}))
			};
		} catch (err) {
			console.error('[Workflows] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const workflows = await db.workflow.findMany({
		where: { orgId: org.id },
		orderBy: { createdAt: 'desc' },
		take: 50,
		include: {
			_count: { select: { executions: true } }
		}
	});

	return {
		org: { name: org.name, slug: org.slug },
		workflows: workflows.map((w) => ({
			id: w.id,
			name: w.name,
			description: w.description,
			trigger: w.trigger as { type: string; tagId?: string; campaignId?: string },
			stepCount: (w.steps as unknown[]).length,
			enabled: w.enabled,
			executionCount: w._count.executions,
			createdAt: w.createdAt.toISOString(),
			updatedAt: w.updatedAt.toISOString()
		}))
	};
};
