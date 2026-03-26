// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const blasts = await serverQuery(api.sms.listBlasts, { slug: params.slug });

	return {
		org: { name: params.slug, slug: params.slug },
		blasts: blasts.map((b) => ({
			id: b._id,
			body: b.body,
			status: b.status,
			sentCount: b.sentCount,
			deliveredCount: b.deliveredCount,
			failedCount: b.failedCount,
			totalRecipients: b.totalRecipients,
			messageCount: b.messageCount,
			createdAt: new Date(b._creationTime).toISOString(),
			sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null
		}))
	};
};
