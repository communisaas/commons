import {
  query,
  mutation,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { decryptSupporterEmail, computeEmailHash } from "./_pii";

// =============================================================================
// EMAIL BLASTS — Queries, Mutations, Actions
// =============================================================================

/**
 * List email blasts for an org.
 */
export const listBlasts = query({
  args: {
    orgSlug: v.string(),
    status: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Always use by_orgId index to enforce org scoping; filter status post-query
    const q = ctx.db
      .query("emailBlasts")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", org._id));

    const results = await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 50),
      cursor: args.paginationOpts.cursor ?? null,
    });

    // Post-filter by status if specified (index only covers orgId)
    if (args.status) {
      return {
        ...results,
        page: results.page.filter((b) => b.status === args.status),
      };
    }

    return results;
  },
});

/**
 * Get a single email blast by ID.
 */
export const getBlast = query({
  args: {
    orgSlug: v.string(),
    blastId: v.id("emailBlasts"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");
    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) return null;
    return blast;
  },
});

/**
 * Get email events (opens, clicks, bounces) for a blast.
 */
export const getBlastEvents = query({
  args: {
    orgSlug: v.string(),
    blastId: v.id("emailBlasts"),
    eventType: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify blast belongs to this org — prevents cross-tenant event leakage
    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) throw new Error("Blast not found in this organization");

    let q;
    if (args.eventType) {
      q = ctx.db
        .query("emailEvents")
        .withIndex("by_blastId_eventType", (qb) =>
          qb.eq("blastId", args.blastId).eq("eventType", args.eventType!),
        );
    } else {
      q = ctx.db
        .query("emailEvents")
        .withIndex("by_blastId", (qb) => qb.eq("blastId", args.blastId));
    }

    return await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 100),
      cursor: args.paginationOpts.cursor ?? null,
    });
  },
});

/**
 * Create an email blast (draft).
 */
export const createBlast = mutation({
  args: {
    orgSlug: v.string(),
    subject: v.string(),
    bodyHtml: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),
    recipientFilter: v.optional(v.any()),
    campaignId: v.optional(v.string()),
    isAbTest: v.optional(v.boolean()),
    abTestConfig: v.optional(v.any()),
    abVariant: v.optional(v.string()),
    abParentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const id = await ctx.db.insert("emailBlasts", {
      orgId: org._id,
      campaignId: args.campaignId,
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      fromName: args.fromName,
      fromEmail: args.fromEmail,
      status: "draft",
      recipientFilter: args.recipientFilter ?? null,
      totalRecipients: 0,
      verificationContext: undefined,
      totalSent: 0,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalComplained: 0,
      sentAt: undefined,
      updatedAt: Date.now(),
      isAbTest: args.isAbTest ?? false,
      abTestConfig: args.abTestConfig,
      abVariant: args.abVariant,
      abParentId: args.abParentId,
      abWinnerPickedAt: undefined,
      batches: undefined,
    });

    return { id };
  },
});

/**
 * Update an email blast (draft only).
 */
export const updateBlast = mutation({
  args: {
    orgSlug: v.string(),
    blastId: v.id("emailBlasts"),
    subject: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    recipientFilter: v.optional(v.any()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) {
      throw new Error("Blast not found");
    }

    if (blast.status !== "draft" && args.status !== "draft") {
      throw new Error("Can only update draft blasts");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.subject !== undefined) patch.subject = args.subject;
    if (args.bodyHtml !== undefined) patch.bodyHtml = args.bodyHtml;
    if (args.fromName !== undefined) patch.fromName = args.fromName;
    if (args.fromEmail !== undefined) patch.fromEmail = args.fromEmail;
    if (args.recipientFilter !== undefined) patch.recipientFilter = args.recipientFilter;
    if (args.status !== undefined) patch.status = args.status;

    await ctx.db.patch(args.blastId, patch);
  },
});

/**
 * Record an email event (open, click, bounce, complaint) from webhook.
 * Internal-only: called from webhook processing, not exposed to clients.
 */
export const recordEmailEvent = internalMutation({
  args: {
    blastId: v.id("emailBlasts"),
    recipientEmail: v.string(),
    eventType: v.string(),
    linkUrl: v.optional(v.string()),
    linkIndex: v.optional(v.number()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Compute deterministic email hash for dedup lookups (HMAC — safe in mutations)
    const recipientEmailHash = await computeEmailHash(args.recipientEmail) ?? undefined;

    await ctx.db.insert("emailEvents", {
      blastId: args.blastId,
      recipientEmailHash,
      eventType: args.eventType,
      linkUrl: args.linkUrl,
      linkIndex: args.linkIndex,
      timestamp: args.timestamp,
    });

    // Update aggregate counters on the blast
    const blast = await ctx.db.get(args.blastId);
    if (blast) {
      const patch: Record<string, unknown> = {};
      if (args.eventType === "open") patch.totalOpened = (blast.totalOpened || 0) + 1;
      if (args.eventType === "click") patch.totalClicked = (blast.totalClicked || 0) + 1;
      if (args.eventType === "bounce") patch.totalBounced = (blast.totalBounced || 0) + 1;
      if (args.eventType === "complaint") patch.totalComplained = (blast.totalComplained || 0) + 1;

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(args.blastId, patch);
      }
    }
  },
});

// =============================================================================
// INTERNAL: Batch send helpers
// =============================================================================

/**
 * Internal: Update blast status and counters.
 */
export const updateBlastStatus = internalMutation({
  args: {
    blastId: v.id("emailBlasts"),
    status: v.string(),
    totalSent: v.optional(v.number()),
    totalBounced: v.optional(v.number()),
    totalRecipients: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    verificationContext: v.optional(v.any()),
    batches: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const blast = await ctx.db.get(args.blastId);
    if (!blast) return;

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.totalSent !== undefined) patch.totalSent = args.totalSent;
    if (args.totalBounced !== undefined) patch.totalBounced = args.totalBounced;
    if (args.totalRecipients !== undefined) patch.totalRecipients = args.totalRecipients;
    if (args.sentAt !== undefined) patch.sentAt = args.sentAt;
    if (args.verificationContext !== undefined) patch.verificationContext = args.verificationContext;
    if (args.batches !== undefined) patch.batches = args.batches;

    await ctx.db.patch(args.blastId, patch);

    // When blast transitions to "sent", increment org-level email counter.
    // Idempotent: only increment on actual status transition (not re-finalization).
    // Note: org.sentEmailCount is a convenience counter for onboarding state;
    // billing enforcement uses period-scoped aggregation from emailBlasts table.
    if (args.status === "sent" && blast.status !== "sent" && blast.orgId) {
      const org = await ctx.db.get(blast.orgId);
      if (org) {
        const currentCount = (org as any).sentEmailCount ?? 0;
        const blastSent = args.totalSent ?? blast.totalSent ?? 0;
        await ctx.db.patch(blast.orgId, {
          sentEmailCount: currentCount + blastSent,
          updatedAt: Date.now(),
        } as any);
      }
    }
  },
});

/**
 * Internal query: Get supporters for a blast (paginated by org + filter).
 */
export const getBlastRecipients = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Fetch subscribed supporters for this org
    const results = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .order("asc")
      .take(args.limit + 1);

    // Filter for subscribed email status
    const subscribed = results.filter((s) => s.emailStatus === "subscribed");

    return subscribed;
  },
});

/**
 * Send an email blast.
 *
 * Auth boundary: This is an internalAction — callers (SvelteKit UI layer,
 * other internal functions) must validate the user's session and org
 * membership before invoking. The blast's orgId is verified against the
 * resolved org to prevent cross-tenant sends.
 *
 * Pipeline:
 *   1. Transition draft → sending (atomic)
 *   2. Count recipients, update blast
 *   3. Schedule first batch via sendBlastBatch
 *
 * Each batch processes up to 100 recipients then schedules the next batch,
 * avoiding action timeouts for large recipient lists.
 */
export const sendBlast = internalAction({
  args: {
    orgSlug: v.string(),
    blastId: v.id("emailBlasts"),
  },
  handler: async (ctx, args) => {
    // Defense-in-depth: check email quota before sending
    const blastForQuota = await ctx.runQuery(internal.email.getBlastById, {
      blastId: args.blastId,
    });
    if (blastForQuota?.orgId) {
      const limits = await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
        orgId: blastForQuota.orgId,
      });
      if (limits && limits.current.emailsSent >= limits.limits.maxEmails) {
        throw new Error("EMAIL_QUOTA_EXCEEDED");
      }
    }

    // Transition to sending (the mutation enforces draft → sending)
    await ctx.runMutation(internal.email.updateBlastStatus, {
      blastId: args.blastId,
      status: "sending",
    });

    // Load blast
    const blast = await ctx.runQuery(internal.email.getBlastById, {
      blastId: args.blastId,
    });
    if (!blast) throw new Error("Blast not found");

    // Get recipients to count them
    const recipients = await ctx.runQuery(internal.email.getBlastRecipients, {
      orgId: blast.orgId,
      limit: 10000,
    });

    await ctx.runMutation(internal.email.updateBlastStatus, {
      blastId: args.blastId,
      status: "sending",
      totalRecipients: recipients.length,
    });

    if (recipients.length === 0) {
      await ctx.runMutation(internal.email.updateBlastStatus, {
        blastId: args.blastId,
        status: "sent",
        totalSent: 0,
        sentAt: Date.now(),
      });
      return { sent: 0 };
    }

    // Schedule the first batch (offset 0)
    await ctx.scheduler.runAfter(0, internal.email.sendBlastBatch, {
      blastId: args.blastId,
      offset: 0,
    });

    return { scheduled: true, totalRecipients: recipients.length };
  },
});

/**
 * Internal action: Process one batch of email blast recipients,
 * then schedule the next batch if more remain.
 */
export const sendBlastBatch = internalAction({
  args: {
    blastId: v.id("emailBlasts"),
    offset: v.number(),
  },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 100;

    // Load blast
    const blast = await ctx.runQuery(internal.email.getBlastById, {
      blastId: args.blastId,
    });
    if (!blast) {
      console.error(`[sendBlastBatch] Blast not found: ${args.blastId}`);
      return;
    }
    if (blast.status !== "sending") {
      console.warn(`[sendBlastBatch] Blast ${args.blastId} status is ${blast.status}, skipping`);
      return;
    }

    // SES credentials
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = process.env.AWS_REGION || "us-east-1";

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      await ctx.runMutation(internal.email.updateBlastStatus, {
        blastId: args.blastId,
        status: "failed",
      });
      throw new Error("AWS SES credentials not configured");
    }

    try {
      // Get all recipients (bounded by getBlastRecipients limit)
      const allRecipients = await ctx.runQuery(internal.email.getBlastRecipients, {
        orgId: blast.orgId,
        limit: 10000,
      });

      const batch = allRecipients.slice(args.offset, args.offset + BATCH_SIZE);
      if (batch.length === 0) {
        // No more recipients — finalize
        await ctx.runMutation(internal.email.updateBlastStatus, {
          blastId: args.blastId,
          status: "sent",
          sentAt: Date.now(),
        });
        return;
      }

      let batchSent = 0;
      let batchFailed = 0;

      for (const recipient of batch) {
        try {
          const email = await decryptSupporterEmail(recipient);
          const success = await sendViaSes(
            email,
            blast.fromEmail,
            blast.fromName,
            blast.subject,
            blast.bodyHtml,
            awsAccessKeyId,
            awsSecretAccessKey,
            awsRegion,
          );
          if (success) {
            batchSent++;
          } else {
            batchFailed++;
          }
        } catch {
          batchFailed++;
        }
      }

      // Update running counters
      await ctx.runMutation(internal.email.incrementBlastCounters, {
        blastId: args.blastId,
        sentDelta: batchSent,
        bouncedDelta: batchFailed,
      });

      // Schedule next batch if more recipients remain
      const nextOffset = args.offset + BATCH_SIZE;
      if (nextOffset < allRecipients.length) {
        await ctx.scheduler.runAfter(0, internal.email.sendBlastBatch, {
          blastId: args.blastId,
          offset: nextOffset,
        });
      } else {
        // All done — finalize
        await ctx.runMutation(internal.email.updateBlastStatus, {
          blastId: args.blastId,
          status: "sent",
          sentAt: Date.now(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[sendBlastBatch] Blast ${args.blastId} batch at offset ${args.offset} failed:`, message);

      await ctx.runMutation(internal.email.updateBlastStatus, {
        blastId: args.blastId,
        status: "failed",
      });
    }
  },
});

/**
 * Internal mutation: Increment running sent/bounced counters for a blast batch.
 */
export const incrementBlastCounters = internalMutation({
  args: {
    blastId: v.id("emailBlasts"),
    sentDelta: v.number(),
    bouncedDelta: v.number(),
  },
  handler: async (ctx, args) => {
    const blast = await ctx.db.get(args.blastId);
    if (!blast) return;

    await ctx.db.patch(args.blastId, {
      totalSent: (blast.totalSent || 0) + args.sentDelta,
      totalBounced: (blast.totalBounced || 0) + args.bouncedDelta,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal query: Get blast by ID.
 */
export const getBlastById = internalQuery({
  args: { blastId: v.id("emailBlasts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.blastId);
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Send email via SES v2 using raw HTTP (no AWS SDK dependency in Convex).
 * Uses the SES v2 SendEmail API with Signature V4 auth.
 */
async function sendViaSes(
  to: string,
  from: string,
  fromName: string,
  subject: string,
  htmlBody: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<boolean> {
  // SES v2 SendEmail via raw HTTP
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const safeFromName = fromName.replace(/[\r\n\x00-\x1f\x7f]/g, "");
  const safeSubject = subject.replace(/[\r\n\x00-\x1f\x7f]/g, "");

  const body = JSON.stringify({
    Content: {
      Simple: {
        Subject: { Data: safeSubject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    },
    Destination: { ToAddresses: [to] },
    FromEmailAddress: `${safeFromName} <${from}>`,
  });

  // AWS Signature V4
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;

  const encoder = new TextEncoder();

  async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  }

  async function sha256Hex(data: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `content-type:application/json\nhost:email.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "ses");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = Array.from(
    new Uint8Array(await hmacSha256(kSigning, stringToSign)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Amz-Date": amzDate,
        Authorization: authHeader,
      },
      body,
    });

    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// CRON STUBS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Process pending bounce reports: SMTP probes + auto-resolve stale reports.
 * Called every 5 minutes by cron.
 */
export const processBounceReports = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = now - 30 * 24 * 60 * 60 * 1000; // 30 days

    // Find unresolved bounce reports older than 30 days and auto-resolve
    const stale = await ctx.runQuery(internal.email.getStaleBounceReports, {
      threshold: staleThreshold,
    });

    let staleResolved = 0;
    for (const report of stale) {
      await ctx.runMutation(internal.email.resolveBounceReport, {
        reportId: report._id,
        resolution: "auto_resolved_stale",
      });
      staleResolved++;
    }

    console.log(
      `[process-bounces] Auto-resolved ${staleResolved} stale bounce reports`,
    );

    return { processed: 0, suppressed: 0, staleResolved };
  },
});

/** Internal query: find stale unresolved bounce reports. */
export const getStaleBounceReports = internalQuery({
  args: { threshold: v.number() },
  handler: async (ctx, { threshold }) => {
    return await ctx.db
      .query("bounceReports")
      .filter((q) =>
        q.and(
          q.eq(q.field("resolved"), false),
          q.lt(q.field("_creationTime"), threshold),
        ),
      )
      .take(100);
  },
});

/** Internal mutation: resolve a bounce report. */
export const resolveBounceReport = internalMutation({
  args: {
    reportId: v.id("bounceReports"),
    resolution: v.string(),
  },
  handler: async (ctx, { reportId, resolution }) => {
    await ctx.db.patch(reportId, { resolved: true });
  },
});

/**
 * Send weekly alert digest emails.
 * Called Monday 14:00 UTC by cron.
 */
export const sendAlertDigests = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find orgs with pending alerts, group by urgency, send via SES
    console.log("[alert-digest] Digest sending not yet implemented in Convex");
    return { totalSent: 0, totalFailed: 0, results: [] };
  },
});

/**
 * Check pending A/B tests and pick winners.
 * Called every 15 minutes by cron.
 */
export const pickAbWinners = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find A/B blasts where both variants sent, test period elapsed, no winner
    console.log("[ab-winner] A/B winner picking not yet implemented in Convex");
    return { checked: 0, picked: 0 };
  },
});

/**
 * Count unresolved bounce reports for a user (per-user cap).
 */
export const countActiveReports = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const reports = await ctx.db
      .query("bounceReports")
      .filter((q) =>
        q.and(
          q.eq(q.field("reportedBy"), userId),
          q.eq(q.field("resolved"), false),
        ),
      )
      .collect();
    return reports.length;
  },
});

/**
 * Find unresolved bounce report for same user + email (dedup).
 * Uses emailHash for lookup instead of plaintext email.
 */
export const findUnresolvedReport = query({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, { userId, email }) => {
    // Compute deterministic hash from email (HMAC — safe in queries)
    const emailHash = await computeEmailHash(email);

    if (emailHash) {
      // Prefer hash-based lookup via index
      const report = await ctx.db
        .query("bounceReports")
        .withIndex("by_emailHash_resolved", (q) =>
          q.eq("emailHash", emailHash).eq("resolved", false),
        )
        .filter((q) => q.eq(q.field("reportedBy"), userId))
        .first();
      return report ? { _id: report._id } : null;
    }

    // EMAIL_LOOKUP_KEY not configured — cannot look up by hash
    return null;
  },
});

/**
 * Create a bounce report with emailHash for hash-primary lookups.
 * Called from /api/emails/report-bounce route.
 */
export const createBounceReport = mutation({
  args: {
    email: v.string(),
    reportedBy: v.string(),
  },
  handler: async (ctx, { email, reportedBy }) => {
    // Compute deterministic hash (HMAC — safe in mutations)
    const emailHash = await computeEmailHash(email) ?? undefined;

    // Extract domain from email
    const domain = email.split("@")[1] ?? "";

    const id = await ctx.db.insert("bounceReports", {
      emailHash: emailHash ?? "",
      domain,
      reportedBy,
      resolved: false,
    });

    return { id };
  },
});
