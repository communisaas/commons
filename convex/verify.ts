/**
 * Verify page queries — public endpoints for verification display.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get campaign delivery by ID for verification page.
 */
export const getDelivery = query({
  args: { deliveryId: v.string() },
  handler: async (ctx, { deliveryId }) => {
    // Try looking up by _id
    const allDeliveries = await ctx.db.query("campaignDeliveries").collect();
    const delivery = allDeliveries.find(d => d._id === deliveryId);
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
    const campaigns = await ctx.db.query("campaigns").collect();
    const campaign = campaigns.find(c => c._id === campaignId);
    if (!campaign) return null;
    return { _id: campaign._id, title: campaign.title };
  },
});

/**
 * Get district credential by hash for verification page.
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
    };
  },
});

/**
 * Get accountability receipt by ID.
 */
export const getReceipt = query({
  args: { receiptId: v.string() },
  handler: async (ctx, { receiptId }) => {
    const receipts = await ctx.db.query("accountabilityReceipts").collect();
    const receipt = receipts.find(r => r._id === receiptId);
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

    return {
      _id: receipt._id,
      dmName: receipt.dmName,
      decisionMakerId: receipt.decisionMakerId,
      dmAction: receipt.dmAction ?? null,
      proofWeight: receipt.proofWeight ?? null,
      verifiedCount: receipt.verifiedCount ?? 0,
      totalCount: receipt.totalCount ?? 0,
      districtCount: receipt.districtCount ?? 0,
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
