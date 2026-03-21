/**
 * PATCH /api/org/[slug]/profile — Update organization public profile fields
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'owner');

	const body = await request.json();
	const { mission, websiteUrl, logoUrl, isPublic } = body as {
		mission?: string;
		websiteUrl?: string;
		logoUrl?: string;
		isPublic?: boolean;
	};

	const data: Record<string, string | boolean> = {};

	if (typeof mission === 'string') {
		if (mission.length > 500) {
			throw error(400, 'Mission must be 500 characters or less');
		}
		data.mission = mission;
	}

	if (typeof websiteUrl === 'string') {
		if (websiteUrl.length > 0) {
			try {
				const parsed = new URL(websiteUrl);
				// F-R8-05: Reject non-HTTP(S) schemes (e.g. javascript:)
				if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
					throw error(400, 'Website URL must use HTTP or HTTPS');
				}
			} catch (e) {
				if (e && typeof e === 'object' && 'status' in e) throw e;
				throw error(400, 'Invalid website URL');
			}
		}
		data.websiteUrl = websiteUrl || '';
	}

	if (typeof logoUrl === 'string') {
		if (logoUrl === '') {
			data.logoUrl = '';
		} else {
			if (logoUrl.length > 2048) throw error(400, 'Logo URL too long');
			try {
				const parsed = new URL(logoUrl);
				if (parsed.protocol === 'data:') {
					// F-R22-02: Block SVG data URLs (can contain <script>, onload handlers)
					const SAFE_DATA_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/gif', 'data:image/webp'];
					if (!SAFE_DATA_PREFIXES.some(p => logoUrl.startsWith(p))) {
						throw error(400, 'Data URLs must be PNG, JPEG, GIF, or WebP images');
					}
				} else if (parsed.protocol !== 'https:') {
					throw error(400, 'Logo URL must use HTTPS');
				}
				data.logoUrl = logoUrl;
			} catch (e) {
				if (e && typeof e === 'object' && 'status' in e) throw e;
				throw error(400, 'Invalid logo URL');
			}
		}
	}

	if (typeof isPublic === 'boolean') {
		data.isPublic = isPublic;
	}

	if (Object.keys(data).length === 0) {
		throw error(400, 'No fields to update');
	}

	const updated = await db.organization.update({
		where: { id: org.id },
		data,
		select: {
			mission: true,
			websiteUrl: true,
			logoUrl: true,
			isPublic: true
		}
	});

	return json({ data: updated });
};
