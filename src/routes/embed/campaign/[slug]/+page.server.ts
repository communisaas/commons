// CONVEX: Form action migrated to Convex submitAction. Load uses Convex queries.
import { error, fail } from '@sveltejs/kit';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
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
		const rlKey = `ratelimit:embed:${params.slug}:${ip}`;
		const rl = await getRateLimiter().check(rlKey, { maxRequests: 10, windowMs: 60_000 });
		if (!rl.allowed) {
			return fail(429, { error: 'Too many submissions. Please try again later.' });
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const name = formData.get('name')?.toString().trim();
		const postalCode = formData.get('postalCode')?.toString().trim() || null;
		const phone = formData.get('phone')?.toString().trim() || null;
		const message = formData.get('message')?.toString().trim() || null;
		const h3Cell = formData.get('h3Cell')?.toString().trim() || null;

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
			return fail(400, { error: 'Invalid email address' });
		}

		// Determine composition mode by comparing message to campaign template
		let compositionMode: 'individual' | 'shared' | 'edited' | undefined;
		if (message) {
			try {
				const campaign = await serverQuery(api.campaigns.getPublicAny, { campaignId: params.slug });
				if (campaign?.body) {
					const normalizeWs = (s: string) => s.trim().replace(/\s+/g, ' ');
					compositionMode = normalizeWs(message) === normalizeWs(campaign.body) ? 'shared' : 'edited';
				} else {
					compositionMode = 'individual';
				}
			} catch {
				// Non-fatal
			}
		}

		try {
			const result = await serverAction(api.campaigns.submitAction, {
				campaignId: params.slug,
				email,
				name,
				postalCode: postalCode ?? undefined,
				phone: phone ?? undefined,
				message: message ?? undefined,
				h3Cell: h3Cell ?? undefined,
				source: 'widget',
				compositionMode
			});

			return {
				success: result.success,
				actionCount: result.actionCount,
				alreadySubmitted: result.alreadySubmitted
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Submission failed';
			if (msg.includes('not found')) {
				return fail(404, { error: 'Campaign not found or inactive' });
			}
			return fail(500, { error: msg });
		}
	}
};
