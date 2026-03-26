import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexSupporter, allTags] = await Promise.all([
				serverQuery(api.supporters.get, {
					orgSlug: org.slug,
					supporterId: params.id as any
				}),
				// Tags still from Prisma (no Convex tag listing yet)
				db.tag.findMany({
					where: { orgId: org.id },
					select: { id: true, name: true },
					orderBy: { name: 'asc' },
					take: 1000
				})
			]);

			if (!convexSupporter) throw error(404, 'Supporter not found');

			console.log(`[Supporter Detail] Convex: loaded supporter ${params.id} for ${org.slug}`);

			return {
				supporter: {
					id: convexSupporter._id,
					email: convexSupporter.email,
					name: convexSupporter.name ?? null,
					postalCode: convexSupporter.postalCode ?? null,
					country: convexSupporter.country ?? null,
					phone: convexSupporter.phone ?? null,
					identityVerified: convexSupporter.identityVerified ?? false,
					verified: convexSupporter.verified ?? false,
					emailStatus: convexSupporter.emailStatus ?? 'subscribed',
					smsStatus: convexSupporter.smsStatus ?? 'none',
					source: convexSupporter.source ?? null,
					importedAt: typeof convexSupporter.importedAt === 'number'
						? new Date(convexSupporter.importedAt).toISOString()
						: convexSupporter.importedAt ?? null,
					customFields: convexSupporter.customFields ?? null,
					createdAt: typeof convexSupporter._creationTime === 'number'
						? new Date(convexSupporter._creationTime).toISOString()
						: String(convexSupporter._creationTime),
					updatedAt: typeof convexSupporter.updatedAt === 'number'
						? new Date(convexSupporter.updatedAt as number).toISOString()
						: String(convexSupporter.updatedAt),
					tags: ((convexSupporter.tags as Array<{ _id: string; name: string }>) ?? []).map(t => ({
						id: t._id,
						name: t.name
					}))
				},
				allTags
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Supporter Detail] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const supporter = await db.supporter.findFirst({
		where: { id: params.id, orgId: org.id },
		include: {
			tags: {
				include: {
					tag: { select: { id: true, name: true } }
				}
			}
		}
	});

	if (!supporter) {
		throw error(404, 'Supporter not found');
	}

	// Get all org tags for the tag management dropdown
	const allTags = await db.tag.findMany({
		where: { orgId: org.id },
		select: { id: true, name: true },
		orderBy: { name: 'asc' },
		take: 1000
	});

	const decryptedEmail = await tryDecryptSupporterEmail(supporter);

	return {
		supporter: {
			id: supporter.id,
			email: decryptedEmail,
			name: supporter.name,
			postalCode: supporter.postalCode,
			country: supporter.country,
			phone: supporter.phone,
			identityVerified: !!(supporter.identityCommitment && supporter.verified),
			verified: supporter.verified,
			emailStatus: supporter.emailStatus,
			smsStatus: supporter.smsStatus,
			source: supporter.source,
			importedAt: supporter.importedAt?.toISOString() ?? null,
			customFields: supporter.customFields,
			createdAt: supporter.createdAt.toISOString(),
			updatedAt: supporter.updatedAt.toISOString(),
			tags: supporter.tags.map((st) => ({
				id: st.tag.id,
				name: st.tag.name
			}))
		},
		allTags
	};
};

export const actions: Actions = {
	addTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag is required' });
		}

		// Verify tag belongs to org
		const tag = await db.tag.findFirst({ where: { id: tagId, orgId: org.id } });
		if (!tag) {
			return fail(400, { error: 'Invalid tag' });
		}

		// Verify supporter belongs to org
		const supporter = await db.supporter.findFirst({ where: { id: params.id, orgId: org.id } });
		if (!supporter) {
			throw error(404, 'Supporter not found');
		}

		// Upsert to avoid duplicate errors
		await db.supporterTag.upsert({
			where: {
				supporterId_tagId: { supporterId: params.id, tagId }
			},
			create: { supporterId: params.id, tagId },
			update: {}
		});

		// Fire-and-forget: dispatch tag_added trigger
		void dispatchTrigger(org.id, 'tag_added', {
			entityId: tagId,
			supporterId: params.id,
			metadata: { tagId }
		});

		return { success: true, action: 'addTag' };
	},

	removeTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag is required' });
		}

		// Verify supporter belongs to org
		const supporter = await db.supporter.findFirst({ where: { id: params.id, orgId: org.id } });
		if (!supporter) {
			throw error(404, 'Supporter not found');
		}

		await db.supporterTag.deleteMany({
			where: { supporterId: params.id, tagId }
		});

		return { success: true, action: 'removeTag' };
	},

	updateSmsStatus: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const smsStatus = formData.get('smsStatus')?.toString();

		const ALLOWED_STATUSES = ['none', 'subscribed', 'unsubscribed'];
		if (!smsStatus || !ALLOWED_STATUSES.includes(smsStatus)) {
			return fail(400, { error: 'Invalid SMS status. Cannot manually set to "stopped".' });
		}

		const supporter = await db.supporter.findFirst({ where: { id: params.id, orgId: org.id } });
		if (!supporter) {
			throw error(404, 'Supporter not found');
		}

		// Cannot override a STOP keyword opt-out manually
		if (supporter.smsStatus === 'stopped') {
			return fail(400, { error: 'Cannot override STOP keyword opt-out. Supporter must text START to re-subscribe.' });
		}

		await db.supporter.update({
			where: { id: supporter.id },
			data: { smsStatus }
		});

		return { success: true, action: 'updateSmsStatus' };
	}
};
