// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const result = await serverQuery(api.sms.getBlast, {
		slug: params.slug,
		blastId: params.id as any
	});

	if (!result) throw error(404, 'SMS campaign not found');

	return {
		org: { name: params.slug, slug: params.slug },
		blast: {
			id: result.blast._id,
			body: result.blast.body,
			status: result.blast.status,
			sentCount: result.blast.sentCount,
			deliveredCount: result.blast.deliveredCount,
			failedCount: result.blast.failedCount,
			totalRecipients: result.blast.totalRecipients,
			createdAt: new Date(result.blast._creationTime).toISOString(),
			sentAt: result.blast.sentAt ? new Date(result.blast.sentAt).toISOString() : null
		},
		messages: result.messages.map((m) => ({
			id: m._id,
			recipientName: m.recipientName,
			to: m.to,
			status: m.status,
			errorCode: m.errorCode,
			createdAt: new Date(m._creationTime).toISOString()
		}))
	};
};
