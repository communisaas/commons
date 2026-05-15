/**
 * Verify page queries — public endpoints for verification display.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Get campaign delivery by ID for verification page.
 */
export const getDelivery = query({
  args: { deliveryId: v.string() },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId as Id<"campaignDeliveries">);
    if (!delivery) return null;

    const campaign = delivery.campaignId ? await ctx.db.get(delivery.campaignId) : null;

    return {
      _id: delivery._id,
      targetDistrict: delivery.targetDistrict ?? null,
      packetSnapshot: delivery.packetSnapshot ?? null,
      sentAt: delivery.sentAt ?? null,
      campaignTitle: campaign?.title ?? null,
    };
  },
});

/**
 * Get campaign by ID for verification page.
 */
export const getCampaignForVerify = query({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
    if (!campaign) return null;
    return { _id: campaign._id, title: campaign.title };
  },
});

/**
 * Get district credential by hash for verification page.
 *
 * H6 — projects the H1 trust-context snapshot (trustTier, cellStraddles,
 * cellAnchorMode, atlasVersion) so /v/[hash] can render the same honest
 * tier-display copy as AttestationFooter and emailService, plus the
 * atlas-version drift surface when the credential predates the current
 * atlas. All four fields are optional in the schema; legacy rows return
 * `undefined` and the UI must render "unknown" rather than a default.
 */
export const getCredentialByHash = query({
  args: { credentialHash: v.string() },
  handler: async (ctx, { credentialHash }) => {
    const cred = await ctx.db
      .query("districtCredentials")
      .filter((q) => q.eq(q.field("credentialHash"), credentialHash))
      .first();
    if (!cred) return null;
    return {
      congressionalDistrict: cred.congressionalDistrict ?? null,
      verificationMethod: cred.verificationMethod ?? null,
      issuedAt: cred.issuedAt ?? null,
      expiresAt: cred.expiresAt ?? null,
      revokedAt: cred.revokedAt ?? null,
      // H6: project H1 trust-context. `undefined` means "this credential
      // predates the field" — surface as "unknown" upstream, NOT as a
      // synonym for "false" / a default tier.
      trustTier: cred.trustTier ?? null,
      cellStraddles: cred.cellStraddles ?? null,
      cellAnchorMode: cred.cellAnchorMode ?? null,
      atlasVersion: cred.atlasVersion ?? null,
    };
  },
});

/**
 * Get accountability receipt by ID.
 */
export const getReceipt = query({
  args: { receiptId: v.string() },
  handler: async (ctx, { receiptId }) => {
    const receipt = await ctx.db.get(receiptId as Id<"accountabilityReceipts">);
    if (!receipt) return null;

    // Get associated bill if any
    let bill = null;
    if (receipt.billId) {
      const b = await ctx.db.get(receipt.billId);
      if (b) {
        bill = {
          externalId: b.externalId,
          title: b.title,
          status: b.status,
          jurisdiction: b.jurisdiction,
          chamber: b.chamber,
        };
      }
    }

    // K-floor at 5 on counts, 3 on districts at the query level so any direct
    // Convex caller (not just /verify/receipt/[id]/+page.server.ts) gets the
    // sub-K suppression. Above the floor, counts are exact — the receipt is a
    // staffer-facing accountability artifact whose value depends on precision.
    const kFloor5 = (n: number): number | null => (n < 5 ? null : n);
    const kFloor3 = (n: number): number | null => (n < 3 ? null : n);

    return {
      _id: receipt._id,
      dmName: receipt.dmName,
      decisionMakerId: receipt.decisionMakerId,
      dmAction: receipt.dmAction ?? null,
      proofWeight: receipt.proofWeight ?? null,
      verifiedCount: kFloor5(receipt.verifiedCount ?? 0),
      totalCount: kFloor5(receipt.totalCount ?? 0),
      districtCount: kFloor3(receipt.districtCount ?? 0),
      gds: receipt.gds ?? null,
      ald: receipt.ald ?? null,
      cai: receipt.cai ?? null,
      attestationDigest: receipt.attestationDigest ?? null,
      proofDeliveredAt: receipt.proofDeliveredAt ?? null,
      proofVerifiedAt: receipt.proofVerifiedAt ?? null,
      actionOccurredAt: receipt.actionOccurredAt ?? null,
      causalityClass: receipt.causalityClass ?? null,
      alignment: receipt.alignment ?? null,
      actionSourceUrl: receipt.actionSourceUrl ?? null,
      anchorCid: receipt.anchorCid ?? null,
      bill,
    };
  },
});
