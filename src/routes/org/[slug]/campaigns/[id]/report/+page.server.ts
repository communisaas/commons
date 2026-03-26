import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const load: PageServerLoad = async ({ params, parent, locals }) => {
	if (!locals.user) throw redirect(302, '/auth/login');
	const { org } = await parent();
	const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	requireRole(ctx.membership.role, 'editor');

	const preview = await serverQuery(api.campaigns.getReportPreview, {
		campaignId: params.id as any,
		orgSlug: params.slug
	});

	if (!preview) {
		throw error(404, 'Campaign not found');
	}

	const pastDeliveries = await serverQuery(api.campaigns.getPastDeliveries, {
		campaignId: params.id as any,
		orgSlug: params.slug
	});

	return {
		campaign: preview.campaign,
		targets: preview.targets,
		packet: preview.packet,
		renderedHtml: preview.renderedHtml,
		pastDeliveries: pastDeliveries ?? []
	};
};

export const actions: Actions = {
	send: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}/report`);
		}

		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const formData = await request.formData();
		const selectedEmails = formData.getAll('target').map((v) => v.toString());

		if (selectedEmails.length === 0) {
			return fail(400, { error: 'No targets selected' });
		}

		// Check usage limits via Convex
		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits && limits.current && (limits.current as any).emailsSent >= (limits.limits as any).maxEmails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const result = await serverMutation(api.campaigns.sendReport, {
			campaignId: params.id as any,
			orgSlug: params.slug,
			targetEmails: selectedEmails
		});

		if (result.error) {
			return fail(400, { error: result.error });
		}

		return {
			success: true,
			sentCount: result.deliveryCount ?? 0
		};
	}
};
