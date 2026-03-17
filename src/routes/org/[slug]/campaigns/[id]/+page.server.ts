import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { computeVerificationPacketCached } from '$lib/server/campaigns/verification';
import { loadCampaignAnalytics } from '$lib/server/campaigns/analytics';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad, Actions } from './$types';

/** Valid status transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
	DRAFT: ['ACTIVE'],
	ACTIVE: ['PAUSED', 'COMPLETE'],
	PAUSED: ['ACTIVE', 'COMPLETE'],
	COMPLETE: []
};

export const load: PageServerLoad = async ({ params, parent, platform }) => {
	const { org } = await parent();

	const campaign = await db.campaign.findFirst({
		where: { id: params.id, orgId: org.id }
	});

	if (!campaign) {
		throw error(404, 'Campaign not found');
	}

	const templates = await db.template.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { title: 'asc' }
	});

	// Resolve current template title
	let templateTitle: string | null = null;
	if (campaign.templateId) {
		const tmpl = templates.find((t) => t.id === campaign.templateId);
		templateTitle = tmpl?.title ?? null;
	}

	// Compute verification packet and analytics for non-draft campaigns
	const packetKV = platform?.env?.PACKET_CACHE_KV as
		| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
		| undefined;
	const isActive = campaign.status !== 'DRAFT';
	const [packet, analytics] = await Promise.all([
		isActive ? computeVerificationPacketCached(campaign.id, org.id, packetKV) : null,
		isActive && FEATURES.ANALYTICS_EXPANDED
			? loadCampaignAnalytics(campaign.id, org.id)
			: null
	]);

	return {
		campaign: {
			id: campaign.id,
			title: campaign.title,
			type: campaign.type,
			status: campaign.status,
			body: campaign.body,
			templateId: campaign.templateId,
			templateTitle,
			debateEnabled: campaign.debateEnabled,
			debateThreshold: campaign.debateThreshold,
			targets: campaign.targets,
			targetCountry: campaign.targetCountry,
			targetJurisdiction: campaign.targetJurisdiction,
			createdAt: campaign.createdAt.toISOString(),
			updatedAt: campaign.updatedAt.toISOString()
		},
		templates,
		packet,
		analytics
	};
};

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
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
			return fail(400, { error: 'Title is required' });
		}

		if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
			return fail(400, { error: 'Invalid campaign type' });
		}

		if (debateEnabled && (isNaN(debateThreshold) || debateThreshold < 1)) {
			return fail(400, { error: 'Debate threshold must be at least 1' });
		}

		// Verify campaign belongs to org
		const existing = await db.campaign.findFirst({
			where: { id: params.id, orgId: org.id }
		});
		if (!existing) {
			throw error(404, 'Campaign not found');
		}

		// Validate templateId if provided
		if (templateId) {
			const template = await db.template.findFirst({
				where: { id: templateId, orgId: org.id }
			});
			if (!template) {
				return fail(400, { error: 'Invalid template selection' });
			}
		}

		await db.campaign.update({
			where: { id: params.id },
			data: {
				title,
				type,
				body,
				templateId,
				debateEnabled,
				debateThreshold,
				targetCountry,
				targetJurisdiction
			}
		});

		return { success: true };
	},

	addTarget: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const title = formData.get('title')?.toString().trim() || undefined;
		const district = formData.get('district')?.toString().trim() || undefined;

		if (!name) {
			return fail(400, { error: 'Target name is required' });
		}
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'A valid email address is required' });
		}

		const campaign = await db.campaign.findFirst({
			where: { id: params.id, orgId: org.id }
		});
		if (!campaign) {
			throw error(404, 'Campaign not found');
		}

		const targets = Array.isArray(campaign.targets) ? (campaign.targets as Array<{ name: string; email: string; title?: string; district?: string }>) : [];

		if (targets.length >= 50) {
			return fail(400, { error: 'Maximum of 50 targets per campaign' });
		}

		if (targets.some((t) => t.email === email)) {
			return fail(400, { error: 'A target with this email already exists' });
		}

		targets.push({ name, email, title, district });

		await db.campaign.update({
			where: { id: params.id },
			data: { targets }
		});

		return { success: true };
	},

	removeTarget: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();

		if (!email) {
			return fail(400, { error: 'Target email is required' });
		}

		const campaign = await db.campaign.findFirst({
			where: { id: params.id, orgId: org.id }
		});
		if (!campaign) {
			throw error(404, 'Campaign not found');
		}

		const targets = Array.isArray(campaign.targets) ? (campaign.targets as Array<{ name: string; email: string; title?: string; district?: string }>) : [];
		const filtered = targets.filter((t) => t.email !== email);

		await db.campaign.update({
			where: { id: params.id },
			data: { targets: filtered }
		});

		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const newStatus = formData.get('status')?.toString();

		if (!newStatus || !['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(newStatus)) {
			return fail(400, { error: 'Invalid status' });
		}

		const campaign = await db.campaign.findFirst({
			where: { id: params.id, orgId: org.id }
		});
		if (!campaign) {
			throw error(404, 'Campaign not found');
		}

		const allowed = VALID_TRANSITIONS[campaign.status] ?? [];
		if (!allowed.includes(newStatus)) {
			return fail(400, {
				error: `Cannot transition from ${campaign.status} to ${newStatus}`
			});
		}

		await db.campaign.update({
			where: { id: params.id },
			data: { status: newStatus }
		});

		return { success: true, newStatus };
	}
};
