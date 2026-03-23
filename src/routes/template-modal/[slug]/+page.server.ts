import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { extractTemplateMetrics } from '$lib/types/templateConfig';
import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';
import { decryptUserPii } from '$lib/core/crypto/user-pii-encryption';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { slug } = params;

	// Look up template by slug
	const template = await db.template.findUnique({
		where: {
			slug,
			is_public: true // Only show public templates via deep links
		},
		include: {
			user: {
				select: {
					id: true,
					encrypted_name: true,
					encrypted_email: true,
					avatar: true
				}
			}
		}
	});

	if (!template) {
		throw error(404, 'Template not found');
	}

	// Gate CWC templates behind CONGRESSIONAL feature flag
	if (!FEATURES.CONGRESSIONAL && template.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	// View tracking handled client-side via DP analytics pipeline (trackTemplateView)

	// Allow unauthenticated access via QR code / direct link
	// Users can send via mailto FIRST, then we prompt account creation
	// This removes friction for viral template sharing

	// Format template for client
	const formattedTemplate = {
		id: template.id,
		slug: template.slug,
		title: template.title,
		description: template.description,
		category: template.category,
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		subject: template.title,
		message_body: template.message_body,
		preview: template.preview,
		metrics: extractTemplateMetrics(template.metrics),
		delivery_config: template.delivery_config,
		recipient_config: null,
		recipientEmails: [],
		author: template.user
			? await (async () => {
					const u = template.user!;
					const pii = await decryptUserPii(u).catch(() => ({ email: '', name: null }));
					return { name: pii.name, avatar: u.avatar };
				})()
			: null,
		createdAt: template.createdAt.toISOString()
	};

	return {
		template: formattedTemplate,
		user: locals.user ? {
			id: locals.user.id,
			name: locals.user.name
		} : null,
		modalMode: true
	};
};
