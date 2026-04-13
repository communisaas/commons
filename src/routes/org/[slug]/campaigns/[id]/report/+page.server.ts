import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { computeVerificationPacketCached } from '$lib/server/verification-packet';
import { renderReportEmail } from '$lib/server/email/report-template';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const load: PageServerLoad = async ({ params, parent, locals, platform }) => {
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

	// Compute full packet for the report email template
	const packetKV = platform?.env?.PACKET_CACHE_KV as
		| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
		| undefined;
	const fullPacket = await computeVerificationPacketCached(
		preview.campaign._id,
		org.id,
		packetKV
	);

	// Render the email HTML using the staffer-legible template
	const renderedHtml = renderReportEmail({
		campaignTitle: preview.campaign.title,
		orgName: org.name ?? org.slug,
		packet: fullPacket,
		verificationUrl: `https://commons.email/v/${preview.campaign._id}`
	});

	const pastDeliveries = await serverQuery(api.campaigns.getPastDeliveries, {
		campaignId: params.id as any,
		orgSlug: params.slug
	});

	return {
		campaign: preview.campaign,
		targets: preview.targets,
		packet: preview.packet,
		renderedHtml,
		pastDeliveries: pastDeliveries ?? []
	};
};

export const actions: Actions = {
	send: async ({ request, params, locals, platform }) => {
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

		// Render the full report email HTML so the decision-maker gets the same quality as the preview
		const packetKV = platform?.env?.PACKET_CACHE_KV as
			| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
			| undefined;
		let renderedHtml: string | undefined;
		try {
			const preview = await serverQuery(api.campaigns.getReportPreview, {
				campaignId: params.id as any, orgSlug: params.slug
			});
			if (preview) {
				const fullPacket = await computeVerificationPacketCached(preview.campaign._id, ctx.org._id, packetKV);
				renderedHtml = renderReportEmail({
					campaignTitle: preview.campaign.title,
					orgName: ctx.org.name ?? params.slug,
					packet: fullPacket,
					verificationUrl: `https://commons.email/v/${preview.campaign._id}`
				});
			}
		} catch {
			// Non-fatal: dispatch will use fallback template
		}

		const result = await serverMutation(api.campaigns.sendReport, {
			campaignId: params.id as any,
			orgSlug: params.slug,
			targetEmails: selectedEmails,
			renderedHtml
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
