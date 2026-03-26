import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad, Actions } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ parent, url }) => {
	const { org } = await parent();

	// Parse filter params
	const q = url.searchParams.get('q')?.trim() || '';
	const status = url.searchParams.get('status') || '';
	const verified = url.searchParams.get('verified') || '';
	const tagId = url.searchParams.get('tag') || '';
	const source = url.searchParams.get('source') || '';
	const cursor = url.searchParams.get('cursor') || '';
	const filters = { q, status, verified, tagId, source };

	const convexFilters: Record<string, unknown> = {};
	if (status && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(status)) {
		convexFilters.emailStatus = status;
	}
	if (verified === 'true') convexFilters.verified = true;
	else if (verified === 'false') convexFilters.verified = false;
	if (source && ['csv', 'action_network', 'organic', 'widget'].includes(source)) {
		convexFilters.source = source;
	}
	if (tagId) {
		convexFilters.tagId = tagId;
	}
	if (q) {
		convexFilters.q = q;
	}

	const [convexResult, summaryStats, tags, campaigns] = await Promise.all([
		serverQuery(api.supporters.list, {
			orgSlug: org.slug,
			paginationOpts: { cursor: cursor || null, numItems: PAGE_SIZE },
			filters: Object.keys(convexFilters).length > 0 ? convexFilters : undefined
		}),
		serverQuery(api.supporters.getSummaryStats, { orgSlug: org.slug }),
		serverQuery(api.supporters.getTags, { orgSlug: org.slug }),
		serverQuery(api.campaigns.listForOrg, { orgSlug: org.slug })
	]);

	// Map Convex supporter shape → shape expected by +page.svelte
	const supporters = convexResult.supporters
		.filter((s: Record<string, unknown>) => s.email !== null)
		.map((s: Record<string, unknown>) => ({
			id: s._id,
			email: s.email,
			name: s.name ?? null,
			postalCode: s.postalCode ?? null,
			country: s.country ?? null,
			phone: s.phone ?? null,
			identityVerified: s.identityVerified ?? false,
			verified: s.verified ?? false,
			emailStatus: s.emailStatus ?? 'subscribed',
			source: s.source ?? null,
			createdAt: typeof s._creationTime === 'number'
				? new Date(s._creationTime as number).toISOString()
				: String(s._creationTime),
			tags: ((s.tags as Array<{ _id: string; name: string }>) ?? []).map(t => ({
				id: t._id,
				name: t.name
			}))
		}));

	return {
		supporters,
		total: summaryStats.total,
		hasMore: convexResult.hasMore,
		nextCursor: convexResult.nextCursor,
		tags: (tags ?? []).map((t: Record<string, unknown>) => ({ id: t._id ?? t.id, name: t.name, supporterCount: t.supporterCount ?? 0 })),
		campaigns: (campaigns ?? []).map((c: Record<string, unknown>) => ({ id: c._id ?? c.id, title: c.title })),
		summary: {
			verified: summaryStats.identityVerified,
			postal: summaryStats.postalResolved,
			imported: summaryStats.imported
		},
		emailHealth: summaryStats.emailHealth,
		filters
	};
};

// TODO: migrate form actions to Convex
export const actions: Actions = {
	createTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const name = formData.get('name')?.toString()?.trim();

		if (!name) {
			return fail(400, { error: 'Tag name is required', action: 'createTag' });
		}

		const existing = await db.tag.findUnique({
			where: { orgId_name: { orgId: org.id, name } }
		});
		if (existing) {
			return fail(409, { error: 'A tag with this name already exists', action: 'createTag' });
		}

		await db.tag.create({ data: { orgId: org.id, name } });
		return { success: true, action: 'createTag' };
	},

	renameTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();
		const name = formData.get('name')?.toString()?.trim();

		if (!tagId || !name) {
			return fail(400, { error: 'Tag ID and name are required', action: 'renameTag' });
		}

		const tag = await db.tag.findFirst({ where: { id: tagId, orgId: org.id } });
		if (!tag) {
			return fail(404, { error: 'Tag not found', action: 'renameTag' });
		}

		const conflict = await db.tag.findUnique({
			where: { orgId_name: { orgId: org.id, name } }
		});
		if (conflict && conflict.id !== tagId) {
			return fail(409, { error: 'A tag with this name already exists', action: 'renameTag' });
		}

		await db.tag.update({ where: { id: tagId }, data: { name } });
		return { success: true, action: 'renameTag' };
	},

	deleteTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag ID is required', action: 'deleteTag' });
		}

		const tag = await db.tag.findFirst({ where: { id: tagId, orgId: org.id } });
		if (!tag) {
			return fail(404, { error: 'Tag not found', action: 'deleteTag' });
		}

		await db.tag.delete({ where: { id: tagId } });
		return { success: true, action: 'deleteTag' };
	}
};
