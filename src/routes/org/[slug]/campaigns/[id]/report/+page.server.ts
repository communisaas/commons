import { error, fail, redirect } from '@sveltejs/kit';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { loadReportPreview, sendReport, loadPastDeliveries } from '$lib/server/campaigns/report';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, parent, locals }) => {
	if (!locals.user) throw redirect(302, '/auth/login');
	const { org } = await parent();
	const { membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const preview = await loadReportPreview(params.id, org.id);

	if (!preview) {
		throw error(404, 'Campaign not found');
	}

	const pastDeliveries = await loadPastDeliveries(params.id, org.id);

	return {
		campaign: preview.campaign,
		targets: preview.targets,
		packet: preview.packet,
		renderedHtml: preview.renderedHtml,
		pastDeliveries
	};
};

export const actions: Actions = {
	send: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}/report`);
		}

		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const selectedEmails = formData.getAll('target').map((v) => v.toString());

		if (selectedEmails.length === 0) {
			return fail(400, { error: 'No targets selected' });
		}

		// Billing usage check — proof reports count against email quota
		const usage = await getOrgUsage(org.id);
		if (isOverLimit(usage).emails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const result = await sendReport(params.id, org.id, selectedEmails);

		if (result.error) {
			return fail(400, { error: result.error });
		}

		return {
			success: true,
			sentCount: result.deliveryIds.length
		};
	}
};
