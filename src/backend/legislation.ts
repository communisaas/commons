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
import { Doc, Id } from "./_generated/dataModel";
import { requireOrgRole } from "./lib/authHelpers";

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
 */
export const computeScorecards = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find all DMs with at least one receipt, then compute + save scorecards
    // Full implementation mirrors src/routes/api/cron/scorecard-compute/+server.ts
    console.log("[scorecard-compute] Scorecard computation not yet fully implemented in Convex");
    return { computed: 0, skipped: 0, errors: [] };
  },
});

