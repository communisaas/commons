/**
 * GET /api/v1/donations/[id] — Single donation detail
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { maskEmail } from '$lib/server/org/mask';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.FUNDRAISING) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const donation = await db.donation.findFirst({
		where: { id: params.id, orgId: auth.orgId }
	});

	if (!donation) return apiError('NOT_FOUND', 'Donation not found', 404);

	return apiOk({
		id: donation.id,
		campaignId: donation.campaignId,
		email: maskEmail(donation.email),
		name: donation.name,
		amountCents: donation.amountCents,
		currency: donation.currency,
		recurring: donation.recurring,
		recurringInterval: donation.recurringInterval,
		status: donation.status,
		engagementTier: donation.engagementTier,
		districtHash: donation.districtHash,
		completedAt: donation.completedAt?.toISOString() ?? null,
		createdAt: donation.createdAt.toISOString()
	});
};
