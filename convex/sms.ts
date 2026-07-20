/**
 * SMS blast queries and mutations.
 * Used by: org/[slug]/sms/* page servers and API routes.
 */

import { query, mutation, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { smsRecipientFilterValidator, smsBlastStatus, smsMessageStatus } from './_validators';
import { requireOrgRole } from './_authHelpers';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { normalizeSmsAudienceFilter, type SmsAudienceFilter } from './_audienceFilters';
import { applyProjectedAudienceMembership } from './_emailRecipientFilter';
import { requireAudienceDispatchJobsReady } from './lib/audienceDispatchGate';
import {
	getSmsReplySummaryMigration,
	recordSmsReply,
	SMS_REPLY_SUMMARY_MIGRATION_KEY,
	SMS_REPLY_SUMMARY_VERSION
} from './lib/smsReplySummary';
import { filterSmsSendAuthorized } from './lib/contactAuthority';

/**
 * Carrier text dispatch accepts at most this many recipients per batch.
 * Convex modules cannot import from src/lib, so this bound is duplicated as
 * MAX_DECRYPTED_SMS_DISPATCH in src/lib/data/org-limit-sentences.ts; a parity
 * test (tests/unit/convex/sms-batch-limit-parity.test.ts) pins the two equal.
 */
export const SMS_CLIENT_DISPATCH_BATCH_LIMIT = 100;
const SMS_REPLY_SUMMARY_MIGRATION_PAGE_SIZE = 100;

type SmsRecipientFilterShape = SmsAudienceFilter;

function readSafeSmsRecipientFilter(raw: unknown): SmsRecipientFilterShape {
	return normalizeSmsAudienceFilter(raw);
}

async function applySmsRecipientFilter<T extends Doc<'supporters'>>(
	ctx: Pick<QueryCtx | MutationCtx, 'db'>,
	orgId: Id<'organizations'>,
	supporters: T[],
	filter: SmsRecipientFilterShape
): Promise<Array<T & { encryptedPhone: string }>> {
	let filtered = supporters.filter(
		(supporter): supporter is T & { encryptedPhone: string } =>
			supporter.smsStatus === 'subscribed' && !!supporter.encryptedPhone
	);
	filtered = await filterSmsSendAuthorized(ctx, filtered);

	return await applyProjectedAudienceMembership(ctx, orgId, filtered, {
		includeTagIds: filter.tags,
		excludeTagIds: filter.excludeTags,
		segmentIds: filter.segments
	});
}

/**
 * Synchronous carrier-boundary recheck for the exact decrypted batch. The
 * cohort loader performs the same authority check, but STOP can arrive between
 * browser decryption and the server-side Twilio loop; this second read keeps
 * provider admission tied to the latest committed authority row.
 */
export const assertDispatchRecipientsAuthorized = query({
	args: {
		slug: v.string(),
		supporterIds: v.array(v.id('supporters'))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		if (
			args.supporterIds.length < 1 ||
			args.supporterIds.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT
		) {
			throw new Error('SMS_CONTACT_AUTHORITY_BATCH_INVALID');
		}
		const unique = new Set(args.supporterIds.map(String));
		if (unique.size !== args.supporterIds.length) {
			throw new Error('SMS_CONTACT_AUTHORITY_DUPLICATE_SUPPORTER');
		}
		const supporters: Array<Doc<'supporters'>> = [];
		for (const supporterId of args.supporterIds) {
			const supporter = await ctx.db.get(supporterId);
			if (!supporter || supporter.orgId !== org._id || supporter.smsStatus !== 'subscribed') {
				throw new Error('SMS_CONTACT_AUTHORITY_SUPPORTER_INELIGIBLE');
			}
			supporters.push(supporter);
		}
		const allowed = await filterSmsSendAuthorized(ctx, supporters);
		if (allowed.length !== supporters.length) throw new Error('SMS_CONTACT_AUTHORITY_DENIED');
		return { authorized: true as const, checked: allowed.length };
	}
});

/**
 * Page size for the bounded supporter scan that backs SMS recipient
 * resolution. One indexed `by_orgId` read per page — far below the per-read
 * ~16K doc cap, so a single page never throws.
 */
export const SMS_RECIPIENT_SCAN_PAGE = 100;

/**
 * Cohort ceiling for the eligible-SMS-recipient scan. The dispatch cohort
 * loader slices to SMS_CLIENT_DISPATCH_BATCH_LIMIT per batch, but the
 * composer-side audience count needs a bounded eligible total. The scan stops
 * one past the cap so a saturated cohort surfaces as a floor instead of an
 * unbounded `.collect()` (which throws past the per-read doc cap on a large
 * roster).
 */
export const SMS_RECIPIENT_COHORT_CAP = 10_000;
export const SMS_RECIPIENT_SCAN_CAP = 10_000;
// 512 KiB = 1/2,048 of the shared 1 GiB monthly free allowance (0.0488%).
// SplitRequired fails closed before a single editor count can read beyond it.
export const SMS_RECIPIENT_MAX_BYTES_PER_PAGE = 512 * 1024;
const SMS_RECIPIENT_MAX_CURSOR_BYTES = 2_048;

type SmsReadCtx = QueryCtx | MutationCtx;

async function pageSmsRecipients<T extends Doc<'supporters'>>(
	ctx: SmsReadCtx,
	orgId: Id<'organizations'>,
	filter: SmsRecipientFilterShape,
	cursor: string | null
): Promise<{
	recipients: Array<T & { encryptedPhone: string }>;
	continueCursor: string | null;
	isDone: boolean;
	scannedCount: number;
}> {
	const normalized = normalizeSmsAudienceFilter(filter);
	if (
		cursor !== null &&
		new TextEncoder().encode(cursor).byteLength > SMS_RECIPIENT_MAX_CURSOR_BYTES
	) {
		throw new Error('SMS_AUDIENCE_CURSOR_TOO_LARGE');
	}
	const result = await ctx.db
		.query('supporters')
		.withIndex('by_orgId_smsStatus', (idx) => idx.eq('orgId', orgId).eq('smsStatus', 'subscribed'))
		.order('asc')
		.paginate({
			cursor,
			numItems: SMS_RECIPIENT_SCAN_PAGE,
			maximumRowsRead: SMS_RECIPIENT_SCAN_PAGE + 1,
			maximumBytesRead: SMS_RECIPIENT_MAX_BYTES_PER_PAGE
		});
	if (result.pageStatus === 'SplitRequired') throw new Error('SMS_AUDIENCE_PAGE_SPLIT_REQUIRED');
	const recipients = result.page.length
		? await applySmsRecipientFilter(ctx, orgId, result.page as T[], normalized)
		: [];
	return {
		recipients,
		continueCursor: result.isDone ? null : result.continueCursor,
		isDone: result.isDone,
		scannedCount: result.page.length
	};
}

/**
 * List SMS blasts for an org.
 */
export const listBlasts = query({
	args: { slug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, limit }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const max = Math.min(limit ?? 50, 200);

		const blasts = await ctx.db
			.query('smsBlasts')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.order('desc')
			.take(max);

		return blasts.map((b) => ({
			_id: b._id,
			_creationTime: b._creationTime,
			body: b.body,
			status: b.status,
			sentCount: b.sentCount,
			deliveredCount: b.deliveredCount,
			failedCount: b.failedCount,
			totalRecipients: b.totalRecipients,
			// recordDispatchBatch maintains this exact scalar. Avoid rebuilding
			// every blast's message history on the list page.
			messageCount: b.recordedCount ?? b.sentCount + b.failedCount,
			sentAt: b.sentAt ?? null
		}));
	}
});

/**
 * Get a single SMS blast with recent messages.
 */
export const getBlast = query({
	args: { slug: v.string(), blastId: v.id('smsBlasts') },
	handler: async (ctx, { slug, blastId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const blast = await ctx.db.get(blastId);
		if (!blast || blast.orgId !== org._id) return null;

		const messages = await ctx.db
			.query('smsMessages')
			.withIndex('by_blastId', (idx) => idx.eq('blastId', blastId))
			.order('desc')
			.take(20);

		const enrichedMessages = await Promise.all(
			messages.map(async (m) => {
				const supporter = await ctx.db.get(m.supporterId);
				return {
					_id: m._id,
					_creationTime: m._creationTime,
					encryptedName: supporter?.encryptedName ?? null,
					encryptedTo: m.encryptedTo ?? null,
					status: m.status,
					errorCode: m.errorCode ?? null
				};
			})
		);

		return {
			blast: {
				_id: blast._id,
				_creationTime: blast._creationTime,
				body: blast.body,
				fromNumber: blast.fromNumber,
				status: blast.status,
				sentCount: blast.sentCount,
				deliveredCount: blast.deliveredCount,
				failedCount: blast.failedCount,
				totalRecipients: blast.totalRecipients,
				sentAt: blast.sentAt ?? null,
				campaignId: blast.campaignId ?? null
			},
			messages: enrichedMessages
		};
	}
});

/**
 * Aggregate inbound free-text SMS replies for one org.
 *
 * This is response evidence only. It does not expose plaintext phone
 * numbers and it does not imply an operator inbox, autoresponder, legal
 * workflow, or reader-office notification loop.
 */
export const getReplySummary = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const migration = await getSmsReplySummaryMigration(ctx);
		if (migration?.status !== 'ready') throw new Error('SMS_REPLY_SUMMARY_NOT_READY');
		const summary = await ctx.db
			.query('smsReplySummaries')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.unique();
		if (summary && summary.version !== SMS_REPLY_SUMMARY_VERSION) {
			throw new Error('SMS_REPLY_SUMMARY_ROW_NOT_READY');
		}

		return {
			replyCount: summary?.replyCount ?? 0,
			matchedSupporterCount: summary?.matchedSupporterCount ?? 0,
			linkedBlastCount: summary?.linkedBlastCount ?? 0,
			latestReceivedAt: summary?.latestReceivedAt ?? null
		};
	}
});

export const smsReplySummaryMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => await getSmsReplySummaryMigration(ctx)
});

export const migrateSmsReplySummaries = internalMutation({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		restart: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		let migration = await getSmsReplySummaryMigration(ctx);
		if (!migration) {
			const id = await ctx.db.insert('smsReplySummaryMigrations', {
				key: SMS_REPLY_SUMMARY_MIGRATION_KEY,
				status: 'running',
				scanned: 0,
				projected: 0,
				startedAt: now,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		} else if (migration.status === 'ready') {
			return migration;
		} else if (args.restart && (args.cursor ?? null) === null) {
			await ctx.db.patch(migration._id, {
				status: 'running',
				cursor: undefined,
				scanned: 0,
				projected: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				completedAt: undefined,
				startedAt: now,
				updatedAt: now
			});
			migration = await ctx.db.get(migration._id);
		}
		if (!migration) throw new Error('SMS_REPLY_SUMMARY_MIGRATION_STATE_MISSING');
		if (migration.status === 'migrated') return migration;
		if (migration.status === 'blocked' && !args.restart) return migration;
		const expectedCursor = migration.cursor ?? null;
		if ((args.cursor ?? null) !== expectedCursor) {
			throw new Error('SMS_REPLY_SUMMARY_MIGRATION_CURSOR_MISMATCH');
		}
		const page = await ctx.db.query('smsReplies').paginate({
			numItems: SMS_REPLY_SUMMARY_MIGRATION_PAGE_SIZE,
			cursor: expectedCursor,
			maximumRowsRead: SMS_REPLY_SUMMARY_MIGRATION_PAGE_SIZE + 1,
			maximumBytesRead: 2 * 1024 * 1024
		});
		let projected = 0;
		let failureSourceId: string | undefined;
		try {
			for (const reply of page.page) {
				failureSourceId = String(reply._id);
				if (reply.summaryVersion === SMS_REPLY_SUMMARY_VERSION) continue;
				await recordSmsReply(ctx, reply, now);
				await ctx.db.patch(reply._id, { summaryVersion: SMS_REPLY_SUMMARY_VERSION });
				projected += 1;
			}
		} catch (error) {
			const failureCode =
				error instanceof Error
					? error.message.slice(0, 200)
					: 'SMS_REPLY_SUMMARY_PROJECTION_FAILED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				failureSourceId,
				updatedAt: now
			});
			return { ...migration, status: 'blocked' as const, failureCode, failureSourceId };
		}
		const patch = {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned: migration.scanned + page.page.length,
			projected: migration.projected + projected,
			completedAt: page.isDone ? now : undefined,
			updatedAt: now
		};
		await ctx.db.patch(migration._id, patch);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.sms.migrateSmsReplySummaries, {
				cursor: page.continueCursor
			});
		}
		return { ...migration, ...patch };
	}
});

export const activateSmsReplySummaries = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await getSmsReplySummaryMigration(ctx);
		if (migration?.status === 'ready') return migration;
		if (
			!migration ||
			migration.status !== 'migrated' ||
			migration.cursor !== undefined ||
			migration.completedAt === undefined ||
			migration.failureCode !== undefined
		) {
			throw new Error('SMS_REPLY_SUMMARY_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

/**
 * Recent inbound free-text SMS replies for an org or a single text record.
 */
export const listReplies = query({
	args: {
		slug: v.string(),
		blastId: v.optional(v.id('smsBlasts')),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { slug, blastId, limit }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const max = Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);

		let replies: Doc<'smsReplies'>[];
		if (blastId) {
			const blast = await ctx.db.get(blastId);
			if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
			replies = await ctx.db
				.query('smsReplies')
				.withIndex('by_blastId', (idx) => idx.eq('blastId', blastId))
				.order('desc')
				.take(max);
		} else {
			replies = await ctx.db
				.query('smsReplies')
				.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
				.order('desc')
				.take(max);
		}

		return replies.map((reply) => ({
			_id: reply._id,
			body: reply.body,
			matchedSupporter: !!reply.supporterId,
			linkedBlastId: reply.blastId ?? null,
			receivedAt: reply.receivedAt
		}));
	}
});

/**
 * Get the encrypted, eligible phone cohort for one browser-dispatched SMS draft.
 *
 * The browser still needs the org key to decrypt phones. This query never
 * returns plaintext phone numbers and refuses to widen beyond the saved SMS
 * recipient filter on the draft.
 */
export const getEncryptedRecipientsForBlast = query({
	args: { slug: v.string(), blastId: v.id('smsBlasts') },
	handler: async (ctx, { slug, blastId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		requireAudienceDispatchJobsReady();

		const blast = await ctx.db.get(blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
		if (blast.status !== 'draft' && blast.status !== 'sending') {
			throw new Error('Only draft or sending text delivery records can load a dispatch cohort');
		}

		if (blast.dispatchComplete) {
			return {
				eligibleCount: blast.totalRecipients,
				dispatchedCount: blast.recordedCount ?? 0,
				remainingCount: 0,
				batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
				truncated: false,
				hasMore: false,
				pageCursor: blast.dispatchCursor ?? null,
				continueCursor: null,
				scannedCount: 0,
				scanDone: true,
				recipients: []
			};
		}
		const pageCursor = blast.dispatchCursor ?? null;
		const page = await pageSmsRecipients(
			ctx,
			org._id,
			readSafeSmsRecipientFilter(blast.recipientFilter),
			pageCursor
		);
		const totalScanned = (blast.dispatchScannedCount ?? 0) + page.scannedCount;
		if (
			totalScanned > SMS_RECIPIENT_SCAN_CAP ||
			(!page.isDone && totalScanned >= SMS_RECIPIENT_SCAN_CAP)
		) {
			throw new Error('SMS_AUDIENCE_SCAN_LIMIT_EXCEEDED');
		}
		const recipients = page.recipients.map((supporter) => ({
			_id: supporter._id,
			encryptedPhone: supporter.encryptedPhone,
			phoneHash: supporter.phoneHash ?? null,
			emailHash: supporter.emailHash
		}));
		const dispatchedCount = blast.recordedCount ?? 0;

		return {
			eligibleCount: blast.totalRecipients,
			dispatchedCount,
			remainingCount: Math.max(0, blast.totalRecipients - dispatchedCount),
			batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
			truncated: false,
			hasMore: !page.isDone,
			pageCursor,
			continueCursor: page.continueCursor,
			scannedCount: page.scannedCount,
			scanDone: page.isDone,
			recipients
		};
	}
});

/**
 * Count the eligible encrypted-phone cohort for an SMS recipient filter.
 *
 * This is the composer-side audience snapshot: no plaintext phones leave
 * storage, and the count uses the same eligibility/filter path as the
 * dispatch cohort loader below. Carrier delivery still requires
 * getEncryptedRecipientsForBlast + browser org-key decrypt at send time.
 */
export const countEligibleRecipientsForFilter = query({
	args: {
		slug: v.string(),
		recipientFilter: v.optional(smsRecipientFilterValidator),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, { slug, recipientFilter, cursor }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const filter = readSafeSmsRecipientFilter(recipientFilter);
		const isUnfiltered =
			(filter.tags?.length ?? 0) === 0 &&
			(filter.segments?.length ?? 0) === 0 &&
			(filter.excludeTags?.length ?? 0) === 0;
		if (cursor == null && isUnfiltered && org.supporterStats?.smsDispatchEligible !== undefined) {
			return {
				pageCount: org.supporterStats.smsDispatchEligible,
				continueCursor: null,
				isDone: true,
				scannedCount: 0,
				batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
				maxRecipients: SMS_RECIPIENT_COHORT_CAP,
				maxScanned: SMS_RECIPIENT_SCAN_CAP,
				source: 'organizations.supporterStats.smsDispatchEligible'
			};
		}
		const page = await pageSmsRecipients(ctx, org._id, filter, cursor ?? null);

		return {
			pageCount: page.recipients.length,
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scannedCount: page.scannedCount,
			batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
			maxRecipients: SMS_RECIPIENT_COHORT_CAP,
			maxScanned: SMS_RECIPIENT_SCAN_CAP,
			source: 'sms.pageSmsRecipients'
		};
	}
});

/**
 * Get SMS blast messages (paginated) for blast detail messages endpoint.
 */
export const getBlastMessages = query({
	args: {
		slug: v.string(),
		blastId: v.id('smsBlasts'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { slug, blastId, limit }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const max = Math.min(limit ?? 50, 200);

		const blast = await ctx.db.get(blastId);
		if (!blast || blast.orgId !== org._id) return [];

		const messages = await ctx.db
			.query('smsMessages')
			.withIndex('by_blastId', (idx) => idx.eq('blastId', blastId))
			.order('desc')
			.take(max);

		return await Promise.all(
			messages.map(async (m) => {
				const supporter = await ctx.db.get(m.supporterId);
				return {
					_id: m._id,
					_creationTime: m._creationTime,
					encryptedName: supporter?.encryptedName ?? null,
					encryptedTo: m.encryptedTo ?? null,
					body: m.body,
					status: m.status,
					errorCode: m.errorCode ?? null
				};
			})
		);
	}
});

/**
 * SMS body cap. SMS messages are typically ≤160 chars (1 GSM segment);
 * multi-segment messages can reach 1600 chars (10 segments) but each
 * segment is billed separately. 2048 is generous for line breaks /
 * non-GSM encoding while preventing arbitrarily large blast bodies
 * from poisoning the persistence layer.
 */
const MAX_SMS_BODY_LENGTH = 2048;

/**
 * Known SMS blast statuses. Free-form `v.string()` would accept
 * arbitrary values → downstream branches on `status === 'sent'` see
 * a blast stuck in undefined state.
 */
const ALLOWED_SMS_BLAST_STATUSES = ['draft', 'sending', 'sent', 'failed'] as const;

/**
 * Create an SMS blast (draft).
 */
export const createBlast = mutation({
	args: {
		slug: v.string(),
		body: v.string(),
		fromNumber: v.string(),
		campaignId: v.optional(v.id('campaigns')),
		recipientFilter: v.optional(smsRecipientFilterValidator),
		totalRecipients: v.number()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		// Bounds + sanity. Body length capped — without the cap, a 1 MiB
		// body would persist and consume billing rows on dispatch.
		// fromNumber capped at E.164 max (15 digits + leading + ≤ 16 chars,
		// pad to 32 for safety); totalRecipients non-negative + bounded.
		if (args.body.length > MAX_SMS_BODY_LENGTH) {
			throw new Error('SMS_BODY_TOO_LARGE');
		}
		if (args.body.length === 0) throw new Error('SMS_BODY_EMPTY');
		if (args.fromNumber.length > 32) throw new Error('FROM_NUMBER_TOO_LARGE');
		if (args.totalRecipients < 0) throw new Error('TOTAL_RECIPIENTS_NEGATIVE');
		if (!Number.isSafeInteger(args.totalRecipients)) throw new Error('TOTAL_RECIPIENTS_INVALID');
		if (args.totalRecipients > SMS_RECIPIENT_COHORT_CAP)
			throw new Error('TOTAL_RECIPIENTS_TOO_LARGE');
		const recipientFilter = normalizeSmsAudienceFilter(args.recipientFilter);

		const id = await ctx.db.insert('smsBlasts', {
			orgId: org._id,
			campaignId: args.campaignId,
			body: args.body,
			fromNumber: args.fromNumber,
			recipientFilter: Object.keys(recipientFilter).length > 0 ? recipientFilter : undefined,
			totalRecipients: args.totalRecipients,
			sentCount: 0,
			deliveredCount: 0,
			failedCount: 0,
			status: 'draft',
			dispatchCursor: undefined,
			dispatchScannedCount: 0,
			dispatchComplete: false,
			recordedCount: 0,
			updatedAt: Date.now()
		});

		return { _id: id };
	}
});

/**
 * Update an SMS blast (draft only).
 */
export const updateBlast = mutation({
	args: {
		slug: v.string(),
		blastId: v.id('smsBlasts'),
		body: v.optional(v.string()),
		recipientFilter: v.optional(v.union(smsRecipientFilterValidator, v.null())),
		totalRecipients: v.optional(v.number()),
		// Pin status to documented enum; free-form `v.string()` would let
		// writers drift from the four known states.
		status: v.optional(smsBlastStatus)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
		if (blast.status !== 'draft')
			throw new Error('Only draft text delivery records can be updated');

		// Bounds on updateable fields (parallel to createBlast).
		if (args.body !== undefined) {
			if (args.body.length > MAX_SMS_BODY_LENGTH) throw new Error('SMS_BODY_TOO_LARGE');
			if (args.body.length === 0) throw new Error('SMS_BODY_EMPTY');
		}
		if (args.totalRecipients !== undefined) {
			if (args.totalRecipients < 0) throw new Error('TOTAL_RECIPIENTS_NEGATIVE');
			if (!Number.isSafeInteger(args.totalRecipients)) throw new Error('TOTAL_RECIPIENTS_INVALID');
			if (args.totalRecipients > SMS_RECIPIENT_COHORT_CAP)
				throw new Error('TOTAL_RECIPIENTS_TOO_LARGE');
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.body !== undefined) patch.body = args.body;
		if (args.recipientFilter !== undefined) {
			const recipientFilter = normalizeSmsAudienceFilter(args.recipientFilter);
			patch.recipientFilter = Object.keys(recipientFilter).length > 0 ? recipientFilter : undefined;
			patch.dispatchCursor = undefined;
			patch.dispatchScannedCount = 0;
			patch.dispatchComplete = false;
			patch.recordedCount = 0;
		}
		if (args.totalRecipients !== undefined) patch.totalRecipients = args.totalRecipients;
		if (args.status !== undefined) patch.status = args.status;

		await ctx.db.patch(args.blastId, patch);
		return { success: true };
	}
});

/**
 * Record one bounded carrier-dispatch batch.
 *
 * The HTTP runner sends only client-decrypted phone values; Convex never
 * receives plaintext phone numbers. This mutation re-checks org membership,
 * supporter ownership, and SMS subscription before it writes message receipts
 * and advances blast counters.
 */
export const recordDispatchBatch = mutation({
	args: {
		slug: v.string(),
		blastId: v.id('smsBlasts'),
		pageCursor: v.union(v.string(), v.null()),
		expectedTotalRecipients: v.number(),
		finalBatch: v.optional(v.boolean()),
		results: v.array(
			v.object({
				supporterId: v.id('supporters'),
				encryptedTo: v.optional(v.string()),
				toHash: v.optional(v.string()),
				twilioSid: v.optional(v.string()),
				status: smsMessageStatus,
				errorCode: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		requireAudienceDispatchJobsReady();
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
		if (blast.status !== 'draft' && blast.status !== 'sending') {
			throw new Error('Only draft or sending text delivery records can be dispatched');
		}
		if (args.results.length === 0) throw new Error('SMS_DISPATCH_EMPTY_BATCH');
		if (args.results.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT)
			throw new Error('SMS_DISPATCH_BATCH_TOO_LARGE');
		if (!Number.isSafeInteger(args.expectedTotalRecipients))
			throw new Error('SMS_DISPATCH_EXPECTED_TOTAL_INVALID');
		if (args.expectedTotalRecipients < args.results.length)
			throw new Error('SMS_DISPATCH_EXPECTED_TOTAL_TOO_SMALL');
		if (args.expectedTotalRecipients > SMS_RECIPIENT_COHORT_CAP)
			throw new Error('SMS_DISPATCH_EXPECTED_TOTAL_TOO_LARGE');
		if (args.expectedTotalRecipients !== blast.totalRecipients)
			throw new Error('SMS_DISPATCH_EXPECTED_TOTAL_MISMATCH');

		const storedCursor = blast.dispatchCursor ?? null;
		if (storedCursor !== args.pageCursor) throw new Error('SMS_DISPATCH_CURSOR_STALE');
		if (blast.dispatchComplete) throw new Error('SMS_DISPATCH_COHORT_COMPLETE');
		const page = await pageSmsRecipients(
			ctx,
			org._id,
			readSafeSmsRecipientFilter(blast.recipientFilter),
			storedCursor
		);
		const allowedIds = new Set(page.recipients.map((supporter) => String(supporter._id)));
		if (allowedIds.size !== args.results.length) throw new Error('SMS_DISPATCH_PAGE_INCOMPLETE');
		for (const result of args.results) {
			if (!allowedIds.has(String(result.supporterId))) {
				throw new Error('SMS_DISPATCH_SUPPORTER_NOT_IN_CURRENT_PAGE');
			}
		}
		const totalScanned = (blast.dispatchScannedCount ?? 0) + page.scannedCount;
		if (
			totalScanned > SMS_RECIPIENT_SCAN_CAP ||
			(!page.isDone && totalScanned >= SMS_RECIPIENT_SCAN_CAP)
		) {
			throw new Error('SMS_AUDIENCE_SCAN_LIMIT_EXCEEDED');
		}
		if (args.finalBatch !== undefined && args.finalBatch !== page.isDone) {
			throw new Error('SMS_DISPATCH_FINAL_PAGE_MISMATCH');
		}

		let batchSentCount = 0;
		let batchFailedCount = 0;
		const seenSupporters = new Set<string>();

		for (const result of args.results) {
			if (seenSupporters.has(result.supporterId)) {
				throw new Error('SMS_DISPATCH_DUPLICATE_SUPPORTER');
			}
			const existing = await ctx.db
				.query('smsMessages')
				.withIndex('by_blastId_supporterId', (idx) =>
					idx.eq('blastId', args.blastId).eq('supporterId', result.supporterId)
				)
				.unique();
			if (existing) {
				throw new Error('SMS_DISPATCH_SUPPORTER_ALREADY_RECORDED');
			}
			seenSupporters.add(result.supporterId);
			const supporter = page.recipients.find((candidate) => candidate._id === result.supporterId);
			if (!supporter) throw new Error('SMS_DISPATCH_SUPPORTER_SCOPE_MISMATCH');

			if (result.status === 'failed') batchFailedCount += 1;
			else batchSentCount += 1;

			await ctx.db.insert('smsMessages', {
				blastId: args.blastId,
				supporterId: result.supporterId,
				encryptedTo: result.encryptedTo ?? supporter.encryptedPhone,
				toHash: result.toHash ?? supporter.phoneHash,
				body: blast.body,
				twilioSid: result.twilioSid,
				status: result.status,
				errorCode: result.errorCode
			});
		}

		const now = Date.now();
		const sentCount = blast.sentCount + batchSentCount;
		const failedCount = blast.failedCount + batchFailedCount;
		const deliveredCount = blast.deliveredCount;
		const recordedCount = (blast.recordedCount ?? 0) + args.results.length;
		const expectedTotalRecipients = blast.totalRecipients;
		const finalBatch = page.isDone;
		if (finalBatch && recordedCount !== expectedTotalRecipients) {
			throw new Error('SMS_DISPATCH_COHORT_DRIFT');
		}
		const status = finalBatch ? (sentCount + deliveredCount > 0 ? 'sent' : 'failed') : 'sending';
		// Plan usage consumes this monotonic lifetime scalar. Fold only carrier-
		// accepted results (queued/sent/delivered; never failed) in the same
		// transaction as the unique message receipts and cursor advance. A retry
		// fails the receipt uniqueness/cursor guards before reaching this patch.
		if (batchSentCount > 0) {
			await ctx.db.patch(org._id, {
				smsSentCount: (org.smsSentCount ?? 0) + batchSentCount,
				updatedAt: now
			});
		}
		await ctx.db.patch(args.blastId, {
			totalRecipients: expectedTotalRecipients,
			sentCount,
			failedCount,
			deliveredCount,
			status,
			dispatchCursor: page.isDone ? undefined : (page.continueCursor ?? undefined),
			dispatchScannedCount: totalScanned,
			dispatchComplete: page.isDone,
			recordedCount,
			sentAt: blast.sentAt ?? now,
			updatedAt: now
		});

		return {
			totalRecipients: expectedTotalRecipients,
			sentCount,
			failedCount,
			deliveredCount,
			batchSentCount,
			batchFailedCount,
			recordedCount,
			status,
			dispatchComplete: finalBatch,
			dispatchCursor: finalBatch ? null : page.continueCursor
		};
	}
});

/**
 * Advance across one supporter page that contains no filter matches.
 *
 * Sparse filters routinely yield empty pages. Persisting their continuation
 * cursor in a mutation prevents the browser from rebuilding all prior pages
 * merely to find the next non-empty carrier batch.
 */
export const advanceEmptyDispatchPage = mutation({
	args: {
		slug: v.string(),
		blastId: v.id('smsBlasts'),
		pageCursor: v.union(v.string(), v.null()),
		expectedTotalRecipients: v.number()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		requireAudienceDispatchJobsReady();
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
		if (blast.status !== 'draft' && blast.status !== 'sending') {
			throw new Error('Only draft or sending text delivery records can advance');
		}
		if (blast.dispatchComplete) throw new Error('SMS_DISPATCH_COHORT_COMPLETE');
		if (args.expectedTotalRecipients !== blast.totalRecipients) {
			throw new Error('SMS_DISPATCH_EXPECTED_TOTAL_MISMATCH');
		}
		const storedCursor = blast.dispatchCursor ?? null;
		if (storedCursor !== args.pageCursor) throw new Error('SMS_DISPATCH_CURSOR_STALE');
		const page = await pageSmsRecipients(
			ctx,
			org._id,
			readSafeSmsRecipientFilter(blast.recipientFilter),
			storedCursor
		);
		if (page.recipients.length !== 0) throw new Error('SMS_DISPATCH_PAGE_NOT_EMPTY');
		const totalScanned = (blast.dispatchScannedCount ?? 0) + page.scannedCount;
		if (
			totalScanned > SMS_RECIPIENT_SCAN_CAP ||
			(!page.isDone && totalScanned >= SMS_RECIPIENT_SCAN_CAP)
		) {
			throw new Error('SMS_AUDIENCE_SCAN_LIMIT_EXCEEDED');
		}
		const recordedCount = blast.recordedCount ?? 0;
		if (page.isDone && recordedCount !== blast.totalRecipients) {
			throw new Error('SMS_DISPATCH_COHORT_DRIFT');
		}
		const now = Date.now();
		const status = page.isDone
			? blast.sentCount + blast.deliveredCount > 0
				? 'sent'
				: 'failed'
			: blast.status;
		await ctx.db.patch(args.blastId, {
			dispatchCursor: page.isDone ? undefined : (page.continueCursor ?? undefined),
			dispatchScannedCount: totalScanned,
			dispatchComplete: page.isDone,
			status,
			updatedAt: now,
			...(page.isDone ? { sentAt: blast.sentAt ?? now } : {})
		});
		return {
			status,
			recordedCount,
			dispatchComplete: page.isDone,
			dispatchCursor: page.isDone ? null : page.continueCursor,
			scannedCount: totalScanned
		};
	}
});

/**
 * Delete an empty SMS draft.
 *
 * Message-bearing blasts are immutable launch records. Historical hard-delete
 * collected and deleted an entire (up to 10,000-row) cohort in one mutation,
 * which exceeds safe transaction write bounds. A future retention workflow
 * must page those children durably before removing the parent.
 */
export const deleteBlast = mutation({
	args: { slug: v.string(), blastId: v.id('smsBlasts') },
	handler: async (ctx, { slug, blastId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');

		const blast = await ctx.db.get(blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found');
		if (blast.status !== 'draft') throw new Error('SMS_BLAST_DELETE_DRAFT_ONLY');

		const existingMessage = await ctx.db
			.query('smsMessages')
			.withIndex('by_blastId', (idx) => idx.eq('blastId', blastId))
			.first();
		if (existingMessage) throw new Error('SMS_BLAST_DELETE_REQUIRES_RETENTION_WORKFLOW');

		await ctx.db.delete(blastId);
		return { success: true };
	}
});
