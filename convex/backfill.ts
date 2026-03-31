/**
 * PII Backfill Actions
 *
 * One-time actions to encrypt plaintext PII fields on existing rows.
 * Run these BEFORE dropping plaintext columns from the schema.
 *
 * All actions are idempotent: rows with valid encrypted fields are skipped.
 * All use batched processing to stay within Convex action time limits.
 *
 * Entity ID patterns (must match decrypt paths):
 *   supporters:  "supporter:{_id}"  fields: email, name, phone
 *   donations:   "{_id}" (bare)     fields: email, name
 *   eventRsvps:  "rsvp:{_id}"       fields: name
 *   smsMessages: "smsMsg:{_id}"     fields: to
 *   calls:       "call:{_id}"       fields: callerPhone, targetPhone
 *   emailEvents: hash only          fields: recipientEmail → recipientEmailHash
 *   suppressed:  hash only          fields: email → emailHash
 *   bounceRpts:  hash only          fields: email → emailHash
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  encryptPii,
  tryDecryptPii,
  computeEmailHash,
  computePhoneHash,
  encryptSupporterEmail,
  encryptSupporterName,
  encryptSupporterPhone,
  type EncryptedPii,
} from "./_pii";

// =============================================================================
// BATCH HELPERS
// =============================================================================

const BATCH_SIZE = 50;

// =============================================================================
// INTERNAL QUERIES — fetch rows needing backfill
// =============================================================================

export const getSupportersNeedingBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("supporters").order("asc").take(10_000);
    // Find rows missing encryptedName, encryptedPhone, or with empty encryptedEmail
    const needsWork = all.filter(
      (s) =>
        (s.name && !s.encryptedName) ||
        (s.phone && !s.encryptedPhone) ||
        !s.encryptedEmail || s.encryptedEmail === "",
    );
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((s) => s._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((s) => ({
        _id: s._id,
        name: s.name ?? null,
        phone: s.phone ?? null,
        encryptedName: s.encryptedName ?? null,
        encryptedPhone: s.encryptedPhone ?? null,
        phoneHash: s.phoneHash ?? null,
        encryptedEmail: s.encryptedEmail,
        email: (s as any).email ?? null,
      })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getDonationsNeedingBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("donations").order("asc").take(10_000);
    const needsWork = all.filter(
      (d) =>
        !d.encryptedEmail ||
        d.encryptedEmail === "" ||
        !d.encryptedName ||
        d.encryptedName === "",
    );
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((d) => d._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((d) => ({
        _id: d._id,
        email: d.email,
        name: d.name,
        encryptedEmail: d.encryptedEmail ?? null,
        encryptedName: d.encryptedName ?? null,
      })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getRsvpsNeedingBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("eventRsvps").order("asc").take(10_000);
    const needsWork = all.filter((r) => r.name && !r.encryptedRsvpName);
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((r) => r._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((r) => ({ _id: r._id, name: r.name })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getEmailEventsNeedingHash = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("emailEvents").order("asc").take(10_000);
    const needsWork = all.filter((e) => e.recipientEmail && !e.recipientEmailHash);
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((e) => e._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((e) => ({ _id: e._id, recipientEmail: e.recipientEmail })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getSmsNeedingBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("smsMessages").order("asc").take(10_000);
    const needsWork = all.filter((m) => m.to && !m.encryptedTo);
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((m) => m._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((m) => ({ _id: m._id, to: m.to })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getCallsNeedingBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("patchThroughCalls").order("asc").take(10_000);
    const needsWork = all.filter(
      (c) =>
        (c.callerPhone && !c.encryptedCallerPhone) ||
        (c.targetPhone && !c.encryptedTargetPhone),
    );
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((c) => c._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((c) => ({
        _id: c._id,
        callerPhone: c.callerPhone,
        targetPhone: c.targetPhone,
        encryptedCallerPhone: c.encryptedCallerPhone ?? null,
        encryptedTargetPhone: c.encryptedTargetPhone ?? null,
      })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getSuppressedNeedingHash = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("suppressedEmails").order("asc").take(10_000);
    const needsWork = all.filter((s) => s.email && !s.emailHash);
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((s) => s._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((s) => ({ _id: s._id, email: s.email })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

export const getBounceReportsNeedingHash = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("bounceReports").order("asc").take(10_000);
    const needsWork = all.filter((b) => b.email && !b.emailHash);
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((b) => b._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((b) => ({ _id: b._id, email: b.email })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

// =============================================================================
// INTERNAL MUTATION — patch encrypted fields
// =============================================================================

export const patchRow = internalMutation({
  args: {
    id: v.string(),
    patch: v.any(),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id as any, patch);
  },
});

// =============================================================================
// BACKFILL ACTIONS
// =============================================================================

/**
 * Backfill supporter name + phone encryption.
 * Idempotent: skips rows that already have encryptedName/encryptedPhone.
 */
export const backfillSupporterPii = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getSupportersNeedingBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const s of batch.items) {
        try {
          const patch: Record<string, unknown> = {};

          // Re-encrypt email if missing/empty (CSV import rows with wrong AAD)
          if (!s.encryptedEmail || s.encryptedEmail === "") {
            if (s.email) {
              const { encryptedEmail } = await encryptSupporterEmail(s.email, s._id);
              patch.encryptedEmail = encryptedEmail;
            }
          }

          // Encrypt name if missing
          if (s.name && !s.encryptedName) {
            patch.encryptedName = await encryptSupporterName(s.name, s._id);
          }

          // Encrypt phone if missing (phone may not be E.164, so hash separately)
          if (s.phone && !s.encryptedPhone) {
            const enc = await encryptPii(s.phone, "supporter:" + s._id, "phone");
            patch.encryptedPhone = JSON.stringify(enc);
            if (!s.phoneHash) {
              try {
                patch.phoneHash = await computePhoneHash(s.phone) ?? undefined;
              } catch {
                // Non-E.164 phone — encrypt succeeds but hash skipped
              }
            }
          }

          if (Object.keys(patch).length > 0) {
            // Also null out legacy plaintext fields to prevent breach recovery
            if (patch.encryptedName) patch.name = undefined;
            if (patch.encryptedPhone) patch.phone = undefined;
            if (patch.encryptedEmail) patch.email = undefined;

            await ctx.runMutation(internal.backfill.patchRow, {
              id: s._id,
              patch,
            });
            processed++;
          } else {
            skipped++;
          }

          cursor = s._id;
        } catch (err) {
          console.error(`[backfill] supporter ${s._id} failed:`, err);
          failed++;
          cursor = s._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, skipped, failed };
  },
});

/**
 * Backfill donation email + name encryption.
 */
export const backfillDonationPii = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getDonationsNeedingBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const d of batch.items) {
        try {
          const patch: Record<string, unknown> = {};

          if (d.email && (!d.encryptedEmail || d.encryptedEmail === "")) {
            const enc = await encryptPii(d.email, d._id, "email");
            patch.encryptedEmail = JSON.stringify(enc);
          }

          if (d.name && (!d.encryptedName || d.encryptedName === "")) {
            const enc = await encryptPii(d.name, d._id, "name");
            patch.encryptedName = JSON.stringify(enc);
          }

          if (Object.keys(patch).length > 0) {
            // Null out legacy plaintext
            if (patch.encryptedEmail) patch.email = undefined;
            if (patch.encryptedName) patch.name = undefined;

            await ctx.runMutation(internal.backfill.patchRow, {
              id: d._id,
              patch,
            });
            processed++;
          } else {
            skipped++;
          }

          cursor = d._id;
        } catch (err) {
          console.error(`[backfill] donation ${d._id} failed:`, err);
          failed++;
          cursor = d._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, skipped, failed };
  },
});

/**
 * Backfill event RSVP name encryption.
 */
export const backfillRsvpNames = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getRsvpsNeedingBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const r of batch.items) {
        try {
          const enc = await encryptPii(r.name, `rsvp:${r._id}`, "name");
          await ctx.runMutation(internal.backfill.patchRow, {

            id: r._id,
            patch: { encryptedRsvpName: JSON.stringify(enc) },
          });
          processed++;
          cursor = r._id;
        } catch (err) {
          console.error(`[backfill] rsvp ${r._id} failed:`, err);
          failed++;
          cursor = r._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, failed };
  },
});

/**
 * Backfill SMS message phone encryption.
 */
export const backfillSmsPhones = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getSmsNeedingBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const m of batch.items) {
        try {
          const enc = await encryptPii(m.to, `smsMsg:${m._id}`, "to");
          let toHash: string | undefined;
          try { toHash = await computePhoneHash(m.to) ?? undefined; } catch { /* non-E.164 */ }
          await ctx.runMutation(internal.backfill.patchRow, {
            id: m._id,
            patch: {
              encryptedTo: JSON.stringify(enc),
              ...(toHash ? { toHash } : {}),
            },
          });
          processed++;
          cursor = m._id;
        } catch (err) {
          console.error(`[backfill] sms ${m._id} failed:`, err);
          failed++;
          cursor = m._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, failed };
  },
});

/**
 * Backfill patch-through call phone encryption.
 */
export const backfillCallPhones = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getCallsNeedingBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const c of batch.items) {
        try {
          const patch: Record<string, unknown> = {};

          if (c.callerPhone && !c.encryptedCallerPhone) {
            const enc = await encryptPii(c.callerPhone, `call:${c._id}`, "callerPhone");
            patch.encryptedCallerPhone = JSON.stringify(enc);
            try { patch.callerPhoneHash = await computePhoneHash(c.callerPhone) ?? undefined; } catch { /* non-E.164 */ }
          }
          if (c.targetPhone && !c.encryptedTargetPhone) {
            const enc = await encryptPii(c.targetPhone, `call:${c._id}`, "targetPhone");
            patch.encryptedTargetPhone = JSON.stringify(enc);
            try { patch.targetPhoneHash = await computePhoneHash(c.targetPhone) ?? undefined; } catch { /* non-E.164 */ }
          }

          if (Object.keys(patch).length > 0) {
            await ctx.runMutation(internal.backfill.patchRow, {

              id: c._id,
              patch,
            });
            processed++;
          }
          cursor = c._id;
        } catch (err) {
          console.error(`[backfill] call ${c._id} failed:`, err);
          failed++;
          cursor = c._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, failed };
  },
});

// =============================================================================
// SUPPORTER CUSTOM FIELDS ENCRYPTION BACKFILL
// =============================================================================

export const getSupportersNeedingCustomFieldsBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("supporters").order("asc").take(10_000);
    // Find rows with plaintext customFields but no encryptedCustomFields
    const needsWork = all.filter(
      (s) => (s as any).customFields && !(s as any).encryptedCustomFields,
    );
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((s) => s._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((s) => ({
        _id: s._id,
        customFields: (s as any).customFields,
      })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

/**
 * Backfill supporter customFields encryption.
 * Reads plaintext customFields, encrypts, writes encryptedCustomFields.
 * Idempotent: skips rows that already have encryptedCustomFields.
 */
export const backfillSupporterCustomFields = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(
        internal.backfill.getSupportersNeedingCustomFieldsBackfill,
        { cursor, limit: BATCH_SIZE },
      );
      hasMore = batch.hasMore;

      for (const s of batch.items) {
        try {
          if (!s.customFields) {
            skipped++;
            cursor = s._id;
            continue;
          }

          const enc = await encryptPii(
            JSON.stringify(s.customFields),
            "supporter:" + s._id,
            "customFields",
          );
          await ctx.runMutation(internal.backfill.patchRow, {
            id: s._id,
            patch: { encryptedCustomFields: JSON.stringify(enc) },
          });
          processed++;
          cursor = s._id;
        } catch (err) {
          console.error(`[backfill] supporter customFields ${s._id} failed:`, err);
          failed++;
          cursor = s._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, skipped, failed };
  },
});

// =============================================================================
// HASH-ONLY BACKFILLS (deterministic — can run as mutations for speed)
// =============================================================================

/**
 * Backfill email event hashes. Deterministic HMAC — runs as mutation.
 */
export const backfillEmailEventHashes = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const batchSize = limit ?? 200;
    const all = await ctx.db.query("emailEvents").order("asc").take(10_000);
    const needsWork = all.filter((e) => e.recipientEmail && !e.recipientEmailHash);
    const batch = needsWork.slice(0, batchSize);

    let processed = 0;
    for (const e of batch) {
      const hash = await computeEmailHash(e.recipientEmail);
      if (hash) {
        await ctx.db.patch(e._id, { recipientEmailHash: hash });
        processed++;
      }
    }

    return { processed, remaining: needsWork.length - processed };
  },
});

/**
 * Backfill suppressed email hashes.
 */
export const backfillSuppressedHashes = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const batchSize = limit ?? 200;
    const all = await ctx.db.query("suppressedEmails").order("asc").take(10_000);
    const needsWork = all.filter((s) => s.email && !s.emailHash);
    const batch = needsWork.slice(0, batchSize);

    let processed = 0;
    for (const s of batch) {
      const hash = await computeEmailHash(s.email);
      if (hash) {
        await ctx.db.patch(s._id, { emailHash: hash });
        processed++;
      }
    }

    return { processed, remaining: needsWork.length - processed };
  },
});

/**
 * Backfill bounce report hashes.
 */
export const backfillBounceReportHashes = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const batchSize = limit ?? 200;
    const all = await ctx.db.query("bounceReports").order("asc").take(10_000);
    const needsWork = all.filter((b) => b.email && !b.emailHash);
    const batch = needsWork.slice(0, batchSize);

    let processed = 0;
    for (const b of batch) {
      const hash = await computeEmailHash(b.email);
      if (hash) {
        await ctx.db.patch(b._id, { emailHash: hash });
        processed++;
      }
    }

    return { processed, remaining: needsWork.length - processed };
  },
});

// =============================================================================
// ORG BILLING EMAIL BACKFILL
// =============================================================================

/**
 * Query orgs that have plaintext billingEmail but no encryptedBillingEmail.
 * Used during migration from plaintext to encrypted billing email.
 */
export const getOrgsNeedingBillingEmailBackfill = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const all = await ctx.db.query("organizations").order("asc").take(10_000);
    // Find orgs that still have plaintext billingEmail but no encrypted version
    const needsWork = all.filter(
      (o) => (o as any).billingEmail && !o.encryptedBillingEmail,
    );
    let start = 0;
    if (cursor) {
      const idx = needsWork.findIndex((o) => o._id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const batch = needsWork.slice(start, start + limit);
    return {
      items: batch.map((o) => ({
        _id: o._id,
        billingEmail: (o as any).billingEmail as string,
      })),
      hasMore: needsWork.length > start + limit,
    };
  },
});

/**
 * Backfill org billing email encryption.
 * Encrypts plaintext billingEmail → encryptedBillingEmail + billingEmailHash.
 * Entity ID pattern: "org:{_id}"
 * Idempotent: skips orgs that already have encryptedBillingEmail.
 */
export const backfillOrgBillingEmail = internalAction({
  args: {},
  handler: async (ctx) => {
    let processed = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await ctx.runQuery(internal.backfill.getOrgsNeedingBillingEmailBackfill, {
        cursor,
        limit: BATCH_SIZE,
      });
      hasMore = batch.hasMore;

      for (const o of batch.items) {
        try {
          const entityId = `org:${o._id}`;
          const enc = await encryptPii(o.billingEmail, entityId, "billingEmail");
          const hash = await computeEmailHash(o.billingEmail);

          await ctx.runMutation(internal.backfill.patchRow, {
            id: o._id,
            patch: {
              encryptedBillingEmail: JSON.stringify(enc),
              ...(hash ? { billingEmailHash: hash } : {}),
            },
          });
          processed++;
          cursor = o._id;
        } catch (err) {
          console.error(`[backfill] org billing email ${o._id} failed:`, err);
          failed++;
          cursor = o._id;
        }
      }

      if (batch.items.length === 0) break;
    }

    return { processed, failed };
  },
});
