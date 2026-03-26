// CONVEX: Form action migrated to Convex submitAction. Load uses Convex queries.
import { error, fail } from '@sveltejs/kit';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad, Actions } from './$types';

import { serverQuery, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params }) => {
	const campaign = await serverQuery(api.campaigns.getPublicAny, { campaignId: params.slug });
	if (!campaign || campaign.status !== 'ACTIVE') {
		throw error(404, 'Campaign not found or inactive');
	}

	return {
		campaign: {
			id: campaign._id,
			title: campaign.title,
			body: campaign.body ?? null,
			type: campaign.type,
			orgName: campaign.orgName ?? '',
			orgSlug: campaign.orgSlug ?? '',
			verifiedActions: campaign.verifiedActionCount ?? 0
		}
	};
};

export const actions: Actions = {
	default: async ({ request, params, getClientAddress }) => {
		// Rate limit: 10 submissions per minute per IP per campaign
		const ip = getClientAddress();
		const rlKey = `ratelimit:campaign:${params.slug}:${ip}`;
		const rl = await getRateLimiter().check(rlKey, { maxRequests: 10, windowMs: 60_000 });
		if (!rl.allowed) {
			return fail(429, { error: 'Too many submissions. Please try again later.' });
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const name = formData.get('name')?.toString().trim();
		const postalCode = formData.get('postalCode')?.toString().trim() || null;
		const message = formData.get('message')?.toString().trim() || null;
		const rawDistrictCode = formData.get('districtCode')?.toString().trim() || null;

		if (message && message.length > 5000) {
			return fail(400, { error: 'Message too long (5000 character maximum)' });
		}

		if (!email) {
			return fail(400, { error: 'Email is required' });
		}

		if (!name) {
			return fail(400, { error: 'Name is required' });
		}

		// Basic email validation
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'Please enter a valid email address' });
		}

		try {
			const result = await serverAction(api.campaigns.submitAction, {
				campaignId: params.slug,
				email,
				name,
				postalCode: postalCode ?? undefined,
				message: message ?? undefined,
				districtCode: rawDistrictCode && FEATURES.ADDRESS_SPECIFICITY === 'district' ? rawDistrictCode : undefined,
				source: 'campaign'
			});

			return {
				success: result.success,
				actionCount: result.actionCount,
				totalCount: result.totalCount,
				supporterName: result.supporterName,
				verified: result.verified,
				alreadySubmitted: result.alreadySubmitted
			};
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Submission failed';
			if (message.includes('not found')) {
				return fail(404, { error: 'Campaign not found or inactive' });
			}
			if (message.includes('limit')) {
				return fail(403, { error: message });
			}
			return fail(500, { error: message });
		}
	}
};
