import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { slug } = params;

	const convexTemplate = await serverQuery(api.templates.getBySlugPublic, { slug });

	if (!convexTemplate) {
		throw error(404, 'Template not found');
	}

	// Gate CWC templates behind CONGRESSIONAL feature flag
	if (!FEATURES.CONGRESSIONAL && convexTemplate.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	return {
		template: {
			id: convexTemplate.id,
			slug: convexTemplate.slug,
			title: convexTemplate.title,
			description: convexTemplate.description,
			category: convexTemplate.category,
			type: convexTemplate.type,
			deliveryMethod: convexTemplate.deliveryMethod,
			subject: convexTemplate.title,
			message_body: convexTemplate.message_body,
			preview: convexTemplate.preview,
			metrics: convexTemplate.metrics,
			delivery_config: convexTemplate.delivery_config,
			recipient_config: convexTemplate.recipient_config,
			recipientEmails: convexTemplate.recipientEmails ?? [],
			author: convexTemplate.author,
			createdAt: convexTemplate.createdAt
		},
		user: locals.user ? {
			id: locals.user.id,
			name: locals.user.name
		} : null,
		modalMode: true
	};
};
