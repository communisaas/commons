/**
 * SMS blast queries and mutations.
 * Used by: org/[slug]/sms/* page servers and API routes.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { smsRecipientFilterValidator, smsBlastStatus } from "./_validators";
import { requireOrgRole } from "./_authHelpers";

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
