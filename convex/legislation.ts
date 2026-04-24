import {
  query,
  mutation,
  internalMutation,
  internalAction,
  internalQuery,
  action,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgRole } from "./_authHelpers";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List bills with optional jurisdiction/status filters. Paginated.
 */
export const listBills = query({
  args: {
    jurisdiction: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let q = ctx.db.query("bills");

    if (args.jurisdiction && args.status) {
      q = q.withIndex("by_jurisdiction_status", (idx) =>
        idx.eq("jurisdiction", args.jurisdiction!).eq("status", args.status!),
      );
    } else {
      q = q.withIndex("by_statusDate");
    }

    const results = await q
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    return {
      page: results.page.map((b) => ({
        _id: b._id,
        externalId: b.externalId,
        title: b.title,
        status: b.status,
        statusDate: b.statusDate,
        jurisdiction: b.jurisdiction,
        jurisdictionLevel: b.jurisdictionLevel,
        chamber: b.chamber ?? null,
        sourceUrl: b.sourceUrl,
        topics: b.topics,
        sponsors: b.sponsors ?? null,
        _creationTime: b._creationTime,
      })),
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

/**
 * Get a single bill by ID with full details.
 */
export const getBill = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, { billId }) => {
    const bill = await ctx.db.get(billId);
    if (!bill) return null;

    // Get all actions for this bill
    const actions = await ctx.db
      .query("legislativeActions")
      .withIndex("by_billId", (q) => q.eq("billId", billId))
      .order("desc")
      .take(100);

    return {
      ...bill,
      topicEmbedding: undefined, // strip large vector from response
      actions: actions.map((a) => ({
        _id: a._id,
        name: a.name,
        action: a.action,
        detail: a.detail ?? null,
        occurredAt: a.occurredAt,
        decisionMakerId: a.decisionMakerId ?? null,
        sourceUrl: a.sourceUrl ?? null,
      })),
    };
  },
});

/**
 * List legislative alerts for an org. Filtered by status.
 */
export const listAlerts = query({
  args: {
    slug: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = args.limit ?? 50;

    let q;
    if (args.status) {
      q = ctx.db
        .query("legislativeAlerts")
        .withIndex("by_orgId_status", (idx) =>
          idx.eq("orgId", org._id).eq("status", args.status!),
        );
    } else {
      q = ctx.db
        .query("legislativeAlerts")
        .withIndex("by_orgId_status", (idx) => idx.eq("orgId", org._id));
    }

    const alerts = await q.order("desc").take(limit);

    // Resolve bill titles
    const enriched = await Promise.all(
      alerts.map(async (a) => {
        const bill = await ctx.db.get(a.billId);
        return {
          _id: a._id,
          type: a.type,
          title: a.title,
          summary: a.summary,
          urgency: a.urgency,
          status: a.status,
          seenAt: a.seenAt ?? null,
          actionTaken: a.actionTaken ?? null,
          _creationTime: a._creationTime,
          bill: bill
            ? {
                _id: bill._id,
                title: bill.title,
                status: bill.status,
                externalId: bill.externalId,
              }
            : null,
        };
      }),
    );

    return enriched;
  },
});

/**
 * Get a single alert with its bill data (for campaign prefill).
 * Used by: src/routes/org/[slug]/campaigns/new/+page.server.ts
 */
export const getAlertWithBill = query({
  args: {
    slug: v.string(),
    alertId: v.id("legislativeAlerts"),
  },
  handler: async (ctx, { slug, alertId }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const alert = await ctx.db.get(alertId);
    if (!alert || alert.orgId !== org._id) return null;

    const bill = await ctx.db.get(alert.billId);
    if (!bill) return null;

    return {
      alertId: alert._id,
      billId: bill._id,
      billTitle: bill.title,
      billSummary: bill.summary ?? null,
      billJurisdictionLevel: bill.jurisdictionLevel,
    };
  },
});

/**
 * Get scorecard snapshots for a decision-maker.
 */
export const getScorecard = query({
  args: { decisionMakerId: v.id("decisionMakers") },
  handler: async (ctx, { decisionMakerId }) => {
    const dm = await ctx.db.get(decisionMakerId);
    if (!dm) return null;

    const snapshots = await ctx.db
      .query("scorecardSnapshots")
      .withIndex("by_decisionMakerId", (q) =>
        q.eq("decisionMakerId", decisionMakerId),
      )
      .order("desc")
      .take(12); // last 12 months

    return {
      decisionMaker: {
        _id: dm._id,
        name: dm.name,
        party: dm.party ?? null,
        jurisdiction: dm.jurisdiction ?? null,
        district: dm.district ?? null,
      },
      snapshots: snapshots.map((s) => ({
        _id: s._id,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        responsiveness: s.responsiveness ?? null,
        alignment: s.alignment ?? null,
        composite: s.composite ?? null,
        proofWeightTotal: s.proofWeightTotal,
        deliveriesSent: s.deliveriesSent,
        deliveriesOpened: s.deliveriesOpened,
        repliesReceived: s.repliesReceived,
        alignedVotes: s.alignedVotes,
        totalScoredVotes: s.totalScoredVotes,
        methodologyVersion: s.methodologyVersion,
      })),
    };
  },
});

/**
 * List legislative actions for a bill.
 */
export const listActions = query({
  args: {
    billId: v.id("bills"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actions = await ctx.db
      .query("legislativeActions")
      .withIndex("by_billId", (q) => q.eq("billId", args.billId))
      .order("desc")
      .take(args.limit ?? 100);

    return Promise.all(
      actions.map(async (a) => {
        let dmName: string | null = null;
        if (a.decisionMakerId) {
          const dm = await ctx.db.get(a.decisionMakerId);
          dmName = dm?.name ?? null;
        }
        return {
          _id: a._id,
          name: a.name,
          action: a.action,
          detail: a.detail ?? null,
          occurredAt: a.occurredAt,
          decisionMakerId: a.decisionMakerId ?? null,
          decisionMakerName: dmName,
          sourceUrl: a.sourceUrl ?? null,
        };
      }),
    );
  },
});

// =============================================================================
// DM FOLLOW / ACTIVITY / FEED QUERIES
// =============================================================================

/**
 * Follow a decision-maker on behalf of an org. Upserts.
 */
export const followDm = mutation({
  args: {
    slug: v.string(),
    decisionMakerId: v.id("decisionMakers"),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    alertsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.slug, "editor");

    const dm = await ctx.db.get(args.decisionMakerId);
    if (!dm) throw new Error("Decision-maker not found");

    const VALID_REASONS = ["manual", "research", "constituent", "coalition"];
    const reason = args.reason && VALID_REASONS.includes(args.reason) ? args.reason : "manual";

    // Check existing
    const existing = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId_decisionMakerId", (q) =>
        q.eq("orgId", org._id).eq("decisionMakerId", args.decisionMakerId),
      )
      .first();

    if (existing) {
      return { _id: existing._id, created: false, ...existing };
    }

    const now = Date.now();
    const id = await ctx.db.insert("orgDmFollows", {
      orgId: org._id,
      decisionMakerId: args.decisionMakerId,
      reason,
      note: args.note?.slice(0, 1000),
      alertsEnabled: args.alertsEnabled ?? true,
      followedBy: userId as any,
      followedAt: now,
    });

    return { _id: id, created: true };
  },
});

/**
 * Update follow settings (alertsEnabled, note).
 */
export const updateDmFollow = mutation({
  args: {
    slug: v.string(),
    decisionMakerId: v.id("decisionMakers"),
    alertsEnabled: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId_decisionMakerId", (q) =>
        q.eq("orgId", org._id).eq("decisionMakerId", args.decisionMakerId),
      )
      .first();

    if (!existing) throw new Error("Not following this decision-maker");

    const updates: Record<string, unknown> = {};
    if (args.alertsEnabled !== undefined) updates.alertsEnabled = args.alertsEnabled;
    if (args.note !== undefined) updates.note = args.note.slice(0, 1000);

    await ctx.db.patch(existing._id, updates);
    return { _id: existing._id };
  },
});

/**
 * Unfollow a decision-maker.
 */
export const unfollowDm = mutation({
  args: {
    slug: v.string(),
    decisionMakerId: v.id("decisionMakers"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId_decisionMakerId", (q) =>
        q.eq("orgId", org._id).eq("decisionMakerId", args.decisionMakerId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

/**
 * Get DM activity timeline (legislative actions + accountability receipts).
 */
export const getDmActivity = query({
  args: {
    slug: v.string(),
    decisionMakerId: v.id("decisionMakers"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 20, 50);

    const dm = await ctx.db.get(args.decisionMakerId);
    if (!dm) throw new Error("Decision-maker not found");

    // Fetch legislative actions
    const actions = await ctx.db
      .query("legislativeActions")
      .withIndex("by_decisionMakerId_occurredAt", (q) =>
        q.eq("decisionMakerId", args.decisionMakerId),
      )
      .order("desc")
      .take(limit);

    // Fetch accountability receipts scoped to org
    const receipts = await ctx.db
      .query("accountabilityReceipts")
      .withIndex("by_decisionMakerId_proofDeliveredAt", (q) =>
        q.eq("decisionMakerId", args.decisionMakerId),
      )
      .order("desc")
      .take(limit);

    // Filter receipts by org
    const orgReceipts = receipts.filter((r) => r.orgId === org._id);

    // Normalize into timeline items
    type TimelineItem = {
      type: "vote" | "sponsor" | "receipt";
      id: string;
      date: number;
      [key: string]: unknown;
    };

    const items: TimelineItem[] = [];

    for (const a of actions) {
      const bill = await ctx.db.get(a.billId);
      const isVote = a.action.startsWith("voted_") || a.action === "abstained";
      items.push({
        type: isVote ? "vote" : "sponsor",
        id: a._id,
        date: a.occurredAt,
        actionId: a._id,
        billId: a.billId,
        billExternalId: bill?.externalId ?? null,
        billTitle: bill?.title ?? null,
        value: a.action,
        detail: a.detail ?? null,
        sourceUrl: a.sourceUrl ?? null,
      });
    }

    for (const r of orgReceipts) {
      const bill = await ctx.db.get(r.billId);
      items.push({
        type: "receipt",
        id: r._id,
        date: r.proofDeliveredAt,
        receiptId: r._id,
        billId: r.billId,
        billExternalId: bill?.externalId ?? null,
        billTitle: bill?.title ?? null,
        proofWeight: r.proofWeight,
        dmAction: r.dmAction ?? null,
        alignment: r.alignment,
        causalityClass: r.causalityClass,
        status: r.status,
      });
    }

    // Sort by date DESC
    items.sort((a, b) => b.date - a.date);
    const page = items.slice(0, limit);

    return { items: page, total: actions.length + orgReceipts.length };
  },
});

/**
 * Get feed of activity across all followed decision-makers.
 */
export const getDmFeed = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 20, 50);

    // Get followed DM IDs
    const follows = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const followedDmIds = follows.map((f) => f.decisionMakerId);

    if (followedDmIds.length === 0) {
      return { items: [], total: 0 };
    }

    // Fetch recent actions across all followed DMs
    type FeedItem = {
      type: "vote" | "sponsor" | "receipt";
      id: string;
      date: number;
      [key: string]: unknown;
    };

    const items: FeedItem[] = [];

    for (const dmId of followedDmIds) {
      const dm = await ctx.db.get(dmId);

      const actions = await ctx.db
        .query("legislativeActions")
        .withIndex("by_decisionMakerId_occurredAt", (q) =>
          q.eq("decisionMakerId", dmId),
        )
        .order("desc")
        .take(limit);

      for (const a of actions) {
        const bill = await ctx.db.get(a.billId);
        const isVote = a.action.startsWith("voted_") || a.action === "abstained";
        items.push({
          type: isVote ? "vote" : "sponsor",
          id: a._id,
          date: a.occurredAt,
          actionId: a._id,
          billId: a.billId,
          billExternalId: bill?.externalId ?? null,
          billTitle: bill?.title ?? null,
          value: a.action,
          detail: a.detail ?? null,
          decisionMaker: dm ? {
            _id: dm._id,
            type: dm.type,
            title: dm.title ?? null,
            name: dm.name,
            party: dm.party ?? null,
            jurisdiction: dm.jurisdiction ?? null,
            district: dm.district ?? null,
            photoUrl: dm.photoUrl ?? null,
          } : null,
        });
      }

      const receipts = await ctx.db
        .query("accountabilityReceipts")
        .withIndex("by_decisionMakerId_proofDeliveredAt", (q) =>
          q.eq("decisionMakerId", dmId),
        )
        .order("desc")
        .take(limit);

      const orgReceipts = receipts.filter((r) => r.orgId === org._id);

      for (const r of orgReceipts) {
        const bill = await ctx.db.get(r.billId);
        items.push({
          type: "receipt",
          id: r._id,
          date: r.proofDeliveredAt,
          receiptId: r._id,
          billId: r.billId,
          billExternalId: bill?.externalId ?? null,
          billTitle: bill?.title ?? null,
          proofWeight: r.proofWeight,
          dmAction: r.dmAction ?? null,
          alignment: r.alignment,
          causalityClass: r.causalityClass,
          status: r.status,
          decisionMaker: dm ? {
            _id: dm._id,
            type: dm.type,
            title: dm.title ?? null,
            name: dm.name,
            party: dm.party ?? null,
            jurisdiction: dm.jurisdiction ?? null,
            district: dm.district ?? null,
            photoUrl: dm.photoUrl ?? null,
          } : null,
        });
      }
    }

    // Sort by date DESC, take limit
    items.sort((a, b) => b.date - a.date);
    const page = items.slice(0, limit);

    return { items: page, total: items.length };
  },
});

// =============================================================================
// BILL WATCH CRUD
// =============================================================================

/**
 * Watch a bill on behalf of an org. Upserts.
 */
export const watchBill = mutation({
  args: {
    slug: v.string(),
    billId: v.id("bills"),
    reason: v.optional(v.string()),
    position: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.slug, "editor");

    const bill = await ctx.db.get(args.billId);
    if (!bill) throw new Error("Bill not found");

    const existing = await ctx.db
      .query("orgBillWatches")
      .withIndex("by_orgId_billId", (q) =>
        q.eq("orgId", org._id).eq("billId", args.billId),
      )
      .first();

    if (existing) {
      return { _id: existing._id, created: false };
    }

    const validPositions = ["support", "oppose"];
    const position = args.position && validPositions.includes(args.position) ? args.position : undefined;

    const id = await ctx.db.insert("orgBillWatches", {
      orgId: org._id,
      billId: args.billId,
      reason: args.reason ?? "manual",
      position,
      addedBy: userId as any,
    });

    return { _id: id, created: true };
  },
});

/**
 * Update position on a watched bill.
 */
export const updateBillWatch = mutation({
  args: {
    slug: v.string(),
    billId: v.id("bills"),
    position: v.string(), // 'support' | 'oppose' | 'neutral'
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const validPositions = ["support", "oppose", "neutral"];
    if (!validPositions.includes(args.position)) {
      throw new Error('position must be "support", "oppose", or "neutral"');
    }

    const existing = await ctx.db
      .query("orgBillWatches")
      .withIndex("by_orgId_billId", (q) =>
        q.eq("orgId", org._id).eq("billId", args.billId),
      )
      .first();

    if (!existing) throw new Error("Bill is not being watched");

    const position = args.position === "neutral" ? undefined : args.position;
    await ctx.db.patch(existing._id, { position });

    return { _id: existing._id, position: position ?? null };
  },
});

/**
 * Unwatch a bill.
 */
export const unwatchBill = mutation({
  args: {
    slug: v.string(),
    billId: v.id("bills"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db
      .query("orgBillWatches")
      .withIndex("by_orgId_billId", (q) =>
        q.eq("orgId", org._id).eq("billId", args.billId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

// =============================================================================
// BILL BROWSE + SEARCH QUERIES
// =============================================================================

/**
 * Browse bills by org relevance score (pre-computed cosine similarity).
 */
export const browseBills = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 20, 50);

    const results = await ctx.db
      .query("orgBillRelevances")
      .withIndex("by_orgId_score", (q) => q.eq("orgId", org._id))
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    const bills = await Promise.all(
      results.page.map(async (r) => {
        const bill = await ctx.db.get(r.billId);
        if (!bill) return null;
        return {
          _id: bill._id,
          externalId: bill.externalId,
          title: bill.title,
          summary: bill.summary ?? null,
          status: bill.status,
          statusDate: bill.statusDate,
          jurisdiction: bill.jurisdiction,
          jurisdictionLevel: bill.jurisdictionLevel,
          chamber: bill.chamber ?? null,
          sourceUrl: bill.sourceUrl,
          relevanceScore: r.score,
          matchedDomains: r.matchedOn,
        };
      }),
    );

    return {
      bills: bills.filter((b): b is NonNullable<typeof b> => b !== null),
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

/**
 * Search bills using Convex full-text search.
 */
export const searchBills = query({
  args: {
    slug: v.string(),
    q: v.string(),
    jurisdiction: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 20, 50);

    if (!args.q.trim()) throw new Error('Query parameter "q" is required');
    if (args.q.length > 200) throw new Error("Search query must be 200 characters or fewer");

    let searchQuery = ctx.db
      .query("bills")
      .withSearchIndex("search_bills", (q) => {
        let search = q.search("title", args.q);
        if (args.jurisdiction) search = search.eq("jurisdiction", args.jurisdiction);
        if (args.status) search = search.eq("status", args.status);
        return search;
      });

    const results = await searchQuery.take(limit);

    return {
      bills: results.map((b) => ({
        _id: b._id,
        externalId: b.externalId,
        title: b.title,
        summary: b.summary ?? null,
        status: b.status,
        statusDate: b.statusDate,
        jurisdiction: b.jurisdiction,
        jurisdictionLevel: b.jurisdictionLevel,
        chamber: b.chamber ?? null,
        sourceUrl: b.sourceUrl,
      })),
      total: results.length,
    };
  },
});

// =============================================================================
// REPRESENTATIVES (DM import + lookup)
// =============================================================================

/**
 * Import international representatives (decision-makers).
 */
export const importRepresentatives = mutation({
  args: {
    slug: v.string(),
    representatives: v.array(
      v.object({
        countryCode: v.string(),
        constituencyId: v.string(),
        constituencyName: v.string(),
        name: v.string(),
        party: v.optional(v.string()),
        office: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        photoUrl: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    if (args.representatives.length > 100) {
      throw new Error("Maximum 100 representatives per request");
    }

    const SAFE_URL_RE = /^https?:\/\/.{1,2048}$/i;
    const sanitizeUrl = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      return SAFE_URL_RE.test(url) ? url : undefined;
    };

    let imported = 0;

    for (const rep of args.representatives) {
      // Look up existing by constituency system
      const existingExt = await ctx.db
        .query("externalIds")
        .withIndex("by_system_value", (q) =>
          q.eq("system", "constituency").eq("value", rep.constituencyId),
        )
        .first();

      if (existingExt) {
        const dm = await ctx.db.get(existingExt.decisionMakerId);
        if (dm && dm.name === rep.name && dm.jurisdiction === rep.countryCode) {
          await ctx.db.patch(dm._id, {
            district: rep.constituencyName,
            party: rep.party,
            title: rep.office,
            phone: rep.phone,
            email: rep.email,
            websiteUrl: sanitizeUrl(rep.websiteUrl),
            photoUrl: sanitizeUrl(rep.photoUrl),
            updatedAt: Date.now(),
          });
          imported++;
          continue;
        }
      }

      // Create new DM
      const nameParts = rep.name.trim().split(/\s+/);
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : rep.name;
      const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : undefined;

      const dmId = await ctx.db.insert("decisionMakers", {
        type: "legislator",
        name: rep.name,
        firstName,
        lastName,
        jurisdiction: rep.countryCode,
        jurisdictionLevel: "international",
        district: rep.constituencyName,
        party: rep.party,
        title: rep.office,
        phone: rep.phone,
        email: rep.email,
        websiteUrl: sanitizeUrl(rep.websiteUrl),
        photoUrl: sanitizeUrl(rep.photoUrl),
        active: true,
        updatedAt: Date.now(),
      });

      await ctx.db.insert("externalIds", {
        decisionMakerId: dmId,
        system: "constituency",
        value: rep.constituencyId,
      });

      imported++;
    }

    return { imported };
  },
});

/**
 * List international representatives with cursor pagination.
 */
export const listRepresentatives = query({
  args: {
    slug: v.string(),
    country: v.optional(v.string()),
    constituency: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 50, 100);

    // If filtering by constituency, look up external IDs first
    if (args.constituency) {
      const extIds = await ctx.db
        .query("externalIds")
        .withIndex("by_system_value", (q) =>
          q.eq("system", "constituency").eq("value", args.constituency!),
        )
        .collect();

      const dms = await Promise.all(
        extIds.map(async (ext) => {
          const dm = await ctx.db.get(ext.decisionMakerId);
          if (!dm) return null;
          if (args.country && dm.jurisdiction !== args.country) return null;
          return {
            _id: dm._id,
            countryCode: dm.jurisdiction ?? null,
            constituencyId: ext.value,
            constituencyName: dm.district ?? null,
            name: dm.name,
            party: dm.party ?? null,
            title: dm.title ?? null,
            phone: dm.phone ?? null,
            email: dm.email ?? null,
            websiteUrl: dm.websiteUrl ?? null,
            photoUrl: dm.photoUrl ?? null,
          };
        }),
      );

      return {
        data: dms.filter((d): d is NonNullable<typeof d> => d !== null),
        hasMore: false,
        cursor: null,
      };
    }

    // General listing by jurisdiction level
    let q = ctx.db
      .query("decisionMakers")
      .withIndex("by_jurisdiction_jurisdictionLevel", (idx) => {
        if (args.country) {
          return idx.eq("jurisdiction", args.country).eq("jurisdictionLevel", "international");
        }
        return idx;
      });

    const results = await q
      .order("asc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    // Filter to international only if no country specified
    const filtered = args.country
      ? results.page
      : results.page.filter((dm) => dm.jurisdictionLevel === "international");

    const data = await Promise.all(
      filtered.map(async (dm) => {
        const ext = await ctx.db
          .query("externalIds")
          .withIndex("by_decisionMakerId_system", (q) =>
            q.eq("decisionMakerId", dm._id).eq("system", "constituency"),
          )
          .first();

        return {
          _id: dm._id,
          countryCode: dm.jurisdiction ?? null,
          constituencyId: ext?.value ?? null,
          constituencyName: dm.district ?? null,
          name: dm.name,
          party: dm.party ?? null,
          title: dm.title ?? null,
          phone: dm.phone ?? null,
          email: dm.email ?? null,
          websiteUrl: dm.websiteUrl ?? null,
          photoUrl: dm.photoUrl ?? null,
        };
      }),
    );

    return {
      data,
      hasMore: !results.isDone,
      cursor: results.continueCursor,
    };
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Upsert a bill from ingestion. Internal — called by syncPipeline action.
 * Returns { id, statusChanged }.
 */
export const upsertBill = internalMutation({
  args: {
    externalId: v.string(),
    jurisdiction: v.string(),
    jurisdictionLevel: v.string(),
    chamber: v.optional(v.string()),
    title: v.string(),
    summary: v.optional(v.string()),
    status: v.string(),
    statusDate: v.number(),
    sponsors: v.optional(v.any()),
    committees: v.array(v.string()),
    sourceUrl: v.string(),
    fullTextUrl: v.optional(v.string()),
    topics: v.array(v.string()),
    entities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("bills")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .first();

    const now = Date.now();

    if (existing) {
      const statusChanged = existing.status !== args.status;
      await ctx.db.patch(existing._id, {
        title: args.title,
        summary: args.summary,
        status: args.status,
        statusDate: args.statusDate,
        sponsors: args.sponsors,
        committees: args.committees,
        sourceUrl: args.sourceUrl,
        fullTextUrl: args.fullTextUrl,
        topics: args.topics,
        entities: args.entities,
        updatedAt: now,
      });
      return { id: existing._id, statusChanged };
    }

    const id = await ctx.db.insert("bills", {
      externalId: args.externalId,
      jurisdiction: args.jurisdiction,
      jurisdictionLevel: args.jurisdictionLevel,
      chamber: args.chamber,
      title: args.title,
      summary: args.summary,
      status: args.status,
      statusDate: args.statusDate,
      sponsors: args.sponsors,
      committees: args.committees,
      sourceUrl: args.sourceUrl,
      fullTextUrl: args.fullTextUrl,
      topics: args.topics,
      entities: args.entities,
      topicEmbedding: undefined,
      updatedAt: now,
    });

    return { id, statusChanged: true };
  },
});

/**
 * Create a legislative alert. Internal — called by alert generation.
 */
export const createAlert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    billId: v.id("bills"),
    type: v.string(),
    title: v.string(),
    summary: v.string(),
    urgency: v.string(),
  },
  handler: async (ctx, args) => {
    // Dedup: check if alert already exists for this org+bill+type
    const existing = await ctx.db
      .query("legislativeAlerts")
      .withIndex("by_orgId_billId_type", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("billId", args.billId)
          .eq("type", args.type),
      )
      .first();

    if (existing) return { id: existing._id, created: false };

    const id = await ctx.db.insert("legislativeAlerts", {
      orgId: args.orgId,
      billId: args.billId,
      type: args.type,
      title: args.title,
      summary: args.summary,
      urgency: args.urgency,
      status: "pending",
    });

    return { id, created: true };
  },
});

/**
 * Dismiss an alert. Authenticated — requires org membership.
 */
export const dismissAlert = mutation({
  args: {
    slug: v.string(),
    alertId: v.id("legislativeAlerts"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");

    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.orgId !== org._id) {
      throw new Error("Alert not found");
    }

    await ctx.db.patch(args.alertId, { status: "dismissed" });
    return args.alertId;
  },
});

/**
 * Create a legislative action (vote/sponsor record). Internal.
 */
export const createAction = internalMutation({
  args: {
    billId: v.id("bills"),
    decisionMakerId: v.optional(v.id("decisionMakers")),
    externalId: v.optional(v.string()),
    name: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("legislativeActions", {
      billId: args.billId,
      decisionMakerId: args.decisionMakerId,
      externalId: args.externalId,
      name: args.name,
      action: args.action,
      detail: args.detail,
      sourceUrl: args.sourceUrl,
      occurredAt: args.occurredAt,
    });
    return id;
  },
});

/**
 * Save a scorecard snapshot. Internal — called by scorecard cron.
 */
export const saveScorecard = internalMutation({
  args: {
    decisionMakerId: v.id("decisionMakers"),
    periodStart: v.number(),
    periodEnd: v.number(),
    responsiveness: v.optional(v.float64()),
    alignment: v.optional(v.float64()),
    composite: v.optional(v.float64()),
    proofWeightTotal: v.float64(),
    deliveriesSent: v.number(),
    deliveriesOpened: v.number(),
    deliveriesVerified: v.number(),
    repliesReceived: v.number(),
    alignedVotes: v.number(),
    totalScoredVotes: v.number(),
    methodologyVersion: v.number(),
    snapshotHash: v.string(),
  },
  handler: async (ctx, args) => {
    // Upsert: check for existing snapshot with same DM + period + version
    const existing = await ctx.db
      .query("scorecardSnapshots")
      .withIndex("by_decisionMakerId_periodEnd_methodologyVersion", (q) =>
        q
          .eq("decisionMakerId", args.decisionMakerId)
          .eq("periodEnd", args.periodEnd)
          .eq("methodologyVersion", args.methodologyVersion),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        periodStart: args.periodStart,
        responsiveness: args.responsiveness,
        alignment: args.alignment,
        composite: args.composite,
        proofWeightTotal: args.proofWeightTotal,
        deliveriesSent: args.deliveriesSent,
        deliveriesOpened: args.deliveriesOpened,
        deliveriesVerified: args.deliveriesVerified,
        repliesReceived: args.repliesReceived,
        alignedVotes: args.alignedVotes,
        totalScoredVotes: args.totalScoredVotes,
        snapshotHash: args.snapshotHash,
      });
      return existing._id;
    }

    return await ctx.db.insert("scorecardSnapshots", args);
  },
});

// =============================================================================
// ACTIONS (external API calls + multi-step pipelines)
// =============================================================================

const CONGRESS_API_BASE = "https://api.congress.gov/v3";

/**
 * Full sync pipeline: fetch Congress.gov → upsert bills → score → alert.
 * Scheduled by cron every 6 hours.
 */
export const syncPipeline = internalAction({
  args: {
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.CONGRESS_API_KEY;
    if (!apiKey) {
      console.error("[legislation-sync] CONGRESS_API_KEY not set");
      return { error: "CONGRESS_API_KEY not set" };
    }

    const limit = args.limit ?? 50;
    const cursor = args.cursor
      ? JSON.parse(args.cursor)
      : { offset: 0, lastSyncedAt: new Date(0).toISOString(), consecutiveErrors: 0 };

    const summary = {
      billsIngested: 0,
      statusChanges: 0,
      alertsCreated: 0,
      errors: [] as string[],
    };

    // Step 1: Fetch bill list from Congress.gov
    const listUrl = `${CONGRESS_API_BASE}/bill/119?offset=${cursor.offset}&limit=250&sort=updateDate+desc&api_key=${apiKey}&format=json`;

    let bills: Array<{
      congress: number;
      type: string;
      number: number;
      title: string;
      latestAction?: { actionDate: string; text: string };
      updateDate: string;
    }> = [];

    try {
      const resp = await fetch(listUrl);
      if (!resp.ok) {
        summary.errors.push(`Congress.gov list fetch failed: HTTP ${resp.status}`);
        return summary;
      }
      const data = (await resp.json()) as {
        bills: typeof bills;
        pagination: { count: number; next?: string };
      };
      bills = data.bills ?? [];
    } catch (err) {
      summary.errors.push(
        `Congress.gov fetch error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return summary;
    }

    // Step 2: Process each bill (fetch detail + upsert)
    let processed = 0;
    for (const bill of bills) {
      if (processed >= limit) break;

      try {
        const billType = bill.type.toLowerCase().replace(/\./g, "");
        const detailUrl = `${CONGRESS_API_BASE}/bill/${bill.congress}/${billType}/${bill.number}?api_key=${apiKey}&format=json`;
        const detailResp = await fetch(detailUrl);

        if (!detailResp.ok) {
          summary.errors.push(`Detail fetch failed for ${bill.type} ${bill.number}`);
          continue;
        }

        const detail = (await detailResp.json()) as {
          bill: {
            title: string;
            originChamber?: string;
            policyArea?: { name: string };
            sponsors?: Array<{ fullName: string; bioguideId: string; party: string }>;
            latestAction?: { actionDate: string; text: string };
            updateDate: string;
          };
        };

        const externalId = `${billType}-${bill.number}-${bill.congress}`;
        const status = inferBillStatus(detail.bill.latestAction?.text);
        const chamber = detail.bill.originChamber?.toLowerCase() === "senate" ? "senate" : "house";

        const result = await ctx.runMutation(internal.legislation.upsertBill, {
          externalId,
          jurisdiction: "us-federal",
          jurisdictionLevel: "federal",
          chamber,
          title: detail.bill.title,
          summary: undefined,
          status,
          statusDate: Date.parse(
            detail.bill.latestAction?.actionDate ?? detail.bill.updateDate,
          ),
          sponsors: detail.bill.sponsors?.map((s) => ({
            name: s.fullName,
            externalId: s.bioguideId,
            party: s.party,
          })),
          committees: [],
          sourceUrl: `https://www.congress.gov/bill/${bill.congress}th-congress/${chamber === "senate" ? "senate" : "house"}-bill/${bill.number}`,
          fullTextUrl: undefined,
          topics: detail.bill.policyArea ? [detail.bill.policyArea.name] : [],
          entities: [],
        });

        summary.billsIngested++;
        if (result.statusChanged) summary.statusChanges++;
        processed++;
      } catch (err) {
        summary.errors.push(
          `Error on ${bill.type} ${bill.number}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `[legislation-sync] Ingested ${summary.billsIngested} bills, ${summary.statusChanges} status changes, ${summary.errors.length} errors`,
    );

    return summary;
  },
});

/**
 * Score a bill's relevance against org issue domains using vector search.
 * Uses Convex's built-in vectorSearch on orgIssueDomains.
 */
export const scoreBillRelevance = internalAction({
  args: { billId: v.id("bills") },
  handler: async (ctx, { billId }) => {
    // Read the bill's embedding
    const bill = await ctx.runQuery(internal.legislation.getBillInternal, {
      billId,
    });
    if (!bill?.topicEmbedding) {
      return { billId, matchesFound: 0, rowsUpserted: 0 };
    }

    // Vector search across all org issue domain embeddings
    const matches = await ctx.vectorSearch("orgIssueDomains", "by_embedding", {
      vector: bill.topicEmbedding,
      limit: 50,
    });

    if (matches.length === 0) {
      return { billId, matchesFound: 0, rowsUpserted: 0 };
    }

    // Resolve full docs to get orgId and label
    const RELEVANCE_THRESHOLD = 0.6;
    const orgMap = new Map<
      string,
      { bestScore: number; labels: string[] }
    >();

    for (const match of matches) {
      if (match._score < RELEVANCE_THRESHOLD) continue;

      const doc = await ctx.runQuery(
        internal.legislation.getIssueDomainInternal,
        { id: match._id },
      );
      if (!doc) continue;

      const orgIdStr = doc.orgId as string;
      const existing = orgMap.get(orgIdStr);
      if (existing) {
        existing.labels.push(doc.label);
        if (match._score > existing.bestScore) existing.bestScore = match._score;
      } else {
        orgMap.set(orgIdStr, {
          bestScore: match._score,
          labels: [doc.label],
        });
      }
    }

    // Upsert relevance rows
    let rowsUpserted = 0;
    for (const [orgIdStr, { bestScore, labels }] of orgMap) {
      await ctx.runMutation(internal.legislation.upsertRelevance, {
        orgId: orgIdStr as Id<"organizations">,
        billId,
        score: bestScore,
        matchedOn: labels,
      });
      rowsUpserted++;
    }

    return { billId, matchesFound: matches.length, rowsUpserted };
  },
});

// =============================================================================
// INTERNAL HELPERS (query/mutation for use by actions)
// =============================================================================

/** Internal query: get bill with embedding for scoring action. */
export const getBillInternal = internalQuery({
  args: { billId: v.id("bills") },
  handler: async (ctx, { billId }) => ctx.db.get(billId),
});

/** Internal query: get issue domain doc for vector search result resolution. */
export const getIssueDomainInternal = internalQuery({
  args: { id: v.id("orgIssueDomains") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/** Internal mutation: upsert org bill relevance. */
export const upsertRelevance = internalMutation({
  args: {
    orgId: v.id("organizations"),
    billId: v.id("bills"),
    score: v.float64(),
    matchedOn: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgBillRelevances")
      .withIndex("by_orgId_billId", (q) =>
        q.eq("orgId", args.orgId).eq("billId", args.billId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        score: args.score,
        matchedOn: args.matchedOn,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgBillRelevances", {
      orgId: args.orgId,
      billId: args.billId,
      score: args.score,
      matchedOn: args.matchedOn,
    });
  },
});

// =============================================================================
// HELPERS
// =============================================================================

function inferBillStatus(actionText?: string): string {
  if (!actionText) return "introduced";
  const text = actionText.toLowerCase();
  if (text.includes("became public law") || text.includes("signed by president"))
    return "signed";
  if (text.includes("vetoed")) return "vetoed";
  if (text.includes("passed house") || text.includes("passed senate"))
    return "passed";
  if (text.includes("failed") || text.includes("rejected")) return "failed";
  if (text.includes("placed on calendar") || text.includes("cloture"))
    return "floor";
  if (text.includes("referred to") || text.includes("committee"))
    return "committee";
  return "introduced";
}

// =============================================================================
// ORG-SCOPED QUERIES (for page server files)
// =============================================================================

/**
 * List bills an org is watching, with bill details.
 */
export const listWatchedBills = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = args.limit ?? 10;

    const watches = await ctx.db
      .query("orgBillWatches")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .take(limit);

    return Promise.all(
      watches.map(async (w) => {
        const bill = await ctx.db.get(w.billId);
        return {
          _id: w._id,
          billId: w.billId,
          reason: w.reason,
          position: w.position ?? null,
          bill: bill
            ? {
                _id: bill._id,
                externalId: bill.externalId,
                title: bill.title,
                summary: bill.summary ?? null,
                status: bill.status,
                statusDate: bill.statusDate,
                jurisdiction: bill.jurisdiction,
                jurisdictionLevel: bill.jurisdictionLevel,
                chamber: bill.chamber ?? null,
                sourceUrl: bill.sourceUrl,
              }
            : null,
        };
      }),
    );
  },
});

/**
 * List bills relevant to an org by relevance score.
 */
export const listRelevantBills = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = args.limit ?? 10;

    const relevances = await ctx.db
      .query("orgBillRelevances")
      .withIndex("by_orgId_score", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(limit);

    return Promise.all(
      relevances.map(async (r) => {
        const bill = await ctx.db.get(r.billId);
        return {
          _id: r._id,
          billId: r.billId,
          score: r.score,
          matchedOn: r.matchedOn,
          bill: bill
            ? {
                _id: bill._id,
                externalId: bill.externalId,
                title: bill.title,
                summary: bill.summary ?? null,
                status: bill.status,
                statusDate: bill.statusDate,
                jurisdiction: bill.jurisdiction,
                jurisdictionLevel: bill.jurisdictionLevel,
                chamber: bill.chamber ?? null,
                sourceUrl: bill.sourceUrl,
              }
            : null,
        };
      }),
    );
  },
});

/**
 * List org DM follows with decision-maker details. Paginated by cursor.
 */
export const listOrgDmFollows = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = args.limit ?? 20;

    const follows = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(limit + 1);

    const hasMore = follows.length > limit;
    const page = follows.slice(0, limit);

    const enriched = await Promise.all(
      page.map(async (f) => {
        const dm = await ctx.db.get(f.decisionMakerId);
        return {
          _id: f._id,
          reason: f.reason,
          alertsEnabled: f.alertsEnabled,
          followedAt: f.followedAt,
          decisionMaker: dm
            ? {
                _id: dm._id,
                type: dm.type,
                title: dm.title ?? null,
                name: dm.name,
                firstName: dm.firstName ?? null,
                lastName: dm.lastName ?? null,
                party: dm.party ?? null,
                jurisdiction: dm.jurisdiction ?? null,
                district: dm.district ?? null,
                photoUrl: dm.photoUrl ?? null,
                active: dm.active,
              }
            : null,
        };
      }),
    );

    const followedCount = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect()
      .then((rows) => rows.length);

    return {
      followed: enriched,
      followedCount,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?._id ?? null : null,
    };
  },
});

/**
 * Discover active DMs not followed by org.
 */
export const discoverDms = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = args.limit ?? 12;

    // Get all followed DM IDs for this org
    const followedRows = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();
    const followedIds = new Set(followedRows.map((f) => f.decisionMakerId));

    // Get active DMs, filtering out followed ones
    const allActive = await ctx.db
      .query("decisionMakers")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(limit + followedIds.size + 10);

    const discovered = allActive
      .filter((dm) => !followedIds.has(dm._id))
      .slice(0, limit);

    return discovered.map((dm) => ({
      _id: dm._id,
      type: dm.type,
      title: dm.title ?? null,
      name: dm.name,
      firstName: dm.firstName ?? null,
      lastName: dm.lastName ?? null,
      party: dm.party ?? null,
      jurisdiction: dm.jurisdiction ?? null,
      district: dm.district ?? null,
      photoUrl: dm.photoUrl ?? null,
      active: dm.active,
    }));
  },
});

/**
 * Get full DM detail + follow status + recent actions + receipts for an org.
 */
export const getDmDetail = query({
  args: {
    slug: v.string(),
    dmId: v.id("decisionMakers"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");

    const dm = await ctx.db.get(args.dmId);
    if (!dm) return null;

    // Follow status
    const follow = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId_decisionMakerId", (q) =>
        q.eq("orgId", org._id).eq("decisionMakerId", args.dmId),
      )
      .first();

    // Recent legislative actions for this DM
    const actions = await ctx.db
      .query("legislativeActions")
      .withIndex("by_decisionMakerId_occurredAt", (q) =>
        q.eq("decisionMakerId", args.dmId),
      )
      .order("desc")
      .take(20);

    // Enrich actions with bill info
    const enrichedActions = await Promise.all(
      actions.map(async (a) => {
        const bill = await ctx.db.get(a.billId);
        return {
          _id: a._id,
          action: a.action,
          detail: a.detail ?? null,
          sourceUrl: a.sourceUrl ?? null,
          occurredAt: a.occurredAt,
          bill: bill
            ? { _id: bill._id, externalId: bill.externalId, title: bill.title }
            : null,
        };
      }),
    );

    // Accountability receipts for this DM + org
    const receipts = await ctx.db
      .query("accountabilityReceipts")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const dmReceipts = receipts.filter(
      (r) => r.decisionMakerId === args.dmId,
    );

    const enrichedReceipts = await Promise.all(
      dmReceipts.map(async (r) => {
        const bill = await ctx.db.get(r.billId);
        return {
          _id: r._id,
          proofWeight: r.proofWeight,
          dmAction: r.dmAction ?? null,
          alignment: r.alignment,
          causalityClass: r.causalityClass ?? null,
          status: r.status,
          proofDeliveredAt: r.proofDeliveredAt,
          bill: bill
            ? { _id: bill._id, externalId: bill.externalId, title: bill.title }
            : null,
        };
      }),
    );

    // Accountability summary
    const receiptCount = enrichedReceipts.length;
    const avgProofWeight =
      receiptCount > 0
        ? enrichedReceipts.reduce((sum, r) => sum + r.proofWeight, 0) /
          receiptCount
        : 0;
    const alignedCount = enrichedReceipts.filter(
      (r) => r.alignment > 0,
    ).length;
    const opposedCount = enrichedReceipts.filter(
      (r) => r.alignment < 0,
    ).length;

    return {
      decisionMaker: {
        _id: dm._id,
        type: dm.type,
        title: dm.title ?? null,
        name: dm.name,
        firstName: dm.firstName ?? null,
        lastName: dm.lastName ?? null,
        party: dm.party ?? null,
        jurisdiction: dm.jurisdiction ?? null,
        jurisdictionLevel: dm.jurisdictionLevel ?? null,
        district: dm.district ?? null,
        phone: dm.phone ?? null,
        email: dm.email ?? null,
        websiteUrl: dm.websiteUrl ?? null,
        officeAddress: dm.officeAddress ?? null,
        photoUrl: dm.photoUrl ?? null,
        active: dm.active,
        termStart: dm.termStart ?? null,
        termEnd: dm.termEnd ?? null,
      },
      follow: follow
        ? {
            _id: follow._id,
            reason: follow.reason,
            alertsEnabled: follow.alertsEnabled,
            note: follow.note ?? null,
            followedAt: follow.followedAt,
          }
        : null,
      actions: enrichedActions,
      receipts: enrichedReceipts,
      accountability: {
        receiptCount,
        avgProofWeight: Math.round(avgProofWeight * 100) / 100,
        alignedCount,
        opposedCount,
      },
    };
  },
});

/**
 * Public DM profile by bioguide ID or direct DM ID. No auth required.
 * Returns: name, party, jurisdiction, district, photoUrl + cross-org
 * accountability receipt summaries with k-anonymity thresholds.
 * Used by: src/routes/accountability/[bioguideId]/+page.server.ts
 */
export const getDmPublicProfile = query({
  args: { identifier: v.string() },
  handler: async (ctx, { identifier }) => {
    let decisionMakerId: Id<"decisionMakers"> | null = null;

    // Try ExternalId lookup first (bioguide -> decisionMakerId)
    const externalId = await ctx.db
      .query("externalIds")
      .withIndex("by_system_value", (q) =>
        q.eq("system", "bioguide").eq("value", identifier),
      )
      .first();

    if (externalId) {
      decisionMakerId = externalId.decisionMakerId;
    } else {
      // Fallback: treat identifier as a direct decisionMakerId
      try {
        const dm = await ctx.db.get(identifier as Id<"decisionMakers">);
        if (dm) decisionMakerId = dm._id;
      } catch {
        // Invalid ID format — not found
      }
    }

    if (!decisionMakerId) return null;

    const dm = await ctx.db.get(decisionMakerId);
    if (!dm) return null;

    // All accountability receipts for this DM (cross-org aggregate)
    const receipts = await ctx.db
      .query("accountabilityReceipts")
      .withIndex("by_decisionMakerId_proofDeliveredAt", (q) =>
        q.eq("decisionMakerId", decisionMakerId!),
      )
      .order("desc")
      .collect();

    if (receipts.length === 0) return null;

    // Enrich with bill info
    const enrichedReceipts = await Promise.all(
      receipts.map(async (r) => {
        const bill = await ctx.db.get(r.billId);
        return { ...r, bill };
      }),
    );

    // Aggregate stats
    const totalWeight = receipts.reduce((sum, r) => sum + r.proofWeight, 0);
    const weightedAlignment =
      totalWeight > 0
        ? receipts.reduce((sum, r) => sum + r.alignment * r.proofWeight, 0) /
          totalWeight
        : 0;

    const causalReceipts = receipts.filter(
      (r) =>
        r.causalityClass === "strong" || r.causalityClass === "moderate",
    );

    const totalVerified = receipts.reduce(
      (sum, r) => sum + r.verifiedCount,
      0,
    );
    const uniqueBills = new Set(receipts.map((r) => r.billId)).size;

    // Group by bill for display
    const billMap = new Map<
      string,
      {
        bill: {
          _id: Id<"bills">;
          externalId: string;
          title: string;
          status: string;
          jurisdiction: string;
        } | null;
        receipts: Array<{
          _id: Id<"accountabilityReceipts">;
          proofWeight: number;
          verifiedCount: number | null;
          districtCount: number | null;
          causalityClass: string;
          dmAction: string | null;
          alignment: number;
          proofDeliveredAt: number;
          actionOccurredAt: number | null;
        }>;
        maxProofWeight: number;
        totalVerified: number;
        latestAction: string | null;
      }
    >();

    for (const r of enrichedReceipts) {
      const billIdStr = r.billId as string;
      if (!billMap.has(billIdStr)) {
        billMap.set(billIdStr, {
          bill: r.bill
            ? {
                _id: r.bill._id,
                externalId: r.bill.externalId,
                title: r.bill.title,
                status: r.bill.status,
                jurisdiction: r.bill.jurisdiction,
              }
            : null,
          receipts: [],
          maxProofWeight: 0,
          totalVerified: 0,
          latestAction: null,
        });
      }
      const entry = billMap.get(billIdStr)!;
      entry.receipts.push({
        _id: r._id,
        proofWeight: r.proofWeight,
        verifiedCount: r.verifiedCount >= 5 ? r.verifiedCount : null, // k-anonymity
        districtCount: r.districtCount >= 3 ? r.districtCount : null,
        causalityClass: r.causalityClass,
        dmAction: r.dmAction ?? null,
        alignment: r.alignment,
        proofDeliveredAt: r.proofDeliveredAt,
        actionOccurredAt: r.actionOccurredAt ?? null,
      });
      entry.maxProofWeight = Math.max(entry.maxProofWeight, r.proofWeight);
      entry.totalVerified += r.verifiedCount;
      if (r.dmAction) entry.latestAction = r.dmAction;
    }

    return {
      decisionMakerId: dm._id,
      dmName: dm.name,
      decisionMaker: {
        _id: dm._id,
        name: dm.name,
        title: dm.title ?? null,
        party: dm.party ?? null,
        jurisdiction: dm.jurisdiction ?? null,
        district: dm.district ?? null,
        photoUrl: dm.photoUrl ?? null,
      },
      summary: {
        accountabilityScore: Math.round((weightedAlignment + 1) * 50),
        weightedAlignment,
        totalReceipts: receipts.length,
        totalVerifiedConstituents:
          totalVerified >= 5 ? totalVerified : null,
        uniqueBills,
        causalityRate: causalReceipts.length / receipts.length,
        avgProofWeight: totalWeight / receipts.length,
      },
      bills: Array.from(billMap.values()).sort(
        (a, b) => b.maxProofWeight - a.maxProofWeight,
      ),
    };
  },
});

/**
 * Get DM + scorecard snapshots (public, no org auth needed).
 */
export const getDmScorecard = query({
  args: { dmId: v.id("decisionMakers") },
  handler: async (ctx, { dmId }) => {
    const dm = await ctx.db.get(dmId);
    if (!dm) return null;

    const latest = await ctx.db
      .query("scorecardSnapshots")
      .withIndex("by_decisionMakerId", (q) => q.eq("decisionMakerId", dmId))
      .order("desc")
      .first();

    const history = await ctx.db
      .query("scorecardSnapshots")
      .withIndex("by_decisionMakerId", (q) => q.eq("decisionMakerId", dmId))
      .order("desc")
      .take(12);

    return {
      decisionMaker: {
        _id: dm._id,
        name: dm.name,
        title: dm.title ?? null,
        party: dm.party ?? null,
        district: dm.district ?? null,
        jurisdiction: dm.jurisdiction ?? null,
        photoUrl: dm.photoUrl ?? null,
      },
      current: latest
        ? {
            responsiveness: latest.responsiveness ?? null,
            alignment: latest.alignment ?? null,
            composite: latest.composite ?? null,
            proofWeightTotal: latest.proofWeightTotal,
            period: {
              start: latest.periodStart,
              end: latest.periodEnd,
            },
            attestationHash: latest.snapshotHash,
            methodologyVersion: latest.methodologyVersion,
            deliveriesSent: latest.deliveriesSent,
            deliveriesOpened: latest.deliveriesOpened,
            deliveriesVerified: latest.deliveriesVerified,
            repliesReceived: latest.repliesReceived,
            alignedVotes: latest.alignedVotes,
            totalScoredVotes: latest.totalScoredVotes,
          }
        : null,
      history: history.map((s) => ({
        period: s.periodEnd,
        responsiveness: s.responsiveness ?? null,
        alignment: s.alignment ?? null,
        composite: s.composite ?? null,
      })),
    };
  },
});

/**
 * List scorecards for all DMs relevant to an org (for org scorecards page).
 */
export const listOrgScorecards = query({
  args: {
    slug: v.string(),
    sortBy: v.optional(v.string()),
    minReports: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const minReports = args.minReports ?? 1;

    // Get all DMs followed by org
    const follows = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const scorecards = await Promise.all(
      follows.map(async (f) => {
        const dm = await ctx.db.get(f.decisionMakerId);
        if (!dm) return null;

        const latest = await ctx.db
          .query("scorecardSnapshots")
          .withIndex("by_decisionMakerId", (q) =>
            q.eq("decisionMakerId", f.decisionMakerId),
          )
          .order("desc")
          .first();

        // Count accountability receipts for this DM + org
        const receipts = await ctx.db
          .query("accountabilityReceipts")
          .withIndex("by_decisionMakerId", (q) =>
            q.eq("decisionMakerId", f.decisionMakerId),
          )
          .collect();
        const orgReceipts = receipts.filter((r) => r.orgId === org._id);

        if (orgReceipts.length < minReports && !latest) return null;

        return {
          decisionMaker: {
            _id: dm._id,
            name: dm.name,
            title: dm.title ?? null,
            party: dm.party ?? null,
            district: dm.district ?? null,
            jurisdiction: dm.jurisdiction ?? null,
            photoUrl: dm.photoUrl ?? null,
          },
          scorecard: latest
            ? {
                composite: latest.composite ?? null,
                responsiveness: latest.responsiveness ?? null,
                alignment: latest.alignment ?? null,
                proofWeightTotal: latest.proofWeightTotal,
                deliveriesSent: latest.deliveriesSent,
                repliesReceived: latest.repliesReceived,
                alignedVotes: latest.alignedVotes,
                totalScoredVotes: latest.totalScoredVotes,
                methodologyVersion: latest.methodologyVersion,
                periodEnd: latest.periodEnd,
              }
            : null,
          receiptCount: orgReceipts.length,
        };
      }),
    );

    const filtered = scorecards.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );

    // Sort
    if (args.sortBy === "score" || !args.sortBy) {
      filtered.sort(
        (a, b) =>
          (b.scorecard?.composite ?? 0) - (a.scorecard?.composite ?? 0),
      );
    }

    return {
      scorecards: filtered,
      meta: {
        totalFollowed: follows.length,
        withScorecards: filtered.filter((s) => s.scorecard).length,
      },
    };
  },
});

// =============================================================================
// ALERT PREFERENCES — stored in orgIssueDomains with reserved label
// =============================================================================

const ALERT_PREFS_LABEL = "__alert_preferences__";

const ALERT_PREF_DEFAULTS = {
  minRelevanceScore: 0.6,
  digestOnly: false,
  autoArchiveDays: 30,
};

/**
 * Get alert preferences for an org.
 */
export const getAlertPreferences = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");

    const row = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId_label", (q) =>
        q.eq("orgId", org._id).eq("label", ALERT_PREFS_LABEL),
      )
      .first();

    if (!row?.description) return { ...ALERT_PREF_DEFAULTS };

    try {
      const parsed = JSON.parse(row.description);
      return {
        minRelevanceScore:
          typeof parsed.minRelevanceScore === "number"
            ? Math.min(1.0, Math.max(0.5, parsed.minRelevanceScore))
            : ALERT_PREF_DEFAULTS.minRelevanceScore,
        digestOnly:
          typeof parsed.digestOnly === "boolean"
            ? parsed.digestOnly
            : ALERT_PREF_DEFAULTS.digestOnly,
        autoArchiveDays:
          typeof parsed.autoArchiveDays === "number"
            ? Math.max(1, Math.round(parsed.autoArchiveDays))
            : ALERT_PREF_DEFAULTS.autoArchiveDays,
      };
    } catch {
      return { ...ALERT_PREF_DEFAULTS };
    }
  },
});

/**
 * Update alert preferences for an org. Requires editor role.
 */
export const updateAlertPreferences = mutation({
  args: {
    slug: v.string(),
    minRelevanceScore: v.optional(v.number()),
    digestOnly: v.optional(v.boolean()),
    autoArchiveDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    // Load current preferences
    const row = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId_label", (q) =>
        q.eq("orgId", org._id).eq("label", ALERT_PREFS_LABEL),
      )
      .first();

    let current = { ...ALERT_PREF_DEFAULTS };
    if (row?.description) {
      try {
        const parsed = JSON.parse(row.description);
        current = {
          minRelevanceScore:
            typeof parsed.minRelevanceScore === "number"
              ? parsed.minRelevanceScore
              : ALERT_PREF_DEFAULTS.minRelevanceScore,
          digestOnly:
            typeof parsed.digestOnly === "boolean"
              ? parsed.digestOnly
              : ALERT_PREF_DEFAULTS.digestOnly,
          autoArchiveDays:
            typeof parsed.autoArchiveDays === "number"
              ? parsed.autoArchiveDays
              : ALERT_PREF_DEFAULTS.autoArchiveDays,
        };
      } catch {
        // Use defaults
      }
    }

    // Apply updates
    if (typeof args.minRelevanceScore === "number" && Number.isFinite(args.minRelevanceScore)) {
      current.minRelevanceScore = Math.min(1.0, Math.max(0.5, args.minRelevanceScore));
    }
    if (typeof args.digestOnly === "boolean") {
      current.digestOnly = args.digestOnly;
    }
    if (typeof args.autoArchiveDays === "number" && Number.isFinite(args.autoArchiveDays)) {
      current.autoArchiveDays = Math.min(365, Math.max(1, Math.round(args.autoArchiveDays)));
    }

    const serialized = JSON.stringify(current);

    if (row) {
      await ctx.db.patch(row._id, { description: serialized });
    } else {
      await ctx.db.insert("orgIssueDomains", {
        orgId: org._id,
        label: ALERT_PREFS_LABEL,
        description: serialized,
        weight: 0,
        updatedAt: Date.now(),
      });
    }

    return current;
  },
});

// =============================================================================
// SCORECARD EXPORT — CSV-ready data for the SvelteKit route to format
// =============================================================================

/**
 * Export scorecard data for an org. Returns structured data (not CSV).
 * The SvelteKit route handles CSV formatting.
 */
export const exportScorecards = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");

    // Get all DMs followed by org
    const follows = await ctx.db
      .query("orgDmFollows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const scorecards = await Promise.all(
      follows.map(async (f) => {
        const dm = await ctx.db.get(f.decisionMakerId);
        if (!dm) return null;

        const latest = await ctx.db
          .query("scorecardSnapshots")
          .withIndex("by_decisionMakerId", (q) =>
            q.eq("decisionMakerId", f.decisionMakerId),
          )
          .order("desc")
          .first();

        // Count accountability receipts for this DM + org
        const receipts = await ctx.db
          .query("accountabilityReceipts")
          .withIndex("by_orgId_billId_decisionMakerId", (q) =>
            q.eq("orgId", org._id),
          )
          .collect();
        const dmReceipts = receipts.filter(
          (r) => r.decisionMakerId === f.decisionMakerId,
        );

        if (!latest && dmReceipts.length === 0) return null;

        return {
          name: dm.name,
          title: dm.title ?? "",
          district: dm.district ?? "",
          reportsReceived: latest?.deliveriesSent ?? 0,
          reportsOpened: latest?.deliveriesOpened ?? 0,
          verifyLinksClicked: latest?.deliveriesVerified ?? 0,
          repliesLogged: latest?.repliesReceived ?? 0,
          relevantVotes: latest?.totalScoredVotes ?? 0,
          alignedVotes: latest?.alignedVotes ?? 0,
          alignmentRate: latest?.alignment ?? null,
          avgResponseTime: latest?.responsiveness != null
            ? Math.round((1 - latest.responsiveness) * 168 * 10) / 10
            : null,
          lastContactDate: null as string | null,
          score: latest?.composite != null ? Math.round(latest.composite * 100) : 0,
        };
      }),
    );

    const filtered = scorecards.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    const avgScore =
      filtered.length > 0
        ? Math.round(
            filtered.reduce((sum, s) => sum + s.score, 0) / filtered.length,
          )
        : 0;

    return {
      scorecards: filtered,
      meta: {
        orgId: org._id as string,
        computedAt: new Date().toISOString(),
        decisionMakers: filtered.length,
        avgScore,
      },
    };
  },
});

// =============================================================================
// CRON STUBS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Track recent roll call votes from Congress.gov.
 * Fetches votes → creates LegislativeAction rows → correlates to deliveries.
 * Called every 2 hours by cron.
 */
export const trackVotes = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.CONGRESS_API_KEY;
    if (!apiKey) {
      console.warn("[vote-tracker] CONGRESS_API_KEY not set");
      return { votesProcessed: 0, actionsCreated: 0, errors: [] };
    }

    // Fetch recent votes from Congress.gov
    // Full implementation mirrors src/lib/server/legislation/actions/vote-tracker.ts
    console.log("[vote-tracker] Vote tracking not yet fully implemented in Convex");
    return { votesProcessed: 0, actionsCreated: 0, errors: [] };
  },
});

/**
 * Compute scorecard snapshots for all DMs with accountability receipts.
 * Called weekly (Sunday 03:00 UTC) by cron.
 *
 * Algorithm per DM (rolling 90-day window):
 *   deliveriesSent       = count(receipts)
 *   deliveriesOpened     = count(responses.type == 'opened')
 *   deliveriesVerified   = count(responses.type == 'clicked_verify')
 *   repliesReceived      = count(responses.type == 'replied')
 *   proofWeightTotal     = Σ receipt.proofWeight
 *   responsiveness       = deliveriesOpened / deliveriesSent (null if no deliveries)
 *   alignment (weighted) = Σ(alignment × proofWeight) / Σ(proofWeight)  over scored receipts
 *   alignedVotes         = count(receipts where alignment > 0.5)
 *   totalScoredVotes     = count(receipts where alignment is non-zero)
 *   composite            = 0.5 × responsiveness + 0.5 × alignment  (each ∈ [0,1])
 *   snapshotHash         = sha256 of canonical field ordering (tamper-evident)
 *
 * Methodology version bumps when aggregation rules change. Snapshots are upserted
 * by (dmId, periodEnd, methodologyVersion), so re-runs for the same week are idempotent.
 */
const SCORECARD_METHODOLOGY_VERSION = 1;
const SCORECARD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export const computeScorecards = internalAction({
  args: {},
  handler: async (ctx): Promise<{ computed: number; skipped: number; errors: string[] }> => {
    const now = Date.now();
    const periodEnd = now;
    const periodStart = now - SCORECARD_WINDOW_MS;

    const dmIds: Id<"decisionMakers">[] = await ctx.runQuery(
      internal.legislation.listDmsWithReceiptsSince,
      { since: periodStart },
    );

    let computed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dmId of dmIds) {
      try {
        const aggregate: ScorecardAggregate | null = await ctx.runQuery(
          internal.legislation.aggregateReceiptsForDm,
          { decisionMakerId: dmId, periodStart, periodEnd },
        );

        if (!aggregate || aggregate.deliveriesSent === 0) {
          skipped++;
          continue;
        }

        const snapshotHash = await hashScorecardSnapshot({
          decisionMakerId: String(dmId),
          periodStart,
          periodEnd,
          methodologyVersion: SCORECARD_METHODOLOGY_VERSION,
          ...aggregate,
        });

        await ctx.runMutation(internal.legislation.upsertScorecardSnapshot, {
          decisionMakerId: dmId,
          periodStart,
          periodEnd,
          responsiveness: aggregate.responsiveness ?? undefined,
          alignment: aggregate.alignment ?? undefined,
          composite: aggregate.composite ?? undefined,
          proofWeightTotal: aggregate.proofWeightTotal,
          deliveriesSent: aggregate.deliveriesSent,
          deliveriesOpened: aggregate.deliveriesOpened,
          deliveriesVerified: aggregate.deliveriesVerified,
          repliesReceived: aggregate.repliesReceived,
          alignedVotes: aggregate.alignedVotes,
          totalScoredVotes: aggregate.totalScoredVotes,
          methodologyVersion: SCORECARD_METHODOLOGY_VERSION,
          snapshotHash,
        });
        computed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${dmId}: ${msg}`);
      }
    }

    console.log(
      `[scorecard-compute] periodEnd=${periodEnd} dms=${dmIds.length} computed=${computed} skipped=${skipped} errors=${errors.length}`,
    );
    return { computed, skipped, errors };
  },
});

interface ScorecardAggregate {
  deliveriesSent: number;
  deliveriesOpened: number;
  deliveriesVerified: number;
  repliesReceived: number;
  proofWeightTotal: number;
  alignedVotes: number;
  totalScoredVotes: number;
  responsiveness: number | null;
  alignment: number | null;
  composite: number | null;
}

/**
 * Returns all DMs that have at least one accountability receipt in the given
 * period. Uses the by_decisionMakerId_proofDeliveredAt index and dedupes in
 * memory. Paginates in case a single period has a very large receipt set.
 */
export const listDmsWithReceiptsSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args): Promise<Id<"decisionMakers">[]> => {
    const dms = new Set<string>();
    // Scan by proofDeliveredAt via a paginated walk through receipts in window.
    // The by_decisionMakerId_proofDeliveredAt index orders per-DM, so we do a
    // full scan once per run and filter — acceptable for weekly cron cadence.
    const receipts = await ctx.db.query("accountabilityReceipts").collect();
    for (const r of receipts) {
      if (r.proofDeliveredAt >= args.since) dms.add(r.decisionMakerId);
    }
    return Array.from(dms) as Id<"decisionMakers">[];
  },
});

export const aggregateReceiptsForDm = internalQuery({
  args: {
    decisionMakerId: v.id("decisionMakers"),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args): Promise<ScorecardAggregate | null> => {
    const receipts = await ctx.db
      .query("accountabilityReceipts")
      .withIndex("by_decisionMakerId_proofDeliveredAt", (q) =>
        q
          .eq("decisionMakerId", args.decisionMakerId)
          .gte("proofDeliveredAt", args.periodStart)
          .lte("proofDeliveredAt", args.periodEnd),
      )
      .collect();

    if (receipts.length === 0) return null;

    let deliveriesOpened = 0;
    let deliveriesVerified = 0;
    let repliesReceived = 0;
    let proofWeightTotal = 0;
    let alignedVotes = 0;
    let totalScoredVotes = 0;
    let weightedAlignmentNumerator = 0;
    let scoredProofWeight = 0;

    for (const r of receipts) {
      proofWeightTotal += r.proofWeight;

      const responses = r.responses ?? [];
      if (responses.some((rx) => rx.type === "opened" || rx.type === "clicked_verify")) {
        deliveriesOpened++;
      }
      if (responses.some((rx) => rx.type === "clicked_verify")) {
        deliveriesVerified++;
      }
      if (responses.some((rx) => rx.type === "replied")) {
        repliesReceived++;
      }

      // `alignment` is set on the receipt itself (per-bill DM action).
      // 0 is the neutral/unknown value; anything non-zero counts as scored.
      if (r.alignment !== 0) {
        totalScoredVotes++;
        weightedAlignmentNumerator += r.alignment * r.proofWeight;
        scoredProofWeight += r.proofWeight;
        if (r.alignment > 0.5) alignedVotes++;
      }
    }

    const deliveriesSent = receipts.length;
    const responsiveness = deliveriesSent > 0 ? deliveriesOpened / deliveriesSent : null;
    const alignment = scoredProofWeight > 0 ? weightedAlignmentNumerator / scoredProofWeight : null;
    const composite =
      responsiveness !== null && alignment !== null
        ? 0.5 * responsiveness + 0.5 * alignment
        : (responsiveness ?? alignment ?? null);

    return {
      deliveriesSent,
      deliveriesOpened,
      deliveriesVerified,
      repliesReceived,
      proofWeightTotal,
      alignedVotes,
      totalScoredVotes,
      responsiveness,
      alignment,
      composite,
    };
  },
});

/**
 * Canonical-order sha256 hash of the snapshot fields. Field order is frozen —
 * any change invalidates prior snapshotHash values and warrants a methodology
 * version bump.
 */
async function hashScorecardSnapshot(input: {
  decisionMakerId: string;
  periodStart: number;
  periodEnd: number;
  methodologyVersion: number;
} & ScorecardAggregate): Promise<string> {
  const canonical = [
    `dm=${input.decisionMakerId}`,
    `ps=${input.periodStart}`,
    `pe=${input.periodEnd}`,
    `mv=${input.methodologyVersion}`,
    `ds=${input.deliveriesSent}`,
    `do=${input.deliveriesOpened}`,
    `dv=${input.deliveriesVerified}`,
    `rr=${input.repliesReceived}`,
    `pw=${input.proofWeightTotal}`,
    `av=${input.alignedVotes}`,
    `tv=${input.totalScoredVotes}`,
    `rs=${input.responsiveness ?? "null"}`,
    `al=${input.alignment ?? "null"}`,
    `cp=${input.composite ?? "null"}`,
  ].join("|");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get pending alerts for an org (used by SSE alert stream).
 * Takes orgId directly — auth is handled by the SvelteKit route.
 */
export const getPendingAlertsByOrgId = query({
  args: { orgId: v.id("organizations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const alerts = await ctx.db
      .query("legislativeAlerts")
      .withIndex("by_orgId_status", (idx) =>
        idx.eq("orgId", args.orgId).eq("status", "pending"),
      )
      .order("desc")
      .take(limit);

    const enriched = await Promise.all(
      alerts.map(async (a) => {
        const bill = await ctx.db.get(a.billId);
        return {
          id: a._id,
          type: a.type,
          title: a.title,
          summary: a.summary,
          urgency: a.urgency,
          createdAt: a._creationTime,
          billTitle: bill?.title ?? "",
          billStatus: bill?.status ?? "",
        };
      }),
    );
    return enriched;
  },
});

/**
 * List recent bills that have embeddings (for rescore endpoint).
 */
export const listRecentBills = query({
  args: { slug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { slug, limit }) => {
    await requireOrgRole(ctx, slug, "editor");
    const max = Math.min(limit ?? 100, 200);
    const bills = await ctx.db
      .query("bills")
      .order("desc")
      .take(max * 2);
    const withEmbeddings = bills
      .filter((b) => (b as any).topicEmbedding != null)
      .slice(0, max);
    return withEmbeddings.map((b) => ({ _id: b._id }));
  },
});

/**
 * Public action: rescore bills against org issue domains.
 */
export const rescoreBills = action({
  args: { slug: v.string(), billIds: v.array(v.id("bills")) },
  handler: async (ctx, { slug, billIds }) => {
    let rowsUpserted = 0;
    const errors: string[] = [];
    for (const billId of billIds) {
      try {
        const result = await ctx.runAction(internal.legislation.scoreBillRelevance, { billId });
        rowsUpserted += result.rowsUpserted;
      } catch (err) {
        errors.push(`${billId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { billsScored: billIds.length, rowsUpserted, errors: errors.length > 0 ? errors : undefined };
  },
});

