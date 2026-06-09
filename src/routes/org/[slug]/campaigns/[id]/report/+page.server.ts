import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import type { PageServerLoad, Actions } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { computeVerificationPacketCached } from '$lib/server/verification-packet';
import { renderReport } from '$lib/server/email/report-template';
import { computeProofWeight } from '$lib/server/legislation/receipts/proof-weight';

const baseUrl = env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://commons.email';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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
		campaignId: params.id as Id<'campaigns'>,
		orgSlug: params.slug
	});

	if (!preview) {
		throw error(404, 'Campaign not found');
	}

	// Compute full packet for the report email template
	const packetKV = platform?.env?.PACKET_CACHE_KV as
		| {
				get(key: string): Promise<string | null>;
				put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
		  }
		| undefined;
	const fullPacket = await computeVerificationPacketCached(preview.campaign._id, org.id, packetKV);

	const rendered = await renderReport({
		campaignId: String(preview.campaign._id),
		campaignTitle: preview.campaign.title,
		orgName: org.name ?? org.slug,
		packet: fullPacket,
		verificationUrl: `${baseUrl}/v/${preview.campaign._id}`
	});
	const renderedHtml = rendered.html;

	const pastDeliveries = await serverQuery(api.campaigns.getPastDeliveries, {
		campaignId: params.id as Id<'campaigns'>,
		orgSlug: params.slug
	});

	return {
		campaign: {
			id: asString(preview.campaign._id),
			title: asString(preview.campaign.title, 'Untitled campaign'),
			status: asString(preview.campaign.status),
			type: asString(preview.campaign.type)
		},
		targets: preview.targets
			.map((target: Record<string, unknown>) => ({
				email: asString(target.email),
				name: typeof target.name === 'string' ? target.name : null,
				title: typeof target.title === 'string' ? target.title : null,
				district: typeof target.district === 'string' ? target.district : null,
				decisionMakerId: typeof target.decisionMakerId === 'string' ? target.decisionMakerId : null
			}))
			.filter((target: { email: string }) => target.email),
		packet: fullPacket,
		renderedHtml,
		pastDeliveries: (pastDeliveries ?? []).map((delivery: Record<string, unknown>) => ({
			id: asString(delivery._id ?? delivery.id),
			receiptId: typeof delivery.receiptId === 'string' ? delivery.receiptId : null,
			decisionMakerId:
				typeof delivery.decisionMakerId === 'string' ? delivery.decisionMakerId : null,
			billId: typeof delivery.billId === 'string' ? delivery.billId : null,
			targetEmail: asString(delivery.targetEmail),
			targetName: typeof delivery.targetName === 'string' ? delivery.targetName : null,
			targetTitle: typeof delivery.targetTitle === 'string' ? delivery.targetTitle : null,
			targetDistrict: typeof delivery.targetDistrict === 'string' ? delivery.targetDistrict : null,
			status: asString(delivery.status, 'sent'),
			sentAt: typeof delivery.sentAt === 'number' ? new Date(delivery.sentAt).toISOString() : null,
			createdAt:
				typeof delivery.createdAt === 'number'
					? new Date(delivery.createdAt).toISOString()
					: asString(delivery.createdAt, new Date().toISOString()),
			receiptBacked: delivery.receiptBacked === true,
			receiptEligibility: asString(delivery.receiptEligibility, 'missing_bill_and_target'),
			receiptBlockers: Array.isArray(delivery.receiptBlockers)
				? delivery.receiptBlockers.filter(
						(blocker): blocker is string => typeof blocker === 'string'
					)
				: [],
			proofStrength: typeof delivery.proofWeight === 'number'
				? {
						weight: asNumber(delivery.proofWeight),
						verified: asNumber(delivery.verifiedCount),
						total: asNumber(delivery.totalCount),
						districtCount: asNumber(delivery.districtCount)
					}
				: null,
			packetDigest: typeof delivery.packetDigest === 'string' ? delivery.packetDigest : null,
			attestationDigest:
				typeof delivery.attestationDigest === 'string' ? delivery.attestationDigest : null,
			responses: Array.isArray(delivery.responses)
				? delivery.responses.map((response: Record<string, unknown>) => ({
						type: asString(response.type),
						confidence: asString(response.confidence, 'reported'),
						occurredAt:
							typeof response.occurredAt === 'number'
								? new Date(response.occurredAt).toISOString()
								: asString(response.occurredAt, new Date().toISOString()),
						detail: typeof response.detail === 'string' ? response.detail : null
					}))
				: []
		}))
	};
};

export const actions: Actions = {
	send: async ({ request, params, locals, platform }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}/report`
			);
		}

		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const formData = await request.formData();
		const selectedEmails = formData.getAll('target').map((v) => v.toString());

		if (selectedEmails.length === 0) {
			return fail(400, { error: 'No targets selected' });
		}
		// Cap target count + per-email length. Reports go to decision-makers
		// per send; 50 matches the campaign target cap (campaigns.addTarget enforces
		// "Maximum of 50"). 254 is RFC 5321 email length cap.
		if (selectedEmails.length > 50) {
			return fail(400, { error: 'Cannot send to more than 50 targets at once' });
		}
		if (selectedEmails.some((e) => e.length > 254)) {
			return fail(400, { error: 'One or more target emails are too long' });
		}

		// Check usage limits via Convex
		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits && limits.current && limits.current.emailsSent >= limits.limits.maxEmails) {
			return fail(403, {
				error:
					'Email send limit reached for the current billing period. Upgrade your plan to send more.'
			});
		}

		// Render the full report email HTML so the decision-maker gets the same quality as the preview
		const packetKV = platform?.env?.PACKET_CACHE_KV as
			| {
					get(key: string): Promise<string | null>;
					put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
			  }
			| undefined;
		let renderedHtml: string | undefined;
		let packetDigest: string | undefined;
		let proofWeight: number | undefined;
		let packetSummary:
			| {
					verified: number;
					total: number;
					districtCount: number;
					gds: number | null;
					ald: number | null;
					cai: number | null;
					temporalEntropy: number | null;
			  }
			| undefined;
		try {
			const preview = await serverQuery(api.campaigns.getReportPreview, {
				campaignId: params.id as Id<'campaigns'>,
				orgSlug: params.slug
			});
			if (preview) {
				const fullPacket = await computeVerificationPacketCached(
					preview.campaign._id,
					ctx.org._id,
					packetKV
				);
				const rendered = await renderReport({
					campaignId: String(preview.campaign._id),
					campaignTitle: preview.campaign.title,
					orgName: ctx.org.name ?? params.slug,
					packet: fullPacket,
					verificationUrl: `${baseUrl}/v/${preview.campaign._id}`
				});
				renderedHtml = rendered.html;
				packetDigest = rendered.attestationHash;
				proofWeight = computeProofWeight(fullPacket);
				packetSummary = {
					verified: fullPacket.verified,
					total: fullPacket.total,
					districtCount: fullPacket.districtCount,
					gds: fullPacket.gds ?? null,
					ald: fullPacket.ald ?? null,
					cai: fullPacket.cai ?? null,
					temporalEntropy: fullPacket.temporalEntropy ?? null
				};
			}
		} catch {
			// Non-fatal: dispatch will use fallback template
		}

		const result = await serverMutation(api.campaigns.sendReport, {
			campaignId: params.id as Id<'campaigns'>,
			orgSlug: params.slug,
			targetEmails: selectedEmails,
			renderedHtml,
			packetDigest,
			proofWeight,
			packetSummary
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
