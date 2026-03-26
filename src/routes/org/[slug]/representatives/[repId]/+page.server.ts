import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { FEATURES } from '$lib/config/features';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.getDmDetail, {
				slug: org.slug,
				dmId: params.repId
			});

			if (!result) {
				throw error(404, 'Decision-maker not found');
			}

			console.log(`[RepDetail] Convex: loaded DM ${result.decisionMaker.name} for ${org.slug}`);

			const toIso = (v: unknown) =>
				typeof v === 'number' ? new Date(v as number).toISOString() : v ? String(v) : null;

			return {
				decisionMaker: {
					...(result.decisionMaker as Record<string, unknown>),
					id: result.decisionMaker._id,
					termStart: toIso(result.decisionMaker.termStart),
					termEnd: toIso(result.decisionMaker.termEnd)
				},
				follow: result.follow
					? {
							id: result.follow._id,
							reason: result.follow.reason,
							alertsEnabled: result.follow.alertsEnabled,
							note: result.follow.note,
							followedAt: toIso(result.follow.followedAt)
						}
					: null,
				actions: result.actions.map((a: Record<string, unknown>) => ({
					id: a._id,
					action: a.action,
					detail: a.detail,
					sourceUrl: a.sourceUrl,
					occurredAt: toIso(a.occurredAt),
					bill: a.bill
						? { ...(a.bill as Record<string, unknown>), id: (a.bill as Record<string, unknown>)._id }
						: null
				})),
				receipts: result.receipts.map((r: Record<string, unknown>) => ({
					id: r._id,
					proofWeight: r.proofWeight,
					dmAction: r.dmAction,
					alignment: r.alignment,
					causalityClass: r.causalityClass,
					status: r.status,
					proofDeliveredAt: toIso(r.proofDeliveredAt),
					bill: r.bill
						? { ...(r.bill as Record<string, unknown>), id: (r.bill as Record<string, unknown>)._id }
						: null
				})),
				accountability: result.accountability
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err; // re-throw SvelteKit errors
			console.error('[RepDetail] Convex failed, falling back to Prisma:', err);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const dm = await db.decisionMaker.findUnique({
		where: { id: params.repId }
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	// Load follow status, recent actions, and receipts in parallel
	const [follow, actions, receipts] = await Promise.all([
		db.orgDMFollow.findUnique({
			where: {
				orgId_decisionMakerId: {
					orgId: org.id,
					decisionMakerId: dm.id
				}
			},
			select: {
				id: true,
				reason: true,
				alertsEnabled: true,
				note: true,
				followedAt: true
			}
		}),
		db.legislativeAction.findMany({
			where: {
				decisionMakerId: dm.id,
				bill: { relevances: { some: { orgId: org.id } } }
			},
			orderBy: { occurredAt: 'desc' },
			take: 20,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				}
			}
		}),
		db.accountabilityReceipt.findMany({
			where: {
				decisionMakerId: dm.id,
				orgId: org.id
			},
			orderBy: { proofDeliveredAt: 'desc' },
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				}
			}
		})
	]);

	// Compute accountability summary
	const receiptCount = receipts.length;
	const avgProofWeight = receiptCount > 0
		? receipts.reduce((sum, r) => sum + r.proofWeight, 0) / receiptCount
		: 0;
	const alignedCount = receipts.filter((r) => r.alignment > 0).length;
	const opposedCount = receipts.filter((r) => r.alignment < 0).length;

	return {
		decisionMaker: {
			id: dm.id,
			type: dm.type,
			title: dm.title,
			name: dm.name,
			firstName: dm.firstName,
			lastName: dm.lastName,
			party: dm.party,
			jurisdiction: dm.jurisdiction,
			jurisdictionLevel: dm.jurisdictionLevel,
			district: dm.district,
			phone: dm.phone,
			email: dm.email,
			websiteUrl: dm.websiteUrl,
			officeAddress: dm.officeAddress,
			photoUrl: dm.photoUrl,
			active: dm.active,
			termStart: dm.termStart?.toISOString() ?? null,
			termEnd: dm.termEnd?.toISOString() ?? null
		},
		follow: follow
			? {
					id: follow.id,
					reason: follow.reason,
					alertsEnabled: follow.alertsEnabled,
					note: follow.note,
					followedAt: follow.followedAt.toISOString()
				}
			: null,
		actions: actions.map((a) => ({
			id: a.id,
			action: a.action,
			detail: a.detail,
			sourceUrl: a.sourceUrl,
			occurredAt: a.occurredAt.toISOString(),
			bill: a.bill
		})),
		receipts: receipts.map((r) => ({
			id: r.id,
			proofWeight: r.proofWeight,
			dmAction: r.dmAction,
			alignment: r.alignment,
			causalityClass: r.causalityClass,
			status: r.status,
			proofDeliveredAt: r.proofDeliveredAt.toISOString(),
			bill: r.bill
		})),
		accountability: {
			receiptCount,
			avgProofWeight: Math.round(avgProofWeight * 100) / 100,
			alignedCount,
			opposedCount
		}
	};
};
