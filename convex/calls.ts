/**
 * Patch-through call queries.
 * Used by: src/routes/org/[slug]/calls/+page.server.ts
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { decryptSupporterName, decryptSupporterPhone, tryDecryptPii, type EncryptedPii } from "./_pii";

/**
 * List patch-through calls for an org, with supporter name join.
 */
export const listCalls = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 50, 200);

    const calls = await ctx.db
      .query("patchThroughCalls")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .order("desc")
      .take(limit);

    // Resolve supporter names (decrypt — no plaintext fallback)
    return await Promise.all(
      calls.map(async (c) => {
        const supporter = await ctx.db.get(c.supporterId);
        const supporterName = supporter
          ? (await decryptSupporterName(supporter) ?? "Unknown")
          : "Unknown";
        // Decrypt targetPhone from encrypted field — no plaintext fallback
        let rawPhone: string | null = null;
        if (c.encryptedTargetPhone) {
          const decrypted = await tryDecryptPii(
            JSON.parse(c.encryptedTargetPhone) as EncryptedPii,
            "call:" + c._id,
            "targetPhone",
          );
          if (decrypted) rawPhone = decrypted;
        }
        return {
          _id: c._id,
          _creationTime: c._creationTime,
          supporterName,
          targetPhone: rawPhone ? "***" + rawPhone.slice(-4) : null,
          targetName: c.targetName ?? null,
          status: c.status,
          duration: c.duration ?? null,
          campaignId: c.campaignId ?? null,
          completedAt: c.completedAt ?? null,
        };
      }),
    );
  },
});

/**
 * Validate supporter belongs to org and has a phone number.
 */
export const validateSupporter = query({
  args: { slug: v.string(), supporterId: v.id("supporters") },
  handler: async (ctx, { slug, supporterId }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    const supporter = await ctx.db.get(supporterId);
    if (!supporter || supporter.orgId !== org._id) return null;
    const name = await decryptSupporterName(supporter);
    const phone = await decryptSupporterPhone(supporter);
    return { _id: supporter._id, phone, name };
  },
});

/**
 * Validate campaign belongs to org.
 */
export const validateCampaign = query({
  args: { slug: v.string(), campaignId: v.id("campaigns") },
  handler: async (ctx, { slug, campaignId }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.orgId !== org._id) return null;
    return { _id: campaign._id };
  },
});

/**
 * Create a patch-through call record.
 */
export const createCall = mutation({
  args: {
    slug: v.string(),
    supporterId: v.id("supporters"),
    callerPhone: v.string(),
    targetPhone: v.string(),
    targetName: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    districtHash: v.optional(v.string()),
    // Optional pre-encrypted fields (caller encrypts before calling)
    encryptedCallerPhone: v.optional(v.string()),
    encryptedTargetPhone: v.optional(v.string()),
    callerPhoneHash: v.optional(v.string()),
    targetPhoneHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");
    const doc: Record<string, unknown> = {
      orgId: org._id,
      supporterId: args.supporterId,
      encryptedCallerPhone: args.encryptedCallerPhone ?? "",
      encryptedTargetPhone: args.encryptedTargetPhone ?? "",
      callerPhoneHash: args.callerPhoneHash ?? null,
      targetPhoneHash: args.targetPhoneHash ?? null,
      targetName: args.targetName ?? null,
      campaignId: args.campaignId ?? null,
      districtHash: args.districtHash ?? null,
      status: "initiated",
      updatedAt: Date.now(),
    };
    const id = await ctx.db.insert("patchThroughCalls", doc as any);
    return { _id: id };
  },
});

/**
 * Update call with Twilio SID after initiation.
 */
export const updateCallSid = mutation({
  args: { callId: v.id("patchThroughCalls"), twilioCallSid: v.string() },
  handler: async (ctx, { callId, twilioCallSid }) => {
    await ctx.db.patch(callId, { twilioCallSid, updatedAt: Date.now() });
    const call = await ctx.db.get(callId);
    return call;
  },
});

/**
 * Update call status (e.g., failed).
 */
export const updateCallStatus = mutation({
  args: { callId: v.id("patchThroughCalls"), status: v.string() },
  handler: async (ctx, { callId, status }) => {
    await ctx.db.patch(callId, { status, updatedAt: Date.now() });
  },
});

/**
 * List calls with pagination (for API GET).
 */
export const listCallsPaginated = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
    statusFilter: v.optional(v.string()),
    campaignIdFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 20, 100);

    let calls = await ctx.db
      .query("patchThroughCalls")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .order("desc")
      .take(limit + 1);

    if (args.statusFilter) {
      calls = calls.filter((c) => c.status === args.statusFilter);
    }
    if (args.campaignIdFilter) {
      calls = calls.filter((c) => c.campaignId === args.campaignIdFilter);
    }

    const hasMore = calls.length > limit;
    const items = calls.slice(0, limit);

    return {
      data: await Promise.all(
        items.map(async (c) => {
          const supporter = await ctx.db.get(c.supporterId);
          // Decrypt targetPhone from encrypted field — no plaintext fallback
          let rawPhone: string | null = null;
          if (c.encryptedTargetPhone) {
            const decrypted = await tryDecryptPii(
              JSON.parse(c.encryptedTargetPhone) as EncryptedPii,
              "call:" + c._id,
              "targetPhone",
            );
            if (decrypted) rawPhone = decrypted;
          }
          return {
            _id: c._id,
            _creationTime: c._creationTime,
            targetPhone: rawPhone ? "***" + rawPhone.slice(-4) : null,
            targetName: c.targetName ?? null,
            status: c.status,
            duration: c.duration ?? null,
            twilioCallSid: c.twilioCallSid ?? null,
            campaignId: c.campaignId ?? null,
            supporter: supporter
              ? { _id: supporter._id, name: await decryptSupporterName(supporter) }
              : null,
            updatedAt: c.updatedAt,
          };
        }),
      ),
      hasMore,
    };
  },
});
