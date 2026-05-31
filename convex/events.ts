import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  eventType as eventTypeV,
  eventStatus as eventStatusV,
  eventRsvpStatus as eventRsvpStatusV,
} from "./_validators";
import { requireOrgRole } from "./_authHelpers";
import { requireInternalSecret } from "./_internalAuth";
import { computeOrgScopedEmailHash } from "./_orgHash";
import type { Doc, Id } from "./_generated/dataModel";

type InsertRsvpResult = {
  id: Id<"eventRsvps">;
  updated: boolean;
};

const getEventInternalRef = makeFunctionReference<"query">("events:getEventInternal") as unknown as FunctionReference<
  "query",
  "internal",
  { eventId: Id<"events"> },
  Doc<"events"> | null
>;
const insertRsvpRef = makeFunctionReference<"mutation">("events:insertRsvp") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    eventId: Id<"events">;
    supporterId?: Id<"supporters">;
    encryptedEmail: string;
    emailHash: string;
    encryptedRsvpName?: string;
    status: string;
    guestCount: number;
    districtHash?: string;
    engagementTier: number;
  },
  InsertRsvpResult
>;

// =============================================================================
// EVENTS — Queries, Mutations, Actions
// =============================================================================

/**
 * List events for an org.
 */
export const list = query({
  args: {
    orgSlug: v.string(),
    status: v.optional(eventStatusV),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    let q;
    if (args.status) {
      q = ctx.db
        .query("events")
        .withIndex("by_orgId_status", (qb) =>
          qb.eq("orgId", org._id).eq("status", args.status!),
        );
    } else {
      q = ctx.db
        .query("events")
        .withIndex("by_orgId", (qb) => qb.eq("orgId", org._id));
    }

    return await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 100),
      cursor: args.paginationOpts.cursor ?? null,
    });
  },
});

/**
 * Public event by ID. No auth required.
 * Returns public-safe fields only (no checkinCode).
 * Used by: src/routes/e/[id]/+page.server.ts
 */
export const getPublic = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status === "DRAFT") return null;

    // Resolve org name/slug for display
    const org = await ctx.db.get(event.orgId);

    return {
      _id: event._id,
      orgId: event.orgId,
      title: event.title,
      description: event.description ?? null,
      eventType: event.eventType,
      startAt: event.startAt,
      endAt: event.endAt ?? null,
      timezone: event.timezone,
      venue: event.venue ?? null,
      address: event.address ?? null,
      city: event.city ?? null,
      state: event.state ?? null,
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      virtualUrl: event.virtualUrl ?? null,
      capacity: event.capacity ?? null,
      // Public counters K-floor at 5 (null below 5, exact above). Sub-K
      // cohort sizes would name a specific attendee; above K, attendance is
      // intentionally public — events advertise turnout.
      rsvpCount: event.rsvpCount < 5 ? null : event.rsvpCount,
      attendeeCount: event.attendeeCount < 5 ? null : event.attendeeCount,
      verifiedAttendees: event.verifiedAttendees < 5 ? null : event.verifiedAttendees,
      status: event.status,
      requireVerification: event.requireVerification,
      waitlistEnabled: event.waitlistEnabled,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      orgAvatar: org?.avatar ?? null,
    };
  },
});

/**
 * Get a single event by ID.
 */
export const get = query({
  args: {
    orgSlug: v.string(),
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");
    const event = await ctx.db.get(args.eventId);
    if (!event || event.orgId !== org._id) return null;
    return event;
  },
});

/**
 * Get RSVPs for an event.
 */
export const getRsvps = query({
  args: {
    orgSlug: v.string(),
    eventId: v.id("events"),
    // Filter on RSVP status (GOING/MAYBE/...), NOT event status —
    // earlier C12 sweep confused the two; query is `eventRsvps.by_eventId_status`.
    status: v.optional(eventRsvpStatusV),
    // When true, include walk-in sentinel rows (status="GOING" +
    // walkIn=true + encryptedEmail=""). Default false — staffer-facing
    // roster queries get only real RSVPs. The attendance/walk-in
    // surface is exposed separately so consumers don't crash on the
    // empty encrypted blob during client-side decrypt.
    includeWalkIns: v.optional(v.boolean()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify event belongs to this org — prevents cross-tenant RSVP leakage
    const event = await ctx.db.get(args.eventId);
    if (!event || event.orgId !== org._id) throw new Error("Event not found in this organization");

    let q;
    if (args.status) {
      q = ctx.db
        .query("eventRsvps")
        .withIndex("by_eventId_status", (qb) =>
          qb.eq("eventId", args.eventId).eq("status", args.status!),
        );
    } else {
      q = ctx.db
        .query("eventRsvps")
        .withIndex("by_eventId", (qb) => qb.eq("eventId", args.eventId));
    }

    const results = await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 100),
      cursor: args.paginationOpts.cursor ?? null,
    });

    // Filter out walk-in sentinels by default. Their encryptedEmail is
    // the empty string, which the staffer-facing roster cannot decrypt;
    // showing them would either crash the client or render a row with
    // "[encrypted]" + empty name. Operators viewing walk-in attendance
    // get it from a dedicated surface (or by passing includeWalkIns).
    if (!args.includeWalkIns) {
      return {
        ...results,
        page: results.page.filter((r) => !r.walkIn),
      };
    }
    return results;
  },
});

/**
 * Create an event.
 */
export const create = mutation({
  args: {
    orgSlug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    eventType: v.optional(eventTypeV),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    venue: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    virtualUrl: v.optional(v.string()),
    capacity: v.optional(v.number()),
    waitlistEnabled: v.optional(v.boolean()),
    requireVerification: v.optional(v.boolean()),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    if (!args.title || args.title.trim().length < 3) {
      throw new Error("Title is required (minimum 3 characters)");
    }

    if (args.startAt <= Date.now()) {
      throw new Error("Start date must be in the future");
    }

    const VALID_EVENT_TYPES = ["IN_PERSON", "VIRTUAL", "HYBRID"];
    if (args.eventType && !VALID_EVENT_TYPES.includes(args.eventType)) {
      throw new Error("Event type must be one of: IN_PERSON, VIRTUAL, HYBRID");
    }

    if (args.endAt && args.endAt <= args.startAt) {
      throw new Error("End date must be after start date");
    }

    // Generate check-in code (8 chars)
    const checkinCode = crypto.randomUUID().slice(0, 8);

    const id = await ctx.db.insert("events", {
      orgId: org._id,
      campaignId: args.campaignId,
      title: args.title.trim(),
      description: args.description?.trim(),
      eventType: args.eventType || "IN_PERSON",
      startAt: args.startAt,
      endAt: args.endAt,
      timezone: args.timezone || "America/New_York",
      venue: args.venue?.trim(),
      address: args.address?.trim(),
      city: args.city?.trim(),
      state: args.state?.trim(),
      postalCode: args.postalCode?.trim(),
      latitude: args.latitude,
      longitude: args.longitude,
      virtualUrl: args.virtualUrl?.trim(),
      capacity: args.capacity,
      waitlistEnabled: args.waitlistEnabled ?? false,
      rsvpCount: 0,
      attendeeCount: 0,
      verifiedAttendees: 0,
      checkinCode,
      requireVerification: args.requireVerification ?? false,
      status: "DRAFT",
      updatedAt: Date.now(),
    });

    return { id, checkinCode };
  },
});

/**
 * Update an event.
 */
export const update = mutation({
  args: {
    orgSlug: v.string(),
    eventId: v.id("events"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    eventType: v.optional(eventTypeV),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    venue: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    virtualUrl: v.optional(v.string()),
    capacity: v.optional(v.number()),
    waitlistEnabled: v.optional(v.boolean()),
    requireVerification: v.optional(v.boolean()),
    status: v.optional(eventStatusV),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const event = await ctx.db.get(args.eventId);
    if (!event || event.orgId !== org._id) {
      throw new Error("Event not found");
    }

    if (event.status === "COMPLETED") {
      throw new Error("Cannot update a completed event");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      if (args.title.trim().length < 3) throw new Error("Title must be at least 3 characters");
      patch.title = args.title.trim();
    }
    if (args.description !== undefined) patch.description = args.description?.trim() || undefined;
    if (args.eventType !== undefined) {
      const VALID = ["IN_PERSON", "VIRTUAL", "HYBRID"];
      if (!VALID.includes(args.eventType)) throw new Error("Invalid event type");
      patch.eventType = args.eventType;
    }
    if (args.startAt !== undefined) patch.startAt = args.startAt;
    if (args.endAt !== undefined) patch.endAt = args.endAt;
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.venue !== undefined) patch.venue = args.venue?.trim() || undefined;
    if (args.address !== undefined) patch.address = args.address?.trim() || undefined;
    if (args.city !== undefined) patch.city = args.city?.trim() || undefined;
    if (args.state !== undefined) patch.state = args.state?.trim() || undefined;
    if (args.postalCode !== undefined) patch.postalCode = args.postalCode?.trim() || undefined;
    if (args.latitude !== undefined) patch.latitude = args.latitude;
    if (args.longitude !== undefined) patch.longitude = args.longitude;
    if (args.virtualUrl !== undefined) patch.virtualUrl = args.virtualUrl?.trim() || undefined;
    if (args.capacity !== undefined) patch.capacity = args.capacity;
    if (args.waitlistEnabled !== undefined) patch.waitlistEnabled = args.waitlistEnabled;
    if (args.requireVerification !== undefined) patch.requireVerification = args.requireVerification;
    if (args.campaignId !== undefined) patch.campaignId = args.campaignId;
    if (args.status !== undefined) {
      const VALID_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"];
      if (!VALID_STATUSES.includes(args.status)) throw new Error("Invalid status");
      patch.status = args.status;
    }

    await ctx.db.patch(args.eventId, patch);
  },
});

/**
 * Internal mutation: Insert RSVP with pre-encrypted PII.
 */
export const insertRsvp = internalMutation({
  args: {
    eventId: v.id("events"),
    supporterId: v.optional(v.id("supporters")),
    encryptedEmail: v.string(),
    emailHash: v.string(),
    encryptedRsvpName: v.optional(v.string()),
    status: eventRsvpStatusV,
    guestCount: v.number(),
    districtHash: v.optional(v.string()),
    engagementTier: v.number(),
  },
  handler: async (ctx, args) => {
    // Check for existing RSVP by email hash
    const existing = await ctx.db
      .query("eventRsvps")
      .withIndex("by_eventId_emailHash", (q) =>
        q.eq("eventId", args.eventId).eq("emailHash", args.emailHash),
      )
      .first();

    if (existing) {
      // Update existing RSVP
      await ctx.db.patch(existing._id, {
        status: args.status,
        guestCount: args.guestCount,
        updatedAt: Date.now(),
      });
      return { id: existing._id, updated: true };
    }

    // Re-read the event inside this mutation and gate capacity here, not
    // only in the calling action. Convex mutations are serializable with
    // OCC — concurrent mutations that touch the same row have their
    // read-write set conflict-detected at commit, so a fresh
    // `event.rsvpCount` read followed by a conditional increment is
    // atomic against other RSVP writers. The action-level check at
    // `createRsvp` runs outside this transaction and reads a stale row
    // under contention — two concurrent RSVPs could both see
    // `rsvpCount < capacity` there and both attempt this mutation. The
    // gate here is the only one that holds under load. Waitlist-enabled
    // events skip the throw because overflow is allowed (the action
    // ought to stamp `WAITLISTED`). NB: the action at line 582 does
    // NOT actually auto-stamp WAITLISTED — it forwards args.status ||
    // "GOING". WAITLISTED is reachable only when a caller passes it
    // explicitly. The auto-promotion-on-overflow product feature is
    // tracked but not yet implemented.
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");
    if (
      event.capacity &&
      event.rsvpCount >= event.capacity &&
      !event.waitlistEnabled
    ) {
      // Match the action-level error string so the SvelteKit
      // endpoint's translator at `/api/e/[id]/rsvp:91` (substring
      // match `'at capacity'`) routes to the same 400 response.
      throw new Error("Event is at capacity");
    }

    // Insert new RSVP
    const id = await ctx.db.insert("eventRsvps", {
      eventId: args.eventId,
      supporterId: args.supporterId,
      encryptedEmail: args.encryptedEmail,
      emailHash: args.emailHash,
      encryptedRsvpName: args.encryptedRsvpName,
      status: args.status,
      guestCount: args.guestCount,
      districtHash: args.districtHash,
      engagementTier: args.engagementTier,
      updatedAt: Date.now(),
      checkedInAt: undefined,
      attendanceVerified: undefined,
      attendanceVerificationMethod: undefined,
      attendanceIdentityCommitment: undefined,
      attendanceDistrictHash: undefined,
    });

    // Increment event RSVP counter using the just-fetched event row
    // (already loaded above for the capacity check).
    await ctx.db.patch(args.eventId, {
      rsvpCount: event.rsvpCount + 1,
    });

    return { id, updated: false };
  },
});

/**
 * Internal query: get event by ID (for action-side validation).
 */
export const getEventInternal = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.eventId);
  },
});

/**
 * Public-API wrapper for `getEventInternal`. SvelteKit `/api/e/[id]/checkin`
 * calls this via the HTTP API; the internal version stays in place for the
 * in-Convex action caller at line 514 which already holds full trust.
 */
export const getEventInternalForCaller = query({
  args: { _secret: v.string(), eventId: v.id("events") },
  handler: async (ctx, { _secret, eventId }): Promise<Doc<"events"> | null> => {
    requireInternalSecret(_secret);
    return await ctx.runQuery(internal.events.getEventInternal, { eventId });
  },
});

/**
 * Internal mutation: patch RSVP with encrypted email after insert.
 */
export const patchRsvpEmail = internalMutation({
  args: {
    rsvpId: v.id("eventRsvps"),
    encryptedEmail: v.string(),
    encryptedRsvpName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      encryptedEmail: args.encryptedEmail,
    };
    if (args.encryptedRsvpName !== undefined) {
      patch.encryptedRsvpName = args.encryptedRsvpName;
    }
    await ctx.db.patch(args.rsvpId, patch);
  },
});

/**
 * Action: Create RSVP (encrypts email then calls internalMutation).
 * Encryption requires random IV — must run in an action, not mutation.
 */
export const createRsvp = action({
  args: {
    eventId: v.id("events"),
    email: v.string(),
    name: v.string(),
    // RSVP status, NOT event status — same mis-mapping as getRsvps.
    status: v.optional(eventRsvpStatusV),
    guestCount: v.optional(v.number()),
    districtHash: v.optional(v.string()),
    engagementTier: v.optional(v.number()),
    supporterId: v.optional(v.id("supporters")),
  },
  handler: async (ctx, args): Promise<InsertRsvpResult> => {
    // Action-boundary length caps. The SvelteKit `/api/e/[id]/rsvp`
    // route enforces these too, but Convex actions are directly
    // callable from any authenticated client.
    if (args.email.length > 254) throw new Error("EMAIL_TOO_LARGE");
    if (args.name.length > 200) throw new Error("NAME_TOO_LARGE");
    // Pin to the documented schema enum so a griefer can't submit
    // `status='JUNK'` rows that still bump `event.rsvpCount` — a
    // capped event would fill with unrecognized values that the
    // analytics status-filter would skip, yielding an empty-event
    // illusion.
    const ALLOWED_RSVP_STATUSES = ["GOING", "MAYBE", "NOT_GOING", "WAITLISTED"] as const;
    if (args.status !== undefined) {
      if (args.status.length > 16) throw new Error("STATUS_TOO_LARGE");
      if (!ALLOWED_RSVP_STATUSES.includes(args.status as typeof ALLOWED_RSVP_STATUSES[number])) {
        throw new Error("INVALID_RSVP_STATUS");
      }
    }
    if (args.districtHash !== undefined && args.districtHash.length > 128) {
      throw new Error("DISTRICT_HASH_TOO_LARGE");
    }

    // Verify event exists and is accepting RSVPs
    const event = await ctx.runQuery(getEventInternalRef, { eventId: args.eventId });
    if (!event) throw new Error("Event not found");
    if (event.status !== "PUBLISHED") throw new Error("Event is not accepting RSVPs");
    if (event.capacity && event.rsvpCount >= event.capacity && !event.waitlistEnabled) {
      throw new Error("Event is at capacity");
    }

    // Org-scoped email hash for dedup — no server-held key
    const orgId = String(event.orgId);
    const emailHash = await computeOrgScopedEmailHash(orgId, args.email);

    // Rate limit per email+event (use org-scoped hash prefix, no plaintext in stored keys)
    const rlKey = `events.createRsvp:${args.eventId}:${emailHash.slice(0, 16)}`;
    const rl = await ctx.runMutation(internal._rateLimit.check, {
      key: rlKey,
      windowMs: 60_000,
      maxRequests: 10,
    });
    if (!rl.allowed) throw new Error("Rate limit exceeded — please try again shortly");

    // Encrypt RSVP PII with org key
    const { getOrgKeyForAction } = await import("./_orgKeyUnseal");
    const { encryptWithOrgKey } = await import("./_orgKey");

    const orgKey = await getOrgKeyForAction(ctx, orgId);
    if (!orgKey) {
      throw new Error("Organization encryption not configured. An org owner must set up encryption before accepting RSVPs.");
    }

    const encEmail = await encryptWithOrgKey(args.email.trim().toLowerCase(), orgKey, `rsvp:${emailHash}`, "email");
    const encryptedEmail = JSON.stringify(encEmail);
    let encryptedRsvpName: string | undefined;
    if (args.name.trim()) {
      const encName = await encryptWithOrgKey(args.name.trim(), orgKey, `rsvp:${emailHash}`, "name");
      encryptedRsvpName = JSON.stringify(encName);
    }

    const result = await ctx.runMutation(insertRsvpRef, {
      eventId: args.eventId,
      supporterId: args.supporterId,
      encryptedEmail,
      emailHash,
      encryptedRsvpName,
      status: args.status || "GOING",
      guestCount: args.guestCount ?? 1,
      districtHash: args.districtHash,
      engagementTier: args.engagementTier ?? 0,
    });

    // Emit event.rsvp_created (T9-3). No PII in payload. Use event.orgId
    // (the Id-typed value) rather than the String()-coerced local orgId.
    await ctx.runMutation(internal.orgWebhooks.queueEvent, {
      orgId: event.orgId,
      event: "event.rsvp_created",
      payload: JSON.stringify({
        eventId: args.eventId,
        rsvpId: (result as { rsvpId?: string } | null)?.rsvpId ?? null,
        status: args.status || "GOING",
        guestCount: args.guestCount ?? 1,
        engagementTier: args.engagementTier ?? 0,
        timestamp: Date.now(),
      }),
    });

    return result;
  },
});

/**
 * Check in an attendee at an event.
 */
export const checkIn = mutation({
  args: {
    orgSlug: v.string(),
    eventId: v.id("events"),
    rsvpId: v.id("eventRsvps"),
    verificationMethod: v.optional(v.string()),
    identityCommitment: v.optional(v.string()),
    districtHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const event = await ctx.db.get(args.eventId);
    if (!event || event.orgId !== org._id) {
      throw new Error("Event not found");
    }

    const rsvp = await ctx.db.get(args.rsvpId);
    if (!rsvp || rsvp.eventId !== args.eventId) {
      throw new Error("RSVP not found");
    }

    if (rsvp.checkedInAt) {
      throw new Error("Already checked in");
    }

    const verified = Boolean(args.verificationMethod && args.identityCommitment);

    await ctx.db.patch(args.rsvpId, {
      checkedInAt: Date.now(),
      attendanceVerified: verified,
      attendanceVerificationMethod: args.verificationMethod,
      attendanceIdentityCommitment: args.identityCommitment,
      attendanceDistrictHash: args.districtHash,
      updatedAt: Date.now(),
    });

    // Update event counters
    const patch: Record<string, unknown> = {
      attendeeCount: event.attendeeCount + 1,
    };
    if (verified) {
      patch.verifiedAttendees = event.verifiedAttendees + 1;
    }
    await ctx.db.patch(args.eventId, patch);
  },
});

/**
 * Public check-in (no org auth required — used by the unauthenticated checkin route).
 * Finds RSVP by email hash, creates attendance record, increments counters.
 */
export const publicCheckIn = mutation({
  args: {
    eventId: v.id("events"),
    // Optional checkin code. The mutation derives `verifiedTrust`
    // server-side via constant-time compare against `event.checkinCode`;
    // caller-supplied `args.verified` is ignored unless the code
    // matches. Without this gate, anyone with an eventId could call
    // this mutation directly and inflate `verifiedAttendees`. Walk-ins
    // (no code) are still allowed but cannot earn verified-attendance
    // credit.
    checkinCode: v.optional(v.string()),
    // Required. The SvelteKit `/api/e/[id]/checkin` route requires
    // `email` and computes the org-scoped hash server-side, so making
    // this required has no client-facing impact; it closes the
    // direct-Convex-call inflation path where a missing emailHash
    // would skip the `by_eventId_emailHash` dedup branch and let a
    // repeated call inflate `event.attendeeCount` against any
    // non-`requireVerification` event.
    emailHash: v.string(),
    verified: v.boolean(),
    verificationMethod: v.optional(v.string()),
    identityCommitment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.emailHash || args.emailHash.length === 0 || args.emailHash.length > 128) {
      throw new Error("EMAIL_HASH_INVALID");
    }
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    // Derive verifiedTrust server-side from checkinCode equality.
    // Constant-time compare avoids leaking length/position via wall-
    // clock timing on a public endpoint. Caller-supplied `args.verified`
    // is ignored unless the code matches — the arg stays in the
    // signature for SvelteKit-side compatibility but is overwritten
    // server-side regardless.
    let codeMatched = false;
    if (event.checkinCode && args.checkinCode && args.checkinCode.length === event.checkinCode.length) {
      let mismatch = 0;
      for (let i = 0; i < args.checkinCode.length; i++) {
        mismatch |= args.checkinCode.charCodeAt(i) ^ event.checkinCode.charCodeAt(i);
      }
      codeMatched = mismatch === 0;
    }
    // If the event requires verification, refuse the check-in entirely
    // without a valid code (matches the SvelteKit endpoint contract).
    if (event.requireVerification && !codeMatched) {
      throw new Error("EVENT_CHECKIN_CODE_REQUIRED");
    }
    const verifiedTrust = codeMatched;

    // Find RSVP by email hash. The hash is now required (see args
    // validator above), so we always have a stable identifier and can
    // always dedup before incrementing the counter.
    const rsvp = await ctx.db
      .query("eventRsvps")
      .withIndex("by_eventId_emailHash", (idx) =>
        idx.eq("eventId", args.eventId).eq("emailHash", args.emailHash)
      )
      .first();

    // Dedup against the existing RSVP row if it's already been
    // checked in. Whether the RSVP was created by `createRsvp` (real
    // RSVP) or by an earlier walk-in branch of this same mutation
    // (sentinel RSVP, see insert below), the `checkedInAt` flag is
    // the canonical "already counted" signal.
    if (rsvp?.checkedInAt) {
      return {
        attendeeCount: event.attendeeCount,
        alreadyCheckedIn: true,
      };
    }

    // Mark RSVP as checked in. Use the server-derived `verifiedTrust`,
    // not the caller-supplied `args.verified` — a malicious direct
    // Convex caller cannot earn verification credit without proving
    // the checkinCode.
    if (rsvp) {
      await ctx.db.patch(rsvp._id, {
        checkedInAt: Date.now(),
        attendanceVerified: verifiedTrust,
        attendanceVerificationMethod: verifiedTrust
          ? args.verificationMethod
          : undefined,
        attendanceIdentityCommitment: verifiedTrust
          ? args.identityCommitment
          : undefined,
        updatedAt: Date.now(),
      });
    } else {
      // Walk-in dedup: no prior RSVP for this emailHash, but the
      // counter must only tick once per identity. Insert a sentinel
      // RSVP — `encryptedEmail: ""` (the walk-in didn't supply one),
      // `checkedInAt` set, `walkIn: true` so the RSVP roster query
      // (`getRsvps`) can filter these out (attendance-dedup rows, not
      // real RSVPs). Subsequent calls with the same emailHash hit the
      // dedup branch above. Without this insert, direct Convex
      // callers could inflate `attendeeCount` indefinitely against
      // any non-`requireVerification` event.
      await ctx.db.insert("eventRsvps", {
        eventId: args.eventId,
        encryptedEmail: "",
        emailHash: args.emailHash,
        status: "GOING",
        guestCount: 1,
        engagementTier: 0,
        walkIn: true,
        checkedInAt: Date.now(),
        attendanceVerified: verifiedTrust,
        attendanceVerificationMethod: verifiedTrust
          ? args.verificationMethod
          : undefined,
        attendanceIdentityCommitment: verifiedTrust
          ? args.identityCommitment
          : undefined,
        updatedAt: Date.now(),
      });
      // Post-insert sanity check: Convex serializable OCC over the
      // empty `by_eventId_emailHash` range read at the top of this
      // handler SHOULD detect any concurrent walk-in insert on the
      // same emailHash and retry one of them so it falls into the
      // dedup branch — but the guarantee has no test, so this read-
      // back is a forensic safety net. We don't try to repair
      // (deleting "ours" when "theirs" already won is a different
      // race); the error log makes the divergence visible.
      const sanity = await ctx.db
        .query("eventRsvps")
        .withIndex("by_eventId_emailHash", (idx) =>
          idx.eq("eventId", args.eventId).eq("emailHash", args.emailHash),
        )
        .collect();
      if (sanity.length > 1) {
        console.error(
          `[publicCheckIn] OCC INVARIANT VIOLATED: ${sanity.length} eventRsvps rows share eventId+emailHash after walk-in insert. attendeeCount may double-count.`,
        );
      }
    }

    // Increment event counters. `verifiedAttendees` only ticks on a
    // server-verified code match — caller-supplied flag is ignored.
    const newCount = (event.attendeeCount ?? 0) + 1;
    const countPatch: Record<string, unknown> = {
      attendeeCount: newCount,
    };
    if (verifiedTrust) {
      countPatch.verifiedAttendees = (event.verifiedAttendees ?? 0) + 1;
    }
    await ctx.db.patch(args.eventId, countPatch);

    return {
      attendeeCount: newCount,
      alreadyCheckedIn: false,
    };
  },
});
