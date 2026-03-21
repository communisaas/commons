import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { org, membership } = await parent();
	requireRole(membership.role, 'editor');

	const templates = await db.template.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { title: 'asc' }
	});

	// Pre-populate from legislative alert if fromAlert param present
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

		// If linking to a bill, require position
		if (billId && !position) {
			return fail(400, { error: 'Position (support/oppose) is required when linking to a bill', title, type, body, targetCountry, targetJurisdiction });
		}
		if (position && !['support', 'oppose'].includes(position)) {
			return fail(400, { error: 'Position must be "support" or "oppose"', title, type, body, targetCountry, targetJurisdiction });
		}

		// Validate billId exists if provided
		if (billId) {
			const bill = await db.bill.findUnique({ where: { id: billId }, select: { id: true } });
			if (!bill) {
				return fail(400, { error: 'Invalid bill reference', title, type, body, targetCountry, targetJurisdiction });
			}
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
				billId,
				position,
				debateEnabled,
				debateThreshold,
				targetCountry,
				targetJurisdiction,
				status: 'DRAFT'
			}
		});

		// If created from an alert, mark it as acted upon
		if (fromAlertId) {
			await db.legislativeAlert.updateMany({
				where: { id: fromAlertId, orgId: org.id },
				data: { status: 'acted', actionTaken: 'created_campaign' }
			}).catch(() => {
				// Non-critical — campaign was already created successfully
			});
		}

		throw redirect(303, `/org/${params.slug}/campaigns/${campaign.id}`);
	}
};
