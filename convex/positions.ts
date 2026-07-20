/**
 * Position registration queries.
 * Used by: src/routes/s/[slug]/+page.server.ts (Power Landscape)
 */

import { query, mutation, internalQuery } from './_generated/server';
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
const DIRECT_DELIVERY_ID_MAX_CHARS = 128;
const DIRECT_DELIVERY_NAME_MAX_CHARS = 200;
const DIRECT_DELIVERY_METHOD_MAX_CHARS = 32;
const DIRECT_DELIVERY_ENVELOPE_MAX_CHARS = 2_048;
const DIRECT_DELIVERY_METHODS = new Set(['cwc', 'email', 'recorded']);

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
 * Confirm a mailto send — upserts position + creates delivery record.
 */
export const confirmMailtoSend = mutation({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		identityCommitment: v.string(),
		districtCode: v.optional(v.string()),
		templateTitle: v.optional(v.string())
	},
	handler: async (
		ctx,
		{ _secret, templateId, identityCommitment, districtCode, templateTitle }
	) => {
		requireInternalSecret(_secret);
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

		// Create delivery record
		await ctx.db.insert('positionDeliveries', {
			registrationId,
			recipientName: templateTitle ?? 'mailto recipient',
			deliveryMethod: 'mailto_confirmed',
			deliveryStatus: 'user_confirmed',
			deliveredAt: Date.now()
		});

		return { registrationId, isNewPosition };
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
		// Verify registration exists and belongs to caller
		const reg = await ctx.db.get(registrationId);
		if (!reg || reg.identityCommitment !== identityCommitment) {
			throw new Error('Registration not found');
		}

		let created = 0;
		for (const r of recipients) {
			// Schema requires `recipientName`; an unguarded `doc as any` cast
			// would mask the missing required field and the mutation would
			// be rejected by Convex's runtime validator.
			await ctx.db.insert('positionDeliveries', {
				registrationId,
				recipientName: r.name,
				recipientKey: slugify(r.name),
				deliveryMethod: r.deliveryMethod,
				deliveryStatus: 'pending',
				...(r.encryptedRecipientEmail
					? { encryptedRecipientEmail: r.encryptedRecipientEmail }
					: {}),
				...(r.recipientEmailHash ? { recipientEmailHash: r.recipientEmailHash } : {}),
				...(r.encryptedRecipientName ? { encryptedRecipientName: r.encryptedRecipientName } : {})
			});
			created++;
		}

		return { created };
	}
});

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
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
		districtCode: v.optional(v.string()),
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
	handler: async (ctx, { _secret, pseudonymousId, templateId, districtCode, recipients }) => {
		requireInternalSecret(_secret);
		if (!pseudonymousId || pseudonymousId.length > DIRECT_DELIVERY_ID_MAX_CHARS) {
			throw new Error('DIRECT_DELIVERY_PSEUDONYM_INVALID');
		}
		if (districtCode !== undefined && districtCode.length > 32) {
			throw new Error('DIRECT_DELIVERY_DISTRICT_INVALID');
		}
		if (recipients.length < 1 || recipients.length > DIRECT_DELIVERY_RECIPIENT_MAX) {
			throw new Error('DIRECT_DELIVERY_RECIPIENT_LIMIT_EXCEEDED');
		}
		if (
			new TextEncoder().encode(JSON.stringify(recipients)).byteLength >
			DIRECT_DELIVERY_INPUT_MAX_BYTES
		) {
			throw new Error('DIRECT_DELIVERY_INPUT_TOO_LARGE');
		}
		const normalized = recipients.map((recipient) => {
			if (!recipient.name.trim() || recipient.name.length > DIRECT_DELIVERY_NAME_MAX_CHARS) {
				throw new Error('DIRECT_DELIVERY_RECIPIENT_NAME_INVALID');
			}
			if (
				!recipient.deliveryMethod ||
				recipient.deliveryMethod.length > DIRECT_DELIVERY_METHOD_MAX_CHARS ||
				!DIRECT_DELIVERY_METHODS.has(recipient.deliveryMethod)
			) {
				throw new Error('DIRECT_DELIVERY_METHOD_INVALID');
			}
			for (const value of [
				recipient.email,
				recipient.encryptedRecipientEmail,
				recipient.recipientEmailHash,
				recipient.encryptedRecipientName
			]) {
				if (value !== undefined && value.length > DIRECT_DELIVERY_ENVELOPE_MAX_CHARS) {
					throw new Error('DIRECT_DELIVERY_ENVELOPE_TOO_LARGE');
				}
			}
			const recipientKey = slugify(recipient.name);
			if (!recipientKey) throw new Error('DIRECT_DELIVERY_RECIPIENT_KEY_INVALID');
			return { recipient, recipientKey };
		});
		const now = Date.now();

		let created = 0;
		for (const { recipient: r, recipientKey } of normalized) {
			const existing = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_templateId_pseudonymousId_recipientKey', (idx) =>
					idx
						.eq('templateId', templateId)
						.eq('pseudonymousId', pseudonymousId)
						.eq('recipientKey', recipientKey)
				)
				.take(2);
			if (existing.length > 1) throw new Error('DIRECT_DELIVERY_IDENTITY_MULTIPLICITY');
			if (existing.length === 1) continue;

			await ctx.db.insert('positionDeliveries', {
				pseudonymousId,
				templateId,
				recipientKey,
				recipientName: r.name,
				deliveryMethod: r.deliveryMethod,
				deliveryStatus: 'pending',
				deliveredAt: now,
				...(districtCode ? { districtCode } : {}),
				...(r.encryptedRecipientEmail
					? { encryptedRecipientEmail: r.encryptedRecipientEmail }
					: {}),
				...(r.recipientEmailHash ? { recipientEmailHash: r.recipientEmailHash } : {}),
				...(r.encryptedRecipientName ? { encryptedRecipientName: r.encryptedRecipientName } : {})
			});
			created++;
		}

		return { created };
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
