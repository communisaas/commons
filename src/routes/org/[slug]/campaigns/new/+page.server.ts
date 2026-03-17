import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();
	requireRole(membership.role, 'editor');

	const templates = await db.template.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { title: 'asc' }
	});

	return { templates };
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/new`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const title = formData.get('title')?.toString().trim();
		const type = formData.get('type')?.toString();
		const body = formData.get('body')?.toString().trim() || null;
		const templateId = formData.get('templateId')?.toString() || null;
		const debateEnabled = formData.get('debateEnabled') === 'on';
		const debateThresholdRaw = formData.get('debateThreshold')?.toString();
		const debateThreshold = debateThresholdRaw ? parseInt(debateThresholdRaw, 10) : 50;
		const targetCountry = formData.get('targetCountry')?.toString()?.toUpperCase() || 'US';
		const targetJurisdiction = formData.get('targetJurisdiction')?.toString() || null;

		if (!title) {
			return fail(400, { error: 'Title is required', title, type, body, targetCountry, targetJurisdiction });
		}

		if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
			return fail(400, { error: 'Invalid campaign type', title, type, body, targetCountry, targetJurisdiction });
		}

		if (debateEnabled && (isNaN(debateThreshold) || debateThreshold < 1)) {
			return fail(400, { error: 'Debate threshold must be at least 1', title, type, body, targetCountry, targetJurisdiction });
		}

		// Validate templateId belongs to this org if provided
		if (templateId) {
			const template = await db.template.findFirst({
				where: { id: templateId, orgId: org.id }
			});
			if (!template) {
				return fail(400, { error: 'Invalid template selection', title, type, body, targetCountry, targetJurisdiction });
			}
		}

		const campaign = await db.campaign.create({
			data: {
				orgId: org.id,
				title,
				type,
				body,
				templateId,
				debateEnabled,
				debateThreshold,
				targetCountry,
				targetJurisdiction,
				status: 'DRAFT'
			}
		});

		throw redirect(303, `/org/${params.slug}/campaigns/${campaign.id}`);
	}
};
