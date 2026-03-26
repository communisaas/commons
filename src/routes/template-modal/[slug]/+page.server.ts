import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { extractRecipientEmails, extractTemplateMetrics } from '$lib/types/templateConfig';
import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';
import { decryptUserPii } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { slug } = params;

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexTemplate = await serverQuery(api.templates.getBySlugPublic, { slug });

			if (convexTemplate) {
				console.log(`[TemplateModal] Convex: loaded template ${slug}`);

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
			}
		} catch (err) {
			console.error('[TemplateModal] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

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
		recipient_config: template.recipient_config,
		recipientEmails: extractRecipientEmails(template.recipient_config),
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
