/**
 * Position Service — Power Landscape (Cycle 37)
 *
 * Manages position registrations (support/oppose) on templates.
 * Privacy-preserving: keyed on identity_commitment, not user_id.
 * One position per identity per template (unique constraint enforced).
 */

import { prisma } from '$lib/core/db';
import { slugify } from '$lib/utils/landscapeMerge';

/**
 * Register a position (support/oppose) on a template.
 * Upsert semantics: if already registered, returns existing record.
 */
export async function registerPosition(params: {
	templateId: string;
	identityCommitment: string;
	stance: 'support' | 'oppose';
	districtCode?: string;
}): Promise<{ id: string; isNew: boolean }> {
	const { templateId, identityCommitment, stance, districtCode } = params;

	try {
		const registration = await prisma.positionRegistration.create({
			data: {
				template_id: templateId,
				identity_commitment: identityCommitment,
				stance,
				district_code: districtCode ?? null
			}
		});

		return { id: registration.id, isNew: true };
	} catch (err: unknown) {
		// Unique constraint violation — already registered
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === 'P2002'
		) {
			const existing = await prisma.positionRegistration.findUnique({
				where: {
					template_id_identity_commitment: {
						template_id: templateId,
						identity_commitment: identityCommitment
					}
				}
			});

			if (existing) {
				return { id: existing.id, isNew: false };
			}
		}

		throw err;
	}
}

/**
 * Get aggregate position counts for a template.
 * Public endpoint — returns only aggregate counts, no PII.
 */
export async function getPositionCounts(templateId: string): Promise<{
	support: number;
	oppose: number;
	districts: number;
}> {
	const [support, oppose, districts] = await Promise.all([
		prisma.positionRegistration.count({
			where: { template_id: templateId, stance: 'support' }
		}),
		prisma.positionRegistration.count({
			where: { template_id: templateId, stance: 'oppose' }
		}),
		prisma.positionRegistration
			.groupBy({
				by: ['district_code'],
				where: {
					template_id: templateId,
					district_code: { not: null }
				}
			})
			.then((groups) => groups.length)
	]);

	return { support, oppose, districts };
}

/**
 * Get position engagement grouped by district for a template.
 * Privacy threshold: districts with < 3 positions are excluded.
 * Returns districts sorted by total engagement descending.
 */
export async function getEngagementByDistrict(
	templateId: string,
	userDistrictCode?: string | null
): Promise<{
	template_id: string;
	districts: Array<{
		district_code: string;
		support: number;
		oppose: number;
		total: number;
		support_percent: number;
		is_user_district: boolean;
	}>;
	aggregate: {
		total_districts: number;
		total_positions: number;
		total_support: number;
		total_oppose: number;
	};
} | null> {
	const PRIVACY_THRESHOLD = 3;

	const groups = await prisma.positionRegistration.groupBy({
		by: ['district_code', 'stance'],
		where: {
			template_id: templateId,
			district_code: { not: null }
		},
		_count: { id: true }
	});

	if (groups.length === 0) return null;

	// Aggregate by district
	const byDistrict = new Map<string, { support: number; oppose: number }>();
	for (const g of groups) {
		const code = g.district_code!;
		const entry = byDistrict.get(code) ?? { support: 0, oppose: 0 };
		if (g.stance === 'support') entry.support = g._count.id;
		else entry.oppose = g._count.id;
		byDistrict.set(code, entry);
	}

	// Apply privacy threshold and build district list
	const districts: Array<{
		district_code: string;
		support: number;
		oppose: number;
		total: number;
		support_percent: number;
		is_user_district: boolean;
	}> = [];

	let totalPositions = 0;
	let totalSupport = 0;
	let totalOppose = 0;

	for (const [code, counts] of byDistrict) {
		const total = counts.support + counts.oppose;
		totalPositions += total;
		totalSupport += counts.support;
		totalOppose += counts.oppose;

		if (total >= PRIVACY_THRESHOLD) {
			districts.push({
				district_code: code,
				support: counts.support,
				oppose: counts.oppose,
				total,
				support_percent: total > 0 ? Math.round((counts.support / total) * 100) : 0,
				is_user_district: code === userDistrictCode
			});
		}
	}

	// Sort by total descending
	districts.sort((a, b) => b.total - a.total);

	if (districts.length === 0 && totalPositions === 0) return null;

	return {
		template_id: templateId,
		districts,
		aggregate: {
			total_districts: byDistrict.size,
			total_positions: totalPositions,
			total_support: totalSupport,
			total_oppose: totalOppose
		}
	};
}

/**
 * Confirm a mailto send — upserts position + creates delivery record.
 * Called when user clicks "Yes, sent" after mailto launch.
 *
 * - Ensures a PositionRegistration exists (stance: 'support' if new — sending is implicit support)
 * - Creates a PositionDelivery with delivery_method: 'mailto_confirmed'
 * - Feeds community field counters via the PositionRegistration
 */
export async function confirmMailtoSend(params: {
	templateId: string;
	identityCommitment: string;
	districtCode?: string;
	templateTitle?: string;
}): Promise<{ registrationId: string; isNewPosition: boolean }> {
	const { templateId, identityCommitment, districtCode, templateTitle } = params;

	// Upsert position — sending is implicit support
	const registration = await registerPosition({
		templateId,
		identityCommitment,
		stance: 'support',
		districtCode
	});

	// Create delivery record — tracks the confirmed mailto send
	await prisma.positionDelivery.create({
		data: {
			registration_id: registration.id,
			recipient_name: templateTitle ?? 'mailto recipient',
			delivery_method: 'mailto_confirmed',
			delivery_status: 'user_confirmed',
			delivered_at: new Date()
		}
	});

	return { registrationId: registration.id, isNewPosition: registration.isNew };
}

/**
 * Batch-create delivery records for a position registration.
 * Called after the citizen confirms which recipients to address.
 */
export async function batchRegisterDeliveries(params: {
	registrationId: string;
	recipients: Array<{
		name: string;
		email?: string;
		deliveryMethod: 'cwc' | 'email' | 'recorded';
	}>;
}): Promise<{ created: number }> {
	const { registrationId, recipients } = params;

	const result = await prisma.positionDelivery.createMany({
		data: recipients.map((r) => ({
			registration_id: registrationId,
			recipient_name: r.name,
			recipient_key: slugify(r.name),
			recipient_email: r.email ?? null,
			delivery_method: r.deliveryMethod,
			delivery_status: 'pending'
		}))
	});

	return { created: result.count };
}
