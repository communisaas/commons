/**
 * Shared Convex validators reused across schema.ts, mutation args,
 * and action args. Centralized so a single source defines the shape;
 * before this file the same closed-shape recipientFilter lived as an
 * untyped `v.any()` on the row, a hand-rolled Record<string, unknown>
 * defense at every read site, and a TypeScript interface in the
 * SvelteKit compose route — three places that could drift.
 */
import { v } from "convex/values";

/**
 * Canonical recipient-filter shape for emailBlasts (and any other
 * tag/verification-scoped blast surface). Closed at the schema
 * boundary so a malformed write cannot persist a structurally
 * different filter — the failure mode the prior `v.any()` admitted
 * (e.g., tagIds: "abc" instead of ["abc"]) could widen a targeted
 * blast to the entire subscribed cohort.
 *
 * Fields:
 *   tagIds  — supporter-tag IDs to restrict the cohort to. Multiple
 *             tags are treated as a de-duplicated union of supporters.
 *   segmentIds — saved People segment IDs to restrict the cohort to.
 *             Multiple segments are treated as a de-duplicated union,
 *             then tag/verification/hash axes can narrow that cohort.
 *   verified — verification-status restriction. "any" is the no-op.
 *   includeEmailHashes — exact supporter email-hash allowlist, used by
 *             A/B cohort snapshots and other saved cohort partitions.
 *   excludeEmailHashes — exact supporter email-hash denylist.
 *
 * Any future filter axis (district, postalCode, consent) MUST be
 * added here, NOT bolted on via a separate v.any() field.
 */
export const recipientFilterValidator = v.object({
	tagIds: v.optional(v.array(v.id("tags"))),
	segmentIds: v.optional(v.array(v.id("segments"))),
	verified: v.optional(
		v.union(v.literal("any"), v.literal("verified"), v.literal("unverified"))
	),
	includeEmailHashes: v.optional(v.array(v.string())),
	excludeEmailHashes: v.optional(v.array(v.string()))
});

/**
 * SMS blast recipient filter — STRUCTURALLY DIFFERENT from
 * recipientFilterValidator above. The SMS HTTP endpoint at
 * src/routes/api/org/[slug]/sms/+server.ts:17-21 validates with a zod
 * schema using `{tags, segments, excludeTags}` (cohort-include +
 * cohort-exclude + segment-add); email uses `{tagIds, segmentIds, verified}`. The
 * two channels' UIs and dispatchers diverged in product semantics, so
 * a single validator can't represent both honestly. tags/excludeTags
 * are typed v.array(v.id('tags')) — the zod boundary accepts string
 * with length ≤ 64 (Convex Id format fits); segments is
 * v.array(v.id('segments')). When the SMS dispatcher actually wires
 * recipient routing (currently storage-only — see memory:
 * 'SMS recipient filtering TODO'), the typed Ids will pay off.
 */
export const smsRecipientFilterValidator = v.object({
	tags: v.optional(v.array(v.id("tags"))),
	segments: v.optional(v.array(v.id("segments"))),
	excludeTags: v.optional(v.array(v.id("tags")))
});

/**
 * Enum literals shared between schema fields and the arg validators of
 * the mutations that write them. Centralized so adding a new value
 * requires one edit, not three. Each tightens a v.string() that the
 * audit identified as enum-by-comment drift.
 */
export const campaignType = v.union(
	v.literal('LETTER'),
	v.literal('EVENT'),
	v.literal('FORM'),
	v.literal('FUNDRAISER'),
	// Congressional / CWC delivery campaign. Authored like a LETTER but
	// dispatched through the congressional delivery spine (House proxy / Senate
	// CWC). Tier-2 address-verified supporters DELIVER; tier-4 gov-ID actions
	// are badged higher-assurance — a tiered floor, not a hard gate.
	v.literal('CONGRESSIONAL')
);

export const campaignStatus = v.union(
	v.literal('DRAFT'),
	v.literal('ACTIVE'),
	v.literal('PAUSED'),
	v.literal('COMPLETE')
);

export const eventType = v.union(
	v.literal('IN_PERSON'),
	v.literal('VIRTUAL'),
	v.literal('HYBRID')
);

export const eventStatus = v.union(
	v.literal('DRAFT'),
	v.literal('PUBLISHED'),
	v.literal('CANCELLED'),
	v.literal('COMPLETED')
);

export const subscriptionPlan = v.union(
	v.literal('free'),
	v.literal('starter'),
	v.literal('organization'),
	v.literal('coalition')
);

export const subscriptionStatus = v.union(
	v.literal('active'),
	v.literal('past_due'),
	v.literal('canceled'),
	v.literal('trialing')
);

export const subscriptionPaymentMethod = v.union(
	v.literal('stripe'),
	v.literal('crypto')
);

export const donationStatus = v.union(
	v.literal('pending'),
	v.literal('completed'),
	v.literal('failed'),
	v.literal('refunded')
);

export const eventRsvpStatus = v.union(
	v.literal('GOING'),
	v.literal('MAYBE'),
	v.literal('NOT_GOING'),
	v.literal('WAITLISTED')
);

// emailBlasts adds 'scheduled' for the TEE-sealed delayed-send path
// (convex/blasts.ts:55, :99 — sealedOrgKey workflow). smsBlasts has no
// scheduled state today.
export const emailBlastStatus = v.union(
	v.literal('draft'),
	v.literal('scheduled'),
	v.literal('sending'),
	v.literal('sent'),
	v.literal('failed')
);

export const smsBlastStatus = v.union(
	v.literal('draft'),
	v.literal('sending'),
	v.literal('sent'),
	v.literal('failed')
);

export const smsMessageStatus = v.union(
	v.literal('queued'),
	v.literal('sent'),
	v.literal('delivered'),
	v.literal('failed')
);

export const debateStatus = v.union(
	v.literal('active'),
	v.literal('resolving'),
	v.literal('resolved'),
	v.literal('awaiting_governance'),
	v.literal('under_appeal')
);

// Mirrors the CausalityClass type at
// src/lib/server/legislation/receipts/causality.ts:12 — the canonical
// source of truth. classifyCausality at :24-28 enumerates the closed
// set explicitly; tightening here forces drift to fail at write time
// instead of silent comment-vs-code mismatch.
export const accountabilityCausalityClass = v.union(
	v.literal('strong'),
	v.literal('moderate'),
	v.literal('weak'),
	v.literal('none'),
	v.literal('pending')
);

// accountabilityReceipts.responses[].type — union derived from two
// observed value sources:
//   - convex/campaigns.ts:536 VALID_TYPES allowlist (writer): replied,
//     meeting_requested, vote_cast, public_statement
//   - convex/legislation.ts:2667-2675 reader-side checks: opened,
//     clicked_verify, replied
// External pipelines may write additional values not visible in-tree;
// if a deploy blocks on a missing value, widen this union with a
// comment explaining the source.
export const accountabilityResponseType = v.union(
	v.literal('opened'),
	v.literal('clicked_verify'),
	v.literal('replied'),
	v.literal('meeting_requested'),
	v.literal('vote_cast'),
	v.literal('public_statement')
);
