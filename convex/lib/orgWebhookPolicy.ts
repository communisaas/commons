import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_SET } from '../_webhookEvents';

declare const process: { env: Record<string, string | undefined> };

export const WEBHOOK_SUBSCRIPTION_MAX = 8;
export const WEBHOOK_EVENT_INPUT_MAX = WEBHOOK_EVENTS.length * 2;
export const WEBHOOK_EVENT_MAX_BYTES = 64;
export const WEBHOOK_URL_MAX_BYTES = 2_048;
export const WEBHOOK_DESCRIPTION_MAX_BYTES = 512;
export const WEBHOOK_PAYLOAD_MAX_BYTES = 64 * 1_024;
export const WEBHOOK_ERROR_MAX_BYTES = 512;
export const WEBHOOK_HEADER_VALUE_MAX_BYTES = 256;
export const WEBHOOK_DELIVERY_CLEANUP_BATCH = 50;
export const WEBHOOK_CREATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const WEBHOOK_CREATION_MAX_PER_WINDOW = 12;
export const WEBHOOK_TRUSTED_ORIGINS_ENV = 'WEBHOOK_EGRESS_TRUSTED_ORIGINS';
export const WEBHOOK_TRUSTED_ORIGIN_MAX = 64;
const WEBHOOK_TRUSTED_ORIGINS_MAX_BYTES = 16 * 1_024;
const WEBHOOK_SIGNING_SECRET_BYTES = 32;
const WEBHOOK_SIGNING_SECRET_MAX_BYTES = 128;

const encoder = new TextEncoder();

type DbCtx = QueryCtx | MutationCtx;

export type WebhookDestinationError =
	| 'invalid_url'
	| 'invalid_url_scheme'
	| 'url_too_long'
	| 'destination_credentials'
	| 'destination_fragment'
	| 'destination_private'
	| 'destination_not_allowed'
	| 'destination_policy_invalid';

export type WebhookInputError =
	| WebhookDestinationError
	| 'empty_events'
	| 'too_many_events'
	| 'unknown_event'
	| 'event_too_long'
	| 'description_too_long';

export type WebhookMutationError =
	| WebhookInputError
	| 'not_found'
	| 'subscription_limit'
	| 'creation_throttled';

const cleanupDeliveriesRef = makeFunctionReference<'mutation'>(
	'orgWebhooks:cleanupDeletedWebhookDeliveries'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ webhookId: Id<'orgWebhooks'> },
	{ deleted: number; hasMore: boolean }
>;

const repairOverflowRef = makeFunctionReference<'mutation'>(
	'orgWebhooks:repairLegacySubscriptionOverflow'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ orgId: Id<'organizations'> },
	{ removed: number; hasMore: boolean }
>;

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

export function truncateWebhookString(value: string, maxBytes: number): string {
	if (utf8Bytes(value) <= maxBytes) return value;
	let result = '';
	let used = 0;
	for (const character of value) {
		const bytes = utf8Bytes(character);
		if (used + bytes > maxBytes) break;
		result += character;
		used += bytes;
	}
	return result;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
	if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
	const octets = hostname.split('.').map(Number);
	if (
		octets.length !== 4 ||
		octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return null;
	}
	return octets as [number, number, number, number];
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function parseIpv6(hostname: string): number[] | null {
	let source = hostname.toLowerCase();
	if (source.startsWith('[') && source.endsWith(']')) source = source.slice(1, -1);
	if (source.includes('%') || (source.match(/::/g)?.length ?? 0) > 1) return null;

	let ipv4Tail: [number, number, number, number] | null = null;
	if (source.includes('.')) {
		const lastColon = source.lastIndexOf(':');
		if (lastColon < 0) return null;
		ipv4Tail = parseIpv4(source.slice(lastColon + 1));
		if (!ipv4Tail) return null;
		source = `${source.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${(
			(ipv4Tail[2] << 8) |
			ipv4Tail[3]
		).toString(16)}`;
	}

	const halves = source.split('::');
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
	const groups = [
		...left,
		...Array.from({ length: Math.max(0, missing) }, () => '0'),
		...right
	].map((part) => Number.parseInt(part, 16));
	if (groups.length !== 8) return null;
	const bytes: number[] = [];
	for (const group of groups) bytes.push(group >> 8, group & 0xff);
	return bytes;
}

function isNonPublicIpv6(bytes: readonly number[]): boolean {
	const allZero = bytes.every((value) => value === 0);
	const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
	const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
	const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
	const siteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
	const multicast = bytes[0] === 0xff;
	const documentation =
		bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
	const documentation2 = bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0;
	const mappedIpv4 =
		bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
	const compatibleIpv4 = bytes.slice(0, 12).every((value) => value === 0);
	const nat64 = bytes
		.slice(0, 12)
		.every((value, index) => value === [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0][index]);
	const embeddedIpv4 = mappedIpv4 || compatibleIpv4 || nat64;
	return (
		allZero ||
		loopback ||
		uniqueLocal ||
		linkLocal ||
		siteLocal ||
		multicast ||
		documentation ||
		documentation2 ||
		(embeddedIpv4 && isNonPublicIpv4(bytes.slice(12)))
	);
}

function normalizedHostname(parsed: URL): string | null {
	const raw = parsed.hostname.toLowerCase().replace(/\.$/, '');
	if (raw.length === 0) return null;
	const ipv4 = parseIpv4(raw);
	if (ipv4) return isNonPublicIpv4(ipv4) ? null : raw;
	if (raw.includes(':') || (raw.startsWith('[') && raw.endsWith(']'))) {
		const ipv6 = parseIpv6(raw);
		return ipv6 && !isNonPublicIpv6(ipv6) ? raw.replace(/^\[|\]$/g, '') : null;
	}

	const deniedSuffixes = [
		'localhost',
		'.localhost',
		'.local',
		'.internal',
		'.home.arpa',
		'.invalid',
		'.test',
		'.example',
		'.nip.io',
		'.sslip.io',
		'localtest.me',
		'.localtest.me',
		'lvh.me',
		'.lvh.me'
	];
	if (deniedSuffixes.some((suffix) => raw === suffix || raw.endsWith(suffix))) return null;
	const labels = raw.split('.');
	if (
		labels.length < 2 ||
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > 63 ||
				!/^[a-z0-9-]+$/.test(label) ||
				label.startsWith('-') ||
				label.endsWith('-')
		) ||
		/^\d+$/.test(labels.at(-1) ?? '')
	) {
		return null;
	}
	return raw;
}

function structurallyNormalizeHttpsUrl(raw: string):
	| { ok: true; url: string; origin: string }
	| {
			ok: false;
			error: Exclude<
				WebhookDestinationError,
				'destination_not_allowed' | 'destination_policy_invalid'
			>;
	  } {
	if (utf8Bytes(raw) > WEBHOOK_URL_MAX_BYTES) return { ok: false, error: 'url_too_long' };
	const source = raw.trim();
	if (source.length === 0 || /[\u0000-\u001f\u007f]/.test(source)) {
		return { ok: false, error: 'invalid_url' };
	}
	let parsed: URL;
	try {
		parsed = new URL(source);
	} catch {
		return { ok: false, error: 'invalid_url' };
	}
	if (parsed.protocol !== 'https:') return { ok: false, error: 'invalid_url_scheme' };
	if (parsed.username || parsed.password) return { ok: false, error: 'destination_credentials' };
	if (source.includes('#')) return { ok: false, error: 'destination_fragment' };
	const hostname = normalizedHostname(parsed);
	if (!hostname) return { ok: false, error: 'destination_private' };
	parsed.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
	parsed.hash = '';
	const url = parsed.toString();
	if (utf8Bytes(url) > WEBHOOK_URL_MAX_BYTES) return { ok: false, error: 'url_too_long' };
	return { ok: true, url, origin: parsed.origin };
}

function trustedOriginSet(rawPolicy: string): Set<string> | null {
	if (utf8Bytes(rawPolicy) > WEBHOOK_TRUSTED_ORIGINS_MAX_BYTES) return null;
	const entries = rawPolicy
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0 || entries.length > WEBHOOK_TRUSTED_ORIGIN_MAX) return null;
	const result = new Set<string>();
	for (const entry of entries) {
		const normalized = structurallyNormalizeHttpsUrl(entry);
		if (!normalized.ok || normalized.url !== `${normalized.origin}/`) {
			return null;
		}
		result.add(normalized.origin);
	}
	return result;
}

export function webhookTrustedOriginsFromEnvironment(): string {
	return process.env[WEBHOOK_TRUSTED_ORIGINS_ENV] ?? '';
}

/**
 * Convex actions do not expose a DNS-resolution primitive. Hostnames therefore
 * fail closed unless their exact HTTPS origin is explicitly trusted by ops.
 * Redirects are disabled by the delivery action, and this policy is evaluated
 * again immediately before every fetch.
 */
export function normalizeWebhookDestination(
	raw: string,
	trustedOrigins = webhookTrustedOriginsFromEnvironment()
): { ok: true; url: string } | { ok: false; error: WebhookDestinationError } {
	const normalized = structurallyNormalizeHttpsUrl(raw);
	if (!normalized.ok) return normalized;
	const allowed = trustedOriginSet(trustedOrigins);
	if (!allowed) return { ok: false, error: 'destination_policy_invalid' };
	if (!allowed.has(normalized.origin)) return { ok: false, error: 'destination_not_allowed' };
	return { ok: true, url: normalized.url };
}

export function normalizeWebhookEvents(
	events: readonly string[]
): { ok: true; events: string[] } | { ok: false; error: WebhookInputError; event?: string } {
	if (events.length === 0) return { ok: false, error: 'empty_events' };
	if (events.length > WEBHOOK_EVENT_INPUT_MAX) return { ok: false, error: 'too_many_events' };
	const seen = new Set<string>();
	for (const event of events) {
		if (utf8Bytes(event) > WEBHOOK_EVENT_MAX_BYTES) {
			return {
				ok: false,
				error: 'event_too_long',
				event: truncateWebhookString(event, WEBHOOK_EVENT_MAX_BYTES)
			};
		}
		if (!WEBHOOK_EVENT_SET.has(event)) return { ok: false, error: 'unknown_event', event };
		seen.add(event);
	}
	return { ok: true, events: WEBHOOK_EVENTS.filter((event) => seen.has(event)) };
}

export function normalizeWebhookDescription(
	description: string | undefined
): { ok: true; description: string | undefined } | { ok: false; error: 'description_too_long' } {
	if (description === undefined) return { ok: true, description: undefined };
	if (utf8Bytes(description) > WEBHOOK_DESCRIPTION_MAX_BYTES) {
		return { ok: false, error: 'description_too_long' };
	}
	const normalized = description.trim();
	return { ok: true, description: normalized || undefined };
}

export function normalizeWebhookPayload(
	event: string,
	payload: string
):
	| { ok: true; event: string; payload: string }
	| {
			ok: false;
			error: 'invalid_event' | 'event_too_long' | 'payload_too_large' | 'invalid_payload';
	  } {
	if (utf8Bytes(event) > WEBHOOK_EVENT_MAX_BYTES) return { ok: false, error: 'event_too_long' };
	if (!WEBHOOK_EVENT_SET.has(event)) return { ok: false, error: 'invalid_event' };
	if (utf8Bytes(payload) > WEBHOOK_PAYLOAD_MAX_BYTES)
		return { ok: false, error: 'payload_too_large' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return { ok: false, error: 'invalid_payload' };
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: 'invalid_payload' };
	}
	const canonical = JSON.stringify(parsed);
	if (utf8Bytes(canonical) > WEBHOOK_PAYLOAD_MAX_BYTES) {
		return { ok: false, error: 'payload_too_large' };
	}
	return { ok: true, event, payload: canonical };
}

export function validateWebhookDeliveryEnvelope(args: {
	event: string;
	payload: string;
	deliveryId: string;
	attempt: number;
	signingSecret: string;
}): { ok: true } | { ok: false; error: string } {
	if (utf8Bytes(args.event) > WEBHOOK_EVENT_MAX_BYTES) {
		return { ok: false, error: 'event_too_long' };
	}
	if (args.event !== 'webhook.test' && !WEBHOOK_EVENT_SET.has(args.event)) {
		return { ok: false, error: 'invalid_event' };
	}
	if (utf8Bytes(args.payload) > WEBHOOK_PAYLOAD_MAX_BYTES) {
		return { ok: false, error: 'payload_too_large' };
	}
	try {
		const parsed = JSON.parse(args.payload) as unknown;
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { ok: false, error: 'invalid_payload' };
		}
	} catch {
		return { ok: false, error: 'invalid_payload' };
	}
	if (utf8Bytes(args.event) > WEBHOOK_HEADER_VALUE_MAX_BYTES)
		return { ok: false, error: 'event_header_too_long' };
	if (utf8Bytes(args.deliveryId) > WEBHOOK_HEADER_VALUE_MAX_BYTES) {
		return { ok: false, error: 'delivery_header_too_long' };
	}
	if (!Number.isSafeInteger(args.attempt) || args.attempt < 1 || args.attempt > 5) {
		return { ok: false, error: 'attempt_invalid' };
	}
	if (
		utf8Bytes(args.signingSecret) === 0 ||
		utf8Bytes(args.signingSecret) > WEBHOOK_SIGNING_SECRET_MAX_BYTES
	) {
		return { ok: false, error: 'signing_secret_too_long' };
	}
	return { ok: true };
}

export function generateWebhookSigningSecret(): string {
	const bytes = new Uint8Array(WEBHOOK_SIGNING_SECRET_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export function publicWebhook(webhook: {
	_id: Id<'orgWebhooks'>;
	url: string;
	events: string[];
	enabled: boolean;
	description?: string;
	createdAt: number;
	lastDeliveredAt?: number;
	failureCount: number;
}) {
	return {
		id: webhook._id,
		url: webhook.url,
		events: webhook.events,
		enabled: webhook.enabled,
		description: webhook.description ?? null,
		createdAt: webhook.createdAt,
		lastDeliveredAt: webhook.lastDeliveredAt ?? null,
		failureCount: webhook.failureCount
	};
}

export async function getOwnedOrgWebhook(ctx: DbCtx, orgId: Id<'organizations'>, rawId: string) {
	const webhookId = ctx.db.normalizeId('orgWebhooks', rawId);
	if (!webhookId) return null;
	const webhook = await ctx.db.get(webhookId);
	return webhook?.orgId === orgId ? webhook : null;
}

export async function recordWebhookOverflow(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	observedCountLowerBound: number
): Promise<void> {
	const existing = await ctx.db
		.query('orgWebhookOverflowEvidence')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();
	if (existing && existing.resolvedAt === undefined && existing.repairScheduledAt !== undefined) {
		return;
	}
	const now = Date.now();
	if (existing) {
		await ctx.db.patch(existing._id, {
			cap: WEBHOOK_SUBSCRIPTION_MAX,
			observedCountLowerBound: Math.max(existing.observedCountLowerBound, observedCountLowerBound),
			lastObservedAt: now,
			repairScheduledAt: now,
			resolvedAt: undefined
		});
	} else {
		await ctx.db.insert('orgWebhookOverflowEvidence', {
			orgId,
			cap: WEBHOOK_SUBSCRIPTION_MAX,
			observedCountLowerBound,
			firstObservedAt: now,
			lastObservedAt: now,
			repairScheduledAt: now,
			removedSubscriptions: 0
		});
	}
	await ctx.scheduler.runAfter(0, repairOverflowRef, { orgId });
}

export async function createOrgWebhook(
	ctx: MutationCtx,
	args: {
		orgId: Id<'organizations'>;
		url: string;
		events: string[];
		description?: string;
		trustedOrigins?: string;
	}
) {
	const destination = normalizeWebhookDestination(args.url, args.trustedOrigins);
	if (!destination.ok) return { error: destination.error as WebhookMutationError };
	const events = normalizeWebhookEvents(args.events);
	if (!events.ok) return { error: events.error as WebhookMutationError, event: events.event };
	const description = normalizeWebhookDescription(args.description);
	if (!description.ok) return { error: description.error as WebhookMutationError };

	const existing = await ctx.db
		.query('orgWebhooks')
		.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
		.take(WEBHOOK_SUBSCRIPTION_MAX + 1);
	if (existing.length > WEBHOOK_SUBSCRIPTION_MAX) {
		await recordWebhookOverflow(ctx, args.orgId, existing.length);
		return { error: 'subscription_limit' as const };
	}
	if (existing.length === WEBHOOK_SUBSCRIPTION_MAX) {
		return { error: 'subscription_limit' as const };
	}

	const now = Date.now();
	const windowStart = Math.floor(now / WEBHOOK_CREATION_WINDOW_MS) * WEBHOOK_CREATION_WINDOW_MS;
	const rateKey = `org-webhook-create:${args.orgId}`;
	const bucket = await ctx.db
		.query('rateLimits')
		.withIndex('by_key_windowStart', (q) => q.eq('key', rateKey).eq('windowStart', windowStart))
		.unique();
	const count = bucket?.count ?? 0;
	if (count >= WEBHOOK_CREATION_MAX_PER_WINDOW) {
		return {
			error: 'creation_throttled' as const,
			retryAt: windowStart + WEBHOOK_CREATION_WINDOW_MS
		};
	}

	const signingSecret = generateWebhookSigningSecret();
	const id = await ctx.db.insert('orgWebhooks', {
		orgId: args.orgId,
		url: destination.url,
		events: events.events,
		signingSecret,
		enabled: true,
		description: description.description,
		createdAt: now,
		failureCount: 0
	});
	if (bucket) {
		await ctx.db.patch(bucket._id, { count: count + 1, updatedAt: now });
	} else {
		await ctx.db.insert('rateLimits', {
			key: rateKey,
			windowStart,
			count: 1,
			updatedAt: now
		});
	}
	return {
		error: null,
		webhook: {
			id,
			url: destination.url,
			events: events.events,
			enabled: true,
			description: description.description ?? null
		},
		signingSecret
	};
}

export async function updateOwnedOrgWebhook(
	ctx: MutationCtx,
	args: {
		orgId: Id<'organizations'>;
		webhookId: string;
		url?: string;
		events?: string[];
		enabled?: boolean;
		description?: string;
		trustedOrigins?: string;
	}
) {
	const webhook = await getOwnedOrgWebhook(ctx, args.orgId, args.webhookId);
	if (!webhook) return { error: 'not_found' as const };
	const patch: {
		url?: string;
		events?: string[];
		enabled?: boolean;
		description?: string;
		failureCount?: number;
	} = {};
	if (args.url !== undefined) {
		const destination = normalizeWebhookDestination(args.url, args.trustedOrigins);
		if (!destination.ok) return { error: destination.error as WebhookMutationError };
		patch.url = destination.url;
	}
	if (args.events !== undefined) {
		const events = normalizeWebhookEvents(args.events);
		if (!events.ok) return { error: events.error as WebhookMutationError, event: events.event };
		patch.events = events.events;
	}
	if (args.description !== undefined) {
		const description = normalizeWebhookDescription(args.description);
		if (!description.ok) return { error: description.error as WebhookMutationError };
		patch.description = description.description;
	}
	if (args.enabled !== undefined) {
		if (args.enabled && !webhook.enabled) {
			const enabled = await ctx.db
				.query('orgWebhooks')
				.withIndex('by_orgId_enabled', (q) => q.eq('orgId', args.orgId).eq('enabled', true))
				.take(WEBHOOK_SUBSCRIPTION_MAX + 1);
			if (enabled.length >= WEBHOOK_SUBSCRIPTION_MAX) {
				if (enabled.length > WEBHOOK_SUBSCRIPTION_MAX) {
					await recordWebhookOverflow(ctx, args.orgId, enabled.length);
				}
				return { error: 'subscription_limit' as const };
			}
			patch.failureCount = 0;
		}
		patch.enabled = args.enabled;
	}
	await ctx.db.patch(webhook._id, patch);
	const updated = { ...webhook, ...patch };
	return { error: null, webhook: publicWebhook(updated) };
}

export async function rotateOwnedOrgWebhookSecret(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	webhookId: string
) {
	const webhook = await getOwnedOrgWebhook(ctx, orgId, webhookId);
	if (!webhook) return { error: 'not_found' as const };
	const signingSecret = generateWebhookSigningSecret();
	await ctx.db.patch(webhook._id, {
		signingSecret,
		signingSecretPrevious: webhook.signingSecret
	});
	return { error: null, signingSecret };
}

async function deleteDeliveryPage(ctx: MutationCtx, webhookId: Id<'orgWebhooks'>) {
	const rows = await ctx.db
		.query('orgWebhookDeliveries')
		.withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
		.take(WEBHOOK_DELIVERY_CLEANUP_BATCH + 1);
	const page = rows.slice(0, WEBHOOK_DELIVERY_CLEANUP_BATCH);
	await Promise.all(page.map((row) => ctx.db.delete(row._id)));
	const hasMore = rows.length > WEBHOOK_DELIVERY_CLEANUP_BATCH;
	if (hasMore) await ctx.scheduler.runAfter(0, cleanupDeliveriesRef, { webhookId });
	return { deleted: page.length, hasMore };
}

export async function cleanupWebhookDeliveryPage(ctx: MutationCtx, webhookId: Id<'orgWebhooks'>) {
	return await deleteDeliveryPage(ctx, webhookId);
}

export async function deleteOwnedOrgWebhook(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	webhookId: string
): Promise<boolean> {
	const webhook = await getOwnedOrgWebhook(ctx, orgId, webhookId);
	if (!webhook) return false;
	// Remove the dispatch target atomically, then drain its history in fixed
	// pages. Concurrent queue mutations conflict on the enabled index and retry
	// without this subscription.
	await ctx.db.delete(webhook._id);
	await deleteDeliveryPage(ctx, webhook._id);
	return true;
}

export async function repairOrgWebhookOverflowPage(
	ctx: MutationCtx,
	orgId: Id<'organizations'>
): Promise<{ removed: number; hasMore: boolean }> {
	const rows = await ctx.db
		.query('orgWebhooks')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.take(WEBHOOK_SUBSCRIPTION_MAX + 1);
	const evidence = await ctx.db
		.query('orgWebhookOverflowEvidence')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();
	if (rows.length <= WEBHOOK_SUBSCRIPTION_MAX) {
		if (evidence && evidence.resolvedAt === undefined) {
			await ctx.db.patch(evidence._id, {
				resolvedAt: Date.now(),
				repairScheduledAt: undefined
			});
		}
		return { removed: 0, hasMore: false };
	}

	// Preserve the oldest canonical cap and remove one legacy overflow target
	// per transaction. Its delivery history is drained independently in pages.
	const victim = rows[WEBHOOK_SUBSCRIPTION_MAX];
	await ctx.db.delete(victim._id);
	await deleteDeliveryPage(ctx, victim._id);
	if (evidence) {
		await ctx.db.patch(evidence._id, {
			removedSubscriptions: evidence.removedSubscriptions + 1
		});
	}
	await ctx.scheduler.runAfter(0, repairOverflowRef, { orgId });
	return { removed: 1, hasMore: true };
}
