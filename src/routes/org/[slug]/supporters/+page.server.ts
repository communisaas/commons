import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { tryDecryptSupporterEmail, computeEmailHash } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad, Actions } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ parent, url }) => {
	const { org } = await parent();

	// Parse filter params (needed for both Convex and Prisma paths)
	const q = url.searchParams.get('q')?.trim() || '';
	const status = url.searchParams.get('status') || '';
	const verified = url.searchParams.get('verified') || '';
	const tagId = url.searchParams.get('tag') || '';
	const source = url.searchParams.get('source') || '';
	const cursor = url.searchParams.get('cursor') || '';
	const filters = { q, status, verified, tagId, source };

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL && !q) {
		// Note: Convex list doesn't support text search (q param), so only use
		// Convex when there's no search query. Fall to Prisma for search.
		try {
			const convexFilters: Record<string, unknown> = {};
			if (status && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(status)) {
				convexFilters.emailStatus = status;
			}
			if (verified === 'true') convexFilters.verified = true;
			else if (verified === 'false') convexFilters.verified = false;
			if (source && ['csv', 'action_network', 'organic', 'widget'].includes(source)) {
				convexFilters.source = source;
			}
			// tagId filter: Convex expects v.id("tags"), only pass if present
			// Skip tag filter in Convex — requires Convex ID format

			const [convexResult, summaryStats, tags, campaigns] = await Promise.all([
				serverQuery(api.supporters.list, {
					orgSlug: org.slug,
					paginationOpts: { cursor: cursor || null, numItems: PAGE_SIZE },
					filters: Object.keys(convexFilters).length > 0 ? convexFilters : undefined
				}),
				serverQuery(api.supporters.getSummaryStats, { orgSlug: org.slug }),
				// Tags and campaigns still from Prisma (no Convex equivalent yet)
				db.tag.findMany({
					where: { orgId: org.id },
					select: { id: true, name: true, _count: { select: { supporters: true } } },
					orderBy: { name: 'asc' }
				}),
				db.campaign.findMany({
					where: { orgId: org.id },
					select: { id: true, title: true },
					orderBy: { updatedAt: 'desc' }
				})
			]);

			console.log(`[Supporters] Convex: loaded ${convexResult.supporters.length} supporters for ${org.slug}`);

			// Map Convex supporter shape → Prisma shape expected by +page.svelte
			const supporters = convexResult.supporters
				.filter((s: Record<string, unknown>) => s.email !== null) // match Prisma behavior: skip null emails
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
				tags: tags.map(t => ({ id: t.id, name: t.name, supporterCount: t._count.supporters })),
				campaigns,
				summary: {
					verified: summaryStats.identityVerified,
					postal: summaryStats.postalResolved,
					imported: summaryStats.imported
				},
				emailHealth: summaryStats.emailHealth,
				filters
			};
		} catch (error) {
			console.error('[Supporters] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	// Build where clause
	const where: Record<string, unknown> = { orgId: org.id };

	if (q) {
		if (q.includes('@')) {
			// Email search: exact hash match (LIKE impossible on encrypted data)
			const qHash = await computeEmailHash(q);
			if (qHash) {
				where.email_hash = qHash;
			} else {
				// Hash unavailable — no results possible for email search
				where.id = '__no_match__';
			}
		} else {
			where.name = { contains: q, mode: 'insensitive' };
		}
	}

	if (status && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(status)) {
		where.emailStatus = status;
	}

	if (verified === 'true') {
		where.verified = true;
	} else if (verified === 'false') {
		where.verified = false;
	}

	if (source && ['csv', 'action_network', 'organic', 'widget'].includes(source)) {
		where.source = source;
	}

	if (tagId) {
		where.tags = { some: { tagId } };
	}

	// Cursor-based pagination
	const findArgs: Record<string, unknown> = {
		where,
		take: PAGE_SIZE + 1, // fetch one extra to determine hasMore
		orderBy: { createdAt: 'desc' as const },
		include: {
			tags: {
				include: {
					tag: { select: { id: true, name: true } }
				}
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1; // skip the cursor item itself
	}

	const [rawSupporters, total, verifiedCount, postalCount, tags, statusCounts, campaigns] =
		await Promise.all([
			db.supporter.findMany(findArgs as Parameters<typeof db.supporter.findMany>[0]) as Promise<Array<Awaited<ReturnType<typeof db.supporter.findFirst>> & { tags: Array<{ tag: { id: string; name: string } }> }>>,
			db.supporter.count({ where }),
			db.supporter.count({
				where: {
					orgId: org.id,
					verified: true,
					identityCommitment: { not: null }
				}
			}),
			db.supporter.count({
				where: {
					orgId: org.id,
					postalCode: { not: null },
					OR: [{ verified: false }, { identityCommitment: null }]
				}
			}),
			db.tag.findMany({
				where: { orgId: org.id },
				select: { id: true, name: true, _count: { select: { supporters: true } } },
				orderBy: { name: 'asc' }
			}),
			db.supporter.groupBy({
				by: ['emailStatus'],
				where: { orgId: org.id },
				_count: { id: true }
			}),
			db.campaign.findMany({
				where: { orgId: org.id },
				select: { id: true, title: true },
				orderBy: { updatedAt: 'desc' }
			})
		]);

	const hasMore = rawSupporters.length > PAGE_SIZE;
	const sliced = rawSupporters.slice(0, PAGE_SIZE);
	const supporterResults = await Promise.all(
		sliced.map(async (s) => {
			const email = await tryDecryptSupporterEmail(s as { id: string; encrypted_email: string }).catch(() => null);
			if (!email) return null; // skip rows with corrupted encryption — don't crash entire page
			return {
				id: s.id,
				email,
					name: s.name,
				postalCode: s.postalCode,
				country: s.country,
				phone: s.phone,
				identityVerified: !!(s.identityCommitment && s.verified),
				verified: s.verified,
				emailStatus: s.emailStatus,
				source: s.source,
				createdAt: s.createdAt.toISOString(),
				tags: s.tags.map((st: { tag: { id: string; name: string } }) => ({
					id: st.tag.id,
					name: st.tag.name
				}))
			};
		})
	);
	const supporters = supporterResults.filter((s): s is NonNullable<typeof s> => s !== null);

	// Use raw slice for cursor (not filtered) to avoid pagination desync from skipped decrypt failures
	const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

	// Imported = total in org minus verified minus postal-resolved
	const totalInOrg = statusCounts.reduce((sum, row) => sum + row._count.id, 0);
	const importedCount = totalInOrg - verifiedCount - postalCount;

	// Build email health counts
	const emailHealth: Record<string, number> = {
		subscribed: 0,
		unsubscribed: 0,
		bounced: 0,
		complained: 0
	};
	for (const row of statusCounts) {
		if (row.emailStatus in emailHealth) {
			emailHealth[row.emailStatus] = row._count.id;
		}
	}

	return {
		supporters,
		total,
		hasMore,
		nextCursor,
		tags: tags.map((t) => ({ id: t.id, name: t.name, supporterCount: t._count.supporters })),
		campaigns,
		summary: {
			verified: verifiedCount,
			postal: postalCount,
			imported: importedCount
		},
		emailHealth,
		filters: { q, status, verified, tagId, source }
	};
};

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
