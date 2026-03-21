import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

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

	return {
		supporter: {
			id: supporter.id,
			email: supporter.email,
			name: supporter.name,
			postalCode: supporter.postalCode,
			country: supporter.country,
			phone: supporter.phone,
			identityVerified: !!(supporter.identityCommitment && supporter.verified),
			verified: supporter.verified,
			emailStatus: supporter.emailStatus,
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
	}
};
