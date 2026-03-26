import { redirect } from '@sveltejs/kit';
import { loadOrgContext } from '$lib/server/org';
import type { LayoutServerLoad } from './$types';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		throw redirect(302, `/auth/google?returnTo=/org/${params.slug}`);
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });

			if (result) {
				console.log(`[OrgLayout] Convex: loaded org context for ${params.slug}`);
				return {
					org: {
						id: result.org._id,
						name: result.org.name,
						slug: result.org.slug,
						description: result.org.description,
						avatar: result.org.avatar,
						max_seats: result.org.maxSeats,
						max_templates_month: result.org.maxTemplatesMonth,
						dm_cache_ttl_days: result.org.dmCacheTtlDays,
						identity_commitment: result.org.identityCommitment,
						createdAt: new Date(result.org._creationTime)
					},
					membership: {
						role: result.membership.role,
						joinedAt: new Date(result.membership.joinedAt)
					}
				};
			}
		} catch (err) {
			// Re-throw auth/access errors (403s mapped as Error messages from Convex)
			if (err instanceof Error && err.message.includes('not a member')) {
				throw redirect(302, '/');
			}
			console.error('[OrgLayout] Convex load failed, falling back to Prisma:', err);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);

	return { org, membership };
};
