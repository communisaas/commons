/**
 * Convex functions backing /api/v1/* public API routes.
 *
 * These use API key auth resolved server-side — Convex functions receive
 * pre-validated orgId from the SvelteKit API key auth middleware.
 */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { tryDecryptPii, type EncryptedPii } from "./_pii";

// =============================================================================
// API KEY AUTH
// =============================================================================

/**
 * Authenticate an API key by its hash.
 * Returns the key's org, scopes, and plan — or null if invalid/revoked/expired.
 */
export const authenticateApiKey = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .unique();

    if (!apiKey) return null;
    if (apiKey.revokedAt) return null;
    if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) return null;

    // Get org subscription plan
    const org = await ctx.db.get(apiKey.orgId);
    const sub = org
      ? await ctx.db
          .query("subscriptions")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .first()
      : null;

    return {
      keyId: apiKey._id,
      orgId: apiKey.orgId,
      scopes: apiKey.scopes,
      planSlug: sub?.plan ?? "free",
    };
  },
});

/**
 * Fire-and-forget usage tracking for API key.
 */
export const trackApiKeyUsage = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get(keyId);
    if (!key || key.revokedAt) return;
    await ctx.db.patch(keyId, {
      lastUsedAt: Date.now(),
      requestCount: key.requestCount + 1,
    });
  },
});

// =============================================================================
// API KEY MANAGEMENT (session-auth, not API key auth)
// =============================================================================

export const createApiKey = internalMutation({
  args: {
    orgSlug: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.orgSlug))
      .first();
    if (!org) throw new Error("Organization not found");

    const id = await ctx.db.insert("apiKeys", {
      orgId: org._id,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      scopes: args.scopes,
      requestCount: 0,
      createdBy: args.createdBy,
    });

    const key = await ctx.db.get(id);
    return key;
  },
});

export const renameApiKey = internalMutation({
  args: {
    keyId: v.string(),
    orgId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { keyId, orgId, name }) => {
    // Scan by org to verify ownership
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId as Id<"organizations">))
      .collect();
    const key = keys.find((k) => k._id === keyId);
    if (!key) return null;
    await ctx.db.patch(key._id, { name });
    return await ctx.db.get(key._id);
  },
});

export const revokeApiKey = internalMutation({
  args: {
    keyId: v.string(),
    orgId: v.string(),
  },
  handler: async (ctx, { keyId, orgId }) => {
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId as Id<"organizations">))
      .collect();
    const key = keys.find((k) => k._id === keyId);
    if (!key) return false;
    await ctx.db.patch(key._id, { revokedAt: Date.now() });
    return true;
  },
});

// =============================================================================
// SUPPORTERS (v1 API)
// =============================================================================

export const listSupporters = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    emailHash: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    emailStatus: v.optional(v.string()),
    source: v.optional(v.string()),
    tagId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allDocs = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    let filtered = allDocs;
    if (args.emailHash) {
      filtered = filtered.filter((s) => s.emailHash === args.emailHash);
    }
    if (args.verified !== undefined) {
      filtered = filtered.filter((s) => s.verified === args.verified);
    }
    if (args.emailStatus) {
      filtered = filtered.filter((s) => s.emailStatus === args.emailStatus);
    }
    if (args.source) {
      filtered = filtered.filter((s) => s.source === args.source);
    }

    // Tag filter
    if (args.tagId) {
      const tagLinks = await ctx.db
        .query("supporterTags")
        .withIndex("by_tagId", (q) => q.eq("tagId", args.tagId as Id<"tags">))
        .collect();
      const supporterIds = new Set(tagLinks.map((t) => t.supporterId));
      filtered = filtered.filter((s) => supporterIds.has(s._id));
    }

    const total = filtered.length;

    // Cursor-based pagination
    let startIdx = 0;
    if (args.cursor) {
      const idx = filtered.findIndex((s) => s._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }

    const page = filtered.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    // Get tags for each supporter — return encrypted blobs as-is (client decrypts)
    const supportersWithTags = await Promise.all(
      items.map(async (s) => {
        const tagLinks = await ctx.db
          .query("supporterTags")
          .withIndex("by_supporterId", (q) => q.eq("supporterId", s._id))
          .collect();
        const tags = await Promise.all(
          tagLinks.map(async (tl) => {
            const tag = await ctx.db.get(tl.tagId);
            return tag ? { id: tag._id, name: tag.name } : null;
          })
        );

        return { ...s, tags: tags.filter(Boolean) };
      })
    );

    return { items: supportersWithTags, cursor: nextCursor, hasMore, total };
  },
});

export const getSupporterById = internalQuery({
  args: { supporterId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { supporterId, orgId }) => {
    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const supporter = supporters.find((s) => s._id === supporterId);
    if (!supporter) return null;

    const tagLinks = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId", (q) => q.eq("supporterId", supporter._id))
      .collect();
    const tags = await Promise.all(
      tagLinks.map(async (tl) => {
        const tag = await ctx.db.get(tl.tagId);
        return tag ? { id: tag._id, name: tag.name } : null;
      })
    );

    // Return encrypted blobs as-is — client decrypts with org key
    return { ...supporter, tags: tags.filter(Boolean) };
  },
});

export const updateSupporter = internalMutation({
  args: {
    supporterId: v.string(),
    orgId: v.id("organizations"),
    data: v.object({
      postalCode: v.optional(v.string()),
      country: v.optional(v.string()),
      encryptedCustomFields: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { supporterId, orgId, data }) => {
    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const supporter = supporters.find((s) => s._id === supporterId);
    if (!supporter) return null;

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (data.postalCode !== undefined) updates.postalCode = data.postalCode;
    if (data.country !== undefined) updates.country = data.country;
    if (data.encryptedCustomFields !== undefined) updates.encryptedCustomFields = data.encryptedCustomFields;

    await ctx.db.patch(supporter._id, updates);
    return { id: supporter._id, updatedAt: Date.now() };
  },
});

export const deleteSupporter = internalMutation({
  args: { supporterId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { supporterId, orgId }) => {
    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const supporter = supporters.find((s) => s._id === supporterId);
    if (!supporter) return false;
    await ctx.db.delete(supporter._id);
    return true;
  },
});

export const createSupporter = internalMutation({
  args: {
    orgId: v.id("organizations"),
    encryptedEmail: v.string(),
    emailHash: v.string(),
    encryptedName: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    encryptedPhone: v.optional(v.string()),
    phoneHash: v.optional(v.string()),
    source: v.string(),
    encryptedCustomFields: v.optional(v.string()),
    tagIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Check for duplicate by emailHash
    const existing = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .take(10_000);
    const dup = existing.find((s) => s.emailHash === args.emailHash);
    if (dup) return { duplicate: true, id: dup._id };

    const id = await ctx.db.insert("supporters", {
      orgId: args.orgId,
      encryptedEmail: args.encryptedEmail,
      emailHash: args.emailHash,
      encryptedName: args.encryptedName,
      postalCode: args.postalCode,
      country: args.country,
      encryptedPhone: args.encryptedPhone,
      phoneHash: args.phoneHash,
      source: args.source,
      verified: false,
      emailStatus: "subscribed",
      smsStatus: "none",
      encryptedCustomFields: args.encryptedCustomFields,
      updatedAt: Date.now(),
    });

    // Create tag links
    if (args.tagIds && args.tagIds.length > 0) {
      for (const tagId of args.tagIds) {
        const tag = await ctx.db.get(tagId as Id<"tags">);
        if (tag && tag.orgId === args.orgId) {
          await ctx.db.insert("supporterTags", {
            supporterId: id,
            tagId: tag._id,
          });
        }
      }
    }

    const supporter = await ctx.db.get(id);
    return { duplicate: false, supporter };
  },
});

// =============================================================================
// TAGS (v1 API)
// =============================================================================

export const listTags = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const result = await Promise.all(
      tags.map(async (t) => {
        const count = await ctx.db
          .query("supporterTags")
          .withIndex("by_tagId", (q) => q.eq("tagId", t._id))
          .collect();
        return { id: t._id, name: t.name, supporterCount: count.length };
      })
    );

    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createTag = internalMutation({
  args: { orgId: v.id("organizations"), name: v.string() },
  handler: async (ctx, { orgId, name }) => {
    // Check for duplicate
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const dup = existing.find((t) => t.name === name.trim());
    if (dup) return { duplicate: true, id: dup._id };

    const id = await ctx.db.insert("tags", {
      orgId,
      name: name.trim(),
    });
    const tag = await ctx.db.get(id);
    return { duplicate: false, tag };
  },
});

export const updateTag = internalMutation({
  args: { tagId: v.string(), orgId: v.id("organizations"), name: v.string() },
  handler: async (ctx, { tagId, orgId, name }) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const tag = tags.find((t) => t._id === tagId);
    if (!tag) return null;

    // Check for duplicate name
    const dup = tags.find((t) => t.name === name.trim() && t._id !== tagId);
    if (dup) return { duplicate: true };

    await ctx.db.patch(tag._id, { name: name.trim() });
    return await ctx.db.get(tag._id);
  },
});

export const deleteTag = internalMutation({
  args: { tagId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { tagId, orgId }) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const tag = tags.find((t) => t._id === tagId);
    if (!tag) return false;

    // Delete tag links first
    const links = await ctx.db
      .query("supporterTags")
      .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(tag._id);
    return true;
  },
});

// =============================================================================
// CAMPAIGNS (v1 API)
// =============================================================================

export const listCampaigns = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    let filtered = all;
    if (args.status) filtered = filtered.filter((c) => c.status === args.status);
    if (args.type) filtered = filtered.filter((c) => c.type === args.type);

    const total = filtered.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = filtered.findIndex((c) => c._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = filtered.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    // Get action/delivery counts
    const campaignsWithCounts = await Promise.all(
      items.map(async (c) => {
        const actions = await ctx.db
          .query("campaignActions")
          .withIndex("by_campaignId", (q) => q.eq("campaignId", c._id))
          .collect();
        const deliveries = await ctx.db
          .query("campaignDeliveries")
          .withIndex("by_campaignId", (q) => q.eq("campaignId", c._id))
          .collect();
        return { ...c, _count: { actions: actions.length, deliveries: deliveries.length } };
      })
    );

    return { items: campaignsWithCounts, cursor: nextCursor, hasMore, total };
  },
});

export const getCampaignById = internalQuery({
  args: { campaignId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { campaignId, orgId }) => {
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const campaign = campaigns.find((c) => c._id === campaignId);
    if (!campaign) return null;

    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaign._id))
      .collect();
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaign._id))
      .collect();

    return { ...campaign, _count: { actions: actions.length, deliveries: deliveries.length } };
  },
});

export const createCampaign = internalMutation({
  args: {
    orgId: v.id("organizations"),
    title: v.string(),
    type: v.string(),
    body: v.optional(v.string()),
    templateId: v.optional(v.string()),
    targetJurisdiction: v.optional(v.string()),
    targetCountry: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("campaigns", {
      orgId: args.orgId,
      title: args.title,
      type: args.type,
      body: args.body ?? null,
      templateId: args.templateId ?? null,
      status: "DRAFT",
      debateEnabled: false,
      debateThreshold: 100,
      targetJurisdiction: args.targetJurisdiction ?? null,
      targetCountry: args.targetCountry,
      targets: [],
      actionCount: 0,
      verifiedActionCount: 0,
      raisedAmountCents: 0,
      donorCount: 0,
      donationCurrency: "USD",
      updatedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const updateCampaign = internalMutation({
  args: {
    campaignId: v.string(),
    orgId: v.id("organizations"),
    data: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      status: v.optional(v.string()),
      targetJurisdiction: v.optional(v.union(v.string(), v.null())),
      targetCountry: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { campaignId, orgId, data }) => {
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const campaign = campaigns.find((c) => c._id === campaignId);
    if (!campaign) return null;

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (data.title !== undefined) updates.title = data.title;
    if (data.body !== undefined) updates.body = data.body;
    if (data.status !== undefined) updates.status = data.status;
    if (data.targetJurisdiction !== undefined) updates.targetJurisdiction = data.targetJurisdiction;
    if (data.targetCountry !== undefined) updates.targetCountry = data.targetCountry;

    await ctx.db.patch(campaign._id, updates);
    return { id: campaign._id, updatedAt: Date.now() };
  },
});

// =============================================================================
// CAMPAIGN ACTIONS (v1 API)
// =============================================================================

export const listCampaignActions = internalQuery({
  args: {
    campaignId: v.string(),
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    verified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify campaign belongs to org
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .take(10_000);
    const campaign = campaigns.find((c) => c._id === args.campaignId);
    if (!campaign) return null;

    let allActions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaign._id))
      .order("desc")
      .take(10_000);

    if (args.verified !== undefined) {
      allActions = allActions.filter((a) => a.verified === args.verified);
    }

    const total = allActions.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = allActions.findIndex((a) => a._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = allActions.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    return { items, cursor: nextCursor, hasMore, total };
  },
});

// =============================================================================
// CALLS (v1 API)
// =============================================================================

export const listCallsV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
    campaignId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("patchThroughCalls")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    if (args.status) all = all.filter((c) => c.status === args.status);
    if (args.campaignId) all = all.filter((c) => String(c.campaignId) === args.campaignId);

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((c) => c._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    return { items, cursor: nextCursor, hasMore, total };
  },
});

// =============================================================================
// DONATIONS (v1 API)
// =============================================================================

export const listDonationsV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
    campaignId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("donations")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    if (args.status) all = all.filter((d) => d.status === args.status);
    if (args.campaignId) all = all.filter((d) => String(d.campaignId) === args.campaignId);

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((d) => d._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    // Decrypt PII from encrypted fields — no plaintext fallback
    const decryptedItems = await Promise.all(
      items.map(async (d) => {
        let email: string | null = null;
        if (d.encryptedEmail) {
          try {
            const enc: EncryptedPii = JSON.parse(d.encryptedEmail);
            email = await tryDecryptPii(enc, d._id, "email");
          } catch { /* decryption failed */ }
        }
        let name: string | null = null;
        if (d.encryptedName) {
          try {
            const enc: EncryptedPii = JSON.parse(d.encryptedName);
            name = await tryDecryptPii(enc, d._id, "name");
          } catch { /* decryption failed */ }
        }
        return { ...d, email, name };
      }),
    );

    return { items: decryptedItems, cursor: nextCursor, hasMore, total };
  },
});

export const getDonationById = internalQuery({
  args: { donationId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { donationId, orgId }) => {
    const donations = await ctx.db
      .query("donations")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const d = donations.find((d) => d._id === donationId) ?? null;
    if (!d) return null;

    // Decrypt PII from encrypted fields — no plaintext fallback
    let email: string | null = null;
    if (d.encryptedEmail) {
      try {
        const enc: EncryptedPii = JSON.parse(d.encryptedEmail);
        email = await tryDecryptPii(enc, d._id, "email");
      } catch { /* decryption failed */ }
    }
    let name: string | null = null;
    if (d.encryptedName) {
      try {
        const enc: EncryptedPii = JSON.parse(d.encryptedName);
        name = await tryDecryptPii(enc, d._id, "name");
      } catch { /* decryption failed */ }
    }

    return { ...d, email, name };
  },
});

// =============================================================================
// SMS BLASTS (v1 API)
// =============================================================================

export const listSmsBlastsV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("smsBlasts")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    if (args.status) all = all.filter((b) => b.status === args.status);

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((b) => b._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    return { items, cursor: nextCursor, hasMore, total };
  },
});

// =============================================================================
// EVENTS (v1 API)
// =============================================================================

export const listEventsV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("events")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    if (args.status) all = all.filter((e) => e.status === args.status);
    if (args.eventType) all = all.filter((e) => e.eventType === args.eventType);

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((e) => e._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    return { items, cursor: nextCursor, hasMore, total };
  },
});

export const getEventById = internalQuery({
  args: { eventId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { eventId, orgId }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    return events.find((e) => e._id === eventId) ?? null;
  },
});

// =============================================================================
// WORKFLOWS (v1 API)
// =============================================================================

export const listWorkflowsV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("workflows")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    if (args.enabled !== undefined) all = all.filter((w) => w.enabled === args.enabled);

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((w) => w._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    return { items, cursor: nextCursor, hasMore, total };
  },
});

export const getWorkflowById = internalQuery({
  args: { workflowId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { workflowId, orgId }) => {
    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    return workflows.find((w) => w._id === workflowId) ?? null;
  },
});

// =============================================================================
// NETWORKS (v1 API)
// =============================================================================

export const listNetworksV1 = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let members = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10_000);

    members = members.filter((m) => m.status === "active");

    const total = members.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = members.findIndex((m) => m._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = members.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    const networksWithDetails = await Promise.all(
      items.map(async (m) => {
        const network = await ctx.db.get(m.networkId);
        if (!network) return null;
        const allMembers = await ctx.db
          .query("orgNetworkMembers")
          .withIndex("by_networkId", (q) => q.eq("networkId", network._id))
          .collect();
        const activeMembers = allMembers.filter((am) => am.status === "active");
        return {
          id: network._id,
          name: network.name,
          slug: network.slug,
          description: network.description,
          status: network.status,
          ownerOrgId: network.ownerOrgId,
          memberCount: activeMembers.length,
          role: m.role,
          joinedAt: m.joinedAt,
          createdAt: network._creationTime,
          updatedAt: network.updatedAt,
        };
      })
    );

    return { items: networksWithDetails.filter(Boolean), cursor: nextCursor, hasMore, total };
  },
});

export const getNetworkByIdV1 = internalQuery({
  args: { networkId: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, { networkId, orgId }) => {
    // Check membership
    const members = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const membership = members.find(
      (m) => String(m.networkId) === networkId && m.status === "active"
    );
    if (!membership) return { forbidden: true };

    const network = await ctx.db.get(networkId as Id<"orgNetworks">);
    if (!network) return null;

    const ownerOrg = await ctx.db.get(network.ownerOrgId);
    const allMembers = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (q) => q.eq("networkId", network._id))
      .collect();
    const activeMembers = allMembers.filter((m) => m.status === "active");

    const membersWithOrgs = await Promise.all(
      activeMembers.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return {
          orgId: m.orgId,
          orgName: org?.name ?? "",
          orgSlug: org?.slug ?? "",
          role: m.role,
          joinedAt: m.joinedAt,
        };
      })
    );

    return {
      forbidden: false,
      network: {
        id: network._id,
        name: network.name,
        slug: network.slug,
        description: network.description,
        status: network.status,
        ownerOrgId: network.ownerOrgId,
        memberCount: activeMembers.length,
        ownerOrg: ownerOrg ? { id: ownerOrg._id, name: ownerOrg.name, slug: ownerOrg.slug } : null,
        members: membersWithOrgs,
        createdAt: network._creationTime,
        updatedAt: network.updatedAt,
      },
    };
  },
});

// =============================================================================
// REPRESENTATIVES (v1 API — international DMs)
// =============================================================================

export const listRepresentativesV1 = internalQuery({
  args: {
    limit: v.number(),
    cursor: v.optional(v.string()),
    country: v.optional(v.string()),
    constituencyId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("decisionMakers")
      .withIndex("by_jurisdiction_jurisdictionLevel", (q) =>
        args.country
          ? q.eq("jurisdiction", args.country).eq("jurisdictionLevel", "international")
          : q
      )
      .take(10_000);

    all = all.filter((dm) => dm.jurisdictionLevel === "international");

    if (args.constituencyId) {
      const extIds = await ctx.db
        .query("externalIds")
        .withIndex("by_system_value", (q) =>
          q.eq("system", "constituency").eq("value", args.constituencyId!)
        )
        .collect();
      const dmIds = new Set(extIds.map((e) => e.decisionMakerId));
      all = all.filter((dm) => dmIds.has(dm._id));
    }

    const total = all.length;
    let startIdx = 0;
    if (args.cursor) {
      const idx = all.findIndex((dm) => dm._id === args.cursor);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = all.slice(startIdx, startIdx + args.limit + 1);
    const hasMore = page.length > args.limit;
    const items = page.slice(0, args.limit);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]._id : null;

    // Get constituency external IDs
    const itemsWithConstituency = await Promise.all(
      items.map(async (dm) => {
        const extIds = await ctx.db
          .query("externalIds")
          .withIndex("by_decisionMakerId_system", (q) =>
            q.eq("decisionMakerId", dm._id).eq("system", "constituency")
          )
          .collect();
        return {
          ...dm,
          constituencyId: extIds[0]?.value ?? null,
        };
      })
    );

    return { items: itemsWithConstituency, cursor: nextCursor, hasMore, total };
  },
});

// =============================================================================
// ORG (v1 API — org detail)
// =============================================================================

export const getOrgForApiKey = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org) return null;

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(10_000);
    const templates = await ctx.db
      .query("templates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    return {
      id: org._id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      avatar: org.avatar,
      createdAt: org._creationTime,
      counts: {
        supporters: supporters.length,
        campaigns: campaigns.length,
        templates: templates.length,
      },
    };
  },
});

// =============================================================================
// SCORECARDS (public, no auth)
// =============================================================================

export const getDmScorecard = internalQuery({
  args: { dmId: v.string() },
  handler: async (ctx, { dmId }) => {
    const dm = await ctx.db.get(dmId as Id<"decisionMakers">);
    if (!dm) return null;

    const snapshots = await ctx.db
      .query("scorecardSnapshots")
      .withIndex("by_decisionMakerId", (q) => q.eq("decisionMakerId", dm._id))
      .order("desc")
      .take(13);

    const latest = snapshots[0] ?? null;
    const history = snapshots.slice(1);

    return {
      decisionMaker: {
        id: dm._id,
        name: dm.name,
        title: dm.title,
        party: dm.party,
        district: dm.district,
        jurisdiction: dm.jurisdiction,
      },
      current: latest
        ? {
            responsiveness: latest.responsiveness,
            alignment: latest.alignment,
            composite: latest.composite,
            proofWeightTotal: latest.proofWeightTotal,
            period: {
              start: new Date(latest.periodStart).toISOString().slice(0, 10),
              end: new Date(latest.periodEnd).toISOString().slice(0, 10),
            },
            attestationHash: latest.snapshotHash,
            methodologyVersion: latest.methodologyVersion,
          }
        : null,
      history: history.map((s) => ({
        period: new Date(s.periodEnd).toISOString().slice(0, 7),
        responsiveness: s.responsiveness,
        alignment: s.alignment,
        composite: s.composite,
      })),
      transparency: latest
        ? {
            deliveriesSent: latest.deliveriesSent,
            deliveriesOpened: latest.deliveriesOpened,
            deliveriesVerified: latest.deliveriesVerified,
            repliesReceived: latest.repliesReceived,
            alignedVotes: latest.alignedVotes,
            totalScoredVotes: latest.totalScoredVotes,
          }
        : null,
    };
  },
});

export const compareDmScorecards = internalQuery({
  args: { dmIds: v.array(v.string()) },
  handler: async (ctx, { dmIds }) => {
    const results = await Promise.all(
      dmIds.map(async (dmId) => {
        const dm = await ctx.db.get(dmId as Id<"decisionMakers">);
        if (!dm) return null;

        const latest = await ctx.db
          .query("scorecardSnapshots")
          .withIndex("by_decisionMakerId", (q) => q.eq("decisionMakerId", dm._id))
          .order("desc")
          .first();

        return {
          decisionMaker: {
            id: dm._id,
            name: dm.name,
            title: dm.title,
            party: dm.party,
            district: dm.district,
            jurisdiction: dm.jurisdiction,
          },
          current: latest
            ? {
                responsiveness: latest.responsiveness,
                alignment: latest.alignment,
                composite: latest.composite,
                proofWeightTotal: latest.proofWeightTotal,
                period: {
                  start: new Date(latest.periodStart).toISOString().slice(0, 10),
                  end: new Date(latest.periodEnd).toISOString().slice(0, 10),
                },
                attestationHash: latest.snapshotHash,
                methodologyVersion: latest.methodologyVersion,
              }
            : null,
        };
      })
    );

    return results.filter(Boolean);
  },
});

// =============================================================================
// CAMPAIGN STATS (public, no auth)
// =============================================================================

export const getCampaignStats = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return null;
    return {
      raisedAmountCents: campaign.raisedAmountCents,
      donorCount: campaign.donorCount,
      goalAmountCents: campaign.goalAmountCents ?? null,
      currency: campaign.donationCurrency,
    };
  },
});

// =============================================================================
// EVENT STATS (public, no auth)
// =============================================================================

export const getEventStats = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId as Id<"events">);
    if (!event) return null;

    const rsvps = await ctx.db
      .query("eventRsvps")
      .withIndex("by_eventId", (q) => q.eq("eventId", event._id))
      .collect();

    const goingCount = rsvps.filter((r) => r.status === "GOING").length;
    const maybeCount = rsvps.filter((r) => r.status === "MAYBE").length;

    return {
      rsvpCount: event.rsvpCount,
      attendeeCount: event.attendeeCount,
      verifiedAttendees: event.verifiedAttendees,
      goingCount,
      maybeCount,
    };
  },
});

// =============================================================================
// SUBMISSION STATUS (authenticated)
// =============================================================================

export const getSubmissionStatus = internalQuery({
  args: { submissionId: v.string(), pseudonymousId: v.string() },
  handler: async (ctx, { submissionId, pseudonymousId }) => {
    const submission = await ctx.db.get(submissionId as Id<"submissions">);
    if (!submission) return null;
    if (submission.pseudonymousId !== pseudonymousId) return { forbidden: true };

    const deliveryCount = submission.cwcSubmissionId
      ? submission.cwcSubmissionId.split(",").length
      : 0;

    return {
      forbidden: false,
      status: submission.deliveryStatus,
      deliveryCount,
      deliveredAt: submission.deliveredAt,
      error: submission.deliveryError
        ? "Delivery encountered an issue. Please try again or contact support."
        : null,
    };
  },
});

// =============================================================================
// EMAIL CONFIRMATION
// =============================================================================

export const confirmEmailDelivery = internalMutation({
  args: { templateId: v.string() },
  handler: async (ctx, { templateId }) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Find recent pending/delivered submissions for this template
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .order("desc")
      .take(100);

    const submission = submissions.find(
      (s) =>
        (s.deliveryStatus === "pending" || s.deliveryStatus === "delivered") &&
        s._creationTime >= sevenDaysAgo
    );

    if (!submission) {
      return { confirmed: false, message: "No pending submission found for this confirmation" };
    }

    if (submission.deliveryStatus === "user_confirmed") {
      return { confirmed: true, already_confirmed: true, message: "Delivery was already confirmed" };
    }

    await ctx.db.patch(submission._id, {
      deliveryStatus: "user_confirmed",
      deliveredAt: Date.now(),
    });

    return { confirmed: true, message: "Thank you! Your email delivery has been confirmed." };
  },
});

// =============================================================================
// DELEGATION (authenticated)
// =============================================================================

export const getDelegationGrant = internalQuery({
  args: { grantId: v.string() },
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get(grantId as Id<"delegationGrants">);
    if (!grant) return null;

    const actions = await ctx.db
      .query("delegatedActions")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .order("desc")
      .take(20);

    const reviews = await ctx.db
      .query("delegationReviews")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .collect();
    const pendingReviews = reviews.filter((r) => r.decision === undefined || r.decision === null);

    return { ...grant, actions, reviewQueue: pendingReviews };
  },
});

export const updateDelegationGrant = internalMutation({
  args: {
    grantId: v.string(),
    userId: v.string(),
    data: v.object({
      status: v.optional(v.string()),
      maxActionsPerDay: v.optional(v.number()),
      requireReviewAbove: v.optional(v.number()),
      issueFilter: v.optional(v.array(v.string())),
      orgFilter: v.optional(v.array(v.string())),
      policyText: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { grantId, userId, data }) => {
    const grant = await ctx.db.get(grantId as Id<"delegationGrants">);
    if (!grant) return null;
    if (String(grant.userId) !== userId) return { forbidden: true };
    if (grant.status === "revoked") return { revoked: true };

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (data.status !== undefined) updates.status = data.status;
    if (data.maxActionsPerDay !== undefined) updates.maxActionsPerDay = data.maxActionsPerDay;
    if (data.requireReviewAbove !== undefined) updates.requireReviewAbove = data.requireReviewAbove;
    if (data.issueFilter !== undefined) updates.issueFilter = data.issueFilter;
    if (data.orgFilter !== undefined) updates.orgFilter = data.orgFilter;
    if (data.policyText !== undefined) updates.policyText = data.policyText;

    await ctx.db.patch(grant._id, updates);
    return await ctx.db.get(grant._id);
  },
});

export const submitDelegationReview = internalMutation({
  args: {
    reviewId: v.string(),
    userId: v.string(),
    decision: v.string(),
  },
  handler: async (ctx, { reviewId, userId, decision }) => {
    const review = await ctx.db.get(reviewId as Id<"delegationReviews">);
    if (!review) return null;

    const grant = await ctx.db.get(review.grantId);
    if (!grant || String(grant.userId) !== userId) return { forbidden: true };
    if (review.decision !== null && review.decision !== undefined) return { alreadyDecided: true };

    await ctx.db.patch(review._id, {
      decision,
      decidedAt: Date.now(),
    });

    return { message: `Review ${decision}d` };
  },
});
