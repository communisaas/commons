import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	const { slug } = params;

	// Modal detail data includes direct-email targets. Keep this purpose-bound
	// response out of browser and Cloudflare caches.
	setHeaders({ 'Cache-Control': 'private, no-store, max-age=0' });

	const convexTemplate = await serverQuery(api.templates.getBySlugPublic, { slug });

	if (!convexTemplate) {
		throw error(404, 'Template not found');
	}

	// Congressional delivery is implemented but not launched while the flag is false.
	if (!FEATURES.CONGRESSIONAL && convexTemplate.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	return {
		template: {
			id: convexTemplate.id,
			slug: convexTemplate.slug,
			title: convexTemplate.title,
			description: convexTemplate.description,
			domain: convexTemplate.domain,
			topics: convexTemplate.topics ?? [],
			type: convexTemplate.type,
			deliveryMethod: convexTemplate.deliveryMethod,
			subject: convexTemplate.title,
			message_body: convexTemplate.message_body,
			preview: convexTemplate.preview,
			metrics: (convexTemplate as { metrics?: unknown }).metrics,
			delivery_config: convexTemplate.delivery_config,
			// Unlike anonymous list cards, an explicit detail/send route needs this
			// roster to construct the user's mailto action.
			recipient_config: convexTemplate.recipient_config,
			recipientEmails: convexTemplate.recipientEmails ?? [],
			recipient_count: convexTemplate.recipient_count,
			author: convexTemplate.author,
			createdAt: convexTemplate.createdAt
		},
		user: locals.user
			? {
					id: locals.user.id,
					name: locals.user.name
				}
			: null,
		modalMode: true
	};
};
