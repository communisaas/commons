/**
 * Org webhook management — list, create, update, rotate-secret, delete.
 * Session-auth: editor+ role required (enforced inside Convex mutations).
 */

import { error, fail, type Actions } from '@sveltejs/kit';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const slug = params.slug!;
		const webhooks = await serverQuery(api.orgWebhooks.sessionListWebhooks, {
			slug
		});
		const recentDeliveriesByWebhook = await Promise.all(
			webhooks.map(async (webhook) => {
				const deliveries = await serverQuery(api.orgWebhooks.sessionListRecentDeliveries, {
					slug,
					webhookId: webhook.id,
					limit: 5
				});
				return deliveries.map((delivery) => ({
					...delivery,
					webhookId: webhook.id,
					webhookUrl: webhook.url
				}));
			})
		);
		const recentDeliveries = recentDeliveriesByWebhook
			.flat()
			.sort((a, b) => deliveryTimestamp(b) - deliveryTimestamp(a))
			.slice(0, 20);
		return { orgSlug: slug, webhooks, recentDeliveries };
	} catch (e) {
		throw error(403, e instanceof Error ? e.message : 'Forbidden');
	}
};

function deliveryTimestamp(delivery: {
	createdAt?: number | null;
	deliveredAt: number | null;
	nextRetryAt: number | null;
}): number {
	return delivery.deliveredAt ?? delivery.nextRetryAt ?? delivery.createdAt ?? 0;
}

export const actions: Actions = {
	create: async ({ request, params }) => {
		const data = await request.formData();
		const url = String(data.get('url') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const eventsRaw = data.getAll('events').map((v) => String(v));
		if (!url) return fail(400, { error: 'URL is required' });
		if (eventsRaw.length === 0) return fail(400, { error: 'Select at least one event' });

		const result = await serverMutation(api.orgWebhooks.sessionCreateWebhook, {
			slug: params.slug!,
			url,
			events: eventsRaw,
			description: description || undefined
		});
		if (result.error === 'invalid_url') return fail(400, { error: 'URL is malformed' });
		if (result.error === 'invalid_url_scheme')
			return fail(400, { error: 'URL must use http or https' });
		if (result.error === 'empty_events')
			return fail(400, { error: 'Select at least one event' });
		if (result.error === 'unknown_event')
			return fail(400, { error: `Unknown event: ${result.event}` });

		// signingSecret returned ONCE — return as flash data so the page can
		// render it for the user to copy. They will never see it again.
		return { created: result.webhook, signingSecret: result.signingSecret };
	},
	update: async ({ request, params }) => {
		const data = await request.formData();
		const webhookId = String(data.get('webhookId') ?? '');
		const enabledRaw = data.get('enabled');
		if (!webhookId) return fail(400, { error: 'webhookId required' });

		const result = await serverMutation(api.orgWebhooks.sessionUpdateWebhook, {
			slug: params.slug!,
			webhookId,
			enabled: enabledRaw === null ? undefined : enabledRaw === 'true'
		});
		if (result.error === 'not_found') return fail(404, { error: 'Webhook not found' });
		return { updated: true };
	},
	rotate: async ({ request, params }) => {
		const data = await request.formData();
		const webhookId = String(data.get('webhookId') ?? '');
		if (!webhookId) return fail(400, { error: 'webhookId required' });

		const result = await serverMutation(api.orgWebhooks.sessionRotateWebhookSecret, {
			slug: params.slug!,
			webhookId
		});
		if (result.error === 'not_found') return fail(404, { error: 'Webhook not found' });
		return { rotated: webhookId, signingSecret: result.signingSecret };
	},
	test: async ({ request, params }) => {
		const data = await request.formData();
		const webhookId = String(data.get('webhookId') ?? '');
		if (!webhookId) return fail(400, { error: 'webhookId required' });

		const result = await serverMutation(api.orgWebhooks.sessionTestWebhook, {
			slug: params.slug!,
			webhookId
		});
		if (result.error === 'not_found') return fail(404, { error: 'Webhook not found' });
		if (result.error === 'disabled')
			return fail(409, { error: 'Enable the endpoint before sending a test delivery' });
		return { tested: result };
	},
	delete: async ({ request, params }) => {
		const data = await request.formData();
		const webhookId = String(data.get('webhookId') ?? '');
		if (!webhookId) return fail(400, { error: 'webhookId required' });

		const ok = await serverMutation(api.orgWebhooks.sessionDeleteWebhook, {
			slug: params.slug!,
			webhookId
		});
		if (!ok) return fail(404, { error: 'Webhook not found' });
		return { deleted: webhookId };
	}
};
