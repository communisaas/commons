/**
 * Supporter CRUD — Convex queries, mutations, and actions.
 *
 * PII model (org-key migration):
 *   Client encrypts/decrypts PII with org key.
 *   Server stores opaque encrypted blobs + org-scoped hashes.
 *   No server-held encryption keys — org key only.
 */

import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";

// =============================================================================
// QUERIES (return encrypted blobs — client decrypts with org key)
// =============================================================================

/**
 * Paginated supporter list with filters. Returns encrypted PII blobs.
 */
export const list = query({
  args: {
    orgSlug: v.string(),
    paginationOpts: v.object({
      cursor: v.union(v.string(), v.null()),
      numItems: v.number(),
    }),
    filters: v.optional(
      v.object({
        emailStatus: v.optional(v.string()),
        verified: v.optional(v.boolean()),
        source: v.optional(v.string()),
        tagId: v.optional(v.id("tags")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");
    const { cursor, numItems } = args.paginationOpts;
    const filters = args.filters;

    // All filters post-process in memory; org scope is always the primary index.
    // Use .take() with a bounded cap to prevent unbounded memory usage.
    const limit = Math.min(numItems, 100);
    const MAX_SCAN = 10_000;
    const allDocs = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .take(MAX_SCAN);

    // Apply filters in memory (Convex indexes are limited to equality prefixes)
    let filtered = allDocs;
    if (filters?.emailStatus) {
      filtered = filtered.filter((s) => s.emailStatus === filters.emailStatus);
    }
    if (filters?.verified !== undefined) {
      filtered = filtered.filter((s) => s.verified === filters.verified);
    }
    if (filters?.source) {
      filtered = filtered.filter((s) => s.source === filters.source);
    }

    // Tag filter: need to join supporterTags
    if (filters?.tagId) {
      const tagLinks = await ctx.db
        .query("supporterTags")
        .withIndex("by_tagId", (idx) => idx.eq("tagId", filters.tagId!))
        .collect();
      const supporterIds = new Set(tagLinks.map((t) => t.supporterId));
      filtered = filtered.filter((s) => supporterIds.has(s._id));
    }

    // Sort by _creationTime descending (newest first)
    filtered.sort((a, b) => b._creationTime - a._creationTime);

    // Cursor-based slicing
    let startIdx = 0;
    if (cursor) {
      const cursorIdx = filtered.findIndex((s) => s._id === cursor);
      if (cursorIdx >= 0) startIdx = cursorIdx + 1;
    }

    const page = filtered.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);

    // Return encrypted blobs — client decrypts with org key
    const supporters = await Promise.all(
      items.map(async (s) => {
        // Load tags for this supporter
        const tagLinks = await ctx.db
          .query("supporterTags")
          .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
          .collect();
        const tags = await Promise.all(
          tagLinks.map(async (link) => {
            const tag = await ctx.db.get(link.tagId);
            return tag ? { _id: tag._id, name: tag.name } : null;
          }),
        );

        return {
          _id: s._id,
          _creationTime: s._creationTime,
          encryptedEmail: s.encryptedEmail,
          encryptedName: s.encryptedName ?? null,
          postalCode: s.postalCode ?? null,
          country: s.country ?? null,
          encryptedPhone: s.encryptedPhone ?? null,
          verified: s.verified,
          identityVerified: !!(s.identityCommitment && s.verified),
          emailStatus: s.emailStatus,
          source: s.source ?? null,
          encryptedCustomFields: s.encryptedCustomFields ?? null,
          updatedAt: s.updatedAt,
          tags: tags.filter((t): t is NonNullable<typeof t> => t !== null),
        };
      }),
    );

    const nextCursor = hasMore ? items[items.length - 1]?._id ?? null : null;

    return {
      supporters,
      nextCursor,
      hasMore,
    };
  },
});

/**
 * Single supporter by ID with all fields + tags + decrypted email.
 */
export const get = query({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    const tagLinks = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId", (idx) =>
        idx.eq("supporterId", supporter._id),
      )
      .collect();
    const tags = await Promise.all(
      tagLinks.map(async (link) => {
        const tag = await ctx.db.get(link.tagId);
        return tag ? { _id: tag._id, name: tag.name } : null;
      }),
    );

    return {
      _id: supporter._id,
      _creationTime: supporter._creationTime,
      encryptedEmail: supporter.encryptedEmail,
      encryptedName: supporter.encryptedName ?? null,
      postalCode: supporter.postalCode ?? null,
      country: supporter.country ?? null,
      encryptedPhone: supporter.encryptedPhone ?? null,
      verified: supporter.verified,
      identityVerified: !!(supporter.identityCommitment && supporter.verified),
      identityCommitment: supporter.identityCommitment ?? null,
      emailStatus: supporter.emailStatus,
      smsStatus: supporter.smsStatus,
      source: supporter.source ?? null,
      encryptedCustomFields: supporter.encryptedCustomFields ?? null,
      importedAt: supporter.importedAt ?? null,
      updatedAt: supporter.updatedAt,
      tags: tags.filter((t): t is NonNullable<typeof t> => t !== null),
    };
  },
});

/**
 * Search by email hash — accepts pre-computed org-scoped hash from client.
 */
export const findByEmailHash = query({
  args: { slug: v.string(), emailHash: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    return ctx.db
      .query("supporters")
      .withIndex("by_orgId_emailHash", (idx) =>
        idx.eq("orgId", org._id).eq("emailHash", args.emailHash),
      )
      .first();
  },
});

export const searchByEmail = query({
  args: {
    orgSlug: v.string(),
    emailHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const supporter = await ctx.db
      .query("supporters")
      .withIndex("by_orgId_emailHash", (idx) =>
        idx.eq("orgId", org._id).eq("emailHash", args.emailHash),
      )
      .first();

    if (!supporter) return null;

    const tagLinks = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId", (idx) =>
        idx.eq("supporterId", supporter._id),
      )
      .collect();
    const tags = await Promise.all(
      tagLinks.map(async (link) => {
        const tag = await ctx.db.get(link.tagId);
        return tag ? { _id: tag._id, name: tag.name } : null;
      }),
    );

    return {
      _id: supporter._id,
      _creationTime: supporter._creationTime,
      encryptedEmail: supporter.encryptedEmail,
      encryptedName: supporter.encryptedName ?? null,
      verified: supporter.verified,
      emailStatus: supporter.emailStatus,
      tags: tags.filter((t): t is NonNullable<typeof t> => t !== null),
    };
  },
});

/**
 * Verification funnel summary stats for an org.
 * Uses org's denormalized supporterCount for total,
 * queries supporters for postal-resolved and identity-verified counts.
 */
export const getSummaryStats = query({
  args: {
    orgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const allSupporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .take(10_001);

    const total = org.supporterCount ?? allSupporters.length;

    let identityVerified = 0;
    let postalResolved = 0;
    const emailHealth: Record<string, number> = {
      subscribed: 0,
      unsubscribed: 0,
      bounced: 0,
      complained: 0,
    };

    for (const s of allSupporters) {
      if (s.identityCommitment && s.verified) {
        identityVerified++;
      } else if (s.postalCode) {
        postalResolved++;
      }

      if (s.emailStatus in emailHealth) {
        emailHealth[s.emailStatus]++;
      }
    }

    const imported = total - identityVerified - postalResolved;

    return {
      total,
      identityVerified,
      postalResolved,
      imported,
      emailHealth,
    };
  },
});

/**
 * List tags for an org.
 */
export const getTags = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const tags = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();

    return tags.map((t) => ({
      _id: t._id,
      id: t._id,
      name: t.name,
    }));
  },
});

// =============================================================================
// MUTATIONS (client-encrypted PII — no server-side encryption needed)
// =============================================================================

/**
 * Create a new supporter. Accepts pre-encrypted blobs + org-scoped hashes
 * from client. No server-side encryption — store as-is.
 */
export const create = mutation({
  args: {
    orgSlug: v.string(),
    encryptedEmail: v.string(),
    emailHash: v.string(),
    encryptedName: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    encryptedPhone: v.optional(v.string()),
    phoneHash: v.optional(v.string()),
    source: v.optional(v.string()),
    encryptedCustomFields: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Dedup check using org-scoped emailHash
    const existing = await ctx.db
      .query("supporters")
      .withIndex("by_orgId_emailHash", (idx) =>
        idx.eq("orgId", org._id).eq("emailHash", args.emailHash),
      )
      .first();

    if (existing) {
      throw new Error("A supporter with this email already exists");
    }

    const now = Date.now();

    const supporterId = await ctx.db.insert("supporters", {
      orgId: org._id,
      encryptedEmail: args.encryptedEmail,
      emailHash: args.emailHash,
      encryptedName: args.encryptedName,
      encryptedPhone: args.encryptedPhone,
      phoneHash: args.phoneHash,
      postalCode: args.postalCode,
      country: args.country ?? "US",
      source: args.source ?? "organic",
      encryptedCustomFields: args.encryptedCustomFields,
      verified: false,
      emailStatus: "subscribed",
      smsStatus: "none",
      updatedAt: now,
    });

    // Link tags
    if (args.tagIds && args.tagIds.length > 0) {
      for (const tagId of args.tagIds) {
        const tag = await ctx.db.get(tagId);
        if (tag && tag.orgId === org._id) {
          await ctx.db.insert("supporterTags", {
            supporterId,
            tagId,
          });
        }
      }
    }

    // Increment org supporterCount
    const newCount = (org.supporterCount ?? 0) + 1;
    const onboarding = org.onboardingState ?? {
      hasDescription: false,
      hasIssueDomains: false,
      hasSupporters: false,
      hasCampaigns: false,
      hasTeam: false,
      hasSentEmail: false,
    };

    await ctx.db.patch(org._id, {
      supporterCount: newCount,
      onboardingState: { ...onboarding, hasSupporters: true },
      updatedAt: now,
    });

    return supporterId;
  },
});

/**
 * Update a supporter. Accepts pre-encrypted blobs + hashes from client.
 * No server-side encrypt/decrypt.
 */
export const update = mutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    encryptedEmail: v.optional(v.string()),
    emailHash: v.optional(v.string()),
    encryptedName: v.optional(v.string()),
    encryptedPhone: v.optional(v.string()),
    phoneHash: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    encryptedCustomFields: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.encryptedEmail !== undefined) patch.encryptedEmail = args.encryptedEmail;
    if (args.emailHash !== undefined) patch.emailHash = args.emailHash;
    if (args.encryptedName !== undefined) patch.encryptedName = args.encryptedName;
    if (args.encryptedPhone !== undefined) patch.encryptedPhone = args.encryptedPhone;
    if (args.phoneHash !== undefined) patch.phoneHash = args.phoneHash;
    if (args.postalCode !== undefined) patch.postalCode = args.postalCode;
    if (args.country !== undefined) patch.country = args.country;
    if (args.encryptedCustomFields !== undefined) patch.encryptedCustomFields = args.encryptedCustomFields;

    await ctx.db.patch(args.supporterId, patch);
  },
});

// =============================================================================
// INTERNAL MUTATIONS (backward compat — used by campaigns.ts action flow)
// =============================================================================

/** @deprecated Migrate callers to use supporters.create mutation with pre-encrypted blobs */
export const patchEncryptedPii = internalMutation({
  args: {
    supporterId: v.id("supporters"),
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    encryptedPhone: v.optional(v.string()),
    phoneHash: v.optional(v.string()),
    encryptedCustomFields: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter) throw new Error("Supporter not found");

    const patch: Record<string, unknown> = {
      encryptedEmail: args.encryptedEmail,
      updatedAt: Date.now(),
    };
    if (args.encryptedName !== undefined) patch.encryptedName = args.encryptedName;
    if (args.encryptedPhone !== undefined) patch.encryptedPhone = args.encryptedPhone;
    if (args.phoneHash !== undefined) patch.phoneHash = args.phoneHash;
    if (args.encryptedCustomFields !== undefined) patch.encryptedCustomFields = args.encryptedCustomFields;

    await ctx.db.patch(args.supporterId, patch);
  },
});

// =============================================================================
// MUTATIONS (no PII encryption needed)
// =============================================================================

/**
 * Delete a supporter + cleanup tags + decrement org counter.
 */
export const remove = mutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    // Delete all tag links for this supporter
    const tagLinks = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId", (idx) =>
        idx.eq("supporterId", args.supporterId),
      )
      .collect();

    for (const link of tagLinks) {
      await ctx.db.delete(link._id);
    }

    // Delete the supporter
    await ctx.db.delete(args.supporterId);

    // Decrement org supporterCount
    const newCount = Math.max((org.supporterCount ?? 1) - 1, 0);
    await ctx.db.patch(org._id, {
      supporterCount: newCount,
      updatedAt: Date.now(),
    });

    return { deleted: true };
  },
});

/**
 * Add a tag to a supporter. Idempotent (upsert-like).
 */
export const addTag = mutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    tagId: v.id("tags"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Verify supporter belongs to org
    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    // Verify tag belongs to org
    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.orgId !== org._id) {
      throw new Error("Tag not found");
    }

    // Check if link already exists (idempotent)
    const existing = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId_tagId", (idx) =>
        idx.eq("supporterId", args.supporterId).eq("tagId", args.tagId),
      )
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("supporterTags", {
      supporterId: args.supporterId,
      tagId: args.tagId,
    });
  },
});

/**
 * Remove a tag from a supporter.
 */
export const removeTag = mutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    tagId: v.id("tags"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Verify supporter belongs to org
    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    const link = await ctx.db
      .query("supporterTags")
      .withIndex("by_supporterId_tagId", (idx) =>
        idx.eq("supporterId", args.supporterId).eq("tagId", args.tagId),
      )
      .first();

    if (link) {
      await ctx.db.delete(link._id);
    }

    return { removed: true };
  },
});

/**
 * Update SMS status on a supporter. Enforces STOP keyword opt-out protection.
 */
export const updateSmsStatus = mutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    smsStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const ALLOWED_STATUSES = ["none", "subscribed", "unsubscribed"];
    if (!ALLOWED_STATUSES.includes(args.smsStatus)) {
      throw new Error("Invalid SMS status. Cannot manually set to 'stopped'.");
    }

    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    // Cannot override a STOP keyword opt-out manually
    if (supporter.smsStatus === "stopped") {
      throw new Error(
        "Cannot override STOP keyword opt-out. Supporter must text START to re-subscribe.",
      );
    }

    await ctx.db.patch(args.supporterId, {
      smsStatus: args.smsStatus,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

/**
 * Public: get supporter email status for unsubscribe page (no auth required).
 * Returns minimal fields only — no PII.
 */
export const getEmailStatus = query({
  args: { supporterId: v.id("supporters") },
  handler: async (ctx, { supporterId }) => {
    const supporter = await ctx.db.get(supporterId);
    if (!supporter) return null;
    return {
      _id: supporter._id,
      orgId: supporter.orgId,
      emailStatus: supporter.emailStatus,
    };
  },
});

/**
 * Public: unsubscribe a supporter by ID (called from unsubscribe page action).
 * HMAC token verification happens in the SvelteKit route before calling this.
 */
export const unsubscribe = mutation({
  args: { supporterId: v.id("supporters") },
  handler: async (ctx, { supporterId }) => {
    const supporter = await ctx.db.get(supporterId);
    if (!supporter) throw new Error("Supporter not found");
    await ctx.db.patch(supporterId, {
      emailStatus: "unsubscribed",
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Ensure tags exist for an org — returns a map of tag name → tag ID.
 * Creates any missing tags.
 */
export const ensureTags = mutation({
  args: { slug: v.string(), tagNames: v.array(v.string()) },
  handler: async (ctx, { slug, tagNames }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const tagMap: Record<string, string> = {};
    for (const name of tagNames) {
      // Check existing
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_orgId_name", (idx) => idx.eq("orgId", org._id).eq("name", name))
        .first();
      if (existing) {
        tagMap[name] = existing._id;
      } else {
        const id = await ctx.db.insert("tags", { orgId: org._id, name });
        tagMap[name] = id;
      }
    }
    return { tagMap, tagsCreated: tagNames.length - Object.keys(tagMap).length };
  },
});

/**
 * Import a batch of supporters (CSV import).
 * Returns counts of imported, updated, skipped.
 */
export const importBatch = mutation({
  args: {
    slug: v.string(),
    supporters: v.array(
      v.object({
        encryptedEmail: v.string(),
        emailHash: v.string(),
        encryptedName: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        encryptedPhone: v.optional(v.string()),
        phoneHash: v.optional(v.string()),
        country: v.optional(v.string()),
        emailStatus: v.string(),
        smsStatus: v.string(),
        tagIds: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { slug, supporters }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const s of supporters) {
      try {
        // Check if supporter exists by email hash
        const existing = await ctx.db
          .query("supporters")
          .withIndex("by_orgId_emailHash", (idx) =>
            idx.eq("orgId", org._id).eq("emailHash", s.emailHash),
          )
          .first();

        if (existing) {
          // Update: only fill in null fields
          const patch: Record<string, unknown> = {};
          if (s.encryptedName && !existing.encryptedName) patch.encryptedName = s.encryptedName;
          if (s.postalCode && !existing.postalCode) patch.postalCode = s.postalCode;
          if (s.encryptedPhone && !existing.encryptedPhone) patch.encryptedPhone = s.encryptedPhone;
          if (s.phoneHash && !existing.phoneHash) patch.phoneHash = s.phoneHash;
          if (s.country && !existing.country) patch.country = s.country;

          if (Object.keys(patch).length > 0) {
            patch.updatedAt = Date.now();
            await ctx.db.patch(existing._id, patch);
          }

          // Add tags (skip duplicates)
          for (const tagId of s.tagIds) {
            const existingTag = await ctx.db
              .query("supporterTags")
              .withIndex("by_supporterId_tagId", (idx) =>
                idx.eq("supporterId", existing._id).eq("tagId", tagId as any),
              )
              .first();
            if (!existingTag) {
              await ctx.db.insert("supporterTags", {
                supporterId: existing._id,
                tagId: tagId as any,
              });
            }
          }
          updated++;
        } else {
          // Create new supporter
          const id = await ctx.db.insert("supporters", {
            orgId: org._id,
            encryptedName: s.encryptedName,
            postalCode: s.postalCode ?? undefined,
            encryptedPhone: s.encryptedPhone,
            phoneHash: s.phoneHash,
            country: s.country ?? undefined,
            emailStatus: s.emailStatus,
            smsStatus: s.smsStatus,
            source: "csv",
            encryptedEmail: s.encryptedEmail,
            emailHash: s.emailHash,
            updatedAt: Date.now(),
          });

          // Add tags
          for (const tagId of s.tagIds) {
            await ctx.db.insert("supporterTags", {
              supporterId: id,
              tagId: tagId as any,
            });
          }
          imported++;
        }
      } catch {
        skipped++;
      }
    }

    return { imported, updated, skipped };
  },
});

/**
 * Import supporters with server-side org key encryption.
 * Accepts plaintext PII, unseals the org key, encrypts each field,
 * then delegates to importBatch mutation.
 */
export const importWithEncryption = action({
  args: {
    slug: v.string(),
    supporters: v.array(
      v.object({
        email: v.string(),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
        emailStatus: v.string(),
        smsStatus: v.string(),
        tagIds: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Auth check first — before any key operations
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const { computeOrgScopedEmailHash, computeOrgScopedPhoneHash } = await import("./_orgHash");
    const { getOrgKeyForAction } = await import("./_orgKeyUnseal");
    const { encryptWithOrgKey } = await import("./_orgKey");
    const { api, internal } = await import("./_generated/api");

    // Get org ID from slug
    const org = await ctx.runQuery(api.organizations.getBySlug, { slug: args.slug });
    if (!org) throw new Error("Organization not found");

    // Unseal org key
    const orgKey = await getOrgKeyForAction(ctx, org._id);
    if (!orgKey) throw new Error("Organization encryption not configured. An org owner must set up encryption in org settings before importing supporters.");

    // Step 1: Insert with placeholder encrypted fields to get real Convex _ids
    const placeholders = await Promise.all(
      args.supporters.map(async (s) => {
        const normalizedEmail = s.email.trim().toLowerCase();
        const emailHash = await computeOrgScopedEmailHash(org._id, normalizedEmail);
        const phoneHash = s.phone
          ? await computeOrgScopedPhoneHash(org._id, s.phone.trim())
          : undefined;

        return {
          encryptedEmail: "",
          emailHash,
          encryptedName: undefined as string | undefined,
          encryptedPhone: undefined as string | undefined,
          phoneHash,
          postalCode: s.postalCode,
          country: s.country,
          emailStatus: s.emailStatus,
          smsStatus: s.smsStatus,
          tagIds: s.tagIds,
        };
      }),
    );

    // importBatch returns { imported, updated, skipped } — but we need the IDs
    // Use a dedicated mutation that returns IDs for patching
    const result = await ctx.runMutation(api.supporters.importBatch, {
      slug: args.slug,
      supporters: placeholders,
    });

    // Step 2: Read back the just-inserted supporters by emailHash, encrypt with real _id AAD
    for (let i = 0; i < args.supporters.length; i++) {
      const s = args.supporters[i];
      const normalizedEmail = s.email.trim().toLowerCase();
      const emailHash = placeholders[i].emailHash;

      // Find the supporter by emailHash
      const supporter = await ctx.runQuery(api.supporters.findByEmailHash, {
        slug: args.slug,
        emailHash,
      });
      if (!supporter) continue;

      // Encrypt with supporter:${_id} AAD — matches decrypt path in email.ts
      const entityId = `supporter:${supporter._id}`;
      const [encEmail, encName, encPhone] = await Promise.all([
        encryptWithOrgKey(normalizedEmail, orgKey, entityId, "email"),
        s.name ? encryptWithOrgKey(s.name.trim(), orgKey, entityId, "name") : null,
        s.phone ? encryptWithOrgKey(s.phone.trim(), orgKey, entityId, "phone") : null,
      ]);

      await ctx.runMutation(internal.supporters.patchEncryptedPii, {
        supporterId: supporter._id as any,
        encryptedEmail: JSON.stringify(encEmail),
        encryptedName: encName ? JSON.stringify(encName) : undefined,
        encryptedPhone: encPhone ? JSON.stringify(encPhone) : undefined,
      });
    }

    return result;
  },
});
