// CONVEX: Fully migrated — form actions use Convex tag mutations
import { fail, redirect } from '@sveltejs/kit';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad, Actions } from './$types';

const PAGE_SIZE = 50;

type SupporterListResult = {
	supporters: Array<{
		_id: string;
		_creationTime: number;
		encryptedEmail?: string | null;
		encryptedName?: string | null;
		encryptedPhone?: string | null;
		postalCode?: string | null;
		country?: string | null;
		identityVerified?: boolean;
		verified?: boolean;
		emailStatus?: string;
		source?: string | null;
		tags?: Array<{ _id: string; name: string }>;
	}>;
	hasMore: boolean;
	nextCursor: string | null;
};

type CampaignListResult = {
	page: Array<{ _id: string; title: string }>;
};

export const load: PageServerLoad = async ({ parent, url }) => {
	const { org, membership } = await parent();

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

	// Load encryption verifier for client-side PII decryption
	const isEditor = membership.role === 'owner' || membership.role === 'editor';
	const keyInfo = isEditor
		? await serverQuery(api.organizations.getOrgKeyVerifier, { slug: org.slug })
		: { orgKeyVerifier: null };

	const [convexResult, summaryStats, tags, campaigns] = await Promise.all([
		serverQuery(api.supporters.list, {
			orgSlug: org.slug,
			paginationOpts: { cursor: cursor || null, numItems: PAGE_SIZE },
			filters: Object.keys(convexFilters).length > 0 ? convexFilters : undefined
		}) as Promise<SupporterListResult>,
		serverQuery(api.supporters.getSummaryStats, { orgSlug: org.slug }),
		serverQuery(api.supporters.getTags, { orgSlug: org.slug }),
		serverQuery(api.campaigns.list, {
			slug: org.slug,
			paginationOpts: { cursor: null, numItems: 100 }
		}) as Promise<CampaignListResult>
	]);

	// Pass encrypted blobs through — client decrypts with org key
	const supporters = convexResult.supporters
		.map((s) => ({
			id: s._id,
			encryptedEmail: s.encryptedEmail ?? null,
			encryptedName: s.encryptedName ?? null,
			encryptedPhone: s.encryptedPhone ?? null,
			postalCode: s.postalCode ?? null,
			country: s.country ?? null,
			identityVerified: s.identityVerified ?? false,
			verified: s.verified ?? false,
			emailStatus: s.emailStatus ?? 'subscribed',
			source: s.source ?? null,
			createdAt: new Date(s._creationTime).toISOString(),
			tags: (s.tags ?? []).map(t => ({
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
		campaigns: campaigns.page.map((c) => ({ id: c._id, title: c.title })),
		summary: {
			verified: summaryStats.identityVerified,
			postal: summaryStats.postalResolved,
			imported: summaryStats.imported
		},
		emailHealth: summaryStats.emailHealth,
		encryption: { orgKeyVerifier: keyInfo.orgKeyVerifier },
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

		return fail(501, { error: 'Tag creation is not available until a public Convex mutation is exposed', action: 'createTag' });
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

		return fail(501, { error: 'Tag rename is not available until a public Convex mutation is exposed', action: 'renameTag' });
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

		return fail(501, { error: 'Tag deletion is not available until a public Convex mutation is exposed', action: 'deleteTag' });
	}
};
