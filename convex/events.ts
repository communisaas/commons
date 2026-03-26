import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { encryptPii, computeEmailHash } from "./_pii";

// =============================================================================
// EVENTS — Queries, Mutations, Actions
// =============================================================================

/**
 * List events for an org.
 */
export const list = query({
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
      rsvpCount: event.rsvpCount,
      attendeeCount: event.attendeeCount,
      verifiedAttendees: event.verifiedAttendees,
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
    status: v.optional(v.string()),
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

    return await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 100),
      cursor: args.paginationOpts.cursor ?? null,
    });
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
    eventType: v.optional(v.string()),
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
    eventType: v.optional(v.string()),
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
    status: v.optional(v.string()),
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
    name: v.string(),
    status: v.string(),
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

    // Insert new RSVP
    const id = await ctx.db.insert("eventRsvps", {
      eventId: args.eventId,
      supporterId: args.supporterId,
      encryptedEmail: args.encryptedEmail,
      emailHash: args.emailHash,
      name: args.name,
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

    // Increment event RSVP counter
    const event = await ctx.db.get(args.eventId);
    if (event) {
      await ctx.db.patch(args.eventId, {
        rsvpCount: event.rsvpCount + 1,
      });
    }

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
 * Internal mutation: patch RSVP with encrypted email after insert.
 */
export const patchRsvpEmail = internalMutation({
  args: {
    rsvpId: v.id("eventRsvps"),
    encryptedEmail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.rsvpId, {
      encryptedEmail: args.encryptedEmail,
    });
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
    status: v.optional(v.string()),
    guestCount: v.optional(v.number()),
    districtHash: v.optional(v.string()),
    engagementTier: v.optional(v.number()),
    supporterId: v.optional(v.id("supporters")),
  },
  handler: async (ctx, args) => {
    // Rate limit: 10 RSVPs per minute per event (spam prevention)
    // Rate limit per email+event (not shared across all users)
    const rlKey = `events.createRsvp:${args.eventId}:${args.email?.slice(0, 10) ?? 'anon'}`;
    const rl = await ctx.runMutation(internal._rateLimit.check, {
      key: rlKey,
      windowMs: 60_000,
      maxRequests: 10,
    });
    if (!rl.allowed) throw new Error("Rate limit exceeded — please try again shortly");

    // Verify event exists and is accepting RSVPs
    const event = await ctx.runQuery(internal.events.getEventInternal, { eventId: args.eventId });
    if (!event) throw new Error("Event not found");
    if (event.status !== "PUBLISHED") throw new Error("Event is not accepting RSVPs");
    if (event.capacity && event.rsvpCount >= event.capacity && !event.waitlistEnabled) {
      throw new Error("Event is at capacity");
    }

    // Compute email hash first
    const emailHash = await computeEmailHash(args.email.toLowerCase());
    if (!emailHash) {
      console.error("[events.createRsvp] EMAIL_LOOKUP_KEY not configured");
      throw new Error("Encryption service not available");
    }

    // Insert with placeholder, encrypt with real _id, then patch (same pattern as supporters)
    const result = await ctx.runMutation(internal.events.insertRsvp, {
      eventId: args.eventId,
      supporterId: args.supporterId,
      encryptedEmail: "",  // placeholder — patched below
      emailHash,
      name: args.name.trim(),
      status: args.status || "GOING",
      guestCount: args.guestCount ?? 1,
      districtHash: args.districtHash,
      engagementTier: args.engagementTier ?? 0,
    });

    // Now encrypt with the real Convex _id as key context
    const encrypted = await encryptPii(args.email.toLowerCase(), `rsvp:${result.id}`, "email");
    await ctx.runMutation(internal.events.patchRsvpEmail, {
      rsvpId: result.id,
      encryptedEmail: JSON.stringify(encrypted),
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
    emailHash: v.optional(v.string()),
    verified: v.boolean(),
    verificationMethod: v.optional(v.string()),
    identityCommitment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    // Find RSVP by email hash (optional — walk-ins allowed)
    let rsvp = null;
    if (args.emailHash) {
      rsvp = await ctx.db
        .query("eventRsvps")
        .withIndex("by_eventId_emailHash", (idx) =>
          idx.eq("eventId", args.eventId).eq("emailHash", args.emailHash!)
        )
        .first();
    }

    // Dedup: if this RSVP already checked in, return early
    if (rsvp?.checkedInAt) {
      return {
        attendeeCount: event.attendeeCount,
        alreadyCheckedIn: true,
      };
    }

    // Mark RSVP as checked in (if found)
    if (rsvp) {
      await ctx.db.patch(rsvp._id, {
        checkedInAt: Date.now(),
        attendanceVerified: args.verified,
        attendanceVerificationMethod: args.verificationMethod,
        attendanceIdentityCommitment: args.identityCommitment,
        updatedAt: Date.now(),
      });
    }

    // Increment event counters
    const newCount = (event.attendeeCount ?? 0) + 1;
    const countPatch: Record<string, unknown> = {
      attendeeCount: newCount,
    };
    if (args.verified) {
      countPatch.verifiedAttendees = (event.verifiedAttendees ?? 0) + 1;
    }
    await ctx.db.patch(args.eventId, countPatch);

    return {
      attendeeCount: newCount,
      alreadyCheckedIn: false,
    };
  },
});
