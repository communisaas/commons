import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
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
		Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
		200
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
		throw error(404, message);
	}
};
