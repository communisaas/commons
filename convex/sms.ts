/**
 * SMS blast queries and mutations.
 * Used by: org/[slug]/sms/* page servers and API routes.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { smsRecipientFilterValidator, smsBlastStatus, smsMessageStatus } from "./_validators";
import { requireOrgRole } from "./_authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  filterNeedsActionContext,
  matchFilter,
  normalizeSegmentFilter,
  type SegmentActionContext,
  type SegmentFilter,
} from "./_segmentMatch";

/**
 * Carrier text dispatch accepts at most this many recipients per batch.
 * Convex modules cannot import from src/lib, so this bound is duplicated as
 * MAX_DECRYPTED_SMS_DISPATCH in src/lib/data/org-limit-sentences.ts; a parity
 * test (tests/unit/convex/sms-batch-limit-parity.test.ts) pins the two equal.
 */
export const SMS_CLIENT_DISPATCH_BATCH_LIMIT = 100;

type SmsRecipientFilterShape = {
  tags?: Id<"tags">[];
  segments?: Id<"segments">[];
  excludeTags?: Id<"tags">[];
};

function cleanIdArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = Array.from(
    new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0 && item.length <= 64,
      ),
    ),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function readSafeSmsRecipientFilter(raw: unknown): SmsRecipientFilterShape {
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const filter: SmsRecipientFilterShape = {};
  const tags = cleanIdArray(candidate.tags);
  const excludeTags = cleanIdArray(candidate.excludeTags);
  const segments = cleanIdArray(candidate.segments);
  if (tags && tags.length > 0) filter.tags = tags as Id<"tags">[];
  if (excludeTags && excludeTags.length > 0) filter.excludeTags = excludeTags as Id<"tags">[];
  if (segments && segments.length > 0) filter.segments = segments as Id<"segments">[];
  return filter;
}

async function loadSegmentFilters(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  rawSegmentIds: Id<"segments">[] | undefined,
): Promise<SegmentFilter[]> {
  const segmentIds = Array.from(new Set(rawSegmentIds ?? []));
  if (segmentIds.length === 0) return [];

  const filters: SegmentFilter[] = [];
  for (const rawSegmentId of segmentIds) {
    const segmentId = ctx.db.normalizeId("segments", rawSegmentId);
    if (!segmentId) continue;
    const segment = await ctx.db.get(segmentId);
    if (!segment || segment.orgId !== orgId) continue;
    filters.push(normalizeSegmentFilter(segment.filters));
  }
  return filters;
}

async function getSupporterTagIds(ctx: QueryCtx, supporterId: Id<"supporters">): Promise<Set<string>> {
  const tags = await ctx.db
    .query("supporterTags")
    .withIndex("by_supporterId", (idx) => idx.eq("supporterId", supporterId))
    .collect();
  return new Set(tags.map((tag) => String(tag.tagId)));
}

async function getSupporterActionContext(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporterId: Id<"supporters">,
): Promise<SegmentActionContext> {
  const actions = await ctx.db
    .query("campaignActions")
    .withIndex("by_orgId_supporterId", (idx) =>
      idx.eq("orgId", orgId).eq("supporterId", supporterId),
    )
    .collect();
  return {
    campaignIds: new Set(actions.map((action) => String(action.campaignId))),
    districtHashes: new Set(
      actions
        .map((action) => action.districtHash?.trim().toLowerCase())
        .filter((hash): hash is string => !!hash),
    ),
    districtCodes: new Set(
      actions
        .map((action) => action.districtCode?.trim().toUpperCase())
        .filter((code): code is string => !!code),
    ),
    maxEngagementTier: actions.reduce(
      (max, action) => Math.max(max, action.engagementTier ?? 0),
      0,
    ),
  };
}

async function matchesAnySegment(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporter: Doc<"supporters">,
  segmentFilters: SegmentFilter[],
  needsActionContext: boolean,
): Promise<boolean> {
  const tagIds = await getSupporterTagIds(ctx, supporter._id);
  const actionContext = needsActionContext
    ? await getSupporterActionContext(ctx, orgId, supporter._id)
    : undefined;
  return segmentFilters.some((filter) => matchFilter(supporter, tagIds, filter, actionContext));
}

async function applySmsRecipientFilter<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporters: T[],
  filter: SmsRecipientFilterShape,
): Promise<Array<T & { encryptedPhone: string }>> {
  let filtered = supporters.filter(
    (supporter): supporter is T & { encryptedPhone: string } =>
      supporter.smsStatus === "subscribed" && !!supporter.encryptedPhone,
  );

  const tagIds = filter.tags ? Array.from(new Set(filter.tags)) : [];
  if (tagIds.length > 0) {
    const tagLinks = (
      await Promise.all(
        tagIds.map((rawTagId) => {
          const tagId = ctx.db.normalizeId("tags", rawTagId);
          if (!tagId) return Promise.resolve([]);
          return ctx.db
            .query("supporterTags")
            .withIndex("by_tagId", (idx) => idx.eq("tagId", tagId))
            .collect();
        }),
      )
    ).flat();
    const supporterIds = new Set(tagLinks.map((tag) => tag.supporterId));
    filtered = filtered.filter((supporter) => supporterIds.has(supporter._id));
  }

  const excludeTagIds = filter.excludeTags ? Array.from(new Set(filter.excludeTags)) : [];
  if (excludeTagIds.length > 0) {
    const tagLinks = (
      await Promise.all(
        excludeTagIds.map((rawTagId) => {
          const tagId = ctx.db.normalizeId("tags", rawTagId);
          if (!tagId) return Promise.resolve([]);
          return ctx.db
            .query("supporterTags")
            .withIndex("by_tagId", (idx) => idx.eq("tagId", tagId))
            .collect();
        }),
      )
    ).flat();
    const excludedSupporterIds = new Set(tagLinks.map((tag) => tag.supporterId));
    filtered = filtered.filter((supporter) => !excludedSupporterIds.has(supporter._id));
  }

  const segmentFilters = await loadSegmentFilters(ctx, orgId, filter.segments);
  if (filter.segments && filter.segments.length > 0) {
    if (segmentFilters.length === 0) return [];
    const needsActionContext = segmentFilters.some(filterNeedsActionContext);
    const segmentMatched: Array<T & { encryptedPhone: string }> = [];
    for (const supporter of filtered) {
      if (await matchesAnySegment(ctx, orgId, supporter, segmentFilters, needsActionContext)) {
        segmentMatched.push(supporter);
      }
    }
    filtered = segmentMatched;
  }

  return filtered;
}

/**
 * Page size for the bounded supporter scan that backs SMS recipient
 * resolution. One indexed `by_orgId` read per page — far below the per-read
 * ~16K doc cap, so a single page never throws.
 */
const SMS_RECIPIENT_SCAN_PAGE = 1_000;

/**
 * Cohort ceiling for the eligible-SMS-recipient scan. The dispatch cohort
 * loader slices to SMS_CLIENT_DISPATCH_BATCH_LIMIT per batch, but the
 * composer-side audience count needs a bounded eligible total. The scan stops
 * one past the cap so a saturated cohort surfaces as a floor instead of an
 * unbounded `.collect()` (which throws past the per-read doc cap on a large
 * roster).
 */
const SMS_RECIPIENT_COHORT_CAP = 10_000;

interface BoundedSmsRecipients<T> {
  recipients: Array<T & { encryptedPhone: string }>;
  truncated: boolean;
}

/**
 * All SMS-eligible recipients matching the filter, accumulated across bounded
 * pages up to `cap`. Sub-class (A) must-enumerate: the dispatch path needs the
 * actual encrypted-phone rows. Never an unbounded `.collect()` of the roster;
 * the filter (subscribed + has-phone + tag/segment/exclude) is applied per page.
 */
async function collectSmsRecipients<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  filter: SmsRecipientFilterShape,
  cap: number = SMS_RECIPIENT_COHORT_CAP,
): Promise<BoundedSmsRecipients<T>> {
  const out: Array<T & { encryptedPhone: string }> = [];
  let cursor: string | null = null;
  let done = false;

  while (!done && out.length <= cap) {
    const { page, isDone, continueCursor } = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .order("asc")
      .paginate({ cursor, numItems: SMS_RECIPIENT_SCAN_PAGE });

    cursor = continueCursor;
    done = isDone;

    if (page.length > 0) {
      const matches = await applySmsRecipientFilter(ctx, orgId, page as T[], filter);
      out.push(...matches);
    }
  }

  const truncated = out.length > cap;
  return { recipients: truncated ? out.slice(0, cap) : out, truncated };
}

/**
 * List SMS blasts for an org.
 */
export const listBlasts = query({
  args: { slug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { slug, limit }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");
    const max = Math.min(limit ?? 50, 200);

    const blasts = await ctx.db
      .query("smsBlasts")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .order("desc")
      .take(max);

    return await Promise.all(
      blasts.map(async (b) => {
        const messages = await ctx.db
          .query("smsMessages")
          .withIndex("by_blastId", (idx) => idx.eq("blastId", b._id))
          .collect();

        return {
          _id: b._id,
          _creationTime: b._creationTime,
          body: b.body,
          status: b.status,
          sentCount: b.sentCount,
          deliveredCount: b.deliveredCount,
          failedCount: b.failedCount,
          totalRecipients: b.totalRecipients,
          messageCount: messages.length,
          sentAt: b.sentAt ?? null,
        };
      }),
    );
  },
});

/**
 * Get a single SMS blast with recent messages.
 */
export const getBlast = query({
  args: { slug: v.string(), blastId: v.id("smsBlasts") },
  handler: async (ctx, { slug, blastId }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const blast = await ctx.db.get(blastId);
    if (!blast || blast.orgId !== org._id) return null;

    const messages = await ctx.db
      .query("smsMessages")
      .withIndex("by_blastId", (idx) => idx.eq("blastId", blastId))
      .order("desc")
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
          errorCode: m.errorCode ?? null,
        };
      }),
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
        campaignId: blast.campaignId ?? null,
      },
      messages: enrichedMessages,
    };
  },
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
    const { org } = await requireOrgRole(ctx, slug, "member");
    const replies = await ctx.db
      .query("smsReplies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();

    return {
      replyCount: replies.length,
      matchedSupporterCount: replies.filter((reply) => !!reply.supporterId).length,
      linkedBlastCount: replies.filter((reply) => !!reply.blastId).length,
      latestReceivedAt:
        replies.reduce<number | null>(
          (latest, reply) => Math.max(latest ?? 0, reply.receivedAt ?? reply._creationTime),
          null,
        ) ?? null,
    };
  },
});

/**
 * Recent inbound free-text SMS replies for an org or a single text record.
 */
export const listReplies = query({
  args: {
    slug: v.string(),
    blastId: v.optional(v.id("smsBlasts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { slug, blastId, limit }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");
    const max = Math.min(limit ?? 20, 100);

    let replies: Doc<"smsReplies">[];
    if (blastId) {
      const blast = await ctx.db.get(blastId);
      if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");
      replies = await ctx.db
        .query("smsReplies")
        .withIndex("by_blastId", (idx) => idx.eq("blastId", blastId))
        .order("desc")
        .take(max);
    } else {
      replies = await ctx.db
        .query("smsReplies")
        .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
        .order("desc")
        .take(max);
    }

    return replies.map((reply) => ({
      _id: reply._id,
      body: reply.body,
      matchedSupporter: !!reply.supporterId,
      linkedBlastId: reply.blastId ?? null,
      receivedAt: reply.receivedAt,
    }));
  },
});

/**
 * Get the encrypted, eligible phone cohort for one browser-dispatched SMS draft.
 *
 * The browser still needs the org key to decrypt phones. This query never
 * returns plaintext phone numbers and refuses to widen beyond the saved SMS
 * recipient filter on the draft.
 */
export const getEncryptedRecipientsForBlast = query({
  args: { slug: v.string(), blastId: v.id("smsBlasts") },
  handler: async (ctx, { slug, blastId }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const blast = await ctx.db.get(blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");
    if (blast.status !== "draft" && blast.status !== "sending") {
      throw new Error("Only draft or sending text delivery records can load a dispatch cohort");
    }

    const filter = readSafeSmsRecipientFilter(blast.recipientFilter);
    // Bounded scan of already-dispatched supporters for this blast — the
    // exclusion set. Capped at the cohort ceiling +1: the eligible scan below
    // is bounded to the same cap, so any recorded message past it cannot affect
    // which (capped) eligible rows remain. Never an unbounded .collect().
    const existingMessages = await ctx.db
      .query("smsMessages")
      .withIndex("by_blastId", (idx) => idx.eq("blastId", blastId))
      .take(SMS_RECIPIENT_COHORT_CAP + 1);
    const alreadyRecorded = new Set(existingMessages.map((message) => String(message.supporterId)));
    // Sub-class (A) must-enumerate: bounded paginated scan over SMS-eligible
    // supporters — never an unbounded .collect() of the roster.
    const { recipients: eligible } = await collectSmsRecipients(ctx, org._id, filter);
    const remaining = eligible.filter((supporter) => !alreadyRecorded.has(String(supporter._id)));
    const recipients = remaining.slice(0, SMS_CLIENT_DISPATCH_BATCH_LIMIT).map((supporter) => ({
      _id: supporter._id,
      encryptedPhone: supporter.encryptedPhone,
      phoneHash: supporter.phoneHash ?? null,
      emailHash: supporter.emailHash,
    }));

    return {
      eligibleCount: eligible.length,
      dispatchedCount: alreadyRecorded.size,
      remainingCount: remaining.length,
      batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
      truncated: remaining.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT,
      hasMore: remaining.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT,
      recipients,
    };
  },
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
  },
  handler: async (ctx, { slug, recipientFilter }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    // Sub-class (B) count via the same bounded paginated scan as the dispatch
    // cohort — never an unbounded .collect(). `truncated` surfaces a floor when
    // the eligible cohort saturates the cap.
    const { recipients: eligible, truncated } = await collectSmsRecipients(
      ctx,
      org._id,
      readSafeSmsRecipientFilter(recipientFilter),
    );

    return {
      eligibleCount: eligible.length,
      truncated,
      batchLimit: SMS_CLIENT_DISPATCH_BATCH_LIMIT,
      hasMoreThanBatchLimit: eligible.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT,
      source: "sms.applySmsRecipientFilter",
    };
  },
});

/**
 * Get SMS blast messages (paginated) for blast detail messages endpoint.
 */
export const getBlastMessages = query({
  args: {
    slug: v.string(),
    blastId: v.id("smsBlasts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { slug, blastId, limit }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");
    const max = Math.min(limit ?? 50, 200);

    const blast = await ctx.db.get(blastId);
    if (!blast || blast.orgId !== org._id) return [];

    const messages = await ctx.db
      .query("smsMessages")
      .withIndex("by_blastId", (idx) => idx.eq("blastId", blastId))
      .order("desc")
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
          errorCode: m.errorCode ?? null,
        };
      }),
    );
  },
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
const ALLOWED_SMS_BLAST_STATUSES = ["draft", "sending", "sent", "failed"] as const;

/**
 * Create an SMS blast (draft).
 */
export const createBlast = mutation({
  args: {
    slug: v.string(),
    body: v.string(),
    fromNumber: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    recipientFilter: v.optional(smsRecipientFilterValidator),
    totalRecipients: v.number(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    // Bounds + sanity. Body length capped — without the cap, a 1 MiB
    // body would persist and consume billing rows on dispatch.
    // fromNumber capped at E.164 max (15 digits + leading + ≤ 16 chars,
    // pad to 32 for safety); totalRecipients non-negative + bounded.
    if (args.body.length > MAX_SMS_BODY_LENGTH) {
      throw new Error("SMS_BODY_TOO_LARGE");
    }
    if (args.body.length === 0) throw new Error("SMS_BODY_EMPTY");
    if (args.fromNumber.length > 32) throw new Error("FROM_NUMBER_TOO_LARGE");
    if (args.totalRecipients < 0) throw new Error("TOTAL_RECIPIENTS_NEGATIVE");
    if (args.totalRecipients > 1_000_000) throw new Error("TOTAL_RECIPIENTS_TOO_LARGE");

    const id = await ctx.db.insert("smsBlasts", {
      orgId: org._id,
      campaignId: args.campaignId,
      body: args.body,
      fromNumber: args.fromNumber,
      recipientFilter: args.recipientFilter,
      totalRecipients: args.totalRecipients,
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      status: "draft",
      updatedAt: Date.now(),
    });

    return { _id: id };
  },
});

/**
 * Update an SMS blast (draft only).
 */
export const updateBlast = mutation({
  args: {
    slug: v.string(),
    blastId: v.id("smsBlasts"),
    body: v.optional(v.string()),
    recipientFilter: v.optional(smsRecipientFilterValidator),
    totalRecipients: v.optional(v.number()),
    // Pin status to documented enum; free-form `v.string()` would let
    // writers drift from the four known states.
    status: v.optional(smsBlastStatus),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");

    // Bounds on updateable fields (parallel to createBlast).
    if (args.body !== undefined) {
      if (args.body.length > MAX_SMS_BODY_LENGTH) throw new Error("SMS_BODY_TOO_LARGE");
      if (args.body.length === 0) throw new Error("SMS_BODY_EMPTY");
    }
    if (args.totalRecipients !== undefined) {
      if (args.totalRecipients < 0) throw new Error("TOTAL_RECIPIENTS_NEGATIVE");
      if (args.totalRecipients > 1_000_000) throw new Error("TOTAL_RECIPIENTS_TOO_LARGE");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.body !== undefined) patch.body = args.body;
    if (args.recipientFilter !== undefined) patch.recipientFilter = args.recipientFilter;
    if (args.totalRecipients !== undefined) patch.totalRecipients = args.totalRecipients;
    if (args.status !== undefined) patch.status = args.status;

    await ctx.db.patch(args.blastId, patch);
    return { success: true };
  },
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
    blastId: v.id("smsBlasts"),
    expectedTotalRecipients: v.optional(v.number()),
    finalBatch: v.optional(v.boolean()),
    results: v.array(
      v.object({
        supporterId: v.id("supporters"),
        encryptedTo: v.optional(v.string()),
        toHash: v.optional(v.string()),
        twilioSid: v.optional(v.string()),
        status: smsMessageStatus,
        errorCode: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");
    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");
    if (blast.status !== "draft" && blast.status !== "sending") {
      throw new Error("Only draft or sending text delivery records can be dispatched");
    }
    if (args.results.length === 0) throw new Error("SMS_DISPATCH_EMPTY_BATCH");
    if (args.results.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT)
      throw new Error("SMS_DISPATCH_BATCH_TOO_LARGE");
    if (args.expectedTotalRecipients !== undefined) {
      if (args.expectedTotalRecipients < args.results.length) {
        throw new Error("SMS_DISPATCH_EXPECTED_TOTAL_TOO_SMALL");
      }
      if (args.expectedTotalRecipients > 1_000_000) {
        throw new Error("SMS_DISPATCH_EXPECTED_TOTAL_TOO_LARGE");
      }
    }

    const existingMessages = await ctx.db
      .query("smsMessages")
      .withIndex("by_blastId", (idx) => idx.eq("blastId", args.blastId))
      .collect();
    const alreadyRecorded = new Set(existingMessages.map((message) => String(message.supporterId)));

    let batchSentCount = 0;
    let batchFailedCount = 0;
    const seenSupporters = new Set<string>();

    for (const result of args.results) {
      if (seenSupporters.has(result.supporterId)) {
        throw new Error("SMS_DISPATCH_DUPLICATE_SUPPORTER");
      }
      if (alreadyRecorded.has(String(result.supporterId))) {
        throw new Error("SMS_DISPATCH_SUPPORTER_ALREADY_RECORDED");
      }
      seenSupporters.add(result.supporterId);

      const supporter = await ctx.db.get(result.supporterId);
      if (!supporter || supporter.orgId !== org._id) {
        throw new Error("SMS_DISPATCH_SUPPORTER_SCOPE_MISMATCH");
      }
      if (supporter.smsStatus !== "subscribed") {
        throw new Error("SMS_DISPATCH_SUPPORTER_NOT_SUBSCRIBED");
      }

      if (result.status === "failed") batchFailedCount += 1;
      else batchSentCount += 1;

      await ctx.db.insert("smsMessages", {
        blastId: args.blastId,
        supporterId: result.supporterId,
        encryptedTo: result.encryptedTo ?? supporter.encryptedPhone,
        toHash: result.toHash ?? supporter.phoneHash,
        body: blast.body,
        twilioSid: result.twilioSid,
        status: result.status,
        errorCode: result.errorCode,
      });
    }

    const now = Date.now();
    const existingSentCount = existingMessages.filter((message) => message.status === "sent").length;
    const existingDeliveredCount = existingMessages.filter(
      (message) => message.status === "delivered",
    ).length;
    const existingFailedCount = existingMessages.filter((message) => message.status === "failed").length;
    const sentCount = existingSentCount + batchSentCount;
    const failedCount = existingFailedCount + batchFailedCount;
    const deliveredCount = existingDeliveredCount;
    const recordedCount = existingMessages.length + args.results.length;
    const expectedTotalRecipients =
      args.expectedTotalRecipients ?? Math.max(blast.totalRecipients, recordedCount);
    const finalBatch = args.finalBatch === true || recordedCount >= expectedTotalRecipients;
    const status = finalBatch ? (sentCount + deliveredCount > 0 ? "sent" : "failed") : "sending";
    await ctx.db.patch(args.blastId, {
      totalRecipients: expectedTotalRecipients,
      sentCount,
      failedCount,
      deliveredCount,
      status,
      sentAt: blast.sentAt ?? now,
      updatedAt: now,
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
    };
  },
});

/**
 * Delete an SMS blast and its messages.
 */
export const deleteBlast = mutation({
  args: { slug: v.string(), blastId: v.id("smsBlasts") },
  handler: async (ctx, { slug, blastId }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const blast = await ctx.db.get(blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");

    // Delete messages first
    const messages = await ctx.db
      .query("smsMessages")
      .withIndex("by_blastId", (idx) => idx.eq("blastId", blastId))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(blastId);
    return { success: true };
  },
});
