import { json, error } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/campaigns/[campaignId]/receipts
 *
 * Per-campaign accountability receipt listing. Org-member auth (Convex
 * mutation enforces). No PII; attestation digests included.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
		50
	);

	try {
		const result = await serverQuery(api.legislation.listReceiptsByCampaign, {
			slug: params.slug!,
			campaignId: params.campaignId as Id<'campaigns'>,
			cursor: cursor || undefined,
			limit
		});
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to load receipts';
		if (message.includes('ACCOUNTABILITY_READ_MODEL_NOT_READY')) throw error(503, message);
		throw error(404, message);
	}
};
