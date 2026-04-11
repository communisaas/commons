// CONVEX: Fully migrated — form actions use Convex supporter mutations
import { error, fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

	const { membership } = await parent();
	const isEditor = membership.role === 'owner' || membership.role === 'editor';

	const [convexSupporter, allTags, keyInfo] = await Promise.all([
		serverQuery(api.supporters.get, {
			orgSlug: org.slug,
			supporterId: params.id as any
		}),
		serverQuery(api.supporters.getTags, { orgSlug: org.slug }),
		isEditor
			? serverQuery(api.organizations.getOrgKeyVerifier, { slug: org.slug })
			: Promise.resolve({ orgKeyVerifier: null })
	]);

	if (!convexSupporter) throw error(404, 'Supporter not found');

	return {
		supporter: {
			id: convexSupporter._id,
			encryptedEmail: convexSupporter.encryptedEmail ?? null,
			encryptedName: convexSupporter.encryptedName ?? null,
			encryptedPhone: convexSupporter.encryptedPhone ?? null,
			postalCode: convexSupporter.postalCode ?? null,
			country: convexSupporter.country ?? null,
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
		allTags: (allTags ?? []).map((t: Record<string, unknown>) => ({ id: t._id ?? t.id, name: t.name })),
		encryption: { orgKeyVerifier: keyInfo.orgKeyVerifier }
	};
};

export const actions: Actions = {
	addTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag is required' });
		}

		try {
			await serverMutation(api.supporters.addTag, {
				orgSlug: params.slug,
				supporterId: params.id as any,
				tagId: tagId as any
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				return fail(400, { error: 'Invalid tag or supporter' });
			}
			throw e;
		}

		return { success: true, action: 'addTag' };
	},

	removeTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag is required' });
		}

		try {
			await serverMutation(api.supporters.removeTag, {
				orgSlug: params.slug,
				supporterId: params.id as any,
				tagId: tagId as any
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				throw error(404, 'Supporter not found');
			}
			throw e;
		}

		return { success: true, action: 'removeTag' };
	},

	updateSmsStatus: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/${params.id}`);
		}

		const formData = await request.formData();
		const smsStatus = formData.get('smsStatus')?.toString();

		const ALLOWED_STATUSES = ['none', 'subscribed', 'unsubscribed'];
		if (!smsStatus || !ALLOWED_STATUSES.includes(smsStatus)) {
			return fail(400, { error: 'Invalid SMS status. Cannot manually set to "stopped".' });
		}

		try {
			await serverMutation(api.supporters.updateSmsStatus, {
				orgSlug: params.slug,
				supporterId: params.id as any,
				smsStatus
			});
		} catch (e: any) {
			if (e.message?.includes('STOP keyword')) {
				return fail(400, { error: 'Cannot override STOP keyword opt-out. Supporter must text START to re-subscribe.' });
			}
			if (e.message?.includes('not found')) {
				throw error(404, 'Supporter not found');
			}
			throw e;
		}

		return { success: true, action: 'updateSmsStatus' };
	}
};
