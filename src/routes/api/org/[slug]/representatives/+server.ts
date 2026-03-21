/**
 * POST /api/org/[slug]/representatives — Import international decision-makers.
 * GET  /api/org/[slug]/representatives — List decision-makers by country + constituency.
 * Requires editor+ role for POST, member+ for GET. Organization+ plan for POST.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const meetsPlan = await orgMeetsPlan(org.id, 'organization');
	if (!meetsPlan) throw error(403, 'International representatives require an Organization plan or higher');

	const body = await request.json();
	const { representatives } = body;

	if (!Array.isArray(representatives) || representatives.length === 0) {
		throw error(400, 'representatives array is required');
	}

	if (representatives.length > 100) {
		throw error(400, 'Maximum 100 representatives per request');
	}

	const SAFE_URL_RE = /^https?:\/\/.{1,2048}$/i;
	const sanitizeUrl = (url: unknown): string | null => {
		if (typeof url !== 'string' || !url) return null;
		return SAFE_URL_RE.test(url) ? url : null;
	};

	let imported = 0;

	for (const rep of representatives) {
		if (!rep.countryCode || !rep.constituencyId || !rep.constituencyName || !rep.name) {
			continue; // skip invalid entries
		}

		if (!VALID_COUNTRY_CODES.includes(rep.countryCode)) {
			continue;
		}

		// Upsert DecisionMaker by matching via ExternalId (constituency system)
		const existingExt = await db.externalId.findFirst({
			where: {
				system: 'constituency',
				value: rep.constituencyId,
				decisionMaker: {
					name: rep.name,
					jurisdiction: rep.countryCode
				}
			},
			select: { decisionMakerId: true }
		});

		if (existingExt) {
			// Update existing decision-maker
			await db.decisionMaker.update({
				where: { id: existingExt.decisionMakerId },
				data: {
					district: rep.constituencyName,
					party: rep.party || null,
					title: rep.office || null,
					phone: rep.phone || null,
					email: rep.email || null,
					websiteUrl: sanitizeUrl(rep.websiteUrl),
					photoUrl: sanitizeUrl(rep.photoUrl)
				}
			});
		} else {
			// Create new decision-maker + external ID
			// Parse name into first/last for required lastName field
			const nameParts = rep.name.trim().split(/\s+/);
			const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : rep.name;
			const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : null;

			await db.decisionMaker.create({
				data: {
					type: 'legislator',
					name: rep.name,
					firstName,
					lastName,
					jurisdiction: rep.countryCode,
					jurisdictionLevel: 'international',
					district: rep.constituencyName,
					party: rep.party || null,
					title: rep.office || null,
					phone: rep.phone || null,
					email: rep.email || null,
					websiteUrl: sanitizeUrl(rep.websiteUrl),
					photoUrl: sanitizeUrl(rep.photoUrl),
					active: true,
					externalIds: {
						create: {
							system: 'constituency',
							value: rep.constituencyId
						}
					}
				}
			});
		}

		imported++;
	}

	return json({ success: true, data: { imported } }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	await loadOrgContext(params.slug, locals.user.id);

	const countryCode = url.searchParams.get('country');
	const constituencyId = url.searchParams.get('constituency');
	const cursor = url.searchParams.get('cursor');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

	const where: Record<string, unknown> = { jurisdictionLevel: 'international' };
	if (countryCode) where.jurisdiction = countryCode;
	if (constituencyId) {
		where.externalIds = { some: { system: 'constituency', value: constituencyId } };
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: [
			{ jurisdiction: 'asc' as const },
			{ district: 'asc' as const },
			{ name: 'asc' as const }
		],
		include: {
			externalIds: {
				where: { system: 'constituency' },
				select: { value: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const reps = await db.decisionMaker.findMany(
		findArgs as Parameters<typeof db.decisionMaker.findMany>[0]
	);

	const hasMore = reps.length > limit;
	const items = reps.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		success: true,
		data: items.map((r: any) => ({
			id: r.id,
			countryCode: r.jurisdiction,
			constituencyId: r.externalIds?.[0]?.value ?? null,
			constituencyName: r.district,
			name: r.name,
			party: r.party,
			title: r.title,
			phone: r.phone,
			email: r.email,
			websiteUrl: r.websiteUrl,
			photoUrl: r.photoUrl,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString()
		})),
		meta: {
			count: items.length,
			cursor: nextCursor,
			hasMore
		}
	});
};
