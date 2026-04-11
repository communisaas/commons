/**
 * GET /api/v1/donations/[id] — Single donation detail
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!domain) return '***';
	return `${local.charAt(0)}***@${domain}`;
}

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.FUNDRAISING) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const donation = await serverQuery(internal.v1api.getDonationById, { donationId: params.id, orgId: auth.orgId });
	if (!donation) return apiError('NOT_FOUND', 'Donation not found', 404);

	return apiOk({
		id: donation._id,
		campaignId: donation.campaignId,
		email: donation.email ? maskEmail(donation.email) : '[encrypted]',
		name: donation.name ?? '[encrypted]',
		amountCents: donation.amountCents,
		currency: donation.currency,
		recurring: donation.recurring,
		recurringInterval: donation.recurringInterval,
		status: donation.status,
		engagementTier: donation.engagementTier,
		districtHash: donation.districtHash,
		completedAt: donation.completedAt ? new Date(donation.completedAt).toISOString() : null,
		createdAt: new Date(donation._creationTime).toISOString()
	});
};
