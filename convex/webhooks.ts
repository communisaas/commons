/**
 * Webhook processing — internal mutations called from HTTP actions.
 *
 * SES bounce/complaint/open/click, Twilio SMS delivery/inbound/call status.
 * Stripe webhook processing is in convex/subscriptions.ts.
 */

import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
/**
 * Unkeyed SHA-256 hash of normalized email — for cross-org bounce/complaint
 * correlation. No server-held secret key needed.
 */
async function computeGlobalEmailHash(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeGlobalPhoneHash(phone: string): Promise<string> {
  const normalized = phone.replace(/\D/g, "");
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// SES WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Update supporter emailStatus by email hash (bounce/complaint).
 * Cross-org update is intentional: a bounced address is bounced everywhere.
 */
export const updateSupporterEmailStatus = internalMutation({
  args: {
    emailHashes: v.array(v.string()),
    status: v.string(), // 'bounced' | 'complained'
  },
  handler: async (ctx, args) => {
    for (const hash of args.emailHashes) {
      const supporters = await ctx.db
        .query("supporters")
        .withIndex("by_globalEmailHash", (q) => q.eq("globalEmailHash", hash))
        .collect();

      for (const s of supporters) {
        // Complaints always win — once complained, never re-emailed
        if (args.status === "bounced" && s.emailStatus === "complained") continue;
        await ctx.db.patch(s._id, { emailStatus: args.status, updatedAt: Date.now() });
      }
    }
  },
});

/**
 * Record an email open event for an email blast.
 */
export const recordEmailOpen = internalMutation({
  args: {
    email: v.string(),
    emailHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Compute email hash for dedup lookups (HMAC is deterministic — safe in mutations)
    const emailHash = args.emailHash ?? await computeGlobalEmailHash(args.email);

    // Find the most recent sent blast that hasn't already recorded an open for this email
    const blasts = await ctx.db
      .query("emailBlasts")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .order("desc")
      .take(20);

    for (const blast of blasts) {
      // Dedup: check via recipientEmailHash only — no plaintext fallback
      let existingOpen;
      if (emailHash) {
        existingOpen = await ctx.db
          .query("emailEvents")
          .withIndex("by_blastId_recipientEmailHash", (q) =>
            q.eq("blastId", blast._id).eq("recipientEmailHash", emailHash),
          )
          .filter((q) => q.eq(q.field("eventType"), "open"))
          .first();
      }

      if (!existingOpen && blast.batches && blast.batches.length > 0) {
        await ctx.db.insert("emailEvents", {
          blastId: blast._id,
          recipientEmailHash: emailHash ?? undefined,
          eventType: "open",
          timestamp: Date.now(),
        });
        await ctx.db.patch(blast._id, {
          totalOpened: (blast.totalOpened ?? 0) + 1,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

/**
 * Record an email click event for an email blast.
 */
export const recordEmailClick = internalMutation({
  args: {
    email: v.string(),
    linkUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Compute email hash (HMAC is deterministic — safe in mutations)
    const emailHash = await computeGlobalEmailHash(args.email);

    // Find the most recent sent blast
    const blasts = await ctx.db
      .query("emailBlasts")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .order("desc")
      .take(20);

    for (const blast of blasts) {
      // Check for open event via hash — no plaintext fallback
      let hasOpen;
      if (emailHash) {
        hasOpen = await ctx.db
          .query("emailEvents")
          .withIndex("by_blastId_recipientEmailHash", (q) =>
            q.eq("blastId", blast._id).eq("recipientEmailHash", emailHash),
          )
          .filter((q) => q.eq(q.field("eventType"), "open"))
          .first();
      }

      if (hasOpen || (blast.batches && blast.batches.length > 0)) {
        await ctx.db.insert("emailEvents", {
          blastId: blast._id,
          recipientEmailHash: emailHash ?? undefined,
          eventType: "click",
          linkUrl: args.linkUrl,
          timestamp: Date.now(),
        });
        await ctx.db.patch(blast._id, {
          totalClicked: (blast.totalClicked ?? 0) + 1,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

/**
 * Handle SES event for a CampaignDelivery (proof report tracking).
 */
export const handleDeliveryEvent = internalMutation({
  args: {
    sesMessageId: v.string(),
    notificationType: v.string(),
    linkUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find campaign delivery by sesMessageId
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .filter((q) => q.eq(q.field("sesMessageId"), args.sesMessageId))
      .collect();

    const delivery = deliveries[0];
    if (!delivery) return { found: false };

    const now = Date.now();

    switch (args.notificationType) {
      case "Delivery":
        await ctx.db.patch(delivery._id, { status: "delivered" });
        break;

      case "Bounce":
        await ctx.db.patch(delivery._id, { status: "bounced" });
        break;

      case "Open": {
        // Find associated accountability receipt to add response
        const receipt = await ctx.db
          .query("accountabilityReceipts")
          .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
          .first();

        if (receipt) {
          const responses = receipt.responses ?? [];
          const alreadyOpened = responses.some(
            (r: { type: string }) => r.type === "opened",
          );
          if (!alreadyOpened) {
            await ctx.db.patch(receipt._id, {
              responses: [
                ...responses,
                { type: "opened", confidence: "observed", occurredAt: now },
              ],
            });
          }
        }
        await ctx.db.patch(delivery._id, { status: "opened" });
        break;
      }

      case "Click": {
        const receipt = await ctx.db
          .query("accountabilityReceipts")
          .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
          .first();

        if (receipt) {
          const responses = receipt.responses ?? [];
          const isVerifyClick = args.linkUrl?.includes("/verify/") ?? false;
          await ctx.db.patch(receipt._id, {
            responses: [
              ...responses,
              {
                type: isVerifyClick ? "clicked_verify" : "opened",
                detail: isVerifyClick ? args.linkUrl : undefined,
                confidence: "observed",
                occurredAt: now,
              },
            ],
          });
        }
        break;
      }
    }

    return { found: true };
  },
});

// =============================================================================
// SES WEBHOOK — ACTION (orchestrates mutations)
// =============================================================================

/**
 * Process an SES/SNS notification. Called from the HTTP router after
 * signature verification + topic ARN validation.
 */
export const processSesWebhook = internalAction({
  args: {
    snsType: v.string(), // 'SubscriptionConfirmation' | 'Notification'
    subscribeURL: v.optional(v.string()),
    message: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Handle SNS subscription confirmation
    if (args.snsType === "SubscriptionConfirmation" && args.subscribeURL) {
      try {
        await fetch(args.subscribeURL);
      } catch (err) {
        console.error("[ses-webhook] Failed to confirm subscription:", err);
      }
      return { ok: true };
    }

    if (args.snsType !== "Notification" || !args.message) {
      return { ok: true };
    }

    const message = args.message;
    const notificationType = message.notificationType;

    // Extract SES mail.messageId for CampaignDelivery correlation
    const mailMessageId = message.mail?.messageId ?? null;

    // Try to route to CampaignDelivery first (report delivery tracking)
    if (mailMessageId) {
      const result = await ctx.runMutation(internal.webhooks.handleDeliveryEvent, {
        sesMessageId: mailMessageId,
        notificationType,
        linkUrl: message.click?.link,
      });

      if (result.found) return { ok: true };
    }

    // Fall through to EmailBlast logic
    if (notificationType === "Bounce") {
      const bounce = message.bounce;
      if (bounce?.bounceType !== "Permanent") return { ok: true };

      const emails: string[] = (bounce.bouncedRecipients ?? []).map(
        (r: { emailAddress: string }) => r.emailAddress.toLowerCase(),
      );

      if (emails.length > 0) {
        const hashes = (
          await Promise.all(emails.map((email: string) => computeGlobalEmailHash(email)))
        ).filter((h): h is string => h !== null);

        if (hashes.length > 0) {
          await ctx.runMutation(internal.webhooks.updateSupporterEmailStatus, {
            emailHashes: hashes,
            status: "bounced",
          });
        }
      }
    } else if (notificationType === "Complaint") {
      const complaint = message.complaint;
      const emails: string[] = (complaint?.complainedRecipients ?? []).map(
        (r: { emailAddress: string }) => r.emailAddress.toLowerCase(),
      );

      if (emails.length > 0) {
        const hashes = (
          await Promise.all(emails.map((email: string) => computeGlobalEmailHash(email)))
        ).filter((h): h is string => h !== null);

        if (hashes.length > 0) {
          await ctx.runMutation(internal.webhooks.updateSupporterEmailStatus, {
            emailHashes: hashes,
            status: "complained",
          });
        }
      }
    } else if (notificationType === "Open") {
      const email = message.mail?.destination?.[0]?.toLowerCase();
      if (email) {
        await ctx.runMutation(internal.webhooks.recordEmailOpen, { email });
      }
    } else if (notificationType === "Click") {
      const email = message.mail?.destination?.[0]?.toLowerCase();
      const linkUrl = message.click?.link;
      if (email && linkUrl) {
        await ctx.runMutation(internal.webhooks.recordEmailClick, { email, linkUrl });
      }
    }

    return { ok: true };
  },
});

// =============================================================================
// TWILIO SMS WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Update SMS message delivery status.
 */
export const updateSmsStatus = internalMutation({
  args: {
    twilioSid: v.string(),
    status: v.string(),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("smsMessages")
      .withIndex("by_twilioSid", (q) => q.eq("twilioSid", args.twilioSid))
      .first();

    if (!message) return;

    await ctx.db.patch(message._id, {
      status: args.status,
      errorCode: args.errorCode ?? undefined,
    });

    // Update blast delivered counter
    if (args.status === "delivered") {
      const blast = await ctx.db.get(message.blastId);
      if (blast) {
        await ctx.db.patch(blast._id, {
          deliveredCount: (blast.deliveredCount ?? 0) + 1,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/**
 * Handle inbound SMS (STOP/START keywords for TCPA compliance).
 */
export const handleInboundSms = internalMutation({
  args: {
    from: v.string(), // E.164 phone number
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
    const START_KEYWORDS = new Set(["start", "yes", "unstop"]);

    const body = args.body.trim().toLowerCase();

    // Compute phone hash for lookup (phone field is encrypted now)
    const fromPhoneHash = await computeGlobalPhoneHash(args.from).catch(() => null);

    if (STOP_KEYWORDS.has(body)) {
      // Mark all supporters with this phone as stopped
      if (!fromPhoneHash) return;
      const supporters = await ctx.db
        .query("supporters")
        .filter((q) => q.eq(q.field("phoneHash"), fromPhoneHash))
        .collect();

      for (const s of supporters) {
        await ctx.db.patch(s._id, { smsStatus: "stopped", updatedAt: Date.now() });
      }
    } else if (START_KEYWORDS.has(body)) {
      // Re-subscribe supporters that were previously stopped
      if (!fromPhoneHash) return;
      const supporters = await ctx.db
        .query("supporters")
        .filter((q) =>
          q.and(
            q.eq(q.field("phoneHash"), fromPhoneHash),
            q.eq(q.field("smsStatus"), "stopped"),
          ),
        )
        .collect();

      for (const s of supporters) {
        await ctx.db.patch(s._id, { smsStatus: "subscribed", updatedAt: Date.now() });
      }
    }
  },
});

/**
 * Update patch-through call status.
 */
export const updateCallStatus = internalMutation({
  args: {
    callSid: v.string(),
    status: v.string(),
    duration: v.optional(v.number()),
    isTerminal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("patchThroughCalls")
      .withIndex("by_twilioCallSid", (q) => q.eq("twilioCallSid", args.callSid))
      .first();

    if (!call) return;

    const patch: Record<string, unknown> = { status: args.status };
    if (args.duration !== undefined) patch.duration = args.duration;
    if (args.isTerminal) patch.completedAt = Date.now();

    await ctx.db.patch(call._id, patch);
  },
});

// =============================================================================
// STRIPE DONATION WEBHOOK — INTERNAL MUTATIONS
// =============================================================================

/**
 * Complete a donation from Stripe checkout.
 * Atomic: only transitions pending → completed.
 */
export const completeDonation = internalMutation({
  args: {
    donationId: v.string(),
    campaignId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find pending donations matching this ID
    const donations = await ctx.db
      .query("donations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.eq(q.field("stripeSessionId"), args.donationId))
      .collect();

    // Also try direct ID lookup if stripeSessionId didn't match
    // (donationId might be a Convex ID)
    let donation = donations[0];
    if (!donation) return { processed: false };

    // Atomic status transition
    if (donation.status !== "pending") return { processed: false };

    await ctx.db.patch(donation._id, {
      status: "completed",
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment campaign counters
    if (donation.campaignId) {
      const campaign = await ctx.db.get(donation.campaignId);
      if (campaign) {
        await ctx.db.patch(campaign._id, {
          raisedAmountCents: (campaign.raisedAmountCents ?? 0) + donation.amountCents,
          donorCount: (campaign.donorCount ?? 0) + 1,
          updatedAt: Date.now(),
        });
      }
    }

    return { processed: true, amountCents: donation.amountCents, supporterId: donation.supporterId };
  },
});

/**
 * Refund a donation (from charge.refunded event).
 */
export const refundDonation = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();

    if (!donation || donation.status !== "completed") return;

    await ctx.db.patch(donation._id, {
      status: "refunded",
      updatedAt: Date.now(),
    });

    // Decrement campaign counters
    if (donation.campaignId) {
      const campaign = await ctx.db.get(donation.campaignId);
      if (campaign) {
        await ctx.db.patch(campaign._id, {
          raisedAmountCents: Math.max(0, (campaign.raisedAmountCents ?? 0) - donation.amountCents),
          donorCount: Math.max(0, (campaign.donorCount ?? 0) - 1),
          updatedAt: Date.now(),
        });
      }
    }
  },
});
