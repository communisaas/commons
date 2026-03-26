/**
 * Supporter CRUD — Convex queries, mutations, and actions.
 *
 * PII rules:
 *   READS  → decryptSupporterEmail (deterministic) → safe in queries
 *   WRITES → encryptSupporterEmail (random IV)      → must use actions
 */

import { query, mutation, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireOrgRole } from "./lib/authHelpers";
import {
  decryptSupporterEmail,
  encryptSupporterEmail,
  computeEmailHash,
} from "./lib/pii";

// =============================================================================
// QUERIES (deterministic PII decryption — safe)
// =============================================================================

/**
 * Paginated supporter list with filters and decrypted emails.
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

    // Decrypt emails
    const supporters = await Promise.all(
      items.map(async (s) => {
        let email: string | null = null;
        try {
          email = await decryptSupporterEmail(s);
        } catch {
          // Skip rows with corrupted encryption
        }

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
          email,
          name: s.name ?? null,
          postalCode: s.postalCode ?? null,
          country: s.country ?? null,
          phone: s.phone ?? null,
          verified: s.verified,
          identityVerified: !!(s.identityCommitment && s.verified),
          emailStatus: s.emailStatus,
          source: s.source ?? null,
          customFields: s.customFields ?? null,
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

    const email = await decryptSupporterEmail(supporter);

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
      email,
      name: supporter.name ?? null,
      postalCode: supporter.postalCode ?? null,
      country: supporter.country ?? null,
      phone: supporter.phone ?? null,
      verified: supporter.verified,
      identityVerified: !!(supporter.identityCommitment && supporter.verified),
      identityCommitment: supporter.identityCommitment ?? null,
      emailStatus: supporter.emailStatus,
      smsStatus: supporter.smsStatus,
      source: supporter.source ?? null,
      customFields: supporter.customFields ?? null,
      importedAt: supporter.importedAt ?? null,
      updatedAt: supporter.updatedAt,
      tags: tags.filter((t): t is NonNullable<typeof t> => t !== null),
    };
  },
});

/**
 * Search by email — compute deterministic hash, query by_orgId_emailHash index.
 */
export const searchByEmail = query({
  args: {
    orgSlug: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const emailHash = await computeEmailHash(args.email);
    if (!emailHash) {
      throw new Error("EMAIL_LOOKUP_KEY not configured");
    }

    const supporter = await ctx.db
      .query("supporters")
      .withIndex("by_orgId_emailHash", (idx) =>
        idx.eq("orgId", org._id).eq("emailHash", emailHash),
      )
      .first();

    if (!supporter) return null;

    const email = await decryptSupporterEmail(supporter);

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
      email,
      name: supporter.name ?? null,
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

// =============================================================================
// ACTIONS (non-deterministic PII encryption — random IV)
// =============================================================================

/**
 * Create a new supporter. Action because email encryption uses random IV.
 * Calls internal mutation to do the actual insert + counter updates.
 */
export const create = action({
  args: {
    orgSlug: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: v.optional(v.string()),
    customFields: v.optional(v.any()),
    tagIds: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Three-step insert: Convex _id is only known after db.insert, but
    // encryptSupporterEmail binds the ciphertext to "supporter:{_id}".
    // So: insert with placeholder → encrypt with real _id → patch.

    const normalizedEmail = args.email.trim().toLowerCase();

    // Compute email hash for duplicate checking (deterministic)
    const emailHash = await computeEmailHash(normalizedEmail);
    if (!emailHash) {
      throw new Error("EMAIL_LOOKUP_KEY not configured — cannot create supporter");
    }

    // Step 1: Insert with placeholder encrypted email, get _id back
    const supporterId = await ctx.runMutation(
      internal.supporters.insertSupporter,
      {
        orgSlug: args.orgSlug,
        emailHash,
        encryptedEmail: "", // placeholder — will be patched
        name: args.name,
        postalCode: args.postalCode,
        country: args.country ?? "US",
        phone: args.phone,
        source: args.source ?? "organic",
        customFields: args.customFields,
        tagIds: args.tagIds,
      },
    );

    // Step 2: Encrypt with the real supporter _id
    const { encryptedEmail } = await encryptSupporterEmail(
      normalizedEmail,
      supporterId,
    );

    // Step 3: Patch the record with the real encrypted email
    await ctx.runMutation(internal.supporters.patchEncryptedEmail, {
      supporterId: supporterId as Id<"supporters">,
      encryptedEmail,
    });

    return supporterId;
  },
});

/**
 * Update a supporter. If email changes, re-encrypt via action.
 * If only non-PII fields change, delegates to direct mutation.
 */
export const update = action({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    customFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (args.email) {
      // Email changed — re-encrypt
      const normalizedEmail = args.email.trim().toLowerCase();
      const emailHash = await computeEmailHash(normalizedEmail);
      if (!emailHash) {
        throw new Error("EMAIL_LOOKUP_KEY not configured");
      }

      const { encryptedEmail } = await encryptSupporterEmail(
        normalizedEmail,
        args.supporterId,
      );

      await ctx.runMutation(internal.supporters.updateSupporterFields, {
        orgSlug: args.orgSlug,
        supporterId: args.supporterId,
        encryptedEmail,
        emailHash,
        name: args.name,
        postalCode: args.postalCode,
        country: args.country,
        phone: args.phone,
        customFields: args.customFields,
      });
    } else {
      // No email change — direct mutation for non-PII fields
      await ctx.runMutation(internal.supporters.updateSupporterFields, {
        orgSlug: args.orgSlug,
        supporterId: args.supporterId,
        name: args.name,
        postalCode: args.postalCode,
        country: args.country,
        phone: args.phone,
        customFields: args.customFields,
      });
    }
  },
});

// =============================================================================
// INTERNAL MUTATIONS (called from actions)
// =============================================================================

/**
 * Insert a supporter row + increment org counters + update onboarding state.
 * Returns the new supporter _id.
 */
export const insertSupporter = internalMutation({
  args: {
    orgSlug: v.string(),
    emailHash: v.string(),
    encryptedEmail: v.string(),
    name: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: v.optional(v.string()),
    customFields: v.optional(v.any()),
    tagIds: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Check for duplicate by email hash
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
      name: args.name,
      postalCode: args.postalCode,
      country: args.country ?? "US",
      phone: args.phone,
      source: args.source ?? "organic",
      customFields: args.customFields,
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
 * Patch the encrypted email on a supporter (called after action encrypts with real _id).
 */
export const patchEncryptedEmail = internalMutation({
  args: {
    supporterId: v.id("supporters"),
    encryptedEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter) throw new Error("Supporter not found");

    await ctx.db.patch(args.supporterId, {
      encryptedEmail: args.encryptedEmail,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update non-PII fields on a supporter. Also handles email field updates
 * when called from the update action with pre-encrypted values.
 */
export const updateSupporterFields = internalMutation({
  args: {
    orgSlug: v.string(),
    supporterId: v.id("supporters"),
    encryptedEmail: v.optional(v.string()),
    emailHash: v.optional(v.string()),
    name: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    customFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const supporter = await ctx.db.get(args.supporterId);
    if (!supporter || supporter.orgId !== org._id) {
      throw new Error("Supporter not found");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.encryptedEmail !== undefined) {
      patch.encryptedEmail = args.encryptedEmail;
    }
    if (args.emailHash !== undefined) {
      patch.emailHash = args.emailHash;
    }
    if (args.name !== undefined) patch.name = args.name;
    if (args.postalCode !== undefined) patch.postalCode = args.postalCode;
    if (args.country !== undefined) patch.country = args.country;
    if (args.phone !== undefined) patch.phone = args.phone;
    if (args.customFields !== undefined) patch.customFields = args.customFields;

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
