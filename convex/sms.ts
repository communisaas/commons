/**
 * SMS blast queries and mutations.
 * Used by: org/[slug]/sms/* page servers and API routes.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { tryDecryptPii, decryptSupporterName, type EncryptedPii } from "./_pii";

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
        // Decrypt phone from encryptedTo — no plaintext fallback
        let phone: string | null = null;
        if (m.encryptedTo) {
          const decrypted = await tryDecryptPii(
            JSON.parse(m.encryptedTo) as EncryptedPii,
            "smsMsg:" + m._id,
            "to",
          );
          if (decrypted) phone = decrypted;
        }
        return {
          _id: m._id,
          _creationTime: m._creationTime,
          recipientName: supporter
            ? (await decryptSupporterName(supporter) ?? "Unknown")
            : "Unknown",
          to: phone,
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
        // Decrypt phone from encryptedTo — no plaintext fallback
        let phone: string | null = null;
        if (m.encryptedTo) {
          const decrypted = await tryDecryptPii(
            JSON.parse(m.encryptedTo) as EncryptedPii,
            "smsMsg:" + m._id,
            "to",
          );
          if (decrypted) phone = decrypted;
        }
        return {
          _id: m._id,
          _creationTime: m._creationTime,
          recipientName: supporter
            ? (await decryptSupporterName(supporter) ?? "Unknown")
            : "Unknown",
          to: phone,
          body: m.body,
          status: m.status,
          errorCode: m.errorCode ?? null,
        };
      }),
    );
  },
});

/**
 * Create an SMS blast (draft).
 */
export const createBlast = mutation({
  args: {
    slug: v.string(),
    body: v.string(),
    fromNumber: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    recipientFilter: v.optional(v.any()),
    totalRecipients: v.number(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

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
    recipientFilter: v.optional(v.any()),
    totalRecipients: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found");

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
