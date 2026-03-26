import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	const result = await serverQuery(api.legislation.getDmDetail, {
		slug: org.slug,
		dmId: params.repId
	});

	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

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
};
