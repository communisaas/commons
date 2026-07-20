/**
 * Outbound webhooks (T9-3, Cluster 3 Composability substrate).
 *
 * Event-emission substrate. Mutations across campaigns/supporters/donations/events
 * call internal `queueEvent` which (a) appends to orgEvents (the lightweight
 * notification table shared with T9-7 SSE subscriptions) and (b) fans out to
 * orgWebhooks subscribers, creating orgWebhookDeliveries rows and scheduling
 * the actual HTTP POST via Convex scheduler.
 *
 * Dispatch action `deliverWebhook` does HMAC-SHA256 signing with dual-secret
 * rotation (signingSecret + signingSecretPrevious) and posts to the org's
 * registered URL. Failures set nextRetryAt = now + 2^attempt * 60s for the
 * retry cron (T9-3.3) to pick up. After 5 attempts, isDead=true and the
 * parent webhook auto-disables.
 *
 * Payload shape: { event, timestamp, orgId, data: <event-specific JSON> }
 * Signature header: X-Commons-Signature-256: t={timestamp},v1={hex_hmac}
 * Receivers verify HMAC over `${timestamp}.${payload}` within a ±5 min replay
 * window. Dual-rotation lets receivers accept either secret during a key
 * rotation window without breaking.
 *
 * Per CP-1 unblocks: orgEvents shared with T9-7 SSE substrate; the same row
 * supplies both push delivery (this file) and pull delivery (SSE polling).
 */

import { v } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
import { internal } from './_generated/api';
import { requireOrgRole } from './_authHelpers';
import type { Id } from './_generated/dataModel';
import { WEBHOOK_EVENT_SET } from './_webhookEvents';
import {
	WEBHOOK_ERROR_MAX_BYTES,
	WEBHOOK_SUBSCRIPTION_MAX,
	cleanupWebhookDeliveryPage,
	createOrgWebhook,
	deleteOwnedOrgWebhook,
	getOwnedOrgWebhook,
	normalizeWebhookDestination,
	normalizeWebhookPayload,
	publicWebhook,
	recordWebhookOverflow,
	repairOrgWebhookOverflowPage,
	rotateOwnedOrgWebhookSecret,
	truncateWebhookString,
	updateOwnedOrgWebhook,
	validateWebhookDeliveryEnvelope
} from './lib/orgWebhookPolicy';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000; // 1 minute; backoff is 2^attempt * RETRY_BASE_MS
const WEBHOOK_TEST_EVENT = 'webhook.test';

type WebhookTestDeliveryResult =
	| {
			error: null;
			deliveryId: Id<'orgWebhookDeliveries'>;
			event: typeof WEBHOOK_TEST_EVENT;
			queuedAt: number;
	  }
	| { error: 'not_found' | 'disabled' };

/**
 * Sign a payload with HMAC-SHA256. Pattern matches the Stripe webhook scheme:
 * the receiver computes `HMAC-SHA256(timestamp + "." + payload)` and compares
 * to the signature value. Dual-rotation: caller must check both signingSecret
 * and signingSecretPrevious during a rotation window.
 *
 * Convex V8 runtime doesn't expose `node:crypto`. Use Web Crypto subtle.
 */
async function signPayload(payload: string, timestamp: number, secret: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
	// Hex-encode for the X-Commons-Signature-256 header
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Emit an event for an org. Called inline from mutations across campaigns,
 * supporters, donations, events (T9-3.4 event emission at call sites).
 *
 * Writes one bounded orgEvents row and at most WEBHOOK_SUBSCRIPTION_MAX
 * delivery rows. Each delivery
 * gets a scheduler.runAfter(0, ...) call so the actual HTTP send happens out
 * of the transaction (mutations can't do fetch).
 *
 * A legacy cap violation never expands fan-out. We read only MAX+1, deliver
 * to the first canonical MAX, persist one coalesced evidence row, and schedule
 * a one-subscription repair step.
 */
export const queueEvent = internalMutation({
	args: {
		orgId: v.id('organizations'),
		event: v.string(),
		payload: v.string() // JSON-serialized event payload
	},
	handler: async (ctx, { orgId, event, payload }) => {
		if (!WEBHOOK_EVENT_SET.has(event)) {
			return { queued: 0, overflow: false, dropped: 'invalid_event' as const };
		}
		const normalized = normalizeWebhookPayload(event, payload);
		if (!normalized.ok) {
			return { queued: 0, overflow: false, dropped: normalized.error };
		}
		const now = Date.now();

		// Always write to orgEvents for SSE polling consumers (T9-7)
		await ctx.db.insert('orgEvents', {
			orgId,
			event: normalized.event,
			payload: normalized.payload,
			emittedAt: now
		});

		const observed = await ctx.db
			.query('orgWebhooks')
			.withIndex('by_orgId_enabled', (q) => q.eq('orgId', orgId).eq('enabled', true))
			.take(WEBHOOK_SUBSCRIPTION_MAX + 1);
		const overflow = observed.length > WEBHOOK_SUBSCRIPTION_MAX;
		if (overflow) await recordWebhookOverflow(ctx, orgId, observed.length);
		const subscribers = observed.slice(0, WEBHOOK_SUBSCRIPTION_MAX);

		let queued = 0;
		for (const sub of subscribers) {
			if (!sub.events.includes(normalized.event)) continue;

			const deliveryId = await ctx.db.insert('orgWebhookDeliveries', {
				webhookId: sub._id,
				orgId,
				event: normalized.event,
				payload: normalized.payload,
				attempt: 1,
				isDead: false
			});
			queued += 1;

			// Schedule the actual HTTP send out of the mutation transaction
			await ctx.scheduler.runAfter(0, internal.orgWebhooks.deliverWebhook, {
				deliveryId
			});
		}
		return { queued, overflow, dropped: null };
	}
});

/**
 * Enqueue a targeted signed test delivery for one endpoint. This deliberately
 * bypasses subscription matching: operators need to verify the endpoint,
 * signing secret, and retry log without creating a real supporter/campaign
 * side effect or fanning out to every subscriber.
 */
export const enqueueTestDelivery = internalMutation({
	args: {
		orgId: v.id('organizations'),
		webhookId: v.id('orgWebhooks'),
		trigger: v.union(v.literal('session'), v.literal('api'))
	},
	handler: async (ctx, { orgId, webhookId, trigger }): Promise<WebhookTestDeliveryResult> => {
		const webhook = await ctx.db.get(webhookId);
		if (!webhook || webhook.orgId !== orgId) {
			return { error: 'not_found' as const };
		}
		if (!webhook.enabled) {
			return { error: 'disabled' as const };
		}

		const now = Date.now();
		const payload = JSON.stringify({
			event: WEBHOOK_TEST_EVENT,
			timestamp: now,
			orgId,
			data: {
				webhookId,
				trigger,
				note: 'Synthetic Commons webhook test delivery. No supporter, campaign, donation, or event record was changed.'
			}
		});

		await ctx.db.insert('orgEvents', {
			orgId,
			event: WEBHOOK_TEST_EVENT,
			payload,
			emittedAt: now
		});

		const deliveryId = await ctx.db.insert('orgWebhookDeliveries', {
			webhookId,
			orgId,
			event: WEBHOOK_TEST_EVENT,
			payload,
			attempt: 1,
			isDead: false
		});

		await ctx.scheduler.runAfter(0, internal.orgWebhooks.deliverWebhook, {
			deliveryId
		});

		return {
			error: null,
			deliveryId,
			event: WEBHOOK_TEST_EVENT,
			queuedAt: now
		};
	}
});

/**
 * Deliver a webhook payload. Runs as an action (needs fetch). Signs with the
 * parent webhook's current signingSecret; receivers MAY accept either secret
 * during a rotation window (the receiver-side verification logic is out of
 * scope here — we always sign with the active secret).
 *
 * Failure modes:
 * - 2xx response: mark deliveredAt, lastDeliveredAt on parent, reset failureCount
 * - 4xx response: treat as permanent failure (caller's config error). Mark
 *   isDead=true immediately; no retry. Increment parent failureCount.
 * - 5xx / network error: retry with backoff up to MAX_ATTEMPTS, then isDead
 *
 * After MAX_ATTEMPTS failures the parent webhook is auto-disabled so we stop
 * burning attempts on a permanently broken endpoint.
 */
export const deliverWebhook = internalAction({
	args: { deliveryId: v.id('orgWebhookDeliveries') },
	handler: async (ctx, { deliveryId }) => {
		const delivery = await ctx.runQuery(internal.orgWebhooks._getDelivery, {
			deliveryId
		});
		if (!delivery || delivery.isDead || delivery.deliveredAt) return;

		const webhook = await ctx.runQuery(internal.orgWebhooks._getWebhook, {
			webhookId: delivery.webhookId
		});
		if (!webhook || !webhook.enabled) {
			// Parent disabled mid-flight; mark dead without burning an attempt
			await ctx.runMutation(internal.orgWebhooks.markDeliveryDead, {
				deliveryId,
				errorMessage: 'parent webhook disabled before delivery'
			});
			return;
		}
		const destination = normalizeWebhookDestination(webhook.url);
		if (!destination.ok) {
			await ctx.runMutation(internal.orgWebhooks.markDeliveryDead, {
				deliveryId,
				errorMessage: `destination rejected before delivery: ${destination.error}`
			});
			return;
		}
		const envelope = validateWebhookDeliveryEnvelope({
			event: delivery.event,
			payload: delivery.payload,
			deliveryId,
			attempt: delivery.attempt,
			signingSecret: webhook.signingSecret
		});
		if (!envelope.ok) {
			await ctx.runMutation(internal.orgWebhooks.markDeliveryDead, {
				deliveryId,
				errorMessage: `delivery envelope rejected: ${envelope.error}`
			});
			return;
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const signature = await signPayload(delivery.payload, timestamp, webhook.signingSecret);

		let statusCode: number | undefined;
		let errorMessage: string | undefined;

		try {
			const res = await fetch(destination.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'Commons-Webhook/1.0',
					'X-Commons-Signature-256': `t=${timestamp},v1=${signature}`,
					'X-Commons-Event': delivery.event,
					'X-Commons-Delivery': deliveryId,
					'X-Commons-Attempt': String(delivery.attempt)
				},
				body: delivery.payload,
				// A trusted endpoint cannot redirect the worker toward an untrusted
				// or private destination after validation.
				redirect: 'manual',
				// Receivers should respond within 10s; we abort after to free worker
				signal: AbortSignal.timeout(10_000)
			});
			statusCode = res.status;
			if (res.status >= 200 && res.status < 300) {
				await ctx.runMutation(internal.orgWebhooks.markDeliverySuccess, {
					deliveryId,
					statusCode
				});
				return;
			}
			errorMessage = `HTTP ${res.status}`;
		} catch (e: unknown) {
			errorMessage = truncateWebhookString(
				e instanceof Error ? e.message : 'fetch failed',
				WEBHOOK_ERROR_MAX_BYTES
			);
		}

		// Redirects and 4xx are permanent configuration failures. 5xx/network
		// failures retry within the fixed attempt ceiling.
		const isPermanentResponse = statusCode !== undefined && statusCode >= 300 && statusCode < 500;
		if (isPermanentResponse || delivery.attempt >= MAX_ATTEMPTS) {
			await ctx.runMutation(internal.orgWebhooks.markDeliveryDead, {
				deliveryId,
				statusCode,
				errorMessage
			});
			return;
		}

		// Backoff: 2^attempt * RETRY_BASE_MS. attempt=1→2min, 2→4min, 3→8min, 4→16min
		const nextRetryAt = Date.now() + Math.pow(2, delivery.attempt) * RETRY_BASE_MS;
		await ctx.runMutation(internal.orgWebhooks.markDeliveryRetryable, {
			deliveryId,
			statusCode,
			errorMessage,
			nextRetryAt
		});
	}
});

// ---- internal helpers (queries + mutations used by deliverWebhook) ----

export const _getDelivery = internalQuery({
	args: { deliveryId: v.id('orgWebhookDeliveries') },
	handler: async (ctx, { deliveryId }) => {
		return await ctx.db.get(deliveryId);
	}
});

export const _getWebhook = internalQuery({
	args: { webhookId: v.id('orgWebhooks') },
	handler: async (ctx, { webhookId }) => {
		return await ctx.db.get(webhookId);
	}
});

// ---- cron-driven housekeeping (T9-3.3 retry policy + dead-letter cron) ----

/**
 * Retry deliveries whose nextRetryAt is past. Runs every 1 minute via cron.
 * Each tick scans by_nextRetryAt index for rows where nextRetryAt <= now,
 * picks up to RETRY_BATCH (capped to avoid action timeout), and fires
 * deliverWebhook for each. The deliver action handles the actual send and
 * marks success/dead/retryable. We don't increment attempt here — that
 * happens inside markDeliveryRetryable when the next attempt also fails.
 */
const RETRY_BATCH = 50;

export const retryPendingDeliveries = internalAction({
	args: {},
	handler: async (ctx) => {
		const due = await ctx.runQuery(internal.orgWebhooks._listDueRetries, {
			now: Date.now()
		});
		for (const d of due.slice(0, RETRY_BATCH)) {
			await ctx.scheduler.runAfter(0, internal.orgWebhooks.deliverWebhook, {
				deliveryId: d._id
			});
		}
	}
});

export const _listDueRetries = internalQuery({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const candidates = await ctx.db
			.query('orgWebhookDeliveries')
			.withIndex('by_nextRetryAt', (q) => q.lte('nextRetryAt', now))
			.take(RETRY_BATCH * 2);
		return candidates.filter((row) => !row.isDead && row.deliveredAt === undefined);
	}
});

/**
 * Delete one indexed page of orgEvents older than 7 days. Every continuation
 * carries the original cutoff, so cleanup terminates instead of chasing new
 * writes.
 */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_CLEANUP_BATCH = 500;

export const expireOldEvents = internalMutation({
	args: { cutoff: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const cutoff = args.cutoff ?? Date.now() - EVENT_RETENTION_MS;
		const observed = await ctx.db
			.query('orgEvents')
			.withIndex('by_emittedAt', (q) => q.lt('emittedAt', cutoff))
			.take(HISTORY_CLEANUP_BATCH + 1);
		const page = observed.slice(0, HISTORY_CLEANUP_BATCH);
		await Promise.all(page.map((row) => ctx.db.delete(row._id)));
		const hasMore = observed.length > HISTORY_CLEANUP_BATCH;
		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.orgWebhooks.expireOldEvents, { cutoff });
		}
		return { deleted: page.length, hasMore };
	}
});

/** Delivery payload/error history is retained for 30 days and drained in pages. */
export const expireOldDeliveryHistory = internalMutation({
	args: { cutoff: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const cutoff = args.cutoff ?? Date.now() - DELIVERY_RETENTION_MS;
		// Default table order is the system creation-time index. Reading the
		// oldest fixed page gives a cardinality bound without a filter scan.
		const observed = await ctx.db
			.query('orgWebhookDeliveries')
			.order('asc')
			.take(HISTORY_CLEANUP_BATCH + 1);
		const stale = observed.filter((row) => row._creationTime < cutoff);
		const page = stale.slice(0, HISTORY_CLEANUP_BATCH);
		await Promise.all(page.map((row) => ctx.db.delete(row._id)));
		const hasMore = stale.length > HISTORY_CLEANUP_BATCH;
		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.orgWebhooks.expireOldDeliveryHistory, {
				cutoff
			});
		}
		return { deleted: page.length, hasMore };
	}
});

export const cleanupDeletedWebhookDeliveries = internalMutation({
	args: { webhookId: v.id('orgWebhooks') },
	handler: async (ctx, { webhookId }) => await cleanupWebhookDeliveryPage(ctx, webhookId)
});

export const repairLegacySubscriptionOverflow = internalMutation({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, { orgId }) => await repairOrgWebhookOverflowPage(ctx, orgId)
});

// ---- session-auth CRUD for settings UI (T9-3.6) ----
//
// These use session authority, but share the same transactional policy helpers
// as v1 API-key adapters. There is no second cap or validation implementation.

export const sessionListWebhooks = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const hooks = await ctx.db
			.query('orgWebhooks')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(WEBHOOK_SUBSCRIPTION_MAX + 1);
		return hooks.slice(0, WEBHOOK_SUBSCRIPTION_MAX).map(publicWebhook);
	}
});

export const sessionListRecentDeliveries = query({
	args: { slug: v.string(), webhookId: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, webhookId, limit }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const webhook = await getOwnedOrgWebhook(ctx, org._id, webhookId);
		if (!webhook) return [];
		const resolvedLimit = limit ?? 20;
		if (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1) {
			throw new Error('WEBHOOK_HISTORY_LIMIT_INVALID');
		}
		const deliveries = await ctx.db
			.query('orgWebhookDeliveries')
			.withIndex('by_webhookId', (q) => q.eq('webhookId', webhook._id))
			.order('desc')
			.take(Math.min(resolvedLimit, 50));
		return deliveries
			.filter((d) => d.orgId === org._id)
			.map((d) => ({
				id: d._id,
				createdAt: d._creationTime,
				event: d.event,
				attempt: d.attempt,
				statusCode: d.statusCode ?? null,
				deliveredAt: d.deliveredAt ?? null,
				nextRetryAt: d.nextRetryAt ?? null,
				errorMessage: d.errorMessage ?? null,
				isDead: d.isDead
			}));
	}
});

export const sessionListRecentEvents = query({
	args: { slug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, limit }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const resolvedLimit = limit ?? 8;
		if (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1) {
			throw new Error('WEBHOOK_EVENT_HISTORY_LIMIT_INVALID');
		}
		const rows = await ctx.db
			.query('orgEvents')
			.withIndex('by_orgId_emittedAt', (q) => q.eq('orgId', org._id))
			.order('desc')
			.take(Math.min(resolvedLimit, 40));

		return rows.map((row) => ({
			id: row._id,
			event: row.event,
			emittedAt: row.emittedAt
		}));
	}
});

export const sessionCreateWebhook = mutation({
	args: {
		slug: v.string(),
		url: v.string(),
		events: v.array(v.string()),
		description: v.optional(v.string())
	},
	handler: async (ctx, { slug, url, events, description }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return await createOrgWebhook(ctx, { orgId: org._id, url, events, description });
	}
});

export const sessionTestWebhook = mutation({
	args: { slug: v.string(), webhookId: v.string() },
	handler: async (ctx, { slug, webhookId }): Promise<WebhookTestDeliveryResult> => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const webhook = await getOwnedOrgWebhook(ctx, org._id, webhookId);
		if (!webhook) return { error: 'not_found' };
		return (await ctx.runMutation(internal.orgWebhooks.enqueueTestDelivery, {
			orgId: org._id,
			webhookId: webhook._id,
			trigger: 'session'
		})) as WebhookTestDeliveryResult;
	}
});

export const sessionUpdateWebhook = mutation({
	args: {
		slug: v.string(),
		webhookId: v.string(),
		url: v.optional(v.string()),
		events: v.optional(v.array(v.string())),
		enabled: v.optional(v.boolean()),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		return await updateOwnedOrgWebhook(ctx, {
			orgId: org._id,
			webhookId: args.webhookId,
			url: args.url,
			events: args.events,
			enabled: args.enabled,
			description: args.description
		});
	}
});

export const sessionRotateWebhookSecret = mutation({
	args: { slug: v.string(), webhookId: v.string() },
	handler: async (ctx, { slug, webhookId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return await rotateOwnedOrgWebhookSecret(ctx, org._id, webhookId);
	}
});

export const sessionDeleteWebhook = mutation({
	args: { slug: v.string(), webhookId: v.string() },
	handler: async (ctx, { slug, webhookId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return await deleteOwnedOrgWebhook(ctx, org._id, webhookId);
	}
});

export const markDeliverySuccess = internalMutation({
	args: {
		deliveryId: v.id('orgWebhookDeliveries'),
		statusCode: v.number()
	},
	handler: async (ctx, { deliveryId, statusCode }) => {
		const delivery = await ctx.db.get(deliveryId);
		if (!delivery) return;
		await ctx.db.patch(deliveryId, {
			statusCode,
			deliveredAt: Date.now(),
			nextRetryAt: undefined
		});
		// Update parent webhook freshness + reset failureCount
		const webhook = await ctx.db.get(delivery.webhookId);
		if (webhook) {
			await ctx.db.patch(delivery.webhookId, {
				lastDeliveredAt: Date.now(),
				failureCount: 0
			});
		}
	}
});

export const markDeliveryDead = internalMutation({
	args: {
		deliveryId: v.id('orgWebhookDeliveries'),
		statusCode: v.optional(v.number()),
		errorMessage: v.optional(v.string())
	},
	handler: async (ctx, { deliveryId, statusCode, errorMessage }) => {
		const delivery = await ctx.db.get(deliveryId);
		if (!delivery) return;
		await ctx.db.patch(deliveryId, {
			isDead: true,
			statusCode,
			errorMessage:
				errorMessage === undefined
					? undefined
					: truncateWebhookString(errorMessage, WEBHOOK_ERROR_MAX_BYTES),
			nextRetryAt: undefined
		});
		// Increment parent failureCount; auto-disable on N consecutive dead deliveries
		const webhook = await ctx.db.get(delivery.webhookId);
		if (webhook) {
			const newCount = (webhook.failureCount ?? 0) + 1;
			await ctx.db.patch(delivery.webhookId, {
				failureCount: newCount,
				// Auto-disable after 5 consecutive dead deliveries; orgs re-enable from UI
				enabled: newCount >= 5 ? false : webhook.enabled
			});
		}
	}
});

export const markDeliveryRetryable = internalMutation({
	args: {
		deliveryId: v.id('orgWebhookDeliveries'),
		statusCode: v.optional(v.number()),
		errorMessage: v.optional(v.string()),
		nextRetryAt: v.number()
	},
	handler: async (ctx, { deliveryId, statusCode, errorMessage, nextRetryAt }) => {
		const delivery = await ctx.db.get(deliveryId);
		if (!delivery) return;
		await ctx.db.patch(deliveryId, {
			statusCode,
			errorMessage:
				errorMessage === undefined
					? undefined
					: truncateWebhookString(errorMessage, WEBHOOK_ERROR_MAX_BYTES),
			attempt: delivery.attempt + 1,
			nextRetryAt
		});
	}
});
