/**
 * Org webhook management — list, create, update, rotate-secret, delete.
 * Session-auth: editor+ role required (enforced inside Convex mutations).
 */

import { error, fail, type Actions } from '@sveltejs/kit';
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
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
		if (result.error === 'url_too_long') return fail(400, { error: 'URL is too long' });
		if (result.error === 'invalid_url_scheme') return fail(400, { error: 'URL must use HTTPS' });
		if (result.error === 'destination_credentials')
			return fail(400, { error: 'Webhook URLs cannot contain credentials' });
		if (result.error === 'destination_fragment')
			return fail(400, { error: 'Webhook URLs cannot contain fragments' });
		if (result.error === 'destination_private')
			return fail(400, { error: 'Private, local, and reserved destinations are not allowed' });
		if (result.error === 'destination_not_allowed')
			return fail(400, { error: 'This destination is not in the trusted webhook egress policy' });
		if (result.error === 'destination_policy_invalid')
			return fail(503, { error: 'Webhook egress is not configured for this deployment' });
		if (result.error === 'empty_events') return fail(400, { error: 'Select at least one event' });
		if (result.error === 'too_many_events') return fail(400, { error: 'Too many event entries' });
		if (result.error === 'event_too_long') return fail(400, { error: 'An event name is too long' });
		if (result.error === 'unknown_event')
			return fail(400, { error: `Unknown event: ${result.event}` });
		if (result.error === 'description_too_long')
			return fail(400, { error: 'Description is too long' });
		if (result.error === 'subscription_limit')
			return fail(409, { error: 'This organization already has the maximum of 8 webhooks' });
		if (result.error === 'creation_throttled')
			return fail(429, { error: 'Webhook creation is temporarily rate limited' });

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
		if (result.error === 'subscription_limit')
			return fail(409, { error: 'This organization already has 8 enabled webhooks' });
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
