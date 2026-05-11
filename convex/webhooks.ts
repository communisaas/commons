/**
 * Webhook processing — internal mutations called from HTTP actions.
 *
 * SES bounce/complaint/open/click, Twilio SMS delivery/inbound/call status.
 * Stripe webhook processing is in convex/subscriptions.ts.
 */

import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
/**
 * Unkeyed SHA-256 hash of normalized email — for cross-org bounce/complaint
 * correlation. No server-held secret key needed.
 */
// Global hash helpers are imported from `convex/_orgHash.ts` so the
// webhook lookup uses byte-identical normalization as the producer-
// side `computeOrgScoped*Hash` writers. Divergent normalization would
// silently produce `globalEmailHash`/`globalPhoneHash` values that
// never match the stored row — SES bounce/complaint and TCPA
// STOP/START would fail to find any supporter.
import {
  computeGlobalEmailHash,
  computeGlobalPhoneHash,
} from "./_orgHash";

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
        // Dedup against duplicate SNS click delivery (AWS retries the same
        // MessageId on transient downstream failures). Without this check,
        // a re-delivered click event inflates totalClicked. Per-link dedup
        // (matching linkUrl) so a user legitimately clicking two links in
        // the same email still produces two click rows. (cure shipped).
        if (emailHash) {
          const existingClick = await ctx.db
            .query("emailEvents")
            .withIndex("by_blastId_recipientEmailHash", (q) =>
              q.eq("blastId", blast._id).eq("recipientEmailHash", emailHash),
            )
            .filter((q) =>
              q.and(
                q.eq(q.field("eventType"), "click"),
                q.eq(q.field("linkUrl"), args.linkUrl),
              ),
            )
            .first();
          if (existingClick) {
            return;
          }
        }
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
    // Find campaign delivery by sesMessageId via the `by_sesMessageId`
    // index — `.filter(q.eq(...))` would full-scan every campaign
    // delivery row. `.first()` is sufficient because the field is
    // unique by construction (SES guarantees one MessageId per send);
    // collisions are operator-investigable via the warn log emitted
    // from `updateDeliveryStatus`.
    const delivery = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_sesMessageId", (q) => q.eq("sesMessageId", args.sesMessageId))
      .first();

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
          const newType = isVerifyClick ? "clicked_verify" : "opened";
          const newDetail = isVerifyClick ? args.linkUrl : undefined;

          // dedup against duplicate SNS click delivery.
          // Same retry-inflation pattern as elsewhere (SNS click on emailEvents)
          // and (Twilio delivered counter). For verify clicks, dedup
          // on (type, detail) so multiple distinct verify links each register
          // but a retried delivery for the same link doesn't double-count.
          // For non-verify clicks (type="opened"), match the Open case's
          // global dedup ("opened" entry exists at all → skip).
          const alreadyRecorded = isVerifyClick
            ? responses.some(
                (r: { type: string; detail?: string }) =>
                  r.type === newType && r.detail === newDetail,
              )
            : responses.some(
                (r: { type: string }) => r.type === "opened",
              );

          if (!alreadyRecorded) {
            await ctx.db.patch(receipt._id, {
              responses: [
                ...responses,
                {
                  type: newType,
                  detail: newDetail,
                  confidence: "observed",
                  occurredAt: now,
                },
              ],
            });
          }
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

    // Capture the previous status BEFORE patching so we can detect a real
    // status transition vs a duplicate-delivery callback. Twilio retries
    // status callbacks on transient downstream failures (network hiccups
    // between Twilio and our endpoint); without this guard, every retry
    // of a `delivered` callback re-increments the blast's deliveredCount.
    // Same class of bug as elsewhere (SNS click-event retry inflation), now
    // closed for SMS via the previous-status check. (cure shipped).
    const previousStatus = message.status;

    await ctx.db.patch(message._id, {
      status: args.status,
      errorCode: args.errorCode ?? undefined,
    });

    // Only increment the blast's deliveredCount when the message TRANSITIONED
    // into 'delivered' — not when an already-delivered message receives a
    // duplicate callback.
    if (args.status === "delivered" && previousStatus !== "delivered") {
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
    // Twilio destination number the user replied to. When present +
    // registered in `orgTwilioNumbers`, START is scoped to just that
    // org's supporters — without this, a START response would
    // resubscribe the phone across every org that ever had it as a
    // supporter, even orgs the user never knowingly engaged. Optional
    // because legacy webhook configs may not populate it; the handler
    // falls back to cross-org with a warn when missing.
    to: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
    const START_KEYWORDS = new Set(["start", "yes", "unstop"]);

    const body = args.body.trim().toLowerCase();

    // Compute phone hash for lookup (phone field is encrypted at rest).
    // If `crypto.subtle.digest` ever errors (e.g. sandbox/edge runtime
    // swap), the catch must be visible — silently dropping a hash
    // failure would honor a TCPA STOP as opt-IN. Log structured
    // context so an operator sees the failure before the silent
    // return; throwing would force Twilio retry but a retry storm on
    // STOP is worse than one visible drop.
    const fromPhoneHash = await computeGlobalPhoneHash(args.from).catch((err) => {
      console.error(
        '[webhooks.handleInboundSms] computeGlobalPhoneHash failed — TCPA opt-in/out cannot be honored without phone hash. Body keyword="' +
          body +
          '":',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });

    if (STOP_KEYWORDS.has(body)) {
      // Mark all supporters with this phone as stopped
      if (!fromPhoneHash) {
        console.error(
          '[webhooks.handleInboundSms] DROPPED TCPA STOP — phone hash unavailable. Body="' +
            body +
            '". This MUST be investigated; user remains opted-in.',
        );
        return;
      }
      // Index lookup via `by_globalPhoneHash`. A `.filter()` on the
      // org-scoped `phoneHash` would not match because that hash
      // family is per-org keyed; the cross-org STOP needs the global
      // hash family that supporter writers populate alongside the
      // org-scoped one. Bounded by the small number of supporters
      // sharing this phone across orgs, not the full table.
      const supporters = await ctx.db
        .query("supporters")
        .withIndex("by_globalPhoneHash", (q) => q.eq("globalPhoneHash", fromPhoneHash))
        .collect();

      for (const s of supporters) {
        await ctx.db.patch(s._id, { smsStatus: "stopped", updatedAt: Date.now() });
      }
    } else if (START_KEYWORDS.has(body)) {
      // Re-subscribe supporters that were previously stopped
      if (!fromPhoneHash) {
        console.error(
          '[webhooks.handleInboundSms] DROPPED TCPA START — phone hash unavailable. Body="' +
            body +
            '". User remains opted-out.',
        );
        return;
      }

      // Scope START to the org that owns the `To` Twilio number when
      // registered. STOP stays cross-org (carrier-level opt-out is
      // TCPA-universal), but START is the re-engagement signal —
      // resubscribing every org that ever had this phone as a
      // supporter would be consent scope collapse. Registry-miss /
      // multi-match falls back to cross-org with a warn: better to
      // honor an ambiguous START than leave the user stuck opted-out.
      let scopedOrgId: Id<"organizations"> | null = null;
      if (args.to) {
        const matches = await ctx.db
          .query("orgTwilioNumbers")
          .withIndex("by_phoneNumber", (q) => q.eq("phoneNumber", args.to as string))
          .collect();
        if (matches.length === 1) {
          scopedOrgId = matches[0].orgId;
        } else if (matches.length > 1) {
          console.warn(
            '[webhooks.handleInboundSms] START to=' + args.to + ' matched ' +
              matches.length + ' orgTwilioNumbers rows (ambiguous registry) — falling back to cross-org resubscribe',
          );
        }
      }

      // Index lookup via `by_globalPhoneHash`, then filter for
      // `smsStatus === "stopped"` post-fetch — the index doesn't
      // carry status; the additional filter is a small fan-out over
      // only the rows that share this phone across orgs.
      const supporters = await ctx.db
        .query("supporters")
        .withIndex("by_globalPhoneHash", (q) => q.eq("globalPhoneHash", fromPhoneHash))
        .collect();

      for (const s of supporters) {
        if (s.smsStatus !== "stopped") continue;
        // When scopedOrgId is resolved, only resubscribe supporters
        // belonging to that org. Cross-org rows stay opted-out until
        // those orgs re-prompt and get their own START.
        if (scopedOrgId !== null && String(s.orgId) !== String(scopedOrgId)) continue;
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
