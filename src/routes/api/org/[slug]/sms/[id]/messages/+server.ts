// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * GET /api/org/[slug]/sms/[id]/messages — List messages for a blast
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

	const messages = await serverQuery(api.sms.getBlastMessages, {
		slug: params.slug,
		blastId: params.id as any,
		limit
	});

	return json({
		data: messages.map((m) => ({
			id: m._id,
			to: m.to ? '***' + m.to.slice(-4) : null,
			status: m.status,
			errorCode: m.errorCode,
			supporter: m.recipientName
				? { name: m.recipientName }
				: null,
			createdAt: new Date(m._creationTime).toISOString()
		})),
		meta: { hasMore: false }
	});
};
