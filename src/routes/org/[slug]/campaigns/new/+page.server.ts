import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import type { PageServerLoad, Actions } from './$types';

// Convex dual-stack imports
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, url, params }) => {
	const { org, membership } = await parent();
	requireRole(membership.role, 'editor');

	// ─── DUAL-STACK: Try Convex first ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const fromAlertId = url.searchParams.get('fromAlert');

			const [templates, alertPrefill] = await Promise.all([
				serverQuery(api.templates.listByOrg, { slug: params.slug }),
				fromAlertId
					? serverQuery(api.legislation.getAlertWithBill, {
						slug: params.slug,
						alertId: fromAlertId
					}).catch(() => null)
					: Promise.resolve(null)
			]);

			return {
				templates: templates.map((t: { _id: string; title: string }) => ({
					id: t._id,
					title: t.title
				})),
				alertPrefill
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[CampaignNew] Convex load failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const templates = await db.template.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { title: 'asc' }
	});

	let alertPrefill: {
		alertId: string;
		billId: string;
		billTitle: string;
		billSummary: string | null;
		billJurisdictionLevel: string;
	} | null = null;

	const fromAlertId = url.searchParams.get('fromAlert');
	if (fromAlertId) {
		const alert = await db.legislativeAlert.findFirst({
			where: { id: fromAlertId, orgId: org.id },
			include: {
				bill: {
					select: {
						id: true,
						title: true,
						summary: true,
						jurisdictionLevel: true
					}
				}
			}
		});
		if (alert) {
			alertPrefill = {
				alertId: alert.id,
				billId: alert.bill.id,
				billTitle: alert.bill.title,
				billSummary: alert.bill.summary,
				billJurisdictionLevel: alert.bill.jurisdictionLevel
			};
		}
	}

	return { templates, alertPrefill };
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
		const billId = formData.get('billId')?.toString() || null;
		const position = formData.get('position')?.toString() || null;
		const fromAlertId = formData.get('fromAlertId')?.toString() || null;

		if (!title) {
			return fail(400, { error: 'Title is required', title, type, body, targetCountry, targetJurisdiction });
		}

		if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
			return fail(400, { error: 'Invalid campaign type', title, type, body, targetCountry, targetJurisdiction });
		}

		if (debateEnabled && (isNaN(debateThreshold) || debateThreshold < 1)) {
			return fail(400, { error: 'Debate threshold must be at least 1', title, type, body, targetCountry, targetJurisdiction });
		}

		if (billId && !position) {
			return fail(400, { error: 'Position (support/oppose) is required when linking to a bill', title, type, body, targetCountry, targetJurisdiction });
		}
		if (position && !['support', 'oppose'].includes(position)) {
			return fail(400, { error: 'Position must be "support" or "oppose"', title, type, body, targetCountry, targetJurisdiction });
		}

		// ─── DUAL-STACK: Try Convex mutation first ───
		if (PUBLIC_CONVEX_URL) {
			try {
				const campaignId = await serverMutation(api.campaigns.create, {
					slug: params.slug,
					title,
					type,
					body: body ?? undefined,
					templateId: templateId ?? undefined,
					debateEnabled,
					debateThreshold,
					targetCountry,
					targetJurisdiction: targetJurisdiction ?? undefined,
					billId: billId ?? undefined,
					position: position ?? undefined
				});

				// Mark alert as acted upon if applicable
				if (fromAlertId) {
					await serverMutation(api.legislation.dismissAlert, {
						slug: params.slug,
						alertId: fromAlertId,
						status: 'acted'
					}).catch(() => {});
				}

				throw redirect(303, `/org/${params.slug}/campaigns/${campaignId}`);
			} catch (err) {
				if (err && typeof err === 'object' && 'status' in err) throw err;
				console.error('[CampaignNew] Convex create failed, falling back to Prisma:', err);
			}
		}

		// ─── PRISMA FALLBACK ───
		if (billId) {
			const bill = await db.bill.findUnique({ where: { id: billId }, select: { id: true } });
			if (!bill) {
				return fail(400, { error: 'Invalid bill reference', title, type, body, targetCountry, targetJurisdiction });
			}
		}

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
				billId,
				position,
				debateEnabled,
				debateThreshold,
				targetCountry,
				targetJurisdiction,
				status: 'DRAFT'
			}
		});

		if (fromAlertId) {
			await db.legislativeAlert.updateMany({
				where: { id: fromAlertId, orgId: org.id },
				data: { status: 'acted', actionTaken: 'created_campaign' }
			}).catch(() => {});
		}

		throw redirect(303, `/org/${params.slug}/campaigns/${campaign.id}`);
	}
};
