/**
 * Canonical org-webhook event catalog — the single source of truth.
 *
 * Every advertised event MUST be emitted by a real `queueEvent` call site, and
 * every `queueEvent` literal MUST appear here. The session validator
 * (`orgWebhooks.ts`), the API-key validator (`v1api.ts`), the public OpenAPI
 * contract, the SignalWell display, and the settings subscribe UI all derive
 * from this list. `webhook.test` is deliberately NOT a catalog event — it is the
 * synthetic test delivery (`enqueueTestDelivery`), not a subscribable event.
 *
 * Drift is guarded by `tests/unit/convex/webhook-event-parity.test.ts`, which
 * asserts this set equals the set of `queueEvent` literals across `convex/`.
 */
export const WEBHOOK_EVENTS = [
	'campaign_action.created',
	'campaign.updated',
	'supporter.created',
	'supporter.updated',
	'supporter.deleted',
	'donation.completed',
	'donation.refunded',
	'event.rsvp_created'
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);
