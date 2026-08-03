import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';
import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';

export const load: PageServerLoad = async ({ params, locals, setHeaders, url, platform }) => {
	const { slug } = params;
	if (!isValidPublicTemplateSlug(slug)) throw error(404, 'Template not found');

	// Modal detail data includes direct-email targets. Keep this purpose-bound
	// response out of browser and Cloudflare caches.
	setHeaders({ 'Cache-Control': 'private, no-store, max-age=0' });

	const artifact = await getCachedPublicTemplatePageArtifact({ url, platform }, slug);
	const convexTemplate = artifact?.detail ?? null;

	if (!convexTemplate) {
		throw error(404, 'Template not found');
	}

	// Congressional delivery is implemented but not launched while the flag is false.
	if (!FEATURES.CONGRESSIONAL && isCongressionalDelivery(convexTemplate.deliveryMethod)) {
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
			send_count: convexTemplate.send_count,
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
