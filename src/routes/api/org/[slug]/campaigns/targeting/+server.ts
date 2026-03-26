/**
 * PATCH /api/org/[slug]/campaigns/targeting — Update campaign geographic targeting.
 * Requires editor+ role.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { VALID_JURISDICTIONS, VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { campaignId, targetJurisdiction, targetCountry } = body;

	if (!campaignId) {
		throw error(400, 'campaignId is required');
	}

	// Validate jurisdiction if provided
	if (targetJurisdiction !== undefined && targetJurisdiction !== null) {
		if (!VALID_JURISDICTIONS.includes(targetJurisdiction)) {
			throw error(400, `Invalid jurisdiction: ${targetJurisdiction}`);
		}
	}

	// Validate country if provided
	if (targetCountry !== undefined) {
		if (!VALID_COUNTRY_CODES.includes(targetCountry)) {
			throw error(400, `Invalid country code: ${targetCountry}`);
		}
	}

	if (targetJurisdiction === undefined && targetCountry === undefined) {
		throw error(400, 'No targeting fields provided');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			await serverMutation(api.campaigns.update, {
				campaignId,
				slug: params.slug,
				...(targetJurisdiction !== undefined ? { targetJurisdiction } : {})
			});
			return json({ success: true, data: { id: campaignId, targetJurisdiction, targetCountry } });
		} catch (err) {
			console.error('[CampaignTargeting] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify campaign belongs to org
	const campaign = await db.campaign.findFirst({
		where: { id: campaignId, orgId: org.id }
	});

	if (!campaign) {
		throw error(404, 'Campaign not found');
	}

	const data: Record<string, unknown> = {};
	if (targetJurisdiction !== undefined) data.targetJurisdiction = targetJurisdiction;
	if (targetCountry !== undefined) data.targetCountry = targetCountry;

	const updated = await db.campaign.update({
		where: { id: campaignId },
		data
	});

	return json({
		success: true,
		data: {
			id: updated.id,
			targetJurisdiction: updated.targetJurisdiction,
			targetCountry: updated.targetCountry
		}
	});
};
