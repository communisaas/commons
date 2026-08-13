/**
 * Position registration queries.
 * Used by: src/routes/s/[slug]/+page.server.ts (Power Landscape)
 */

import { query, mutation, internalQuery, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { requireInternalSecret } from './_internalAuth';
import {
	RECIPIENT_METRICS_VERSION,
	applyPositionRegistrationMetric,
	assertPositionDistrictCode,
	readPositionMetrics,
	requireRecipientMetricsWritable
} from './lib/recipientMetrics';

const DIRECT_DELIVERY_RECIPIENT_MAX = 20;
const DIRECT_DELIVERY_INPUT_MAX_BYTES = 64 * 1024;
const DIRECT_DELIVERY_ADMISSION_WINDOW_MS = 60 * 1_000;
const DIRECT_DELIVERY_ADMISSION_MAX_REQUESTS = 5;
const DIRECT_DELIVERY_PSEUDONYMOUS_ID = /^[0-9a-f]{64}$/u;
const DIRECT_DELIVERY_NAME_MAX_CHARS = 200;
const DIRECT_DELIVERY_METHOD_MAX_CHARS = 32;
const DIRECT_DELIVERY_ENVELOPE_MAX_CHARS = 2_048;
const DIRECT_DELIVERY_METHODS = new Set(['cwc', 'email', 'recorded']);
const REGISTRATION_DELIVERY_ADMISSION_WINDOW_MS = 60 * 1_000;
const REGISTRATION_DELIVERY_ADMISSION_MAX_REQUESTS = 5;
const POSITION_DELIVERY_IDENTITY_MAX_CHARS = 512;
const POSITION_DELIVERY_EMAIL_MAX_CHARS = 254;
const POSITION_DELIVERY_HASH_MAX_CHARS = 128;
const POSITION_DELIVERY_RECIPIENT_KEY_MAX_CHARS = 256;
const POSITION_DELIVERY_REGISTRATION_MAX_RECIPIENTS = 20;
// eslint-disable-next-line no-control-regex
const POSITION_DELIVERY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
// eslint-disable-next-line no-control-regex
const POSITION_DELIVERY_EMAIL_SHAPE = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/u;
const MAILTO_CONFIRMATION_RECIPIENT_NAME = 'Commons mailto confirmation';
// `:` cannot be produced by canonicalPositionRecipientKey, so a caller-supplied
// human recipient name can never alias the reserved system event identity.
const MAILTO_CONFIRMATION_RECIPIENT_KEY = 'system:mailto-confirmation:v1';
const positionDeliveryEncoder = new TextEncoder();

type PositionDeliveryRecipientInput = {
	name: string;
	email?: string;
	deliveryMethod: string;
	encryptedRecipientEmail?: string;
	recipientEmailHash?: string;
	encryptedRecipientName?: string;
};

type NormalizedPositionDeliveryRecipient = PositionDeliveryRecipientInput & {
	recipientKey: string;
};

type RegistrationLinkedDelivery = {
	recipientName: string;
	recipientKey: string;
	deliveryMethod: string;
	deliveryStatus: string;
	deliveredAt?: number;
	encryptedRecipientEmail?: string;
	recipientEmailHash?: string;
	encryptedRecipientName?: string;
};

function positionDeliveryBytes(value: unknown): number {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error('POSITION_DELIVERY_INPUT_INVALID');
	}
	if (serialized === undefined) throw new Error('POSITION_DELIVERY_INPUT_INVALID');
	return positionDeliveryEncoder.encode(serialized).byteLength;
}

function normalizePositionDeliveryName(value: string): string {
	const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (
		name.length === 0 ||
		name.length > DIRECT_DELIVERY_NAME_MAX_CHARS ||
		positionDeliveryEncoder.encode(name).byteLength > 512 ||
		POSITION_DELIVERY_CONTROL_CHARACTERS.test(name)
	) {
		throw new Error('POSITION_DELIVERY_RECIPIENT_NAME_INVALID');
	}
	return name;
}

function canonicalPositionRecipientKey(name: string): string {
	const key = name
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	if (key.length === 0 || key.length > POSITION_DELIVERY_RECIPIENT_KEY_MAX_CHARS) {
		throw new Error('POSITION_DELIVERY_RECIPIENT_KEY_INVALID');
	}
	return key;
}

function normalizePositionDeliveryEmail(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const email = value.normalize('NFKC').trim().toLowerCase();
	if (
		email.length === 0 ||
		email.length > POSITION_DELIVERY_EMAIL_MAX_CHARS ||
		!POSITION_DELIVERY_EMAIL_SHAPE.test(email)
	) {
		throw new Error('POSITION_DELIVERY_RECIPIENT_EMAIL_INVALID');
	}
	return email;
}

function assertPositionDeliveryIdentity(identityCommitment: string): void {
	if (
		identityCommitment.length === 0 ||
		identityCommitment.length > POSITION_DELIVERY_IDENTITY_MAX_CHARS ||
		identityCommitment.trim() !== identityCommitment ||
		POSITION_DELIVERY_CONTROL_CHARACTERS.test(identityCommitment)
	) {
		throw new Error('POSITION_DELIVERY_IDENTITY_INVALID');
	}
}

function normalizePositionDeliveryRecipients(recipients: PositionDeliveryRecipientInput[]): {
	recipients: NormalizedPositionDeliveryRecipient[];
	duplicates: number;
} {
	if (recipients.length < 1 || recipients.length > DIRECT_DELIVERY_RECIPIENT_MAX) {
		throw new Error('POSITION_DELIVERY_RECIPIENT_LIMIT_EXCEEDED');
	}
	if (positionDeliveryBytes(recipients) > DIRECT_DELIVERY_INPUT_MAX_BYTES) {
		throw new Error('POSITION_DELIVERY_INPUT_TOO_LARGE');
	}

	const byKey = new Map<string, NormalizedPositionDeliveryRecipient & { fingerprint: string }>();
	for (const recipient of recipients) {
		const name = normalizePositionDeliveryName(recipient.name);
		if (
			!recipient.deliveryMethod ||
			recipient.deliveryMethod.length > DIRECT_DELIVERY_METHOD_MAX_CHARS ||
			!DIRECT_DELIVERY_METHODS.has(recipient.deliveryMethod)
		) {
			throw new Error('POSITION_DELIVERY_METHOD_INVALID');
		}
		const email = normalizePositionDeliveryEmail(recipient.email);
		for (const value of [recipient.encryptedRecipientEmail, recipient.encryptedRecipientName]) {
			if (
				value !== undefined &&
				(value.length === 0 ||
					value.length > DIRECT_DELIVERY_ENVELOPE_MAX_CHARS ||
					positionDeliveryEncoder.encode(value).byteLength > DIRECT_DELIVERY_ENVELOPE_MAX_CHARS ||
					POSITION_DELIVERY_CONTROL_CHARACTERS.test(value))
			) {
				throw new Error('POSITION_DELIVERY_ENVELOPE_TOO_LARGE');
			}
		}
		if (
			recipient.recipientEmailHash !== undefined &&
			(recipient.recipientEmailHash.length === 0 ||
				recipient.recipientEmailHash.length > POSITION_DELIVERY_HASH_MAX_CHARS ||
				POSITION_DELIVERY_CONTROL_CHARACTERS.test(recipient.recipientEmailHash))
		) {
			throw new Error('POSITION_DELIVERY_RECIPIENT_HASH_INVALID');
		}

		const recipientKey = canonicalPositionRecipientKey(name);
		const normalized = {
			name,
			...(email ? { email } : {}),
			deliveryMethod: recipient.deliveryMethod,
			...(recipient.encryptedRecipientEmail
				? { encryptedRecipientEmail: recipient.encryptedRecipientEmail }
				: {}),
			...(recipient.recipientEmailHash ? { recipientEmailHash: recipient.recipientEmailHash } : {}),
			...(recipient.encryptedRecipientName
				? { encryptedRecipientName: recipient.encryptedRecipientName }
				: {}),
			recipientKey
		};
		const fingerprint = JSON.stringify([
			normalized.email ?? '',
			normalized.deliveryMethod,
			normalized.encryptedRecipientEmail ?? '',
			normalized.recipientEmailHash ?? '',
			normalized.encryptedRecipientName ?? ''
		]);
		const existing = byKey.get(recipientKey);
		if (existing) {
			if (existing.fingerprint !== fingerprint) {
				throw new Error('POSITION_DELIVERY_RECIPIENT_KEY_COLLISION');
			}
			continue;
		}
		byKey.set(recipientKey, { ...normalized, fingerprint });
	}

	return {
		recipients: [...byKey.values()].map(({ fingerprint: _fingerprint, ...recipient }) => recipient),
		duplicates: recipients.length - byKey.size
	};
}

async function reserveRegistrationDeliveryAdmission(
	ctx: MutationCtx,
	identityCommitment: string
): Promise<void> {
	const now = Date.now();
	const windowStart =
		Math.floor(now / REGISTRATION_DELIVERY_ADMISSION_WINDOW_MS) *
		REGISTRATION_DELIVERY_ADMISSION_WINDOW_MS;
	const identityDigest = await crypto.subtle.digest(
		'SHA-256',
		positionDeliveryEncoder.encode(identityCommitment)
	);
	const key = `positions.registrationLinkedDeliveries:${Array.from(
		new Uint8Array(identityDigest),
		(byte) => byte.toString(16).padStart(2, '0')
	).join('')}`;
	const rows = await ctx.db
		.query('rateLimits')
		.withIndex('by_key_windowStart', (q) => q.eq('key', key).eq('windowStart', windowStart))
		.take(2);
	if (rows.length > 1) throw new Error('POSITION_DELIVERY_ADMISSION_MULTIPLICITY');
	const bucket = rows[0];
	const count = bucket?.count ?? 0;
	if (count >= REGISTRATION_DELIVERY_ADMISSION_MAX_REQUESTS) {
		throw new Error('POSITION_DELIVERY_RATE_LIMITED');
	}
	if (bucket) {
		await ctx.db.patch(bucket._id, { count: count + 1, updatedAt: now });
	} else {
		await ctx.db.insert('rateLimits', {
			key,
			windowStart,
			count: 1,
			updatedAt: now
		});
	}
}

function existingRegistrationRecipientKey(row: {
	_id: Id<'positionDeliveries'>;
	recipientName: string;
	recipientKey?: string;
	deliveryMethod: string;
}): string {
	// Legacy mailto rows used a template title (or a fallback) as recipientName.
	// Their event identity is the deterministic mailto confirmation, not that title.
	if (row.deliveryMethod === 'mailto_confirmed') return MAILTO_CONFIRMATION_RECIPIENT_KEY;
	try {
		return canonicalPositionRecipientKey(normalizePositionDeliveryName(row.recipientName));
	} catch {
		// A malformed legacy row must retain a distinct identity rather than being
		// silently merged with a new canonical recipient.
		return row.recipientKey ?? `legacy-${row._id}`;
	}
}

/**
 * The sole append boundary for every delivery linked to a stance registration.
 * The bounded indexed read owns canonical idempotency and the lifetime ceiling;
 * the shared durable admission bucket owns replay across every caller.
 */
async function appendRegistrationLinkedDeliveries(
	ctx: MutationCtx,
	args: {
		registrationId: Id<'positionRegistrations'>;
		identityCommitment: string;
		deliveries: readonly RegistrationLinkedDelivery[];
	}
): Promise<{ created: number; existing: number }> {
	const existingRows = await ctx.db
		.query('positionDeliveries')
		.withIndex('by_registrationId', (q) => q.eq('registrationId', args.registrationId))
		.take(POSITION_DELIVERY_REGISTRATION_MAX_RECIPIENTS + 1);
	if (existingRows.length > POSITION_DELIVERY_REGISTRATION_MAX_RECIPIENTS) {
		throw new Error('POSITION_DELIVERY_CARDINALITY_REPAIR_REQUIRED');
	}

	const existingKeys = new Set<string>();
	for (const row of existingRows) {
		const recipientKey = existingRegistrationRecipientKey(row);
		if (existingKeys.has(recipientKey)) {
			throw new Error('POSITION_DELIVERY_IDENTITY_MULTIPLICITY');
		}
		existingKeys.add(recipientKey);
	}

	const candidateKeys = new Set<string>();
	for (const delivery of args.deliveries) {
		if (candidateKeys.has(delivery.recipientKey)) {
			throw new Error('POSITION_DELIVERY_CANDIDATE_MULTIPLICITY');
		}
		candidateKeys.add(delivery.recipientKey);
	}
	const pending = args.deliveries.filter((delivery) => !existingKeys.has(delivery.recipientKey));
	if (existingRows.length + pending.length > POSITION_DELIVERY_REGISTRATION_MAX_RECIPIENTS) {
		throw new Error('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED');
	}

	// This is intentionally after all expected rejection branches. A successful
	// reservation and its delivery inserts commit atomically in the same mutation.
	await reserveRegistrationDeliveryAdmission(ctx, args.identityCommitment);
	for (const delivery of pending) {
		await ctx.db.insert('positionDeliveries', {
			registrationId: args.registrationId,
			recipientName: delivery.recipientName,
			recipientKey: delivery.recipientKey,
			deliveryMethod: delivery.deliveryMethod,
			deliveryStatus: delivery.deliveryStatus,
			...(delivery.deliveredAt !== undefined ? { deliveredAt: delivery.deliveredAt } : {}),
			...(delivery.encryptedRecipientEmail
				? { encryptedRecipientEmail: delivery.encryptedRecipientEmail }
				: {}),
			...(delivery.recipientEmailHash ? { recipientEmailHash: delivery.recipientEmailHash } : {}),
			...(delivery.encryptedRecipientName
				? { encryptedRecipientName: delivery.encryptedRecipientName }
				: {})
		});
	}

	return { created: pending.length, existing: args.deliveries.length - pending.length };
}

/**
 * Get aggregate position counts for a template. K-floor at 5 on stance counts,
 * 3 on district count: sub-K cohort sizes would name specific submitters. Above
 * the floor, counts are exact — position-taking on a public template is
 * intentionally visible.
 */
export const getCounts = query({
	args: { _secret: v.string(), templateId: v.id('templates') },
	handler: async (ctx, { _secret, templateId }) => {
		requireInternalSecret(_secret);
		return (await readPositionMetrics(ctx, { templateId })).counts;
	}
});

/** One compact recipient-page read replaces the former duplicate raw scans. */
export const getMetrics = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		userDistrictCode: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, userDistrictCode }) => {
		requireInternalSecret(_secret);
		const metrics = await readPositionMetrics(ctx, {
			templateId,
			viewerDistrictCode: userDistrictCode
		});
		return {
			counts: metrics.counts,
			engagement: metrics.hasPositions ? metrics.engagement : null
		};
	}
});

/** Exact viewer-district overlay for the producer-published public base. */
export const getViewerDistrictMetric = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		userDistrictCode: v.string()
	},
	handler: async (ctx, { _secret, templateId, userDistrictCode }) => {
		requireInternalSecret(_secret);
		const districtCode = assertPositionDistrictCode(userDistrictCode);
		if (!districtCode) throw new Error('POSITION_DISTRICT_CODE_INVALID');
		const row = await ctx.db
			.query('templatePositionDistrictMetrics')
			.withIndex('by_templateId_districtCode', (q) =>
				q.eq('templateId', templateId).eq('districtCode', districtCode)
			)
			.unique();
		const total = (row?.support ?? 0) + (row?.oppose ?? 0);
		if (!row || total < 5) return null;
		return {
			district_code: districtCode,
			support: row.support,
			oppose: row.oppose,
			total,
			support_percent: Math.round((row.support / total) * 100),
			is_user_district: true
		};
	}
});

/**
 * Get a user's existing position on a template (by identity commitment).
 */
export const getExisting = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		identityCommitment: v.string()
	},
	handler: async (ctx, { _secret, templateId, identityCommitment }) => {
		requireInternalSecret(_secret);
		const reg = await ctx.db
			.query('positionRegistrations')
			.withIndex('by_templateId_identityCommitment', (idx) =>
				idx.eq('templateId', templateId).eq('identityCommitment', identityCommitment)
			)
			.first();

		if (!reg) return null;

		return {
			_id: reg._id,
			stance: reg.stance
		};
	}
});

/**
 * Get position deliveries for a registration.
 */
export const getDeliveries = internalQuery({
	args: {
		registrationId: v.id('positionRegistrations'),
		deliveryMethod: v.optional(v.string())
	},
	handler: async () => {
		throw new Error('POSITION_DELIVERY_HISTORY_RETIRED');
	}
});

/**
 * Get all deliveries a user has made for a template, across both
 * stance-agnostic (direct, keyed on pseudonymousId) and stance-linked
 * (keyed on positionRegistrations.identityCommitment) paths.
 *
 * pseudonymousId covers the tier-1+ civic-action path (direct mailto, etc).
 * identityCommitment (optional) covers the tier-3+ stance-linked path used
 * when DEBATE market mechanics apply.
 */
export const getUserDeliveries = internalQuery({
	args: {
		templateId: v.id('templates'),
		pseudonymousId: v.string(),
		identityCommitment: v.optional(v.string()),
		deliveryMethod: v.optional(v.string())
	},
	handler: async () => {
		throw new Error('POSITION_USER_DELIVERY_HISTORY_RETIRED');
	}
});

/**
 * Get engagement by district for a template (coordination visibility).
 * Returns per-district action counts grouped by district code.
 */
export const getEngagementByDistrict = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		userDistrictCode: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, userDistrictCode }) => {
		requireInternalSecret(_secret);
		const metrics = await readPositionMetrics(ctx, {
			templateId,
			viewerDistrictCode: userDistrictCode
		});
		return metrics.hasPositions ? metrics.engagement : null;
	}
});

/**
 * Register a position (upsert). Returns existing if duplicate.
 */
export const register = mutation({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		identityCommitment: v.string(),
		stance: v.string(),
		districtCode: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, identityCommitment, stance, districtCode }) => {
		requireInternalSecret(_secret);
		if (stance !== 'support' && stance !== 'oppose') {
			throw new Error('POSITION_STANCE_INVALID');
		}
		const normalizedDistrictCode = assertPositionDistrictCode(districtCode);
		await requireRecipientMetricsWritable(ctx);
		// Check template exists
		const template = await ctx.db.get(templateId);
		if (!template) throw new Error('Template not found');

		// Check for existing registration (upsert)
		const existing = await ctx.db
			.query('positionRegistrations')
			.withIndex('by_templateId_identityCommitment', (idx) =>
				idx.eq('templateId', templateId).eq('identityCommitment', identityCommitment)
			)
			.first();

		if (existing) {
			return { _id: existing._id, isNew: false };
		}

		const id = await ctx.db.insert('positionRegistrations', {
			templateId,
			identityCommitment,
			stance,
			districtCode: normalizedDistrictCode,
			registeredAt: Date.now(),
			recipientMetricsVersion: RECIPIENT_METRICS_VERSION
		});
		await applyPositionRegistrationMetric(ctx, {
			templateId,
			stance,
			districtCode: normalizedDistrictCode
		});

		return { _id: id, isNew: true };
	}
});

/**
 * Confirm a mailto send — upserts the position and idempotently registers one delivery.
 */
export const confirmMailtoSend = mutation({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		identityCommitment: v.string(),
		districtCode: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, identityCommitment, districtCode }) => {
		requireInternalSecret(_secret);
		assertPositionDeliveryIdentity(identityCommitment);
		const normalizedDistrictCode = assertPositionDistrictCode(districtCode);
		await requireRecipientMetricsWritable(ctx);
		// Upsert position (support implied by sending)
		const existing = await ctx.db
			.query('positionRegistrations')
			.withIndex('by_templateId_identityCommitment', (idx) =>
				idx.eq('templateId', templateId).eq('identityCommitment', identityCommitment)
			)
			.first();

		let registrationId: Id<'positionRegistrations'>;
		let isNewPosition = false;
		if (existing) {
			registrationId = existing._id;
		} else {
			registrationId = await ctx.db.insert('positionRegistrations', {
				templateId,
				identityCommitment,
				stance: 'support',
				districtCode: normalizedDistrictCode,
				registeredAt: Date.now(),
				recipientMetricsVersion: RECIPIENT_METRICS_VERSION
			});
			await applyPositionRegistrationMetric(ctx, {
				templateId,
				stance: 'support',
				districtCode: normalizedDistrictCode
			});
			isNewPosition = true;
		}

		const delivery = await appendRegistrationLinkedDeliveries(ctx, {
			registrationId,
			identityCommitment,
			deliveries: [
				{
					recipientName: MAILTO_CONFIRMATION_RECIPIENT_NAME,
					recipientKey: MAILTO_CONFIRMATION_RECIPIENT_KEY,
					deliveryMethod: 'mailto_confirmed',
					deliveryStatus: 'user_confirmed',
					deliveredAt: Date.now()
				}
			]
		});

		return { registrationId, isNewPosition, ...delivery };
	}
});

/**
 * Batch-create delivery records for a position registration.
 */
export const batchRegisterDeliveries = mutation({
	args: {
		_secret: v.string(),
		registrationId: v.id('positionRegistrations'),
		identityCommitment: v.string(),
		recipients: v.array(
			v.object({
				name: v.string(),
				email: v.optional(v.string()),
				deliveryMethod: v.string(),
				// Optional pre-encrypted fields (caller encrypts before calling)
				encryptedRecipientEmail: v.optional(v.string()),
				recipientEmailHash: v.optional(v.string()),
				encryptedRecipientName: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, { _secret, registrationId, identityCommitment, recipients }) => {
		requireInternalSecret(_secret);
		if (
			positionDeliveryBytes({ _secret, registrationId, identityCommitment, recipients }) >
			DIRECT_DELIVERY_INPUT_MAX_BYTES
		) {
			throw new Error('POSITION_DELIVERY_INPUT_TOO_LARGE');
		}
		assertPositionDeliveryIdentity(identityCommitment);
		const normalized = normalizePositionDeliveryRecipients(recipients);

		// Verify registration exists and belongs to caller
		const reg = await ctx.db.get(registrationId);
		if (!reg || reg.identityCommitment !== identityCommitment) {
			throw new Error('Registration not found');
		}
		const delivery = await appendRegistrationLinkedDeliveries(ctx, {
			registrationId,
			identityCommitment,
			deliveries: normalized.recipients.map((recipient) => ({
				recipientName: recipient.name,
				recipientKey: recipient.recipientKey,
				deliveryMethod: recipient.deliveryMethod,
				deliveryStatus: 'pending',
				...(recipient.encryptedRecipientEmail
					? { encryptedRecipientEmail: recipient.encryptedRecipientEmail }
					: {}),
				...(recipient.recipientEmailHash
					? { recipientEmailHash: recipient.recipientEmailHash }
					: {}),
				...(recipient.encryptedRecipientName
					? { encryptedRecipientName: recipient.encryptedRecipientName }
					: {})
			}))
		});

		return {
			...delivery,
			duplicates: normalized.duplicates
		};
	}
});

function canonicalDirectPseudonymousId(value: string): string {
	const canonical = value.normalize('NFKC').trim().toLowerCase();
	// The only producer is HMAC-SHA256. Reject aliases rather than silently
	// creating a second history/admission identity for the same actor.
	if (canonical !== value || !DIRECT_DELIVERY_PSEUDONYMOUS_ID.test(canonical)) {
		throw new Error('DIRECT_DELIVERY_PSEUDONYM_INVALID');
	}
	return canonical;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', positionDeliveryEncoder.encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type DirectDeliveryCandidate = {
	recipient: NormalizedPositionDeliveryRecipient;
	recipientKey: string;
	aliases: readonly string[];
};

function normalizeDirectDeliveryCandidates(
	recipients: readonly NormalizedPositionDeliveryRecipient[]
): DirectDeliveryCandidate[] {
	const candidates: DirectDeliveryCandidate[] = [];
	const candidateKeys = new Set<string>();

	for (const recipient of recipients) {
		const recipientKey = canonicalPositionRecipientKey(recipient.name);
		if (candidateKeys.has(recipientKey)) {
			throw new Error('DIRECT_DELIVERY_RECIPIENT_IDENTITY_COLLISION');
		}
		candidateKeys.add(recipientKey);
		candidates.push({
			recipient,
			recipientKey,
			aliases: [recipientKey]
		});
	}

	return candidates;
}

function existingDirectDeliveryAliases(row: {
	_id: Id<'positionDeliveries'>;
	recipientName: string;
	recipientKey?: string;
}): string[] {
	let nameKey: string;
	try {
		nameKey = canonicalPositionRecipientKey(normalizePositionDeliveryName(row.recipientName));
	} catch {
		throw new Error('DIRECT_DELIVERY_IDENTITY_REPAIR_REQUIRED');
	}
	const aliases = new Set<string>([nameKey]);
	if (row.recipientKey !== undefined) {
		if (
			row.recipientKey.length === 0 ||
			row.recipientKey.length > POSITION_DELIVERY_RECIPIENT_KEY_MAX_CHARS ||
			POSITION_DELIVERY_CONTROL_CHARACTERS.test(row.recipientKey)
		) {
			throw new Error('DIRECT_DELIVERY_IDENTITY_REPAIR_REQUIRED');
		}
		aliases.add(row.recipientKey);
	}
	return [...aliases];
}

async function reserveDirectDeliveryAdmission(
	ctx: MutationCtx,
	pseudonymousId: string,
	templateId: Id<'templates'>
): Promise<void> {
	const now = Date.now();
	const windowStart =
		Math.floor(now / DIRECT_DELIVERY_ADMISSION_WINDOW_MS) * DIRECT_DELIVERY_ADMISSION_WINDOW_MS;
	// Hash the pair so the general rate-limit table never becomes a second
	// plaintext pseudonymous-identity index.
	const pairDigest = await sha256Hex(`${pseudonymousId}\u0000${templateId}`);
	const key = `positions.directDeliveries:v1:${pairDigest}`;
	const rows = await ctx.db
		.query('rateLimits')
		.withIndex('by_key_windowStart', (q) => q.eq('key', key).eq('windowStart', windowStart))
		.take(2);
	if (rows.length > 1) throw new Error('DIRECT_DELIVERY_ADMISSION_MULTIPLICITY');
	const bucket = rows[0];
	const count = bucket?.count ?? 0;
	if (count >= DIRECT_DELIVERY_ADMISSION_MAX_REQUESTS) {
		throw new Error('DIRECT_DELIVERY_RATE_LIMITED');
	}
	if (bucket) {
		await ctx.db.patch(bucket._id, { count: count + 1, updatedAt: now });
	} else {
		await ctx.db.insert('rateLimits', {
			key,
			windowStart,
			count: 1,
			updatedAt: now
		});
	}
}

/**
 * The sole append boundary for direct delivery history. One bounded indexed
 * read owns both legacy-aware identity collision detection and the lifetime
 * ceiling. Convex transaction retries serialize concurrent writers across the
 * indexed range and the durable admission bucket.
 *
 * Rows land as `user_confirmed`, not `pending`. The only caller of this lane is
 * `recordDirectDeliveries`, and its only client is the explicit human confirm in
 * `confirmSendContacted()` on the recipient page — the person says they wrote.
 * Nothing downstream ever observes the send, so there is no later transition
 * out of `pending` and a `pending` row here would be a status that no writer
 * could ever advance. `user_confirmed` names exactly what happened: a person's
 * own assertion, never a receipt. The registration-linked lane at
 * `batchRegisterDeliveries` keeps `pending` — that one is gated on an
 * identity_commitment and is a different history.
 */
async function appendDirectDeliveries(
	ctx: MutationCtx,
	args: {
		pseudonymousId: string;
		templateId: Id<'templates'>;
		candidates: readonly DirectDeliveryCandidate[];
	}
): Promise<{ created: number; existing: number }> {
	const existingRows = await ctx.db
		.query('positionDeliveries')
		.withIndex('by_templateId_pseudonymousId', (q) =>
			q.eq('templateId', args.templateId).eq('pseudonymousId', args.pseudonymousId)
		)
		.take(DIRECT_DELIVERY_RECIPIENT_MAX + 1);
	if (existingRows.length > DIRECT_DELIVERY_RECIPIENT_MAX) {
		throw new Error('DIRECT_DELIVERY_CARDINALITY_REPAIR_REQUIRED');
	}

	const existingAliasOwners = new Map<string, Id<'positionDeliveries'>>();
	for (const row of existingRows) {
		for (const alias of existingDirectDeliveryAliases(row)) {
			const owner = existingAliasOwners.get(alias);
			if (owner !== undefined && owner !== row._id) {
				throw new Error('DIRECT_DELIVERY_IDENTITY_MULTIPLICITY');
			}
			existingAliasOwners.set(alias, row._id);
		}
	}

	const pending: DirectDeliveryCandidate[] = [];
	let existing = 0;
	for (const candidate of args.candidates) {
		const owners = new Set(
			candidate.aliases
				.map((alias) => existingAliasOwners.get(alias))
				.filter((owner): owner is Id<'positionDeliveries'> => owner !== undefined)
		);
		if (owners.size > 1) throw new Error('DIRECT_DELIVERY_IDENTITY_MULTIPLICITY');
		if (owners.size === 1) {
			existing += 1;
		} else {
			pending.push(candidate);
		}
	}
	if (existingRows.length + pending.length > DIRECT_DELIVERY_RECIPIENT_MAX) {
		throw new Error('DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED');
	}

	// Expected input/history rejection occurs before admission. Every accepted
	// call, including a pure replay, consumes one durable request reservation.
	await reserveDirectDeliveryAdmission(ctx, args.pseudonymousId, args.templateId);
	const now = Date.now();
	for (const candidate of pending) {
		const recipient = candidate.recipient;
		await ctx.db.insert('positionDeliveries', {
			pseudonymousId: args.pseudonymousId,
			templateId: args.templateId,
			recipientKey: candidate.recipientKey,
			recipientName: recipient.name,
			deliveryMethod: recipient.deliveryMethod,
			deliveryStatus: 'user_confirmed',
			deliveredAt: now
		});
	}

	return { created: pending.length, existing };
}

/**
 * Record delivery events directly, keyed on pseudonymousId + templateId, with
 * NO stance registration required. This is the stance-agnostic civic-action
 * pathway: writing to a decision-maker is a first-class civic event, not an
 * overlay on a public support/oppose tally.
 *
 * pseudonymousId = HMAC-SHA256(user.id, salt) per voter-protocol G-07
 * (ANTI-ASTROTURF-IMPLEMENTATION-PLAN.md). Matches the primitive used by the
 * submissions table so tier 1+ users can persist civic actions without
 * exposing raw user_id or requiring identity_commitment (tier 3+).
 *
 * Stance registration (positionRegistrations) remains meaningful when DEBATE
 * markets provide truth-testing mechanics for support/oppose claims. Until
 * then, deliveries stand on their own and do not fabricate stances from
 * civic actions.
 *
 * Idempotent: if a delivery exists for this (pseudonymousId, templateId,
 * recipientKey) tuple, no duplicate is created.
 */
export const recordDirectDeliveries = mutation({
	args: {
		_secret: v.string(),
		pseudonymousId: v.string(),
		templateId: v.id('templates'),
		recipients: v.array(
			v.object({
				name: v.string(),
				deliveryMethod: v.string()
			})
		)
	},
	handler: async (ctx, { _secret, pseudonymousId, templateId, recipients }) => {
		requireInternalSecret(_secret);
		const canonicalPseudonymousId = canonicalDirectPseudonymousId(pseudonymousId);
		if (
			positionDeliveryBytes({ _secret, pseudonymousId, templateId, recipients }) >
			DIRECT_DELIVERY_INPUT_MAX_BYTES
		) {
			throw new Error('DIRECT_DELIVERY_INPUT_TOO_LARGE');
		}
		const normalized = normalizePositionDeliveryRecipients(recipients);
		const candidates = normalizeDirectDeliveryCandidates(normalized.recipients);
		const template = await ctx.db.get(templateId);
		if (!template || template.status !== 'published' || template.isPublic !== true) {
			throw new Error('DIRECT_DELIVERY_TEMPLATE_INELIGIBLE');
		}
		const delivery = await appendDirectDeliveries(ctx, {
			pseudonymousId: canonicalPseudonymousId,
			templateId,
			candidates
		});

		return { ...delivery, duplicates: normalized.duplicates };
	}
});

/**
 * Get full engagement by district with privacy threshold.
 */
export const getFullEngagementByDistrict = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		userDistrictCode: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, userDistrictCode }) => {
		requireInternalSecret(_secret);
		const metrics = await readPositionMetrics(ctx, {
			templateId,
			viewerDistrictCode: userDistrictCode
		});
		return metrics.hasPositions ? metrics.engagement : null;
	}
});

/**
 * The viewer's own direct-delivery history for one template.
 *
 * Reads exactly the rows this viewer wrote through `recordDirectDeliveries`,
 * through the same (templateId, pseudonymousId) index and under the same
 * lifetime ceiling the writer enforces, so the read can never out-run the
 * write. `deliveryStatus` is returned VERBATIM: this query does not filter,
 * collapse, or reinterpret it — the caller decides what a status means.
 *
 * The reserved mailto-confirmation identity is a system event, not a person the
 * viewer wrote to, so it is excluded. Nothing location-derived, nothing
 * contactable, and no pseudonym echo crosses this boundary: only the recipient
 * name the viewer already sees on the page, the status, and when it landed.
 */
export const listViewerConfirmedContacts = query({
	args: {
		_secret: v.string(),
		pseudonymousId: v.string(),
		templateId: v.id('templates')
	},
	handler: async (ctx, { _secret, pseudonymousId, templateId }) => {
		requireInternalSecret(_secret);
		const canonicalPseudonymousId = canonicalDirectPseudonymousId(pseudonymousId);
		const rows = await ctx.db
			.query('positionDeliveries')
			.withIndex('by_templateId_pseudonymousId', (q) =>
				q.eq('templateId', templateId).eq('pseudonymousId', canonicalPseudonymousId)
			)
			.take(DIRECT_DELIVERY_RECIPIENT_MAX);

		return rows
			.filter((row) => row.recipientKey !== MAILTO_CONFIRMATION_RECIPIENT_KEY)
			.map((row) => ({
				recipientName: row.recipientName,
				deliveryStatus: row.deliveryStatus,
				confirmedAt: row.deliveredAt ?? row._creationTime
			}));
	}
});
