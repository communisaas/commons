// CONVEX: Keep SvelteKit — complex load (verification packets, analytics, debate chain). Form actions use Convex mutations.
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { computeVerificationPacketCached } from '$lib/server/campaigns/verification';
import { loadCampaignAnalytics } from '$lib/server/campaigns/analytics';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, parent, platform }) => {
	const { org, membership } = await parent();

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

	// Load debate data if campaign has a linked debate
	let debate = null;
	if (campaign.debateId) {
		const dbDebate = await db.debate.findUnique({
			where: { id: campaign.debateId },
			select: {
				id: true,
				proposition_text: true,
				status: true,
				deadline: true,
				argument_count: true,
				unique_participants: true,
				winning_stance: true,
				winning_argument_index: true,
				ai_panel_consensus: true,
				resolution_method: true,
				governance_justification: true,
				template: { select: { slug: true } },
				arguments: {
					select: { body: true, stance: true, argument_index: true }
				}
			}
		});
		if (dbDebate) {
			const winningArg = dbDebate.winning_argument_index != null
				? dbDebate.arguments.find((a) => a.argument_index === dbDebate.winning_argument_index)
				: null;
			debate = { ...dbDebate, winningArg };
		}
	}

	// Action count for pre-threshold debate progress
	const actionCount = isActive && campaign.debateEnabled && !campaign.debateId
		? await db.campaignAction.count({ where: { campaignId: campaign.id, verified: true } })
		: null;

	// Strip target emails for non-editor members (PII minimization)
	const rawTargets = campaign.targets;
	const safeTargets = membership.role === 'member' && Array.isArray(rawTargets)
		? rawTargets.map((t: Record<string, unknown>) => ({ name: t.name, title: t.title, district: t.district }))
		: rawTargets;

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
			debateId: campaign.debateId,
			targets: safeTargets,
			targetCountry: campaign.targetCountry,
			targetJurisdiction: campaign.targetJurisdiction,
			createdAt: campaign.createdAt.toISOString(),
			updatedAt: campaign.updatedAt.toISOString()
		},
		templates,
		packet,
		analytics,
		debate: debate
			? {
					id: debate.id,
					propositionText: debate.proposition_text,
					status: debate.status,
					deadline: debate.deadline.toISOString(),
					argumentCount: debate.argument_count,
					uniqueParticipants: debate.unique_participants,
					winningStance: debate.winning_stance,
					aiPanelConsensus: debate.ai_panel_consensus,
					resolutionMethod: debate.resolution_method,
					governanceJustification: debate.governance_justification,
					templateSlug: debate.template.slug,
					winningArgument: debate.winningArg
						? { body: debate.winningArg.body, stance: debate.winningArg.stance }
						: null
				}
			: null,
		actionCount
	};
};

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}

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

		try {
			await serverMutation(api.campaigns.update, {
				campaignId: params.id as any,
				slug: params.slug,
				title,
				type,
				body: body ?? undefined,
				templateId: templateId ?? undefined,
				debateEnabled,
				debateThreshold,
				targetCountry,
				targetJurisdiction: targetJurisdiction ?? undefined
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				throw error(404, 'Campaign not found');
			}
			throw e;
		}

		return { success: true };
	},

	addTarget: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}

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

		try {
			await serverMutation(api.campaigns.addTarget, {
				campaignId: params.id as any,
				slug: params.slug,
				target: { name, email, title, district }
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				throw error(404, 'Campaign not found');
			}
			if (e.message?.includes('Maximum of 50')) {
				return fail(400, { error: 'Maximum of 50 targets per campaign' });
			}
			if (e.message?.includes('already exists')) {
				return fail(400, { error: 'A target with this email already exists' });
			}
			throw e;
		}

		return { success: true };
	},

	removeTarget: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();

		if (!email) {
			return fail(400, { error: 'Target email is required' });
		}

		try {
			await serverMutation(api.campaigns.removeTarget, {
				campaignId: params.id as any,
				slug: params.slug,
				email
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				throw error(404, 'Campaign not found');
			}
			throw e;
		}

		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/${params.id}`);
		}

		const formData = await request.formData();
		const newStatus = formData.get('status')?.toString();

		if (!newStatus || !['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(newStatus)) {
			return fail(400, { error: 'Invalid status' });
		}

		try {
			await serverMutation(api.campaigns.updateStatus, {
				campaignId: params.id as any,
				slug: params.slug,
				status: newStatus
			});
		} catch (e: any) {
			if (e.message?.includes('not found')) {
				throw error(404, 'Campaign not found');
			}
			if (e.message?.includes('Cannot transition')) {
				return fail(400, { error: e.message });
			}
			throw e;
		}

		return { success: true, newStatus };
	}
};
