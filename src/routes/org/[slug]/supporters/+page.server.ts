// CONVEX: Fully migrated — form actions use Convex tag mutations
import { fail, redirect } from '@sveltejs/kit';

import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api, internal } from '$lib/convex';

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

export const actions: Actions = {
	createTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const name = formData.get('name')?.toString()?.trim();

		if (!name) {
			return fail(400, { error: 'Tag name is required', action: 'createTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'createTag' });
		}

		const result = await serverMutation(internal.v1api.createTag, {
			orgId: org._id,
			name
		});

		if (result && 'duplicate' in result && result.duplicate) {
			return fail(409, { error: 'A tag with this name already exists', action: 'createTag' });
		}

		return { success: true, action: 'createTag' };
	},

	renameTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();
		const name = formData.get('name')?.toString()?.trim();

		if (!tagId || !name) {
			return fail(400, { error: 'Tag ID and name are required', action: 'renameTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'renameTag' });
		}

		const result = await serverMutation(internal.v1api.updateTag, {
			tagId,
			orgId: org._id,
			name
		});

		if (!result) {
			return fail(404, { error: 'Tag not found', action: 'renameTag' });
		}
		if ('duplicate' in result && result.duplicate) {
			return fail(409, { error: 'A tag with this name already exists', action: 'renameTag' });
		}

		return { success: true, action: 'renameTag' };
	},

	deleteTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag ID is required', action: 'deleteTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'deleteTag' });
		}

		const deleted = await serverMutation(internal.v1api.deleteTag, {
			tagId,
			orgId: org._id
		});

		if (!deleted) {
			return fail(404, { error: 'Tag not found', action: 'deleteTag' });
		}

		return { success: true, action: 'deleteTag' };
	}
};
